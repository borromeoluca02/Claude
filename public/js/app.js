/* app.js — controller: stato, eventi, azioni, salvataggi. */

import * as G from './geometry.js';
import {
  createProject, normalizeProject, makeArea, makeStructure, makeElement,
  DEFAULT_RULES, DEFAULT_START_GATE, DEFAULT_START_RAMP, libraryItem,
} from './model.js';
import { rulePreset, categoryInfo, ROLLER } from './regulation.js';
import { analyze, validStationRanges, extendTo, bakeTrack, projectPoint } from './track.js';
import { generateCandidates, autoPlaceStructures } from './generator.js';
import { render, fitView, toScreen, fmtM, fmt } from './render.js';
import { attachInteractions } from './interact.js';
import { panelHTML, tabsHTML, statusHTML, getPath, setPath } from './ui.js';
import * as store from './store.js';
import { buildPlateSet } from './plate.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const stage = $('#stage');
const panel = $('#panel');
const panelBody = $('#panelBody');
const tabsEl = $('#tabs');
const statusEl = $('#status');
const hintBar = $('#hintBar');
const toastEl = $('#toast');
const nameInput = $('#prjName');

/* ------------------------------------------------------------------ stato */

const state = {
  project: null,
  analysis: null,
  view: { scale: 10, cx: 0, cy: 0 },
  W: 800, H: 600,
  tab: 'track',
  mode: 'select',        // 'select' | 'area'
  tool: null,            // null | 'draw' | 'add:<key>'
  selection: null,
  snap: true,
  showLabels: true,
  drawRadius: 8,
  candidates: [],
  candidateIndex: -1,
  generating: false,
  user: null,
  firebaseConfig: null,
  localProjects: [],
  cloudProjects: [],
};

/* Progetto dimostrativo: serpentina di 275 m in un'area trapezoidale,
   conforme a tutti i controlli del Regolamento Tecnico FISR 2025-2026. */
function demoProject() {
  const p = createProject({ name: 'Percorso di esempio', area: makeArea('trapezoid', { b1: 110, b2: 80, h: 72 }) });
  p.track.start = { x: 23.5, y: 68, heading: 0 };
  p.track.defaultWidth = 5;
  const S = (length) => makeElement('straight', { length, widthStart: 5, widthEnd: 5 });
  const A = (dir) => makeElement('arc', { radius: 5, angle: 180, dir, widthStart: 5, widthEnd: 5 });
  p.track.elements = [
    S(37.39), A('right'), S(40.06), A('left'), S(42.43),
    A('right'), S(44.81), A('left'), S(47.48),
  ];
  p.structures = [
    ['tunnel', 22.2], ['dosso', 62.81], ['sottopasso', 73.13], ['saltosecco', 83.44],
    ['banktobank', 119.35], ['saltosecco', 130.08], ['dritta200', 140.81],
    ['sottopasso', 176.21], ['gimkana', 189.41], ['saltotriplo', 246.26],
  ].map(([key, station]) => makeStructure(key, station, { category: p.category }));
  p.genParams.width = 5;
  return p;
}

/* ----------------------------------------------------------- rendering */

let rafPending = false;
function paint() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    canvas.innerHTML = render(state);
  });
}
function paintPanel() {
  const top = panelBody.scrollTop;
  tabsEl.innerHTML = tabsHTML(state);
  panelBody.innerHTML = panelHTML(state);
  panelBody.scrollTop = top;
  paintHint();
  syncToolButtons();
}
function paintStatus() { statusEl.innerHTML = statusHTML(state); }
function paintHint() {
  let msg = '';
  if (state.tool === 'draw') msg = '✏️ Tocca la mappa dove vuoi far passare il percorso.';
  else if (state.tool && state.tool.startsWith('add:')) msg = `Tocca la mappa per posizionare «${libraryItem(state.tool.slice(4)).name}».`;
  else if (state.mode === 'area') msg = '◇ Trascina i vertici per modificare l\'area.';
  if (msg) {
    hintBar.hidden = false;
    hintBar.innerHTML = `<span>${msg}</span> <button class="btn mini" data-act="tool:none" style="margin-left:8px">Esci</button>`;
  } else hintBar.hidden = true;
}
function syncToolButtons() {
  document.querySelectorAll('.ft').forEach((b) => {
    const act = b.getAttribute('data-act');
    const on = (act === 'tool:draw' && state.tool === 'draw')
      || (act === 'area.toggleEdit' && state.mode === 'area')
      || (act === 'labels.toggle' && state.showLabels)
      || (act === 'snap.toggle' && state.snap);
    b.classList.toggle('on', !!on);
  });
  document.querySelectorAll('#discSeg .segb').forEach((b) => {
    b.classList.toggle('on', b.getAttribute('data-act') === 'discipline:' + state.project.discipline);
  });
}

function reanalyze() { state.analysis = analyze(state.project); }

/* modifica in corso (trascinamento): aggiorna solo la mappa */
function live() { reanalyze(); paint(); paintStatus(); }

/* modifica conclusa: cronologia, pannello, salvataggio automatico */
function commit() {
  reanalyze();
  pushHist();
  paint(); paintPanel(); paintStatus();
  scheduleAutosave();
}

/* ------------------------------------------------------------ cronologia */

let hist = [], hi = -1;
function pushHist() {
  const snap = JSON.stringify(state.project);
  if (hi >= 0 && hist[hi] === snap) return;
  hist = hist.slice(0, hi + 1);
  hist.push(snap);
  if (hist.length > 60) hist.shift();
  hi = hist.length - 1;
}
function undo() {
  if (hi <= 0) return toast('Niente da annullare');
  hi--; state.project = JSON.parse(hist[hi]);
  reanalyze(); paint(); paintPanel(); paintStatus(); scheduleAutosave();
}
function redo() {
  if (hi >= hist.length - 1) return toast('Niente da ripetere');
  hi++; state.project = JSON.parse(hist[hi]);
  reanalyze(); paint(); paintPanel(); paintStatus(); scheduleAutosave();
}

let asTimer = null;
function scheduleAutosave() {
  clearTimeout(asTimer);
  asTimer = setTimeout(() => store.autosave(state.project), 700);
}

let toastTimer = null;
function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.toggle('bad', !!bad);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

/* --------------------------------------------------------------- utilità */

function selectedElement() {
  if (!state.selection || state.selection.kind !== 'element') return null;
  return state.project.track.elements.find((e) => e.id === state.selection.id) || null;
}
function elIndex(id) { return state.project.track.elements.findIndex((e) => e.id === id); }
function stIndex(id) { return state.project.structures.findIndex((s) => s.id === id); }

function centerOn(point) {
  state.view.cx = point.x; state.view.cy = point.y;
  paint();
}
function focusTarget(id) {
  const st = state.project.structures.find((s) => s.id === id);
  if (st) {
    state.selection = { kind: 'structure', id };
    state.tab = 'structures';
    centerOn(projectFramePoint(st));
    paintPanel();
    return;
  }
  const el = state.analysis.baked.elements.find((e) => e.id === id);
  if (el) {
    state.selection = { kind: 'element', id };
    state.tab = 'track';
    centerOn(el.startPoint);
    paintPanel();
  }
}
function projectFramePoint(st) {
  const baked = state.analysis.baked;
  if (st.mode === 'free') return { x: st.x, y: st.y };
  return G.polylineAt(baked.samples, st.station).point;
}

function fit() {
  state.view = fitView(state.project, state.W, state.H, 70);
  paint();
}

function afterProjectLoad(doFit = true) {
  nameInput.value = state.project.name || '';
  state.selection = null; state.candidates = []; state.candidateIndex = -1;
  reanalyze();
  hist = []; hi = -1; pushHist();
  if (doFit) fit();
  paint(); paintPanel(); paintStatus();
  scheduleAutosave();
}

/* ----------------------------------------------------------- dimensioni */

function resize() {
  const r = stage.getBoundingClientRect();
  state.W = Math.max(200, Math.round(r.width));
  state.H = Math.max(200, Math.round(r.height));
  canvas.setAttribute('viewBox', `0 0 ${state.W} ${state.H}`);
  canvas.setAttribute('width', state.W);
  canvas.setAttribute('height', state.H);
  paint();
}

/* -------------------------------------------------------------- azioni */

const OPTIONAL_NUM = /^(genParams\.(targetLength|minCurves|structureCount)|area\.params\.(offset|apexX))$/;

function applyBind(target) {
  const path = target.getAttribute('data-bind');
  if (!path) return false;
  if (path.startsWith('ui.')) {
    const key = path.slice(3);
    state[key] = target.type === 'number' ? (+target.value || 0) : target.value;
    return true;
  }
  if (target.type === 'checkbox') {
    setPath(state.project, path, target.checked);
    return true;
  }
  if (target.type === 'number') {
    const raw = target.value.trim();
    if (raw === '') {
      if (OPTIONAL_NUM.test(path)) { setPath(state.project, path, null); return true; }
      return false; // campo obbligatorio: aspetta un valore valido
    }
    const v = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(v)) return false;
    setPath(state.project, path, v);
    return true;
  }
  setPath(state.project, path, target.value);
  return true;
}

function regenerateArea(shape) {
  const a = state.project.area;
  const b = G.polygonBounds(a.points);
  const p = { ...a.params };
  if (shape === 'rect') { p.w = p.w || b.w || 60; p.h = p.h || b.h || 40; }
  if (shape === 'trapezoid') { p.b1 = p.b1 || b.w || 60; p.b2 = p.b2 || Math.max(5, (b.w || 60) * 0.7); p.h = p.h || b.h || 40; }
  if (shape === 'triangle') { p.base = p.base || b.w || 60; p.h = p.h || b.h || 40; }
  if (shape === 'polygon') { p.sides = p.sides || 5; p.r = p.r || Math.max(10, Math.min(b.w, b.h) / 2 || 25); delete p.points; }
  const na = makeArea(shape, p);
  // mantiene l'angolo in basso a sinistra
  const nb = G.polygonBounds(na.points);
  const dx = b.minX - nb.minX, dy = b.minY - nb.minY;
  na.points = na.points.map((q) => ({ x: G.round(q.x + dx, 3), y: G.round(q.y + dy, 3) }));
  state.project.area = na;
}

const actions = {
  /* --- navigazione --- */
  tab(name) { state.tab = name; panel.classList.add('open'); paintPanel(); },
  undo, redo,
  focus(id) { focusTarget(id); },
  'view.fit': () => fit(),
  'view.zoomIn': () => { state.view.scale = G.clamp(state.view.scale * 1.25, 0.5, 240); paint(); },
  'view.zoomOut': () => { state.view.scale = G.clamp(state.view.scale / 1.25, 0.5, 240); paint(); },
  'labels.toggle': () => { state.showLabels = !state.showLabels; paint(); syncToolButtons(); },
  'snap.toggle': () => { state.snap = !state.snap; toast(state.snap ? 'Aggancio 25 cm attivo' : 'Aggancio disattivato'); syncToolButtons(); },
  'tool:draw': () => { state.tool = state.tool === 'draw' ? null : 'draw'; state.mode = 'select'; paintPanel(); paint(); },
  'tool:none': () => { state.tool = null; state.mode = 'select'; paintPanel(); paint(); },

  /* --- disciplina --- */
  discipline(kind) {
    const p = state.project;
    if (p.discipline === kind) return;
    p.discipline = kind;
    p.rules = { ...p.rules, ...rulePreset(kind) };
    if (kind === 'skate') {
      p.startRamp = { ...DEFAULT_START_RAMP, ...p.startRamp, enabled: true };
    }
    commit();
    toast(kind === 'skate'
      ? 'Skate cross: corsia minima 5 m, partenza su rampa'
      : 'Roller cross: distanze 5–25 m, corsia minima 3,5 m');
  },

  /* categoria: aggiorna le altezze normate di salti e sottopassi */
  cat(key) {
    state.project.category = key;
    const info = categoryInfo(key);
    let n = 0;
    for (const s of state.project.structures) {
      const lib = libraryItem(s.key);
      if (!lib.byCategory) continue;
      const h = info[lib.byCategory];
      if (h && Math.abs(s.height - h) > 1e-6) { s.height = h; n++; }
    }
    commit();
    toast(n ? `${info.label}: aggiornate ${n} altezze` : info.label);
  },

  'rules.preset': () => {
    state.project.rules = { ...state.project.rules, ...rulePreset(state.project.discipline) };
    commit();
    toast('Ripristinati i valori del regolamento');
  },

  /* --- area --- */
  'area.shape': (shape) => { regenerateArea(shape); commit(); fit(); },
  'area.apply': () => { regenerateArea(state.project.area.shape); commit(); fit(); },
  'area.toggleEdit': () => {
    state.mode = state.mode === 'area' ? 'select' : 'area';
    if (state.mode === 'area') { state.tool = null; state.tab = 'area'; }
    paintPanel(); paint();
  },
  'area.addVertex': () => {
    const pts = state.project.area.points;
    const a = pts[pts.length - 1], b = pts[0];
    pts.push({ x: G.round((a.x + b.x) / 2, 2), y: G.round((a.y + b.y) / 2, 2) });
    state.project.area.shape = 'polygon';
    commit();
  },
  'area.splitEdge': (i) => {
    const pts = state.project.area.points;
    const k = +i;
    const a = pts[k], b = pts[(k + 1) % pts.length];
    pts.splice(k + 1, 0, { x: G.round((a.x + b.x) / 2, 2), y: G.round((a.y + b.y) / 2, 2) });
    state.project.area.shape = 'polygon';
    commit();
  },
  'area.delVertex': (i) => {
    const pts = state.project.area.points;
    if (pts.length <= 3) return toast('Servono almeno 3 vertici', true);
    pts.splice(+i, 1);
    state.project.area.shape = 'polygon';
    commit();
  },
  'area.normalize': () => {
    const b = G.polygonBounds(state.project.area.points);
    state.project.area.points = state.project.area.points.map((q) => ({ x: G.round(q.x - b.minX, 3), y: G.round(q.y - b.minY, 3) }));
    state.project.track.start.x = G.round(state.project.track.start.x - b.minX, 3);
    state.project.track.start.y = G.round(state.project.track.start.y - b.minY, 3);
    commit(); fit();
  },

  /* --- elementi del percorso --- */
  'el.addStraight': () => { state.project.track.elements.push(makeElement('straight', { length: 12, widthStart: state.project.track.defaultWidth })); commit(); },
  'el.addArc': () => { state.project.track.elements.push(makeElement('arc', { radius: state.drawRadius, angle: 90, widthStart: state.project.track.defaultWidth })); commit(); },
  'el.insStraight': (id) => {
    const i = elIndex(id);
    state.project.track.elements.splice(i + 1, 0, makeElement('straight', { length: 10, widthStart: state.project.track.defaultWidth }));
    commit();
  },
  'el.insArc': (id) => {
    const i = elIndex(id);
    state.project.track.elements.splice(i + 1, 0, makeElement('arc', { radius: state.drawRadius, angle: 90, widthStart: state.project.track.defaultWidth }));
    commit();
  },
  'el.dup': (id) => {
    const i = elIndex(id);
    const copy = { ...state.project.track.elements[i], id: 'el_' + Math.random().toString(36).slice(2, 9) };
    state.project.track.elements.splice(i + 1, 0, copy);
    commit();
  },
  'el.del': (id) => { const i = elIndex(id); if (i >= 0) state.project.track.elements.splice(i, 1); commit(); },
  'el.up': (id) => {
    const i = elIndex(id); if (i <= 0) return;
    const els = state.project.track.elements;
    [els[i - 1], els[i]] = [els[i], els[i - 1]];
    commit();
  },
  'el.down': (id) => {
    const i = elIndex(id); const els = state.project.track.elements;
    if (i < 0 || i >= els.length - 1) return;
    [els[i + 1], els[i]] = [els[i], els[i + 1]];
    commit();
  },
  'track.applyWidthAll': () => {
    const w = state.project.track.defaultWidth;
    state.project.track.elements.forEach((e) => { e.widthStart = w; e.widthEnd = w; });
    commit(); toast(`Larghezza ${fmtM(w, 2)} su tutti i tratti`);
  },
  'track.taperTo3': () => {
    const el = selectedElement();
    if (!el) return toast('Seleziona prima un tratto', true);
    const i = elIndex(el.id);
    el.widthEnd = 3;
    const next = state.project.track.elements[i + 1];
    if (next) next.widthStart = 3;
    commit(); toast('Restringimento a 3 m applicato');
  },
  'track.closeLoop': () => {
    const baked = state.analysis.baked;
    const els = extendTo(baked, baked.startPoint, state.drawRadius, state.project.track.defaultWidth);
    if (!els.length) return toast('Sei già in partenza', true);
    state.project.track.elements.push(...els);
    commit(); toast('Anello chiuso verso la partenza');
  },
  'track.clear': () => {
    if (!confirm('Eliminare tutti gli elementi del percorso?')) return;
    state.project.track.elements = [];
    commit();
  },

  /* --- strutture --- */
  'st.pick': (key) => {
    state.tool = state.tool === 'add:' + key ? null : 'add:' + key;
    state.mode = 'select';
    paintPanel();
    if (state.tool && window.matchMedia('(max-width:860px)').matches) panel.classList.remove('open');
  },
  'st.del': (id) => { const i = stIndex(id); if (i >= 0) state.project.structures.splice(i, 1); commit(); },
  'st.dup': (id) => {
    const s = state.project.structures[stIndex(id)];
    const copy = { ...s, id: 'st_' + Math.random().toString(36).slice(2, 9), station: s.station + s.length + state.project.rules.minGap };
    state.project.structures.push(copy);
    commit();
  },
  'st.center': (id) => { const s = state.project.structures[stIndex(id)]; s.side = 0; s.rotation = 0; s.mode = 'path'; commit(); },
  'st.snapValid': (id) => {
    const s = state.project.structures[stIndex(id)];
    const ranges = validStationRanges(state.project, state.analysis.baked, id);
    if (!ranges.length) return toast('Nessuna posizione valida libera', true);
    let best = null;
    for (const r of ranges) {
      const from = r.from + s.length / 2, to = r.to - s.length / 2;
      if (to < from) continue;
      const cand = G.clamp(s.station, from, to);
      const d = Math.abs(cand - s.station);
      if (!best || d < best.d) best = { d, station: cand, after: r.after };
    }
    if (!best) return toast('Nessuno spazio sufficiente: serve un tratto più lungo', true);
    s.station = G.round(best.station, 2);
    commit(); toast(`Spostata a ${fmtM(s.station, 2)} (dopo ${best.after})`);
  },
  'st.auto': () => {
    const n = autoPlaceStructures(state.project, { count: state.project.genParams.structureCount ?? null });
    commit();
    toast(n ? `${n} strutture posizionate` : 'Nessun tratto libero abbastanza lungo');
  },
  'st.clear': () => {
    if (!state.project.structures.length) return;
    if (!confirm('Rimuovere tutte le strutture?')) return;
    state.project.structures = [];
    commit();
  },

  /* --- generazione --- */
  'gen.addReq': () => {
    state.project.genParams.curveReqs = state.project.genParams.curveReqs || [];
    state.project.genParams.curveReqs.push({ radius: 8, count: 2 });
    commit();
  },
  'gen.delReq': (i) => { state.project.genParams.curveReqs.splice(+i, 1); commit(); },
  'gen.run': () => runGeneration(1),
  'gen.runMore': () => runGeneration(Math.floor(Math.random() * 90000) + 10),
  'gen.use': (i) => {
    const c = state.candidates[+i];
    if (!c) return;
    state.project.track = JSON.parse(JSON.stringify(c.project.track));
    state.project.structures = JSON.parse(JSON.stringify(c.project.structures));
    state.candidateIndex = +i;
    commit(); fit();
    toast(`Applicata: ${c.name}`);
  },

  /* --- regole --- */
  'rules.reset': () => { state.project.rules = { ...DEFAULT_RULES }; commit(); },
  'start.preset': () => { state.project.startGate = { ...DEFAULT_START_GATE }; commit(); },

  /* --- tavola in scala --- */
  'plate.print': () => {
    try {
      const set = buildPlateSet(state.project, state.analysis, state.project.plate);
      store.printPages(set.pages, set.size, state.project.name || 'Tavola');
      toast(`${set.pages.length} fogli pronti per la stampa (scala 1:${set.scale})`);
    } catch (err) { toast(err.message, true); }
  },
  'plate.svg': () => {
    const set = buildPlateSet(state.project, state.analysis, state.project.plate);
    const base = (state.project.name || 'percorso').replace(/[^\w\-]+/g, '_');
    set.pages.forEach((pg, i) => {
      setTimeout(() => store.downloadSVGText(pg.svg, `${base}_tav${i + 1}_${pg.name}_1-${set.scale}.svg`), i * 350);
    });
    toast(`${set.pages.length} fogli SVG in scala 1:${set.scale}`);
  },
  'plate.png': async () => {
    const set = buildPlateSet(state.project, state.analysis, state.project.plate);
    const base = (state.project.name || 'percorso').replace(/[^\w\-]+/g, '_');
    toast('Esporto i fogli…');
    for (let i = 0; i < set.pages.length; i++) {
      const blob = await store.pngFromSheet(set.pages[i].svg, set.size, 200);
      store.downloadBlob(blob, `${base}_tav${i + 1}_${set.pages[i].name}_1-${set.scale}.png`);
      await new Promise((r) => setTimeout(r, 250));
    }
    toast(`${set.pages.length} fogli PNG a 200 dpi`);
  },

  /* --- esportazioni --- */
  'exp.png': async () => { await store.exportPNG(canvas, state.W, state.H, state.project, 2); toast('PNG esportato'); },
  'exp.svg': async () => { await store.exportSVG(canvas, state.W, state.H, state.project); toast('SVG esportato'); },
  'exp.csv': () => { store.exportCSV(state.project, state.analysis); toast('Distinta CSV esportata'); },
  'exp.json': () => { store.exportJSON(state.project); toast('Progetto esportato'); },
  'imp.json': async () => {
    try {
      const raw = await store.pickJSON();
      state.project = normalizeProject(raw);
      afterProjectLoad();
      toast('Progetto importato');
    } catch (e) { toast('Import non riuscito: ' + e.message, true); }
  },

  /* --- progetti --- */
  'proj.new': () => {
    if (!confirm('Creare un nuovo progetto? Le modifiche non salvate vanno perse.')) return;
    state.project = createProject({});
    afterProjectLoad();
  },
  'loc.save': () => {
    store.saveLocal(state.project);
    state.localProjects = store.listLocal();
    if (state.tab === 'cloud') paintPanel();
    toast('Salvato in questo browser');
  },
  'loc.open': (id) => {
    const p = store.loadLocal(id);
    if (!p) return toast('Progetto non trovato', true);
    state.project = normalizeProject(p);
    afterProjectLoad();
    toast('Progetto aperto');
  },
  'loc.del': (id) => {
    if (!confirm('Eliminare il progetto salvato?')) return;
    store.deleteLocal(id);
    state.localProjects = store.listLocal();
    paintPanel();
  },

  /* --- cloud --- */
  'cloud.saveCfg': async () => {
    const box = document.getElementById('cfgBox');
    const raw = (box && box.value || '').trim();
    if (!raw) return toast('Incolla la configurazione', true);
    try {
      const cfg = JSON.parse(raw.replace(/^\s*(const|var|let)?\s*firebaseConfig\s*=\s*/, '').replace(/;\s*$/, '')
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,(\s*[}\]])/g, '$1'));
      if (!cfg.apiKey || !cfg.projectId) throw new Error('mancano apiKey o projectId');
      store.saveConfig(cfg);
      state.firebaseConfig = cfg;
      await store.initFirebase();
      paintPanel();
      toast('Firebase configurato');
    } catch (e) { toast('Configurazione non valida: ' + e.message, true); }
  },
  'cloud.clearCfg': () => {
    store.saveConfig(null);
    state.firebaseConfig = null;
    paintPanel();
    toast('Configurazione rimossa (ricarica la pagina)');
  },
  'cloud.google': async () => { try { await store.signInGoogle(); } catch (e) { toast(e.message, true); } },
  'cloud.anon': async () => { try { await store.signInAnon(); } catch (e) { toast(e.message, true); } },
  'cloud.signout': async () => { await store.signOutUser(); },
  'cloud.save': async () => {
    try {
      await store.cloudSave(state.project);
      state.cloudProjects = await store.cloudList();
      paintPanel();
      toast('Salvato sul cloud');
    } catch (e) { toast('Salvataggio non riuscito: ' + e.message, true); }
  },
  'cloud.list': async () => {
    try { state.cloudProjects = await store.cloudList(); paintPanel(); }
    catch (e) { toast(e.message, true); }
  },
  'cloud.open': async (id) => {
    try {
      const p = await store.cloudLoad(id);
      if (!p) return toast('Non trovato', true);
      state.project = normalizeProject(p);
      afterProjectLoad();
      toast('Progetto aperto dal cloud');
    } catch (e) { toast(e.message, true); }
  },
  'cloud.del': async (id) => {
    if (!confirm('Eliminare dal cloud?')) return;
    try { await store.cloudDelete(id); state.cloudProjects = await store.cloudList(); paintPanel(); }
    catch (e) { toast(e.message, true); }
  },
};

function runGeneration(seed) {
  state.generating = true;
  state.candidates = [];
  paintPanel();
  setTimeout(() => {
    try {
      const cands = generateCandidates(state.project, { seed });
      for (const c of cands) c.analysisCache = analyze(c.project);
      state.candidates = cands;
      state.candidateIndex = -1;
      if (!cands.length) toast('Nessuna variante possibile: prova a ridurre il margine o il raggio', true);
    } catch (e) {
      console.error(e);
      toast('Errore nella generazione: ' + e.message, true);
    } finally {
      state.generating = false;
      paintPanel();
    }
  }, 30);
}

/* --------------------------------------------------------- eventi globali */

function handleAct(actRaw, id, target) {
  const [name, arg] = actRaw.includes(':') ? [actRaw.slice(0, actRaw.indexOf(':')), actRaw.slice(actRaw.indexOf(':') + 1)] : [actRaw, null];
  const fn = actions[actRaw] || actions[name];
  if (!fn) return false;
  fn(actions[actRaw] ? (id || arg) : (arg !== null ? arg : id), target);
  return true;
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.getAttribute('data-act');
  const id = t.getAttribute('data-id');
  if (handleAct(act, id, t)) ev.preventDefault();
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t === nameInput) { state.project.name = t.value; scheduleAutosave(); return; }
  if (!t.getAttribute || !t.getAttribute('data-bind')) return;
  if (applyBind(t)) {
    if (t.type === 'checkbox' || t.tagName === 'SELECT') commit();
    else live();
  }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t === nameInput) { state.project.name = t.value; commit(); return; }
  if (!t.getAttribute || !t.getAttribute('data-bind')) return;
  if (applyBind(t)) commit();
});

document.addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  if (ev.key === 'Escape') { state.tool = null; state.mode = 'select'; state.selection = null; paintPanel(); paint(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
    return;
  }
  if (typing) return;
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selection) {
    ev.preventDefault();
    const s = state.selection;
    if (s.kind === 'structure') actions['st.del'](s.id);
    else if (s.kind === 'element') actions['el.del'](s.id);
    state.selection = null;
  }
});

/* pannello a cassetto su mobile */
$('#panelGrip').addEventListener('click', () => panel.classList.toggle('open'));
$('#panelToggle').addEventListener('click', () => panel.classList.toggle('open'));
tabsEl.addEventListener('click', () => panel.classList.add('open'));

/* ------------------------------------------------------------------ avvio */

const api = {
  state: () => state,
  render: paint,
  live,
  commit,
  select(sel) {
    state.selection = sel;
    if (sel && sel.kind === 'structure') state.tab = 'structures';
    if (sel && sel.kind === 'element') state.tab = 'track';
    paintPanel(); paint();
  },
  drawTo(wp) {
    const els = extendTo(state.analysis.baked, wp, state.drawRadius, state.project.track.defaultWidth);
    if (!els.length) return;
    state.project.track.elements.push(...els);
    commit();
  },
  addStructureAt(key, wp) {
    const pr = projectPoint(state.analysis.baked, wp);
    const lib = libraryItem(key);
    const onTrack = pr.dist < Math.max(8, lib.width);
    const cat = state.project.category;
    const s = onTrack
      ? makeStructure(key, G.round(G.clamp(pr.station, 0, state.analysis.baked.totalLength), 2), { side: G.round(pr.side, 2), category: cat })
      : makeStructure(key, 0, { mode: 'free', x: G.round(wp.x, 2), y: G.round(wp.y, 2), category: cat });
    state.project.structures.push(s);
    state.selection = { kind: 'structure', id: s.id };
    commit();
    const info = state.analysis.status[s.id];
    if (info && info.level === 'bad') toast(info.reasons[0] || 'Posizione fuori regola', true);
  },
  openStructure(id) { state.tab = 'structures'; state.selection = { kind: 'structure', id }; panel.classList.add('open'); paintPanel(); },
  openElement(id) { state.tab = 'track'; state.selection = { kind: 'element', id }; panel.classList.add('open'); paintPanel(); },
};

function boot() {
  const saved = store.loadAutosave();
  state.project = saved ? normalizeProject(saved) : demoProject();
  state.firebaseConfig = store.getConfig();
  state.localProjects = store.listLocal();
  resize();
  afterProjectLoad();
  attachInteractions(canvas, api);
  new ResizeObserver(() => resize()).observe(stage);
  window.addEventListener('resize', resize);

  if (state.firebaseConfig) {
    store.initFirebase().then(() => {
      store.onUser(async (u) => {
        state.user = u;
        if (u) { try { state.cloudProjects = await store.cloudList(); } catch (e) { /* offline */ } }
        if (state.tab === 'cloud') paintPanel();
      });
    }).catch((e) => console.warn('Firebase non inizializzato:', e));
  }
  if (!window.matchMedia('(max-width:860px)').matches) panel.classList.add('open');
  // ganci per debug e test automatici
  window.__state = state;
  window.__api = api;
  window.__commit = commit;
  window.__repaint = () => { paint(); paintPanel(); paintStatus(); };
}

boot();
