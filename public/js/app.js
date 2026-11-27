/* app.js — controller: stato, eventi, azioni, salvataggi. */

import * as G from './geometry.js';
import {
  createProject, normalizeProject, makeArea, makeStructure, makeElement,
  DEFAULT_RULES, DEFAULT_START_GATE, DEFAULT_START_RAMP, libraryItem,
} from './model.js';
import { rulePreset, categoryInfo, ROLLER } from './regulation.js';
import { analyze, validStationRanges, extendTo, bakeTrack, projectPoint, frameAt, edgePaths, closeToStartOptions } from './track.js';
import { generateCandidates, autoPlaceStructures } from './generator.js';
import { render, fitView, toScreen, fmtM, fmt } from './render.js';
import { attachInteractions } from './interact.js';
import { panelHTML, tabsHTML, statusHTML, getPath, setPath, clearDialogHTML, toolbarHTML, flyoutHTML } from './ui.js';
import { homeHTML, AREA_PRESETS } from './home.js';
import * as store from './store.js';
import { parsePlace, worldToLatLon, latLonToWorld, formatLatLon, mapsLink, provider, noteTileError } from './basemap.js';
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
const homeEl = $('#home');
const modalEl = $('#modal');
const toolsEl = $('#floatTools');
const flyEl = $('#flyout');
const editorEl = $('#editor');

/* ------------------------------------------------------------------ stato */

const state = {
  project: null,
  analysis: null,
  view: { scale: 10, cx: 0, cy: 0 },
  W: 800, H: 600,
  tab: 'track',
  mode: 'select',        // 'select' | 'area' | 'quota'
  tool: null,            // null | 'draw' | 'finish' | 'add:<key>'
  selection: null,
  snap: true,
  showLabels: true,
  drawRadius: 8,
  candidates: [],
  candidateIndex: -1,
  ghost: null,
  measure: null,      // lettura delle misure in modalità quota: {at, from}
  mapsKey: '',        // chiave Static Maps, solo su questo browser
  placeText: '',      // indirizzo/link incollato per posizionare lo sfondo
  mapDrag: 'move',    // nella modalità sfondo: 'move' | 'rotate'
  drawArmed: false,   // nel disegno da zero: la partenza è stata fissata?
  modal: null,        // finestra aperta (per ora solo 'clear')
  flyout: null,       // menù a comparsa della barra strumenti
  clearSel: null,     // selezione della finestra di svuotamento
  generating: false,
  user: null,
  firebaseConfig: null,
  localProjects: [],
  cloudProjects: [],
  screen: 'home',
  resume: null,
  home: { discipline: 'roller', preset: 'gara', shape: 'rect', w: 60, h: 30, b2: 42 },
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
    // sopra la foto aerea le scritte prendono un alone chiaro, altrimenti
    // su un prato scuro non si leggono
    canvas.classList.toggle('hasMap', !!(state.project && state.project.basemap && state.project.basemap.on));
    canvas.innerHTML = render(state);
    watchTiles();
  });
}
/* se una tessera non arriva si scende di livello e si ridisegna: meglio una
   foto ingrandita che nessuna foto */
let tileErrAt = 0;
function watchTiles() {
  const bm = state.project && state.project.basemap;
  if (!bm || !bm.on) return;
  canvas.querySelectorAll('.basemap image').forEach((img) => {
    img.addEventListener('error', () => {
      const z = +img.getAttribute('data-z') || 0;
      const now = Date.now();
      if (now - tileErrAt < 400) return;      // un solo passo per volta
      tileErrAt = now;
      noteTileError(bm, z);
      paint();
    }, { once: true });
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
  if (state.tool === 'draw') {
    msg = !state.project.track.elements.length && !state.drawArmed
      ? '✏️ Passo 1: clicca sulla mappa dove deve partire il percorso.'
      : '✏️ Muovi il puntatore: la corsia si allunga in tempo reale. Clicca per fissare la lunghezza.';
  }
  else if (state.tool && state.tool.startsWith('add:')) msg = `Tocca la mappa per posizionare «${libraryItem(state.tool.slice(4)).name}».`;
  else if (state.tool === 'finish') msg = '🏁 Clicca sul percorso dove deve stare la linea di arrivo.';
  else if (state.mode === 'quota') msg = '📐 Modalità quota: tutto bloccato. Muovi il puntatore sulla pista per leggere le misure, clicca per fissare il primo punto.';
  else if (state.mode === 'map') msg = state.mapDrag === 'rotate'
    ? '🛰 Trascina per ruotare lo sfondo attorno al centro dell\'area. Quando è a posto, fissalo.'
    : '🛰 Trascina per spostare lo sfondo sotto il disegno (Maiusc per ruotare). Quando è a posto, fissalo.';
  else if (state.mode === 'area') msg = '◇ Trascina i vertici per modificare l\'area.';
  if (msg) {
    hintBar.hidden = false;
    hintBar.innerHTML = `<span>${msg}</span> <button class="btn mini" data-act="tool:none" style="margin-left:8px">Esci</button>`;
  } else hintBar.hidden = true;
}
function syncToolButtons() {
  if (toolsEl) toolsEl.innerHTML = toolbarHTML(state);
  if (flyEl) {
    const html = flyoutHTML(state);
    flyEl.innerHTML = html;
    flyEl.hidden = !html;
  }
  document.querySelectorAll('#discSeg .segb').forEach((b) => {
    b.classList.toggle('on', b.getAttribute('data-act') === 'discipline:' + state.project.discipline);
  });
}

function reanalyze() { state.analysis = analyze(state.project); }

/* ------------------------------------------------------- finestre modali */

function paintModal() {
  if (state.modal === 'clear') {
    modalEl.innerHTML = clearDialogHTML(state);
    modalEl.hidden = false;
  } else {
    modalEl.innerHTML = '';
    modalEl.hidden = true;
  }
}
function closeModal() { state.modal = null; paintModal(); }

/** selezione iniziale: tutto spuntato, o solo l'ambito richiesto */
function buildClearSel(scope) {
  const types = {};
  for (const s of state.project.structures) types[s.key || 'generica'] = scope !== 'track';
  return {
    straight: scope !== 'structures',
    arc: scope !== 'structures',
    types,
  };
}

/* ------------------------------------------------------ schermata iniziale */

function paintHome() {
  homeEl.innerHTML = homeHTML(state);
}
function showHome() {
  // il lavoro in corso viene archiviato, così si ritrova fra i propri progetti
  if (state.project && (state.project.track.elements.length || state.project.structures.length)) {
    try { store.saveLocal(state.project); } catch (e) { /* archiviazione piena */ }
  }
  state.screen = 'home';
  state.localProjects = store.listLocal();
  state.resume = store.loadAutosave();
  homeEl.hidden = false;
  editorEl.hidden = true;
  document.body.classList.add('onHome');
  paintHome();
}
function showEditor(doFit = true) {
  state.screen = 'editor';
  homeEl.hidden = true;
  editorEl.hidden = false;
  document.body.classList.remove('onHome');
  resize();
  if (doFit) fit();
  paint(); paintPanel(); paintStatus();
}

/** area scelta nella schermata iniziale */
function homeArea() {
  const h = state.home;
  if (h.preset !== 'custom') {
    const p = AREA_PRESETS.find((x) => x.key === h.preset) || AREA_PRESETS[0];
    return makeArea('rect', { w: p.w, h: p.h });
  }
  const w = Math.max(10, +h.w || 60), d = Math.max(10, +h.h || 30);
  switch (h.shape) {
    case 'trapezoid': return makeArea('trapezoid', { b1: w, b2: Math.max(5, +h.b2 || Math.round(w * 0.7)), h: d });
    case 'triangle': return makeArea('triangle', { base: w, h: d });
    case 'draw': {
      const pts = (h.points || []).map((p) => ({ x: p.x, y: p.y }));
      if (pts.length < 3) return makeArea('rect', { w, h: d });
      // il contorno disegnato viene portato all'origine
      const b = G.polygonBounds(pts);
      return makeArea('polygon', { points: pts.map((p) => ({ x: G.round(p.x - b.minX, 2), y: G.round(p.y - b.minY, 2) })) });
    }
    default: return makeArea('rect', { w, h: d });
  }
}
function areaLabel() {
  const h = state.home;
  if (h.preset !== 'custom') {
    const p = AREA_PRESETS.find((x) => x.key === h.preset) || AREA_PRESETS[0];
    return `${p.w}×${p.h}`;
  }
  if (h.shape === 'draw' && (h.points || []).length >= 3) {
    const b = G.polygonBounds(h.points);
    return `${Math.round(b.w)}×${Math.round(b.h)}`;
  }
  return `${Math.round(+h.w || 60)}×${Math.round(+h.h || 30)}`;
}

/* modifica in corso (trascinamento): aggiorna solo la mappa */
function live() { reanalyze(); paint(); paintStatus(); }

function paintTools() { syncToolButtons(); }

/* come commit(), ma senza ricostruire pannello e menù: si usa quando la
   modifica arriva da un campo di testo. Ricostruire il pannello mentre il
   dito è già premuto su un pulsante lo faceva sparire fra la pressione e il
   rilascio, e il clic andava perso. */
function commitQuiet() {
  reanalyze();
  pushHist();
  paint(); paintStatus();
  scheduleAutosave();
}

/* ricostruzione del pannello rimandata a fine clic */
let pointerDownNow = false, panelDirty = false;
function schedulePanel() {
  if (pointerDownNow) { panelDirty = true; return; }
  paintPanel();
}
document.addEventListener('pointerdown', () => { pointerDownNow = true; }, true);
document.addEventListener('pointerup', () => {
  pointerDownNow = false;
  if (!panelDirty) return;
  panelDirty = false;
  // dopo il clic, non prima: altrimenti si perde di nuovo
  setTimeout(() => paintPanel(), 0);
}, true);

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

const OPTIONAL_NUM = /^(genParams\.(targetLength|minCurves|structureCount)|area\.params\.(offset|apexX)|track\.finishAt)$/;

function applyBind(target) {
  const path = target.getAttribute('data-bind');
  if (!path) return false;
  if (path.startsWith('home.')) {
    const key = path.slice(5);
    state.home[key] = target.type === 'number' ? (+target.value || 0) : target.value;
    if (key === 'shape') paintHome();
    return true;
  }
  if (path.startsWith('ui.')) {
    const key = path.slice(3);
    state[key] = target.type === 'number' ? (+target.value || 0) : target.value;
    if (key === 'mapsKey') store.setMapsKey(state.mapsKey);
    return true;
  }
  if (target.type === 'checkbox') {
    setPath(state.project, path, target.checked);
    return true;
  }
  if (target.type === 'range') {
    setPath(state.project, path, parseFloat(target.value));
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
  'tool:draw': () => {
    state.flyout = null;
    state.tool = state.tool === 'draw' ? null : 'draw';
    state.mode = 'select';
    state.ghost = null;
    // su un percorso vuoto si riparte dal fissare la partenza
    if (state.tool === 'draw') state.drawArmed = state.project.track.elements.length > 0;
    paintPanel(); paint();
  },
  'tool:none': () => { state.tool = null; state.mode = 'select'; state.ghost = null; state.measure = null; paintPanel(); paint(); },
  'tool:finish': () => {
    state.flyout = null;
    if (state.mode === 'quota') state.mode = 'select';
    state.tool = state.tool === 'finish' ? null : 'finish';
    state.ghost = null;
    state.measure = null;
    paintPanel(); paint();
  },
  /* modalità quota: niente si afferra, niente si modifica, si misura */
  'mode.quota': () => {
    const on = state.mode === 'quota';
    state.flyout = null;
    state.mode = on ? 'select' : 'quota';
    state.tool = null;
    state.ghost = null;
    state.measure = null;
    if (!on) state.selection = null;
    paintPanel(); paint();
  },
  'measure.reset': () => { state.measure = state.measure ? { at: state.measure.at, from: null } : null; paint(); },

  /* --- barra strumenti sul disegno --- */
  fly: (which) => {
    state.flyout = (which === 'none' || state.flyout === which) ? null : which;
    if (state.flyout) state.tool = state.tool && state.tool.startsWith('add:') && state.flyout === 'struct' ? state.tool : state.tool;
    paintTools();
  },
  'gen.runHere': () => {
    state.tab = 'auto';
    state.flyout = null;
    panel.classList.add('open');
    paintPanel();
    runGeneration(Math.floor(Math.random() * 90000) + 10);
  },

  /* --- svuotamento selettivo --- */
  'clear.open': (scope) => {
    if (state.screen !== 'editor') showEditor(false);
    state.clearSel = buildClearSel(scope || 'all');
    state.modal = 'clear';
    paintModal();
  },
  'modal.close': () => closeModal(),
  'clear.el': (kind) => { state.clearSel[kind] = !state.clearSel[kind]; paintModal(); },
  'clear.type': (key) => { state.clearSel.types[key] = !state.clearSel.types[key]; paintModal(); },
  'clear.group': (g) => {
    const keys = state.project.structures.filter((s) => (s.group || 'altro') === g).map((s) => s.key || 'generica');
    const allOn = keys.every((k) => state.clearSel.types[k]);
    keys.forEach((k) => { state.clearSel.types[k] = !allOn; });
    paintModal();
  },
  'clear.all': () => { state.clearSel = buildClearSel('all'); paintModal(); },
  'clear.none': () => {
    state.clearSel.straight = false;
    state.clearSel.arc = false;
    Object.keys(state.clearSel.types).forEach((k) => { state.clearSel.types[k] = false; });
    paintModal();
  },
  'clear.apply': () => {
    const sel = state.clearSel || {};
    const t = state.project.track;
    const beforeEl = t.elements.length, beforeSt = state.project.structures.length;
    t.elements = t.elements.filter((el) => !(el.type === 'straight' ? sel.straight : sel.arc));
    state.project.structures = state.project.structures.filter((s) => !(sel.types && sel.types[s.key || 'generica']));
    if (!t.elements.length) { t.laps = 1; t.finishAt = null; t.closed = false; state.drawArmed = false; }
    state.selection = null;
    state.ghost = null;
    closeModal();
    commit();
    const nEl = beforeEl - t.elements.length, nSt = beforeSt - state.project.structures.length;
    toast(nEl || nSt
      ? `Eliminati ${nEl ? `${nEl} tratti` : ''}${nEl && nSt ? ' e ' : ''}${nSt ? `${nSt} ostacoli` : ''}`
      : 'Niente da eliminare');
  },

  /* --- schermata iniziale --- */
  'go.home': () => showHome(),
  'home.disc': (k) => { state.home.discipline = k === 'skate' ? 'skate' : 'roller'; paintHome(); },
  'home.preset': (k) => { state.home.preset = k; paintHome(); },
  'home.scroll': (which) => {
    const el = document.getElementById(which === 'mine' ? 'wmine' : 'wnew');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'home.undoVtx': () => { (state.home.points = state.home.points || []).pop(); paintHome(); },
  'home.clearVtx': () => { state.home.points = []; paintHome(); },
  'home.vtxPreset': (kind) => {
    if (kind === 'rect') state.home.points = [{ x: 30, y: 25 }, { x: 110, y: 25 }, { x: 110, y: 70 }, { x: 30, y: 70 }];
    paintHome();
  },
  'home.create': () => startNew(false),
  'home.createFull': () => startNew(true),
  'home.resume': () => {
    const p = store.loadAutosave();
    if (!p) return toast('Nessun lavoro da riprendere', true);
    state.project = normalizeProject(p);
    afterProjectLoad();
    showEditor();
  },
  'home.cloud': () => { state.tab = 'cloud'; showEditor(false); panel.classList.add('open'); },
  'resume.open': () => actions['home.resume'](),
  'resume.dup': () => actions['home.resume'](),
  'resume.del': () => { try { localStorage.removeItem('rc.current'); } catch (e) { /* ignora */ } state.resume = null; paintHome(); },
  'loc.dup': (id) => {
    const p = store.loadLocal(id);
    if (!p) return;
    const copy = normalizeProject(p);
    copy.id = 'prj_' + Math.random().toString(36).slice(2, 9);
    copy.name = (copy.name || 'Percorso') + ' (copia)';
    copy.updatedAt = Date.now();
    store.saveLocal(copy);
    state.localProjects = store.listLocal();
    paintHome();
    toast('Copia creata');
  },
  'cloud.dup': (id) => actions['cloud.open'](id),

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

  /* --- sfondo satellitare --- */
  'map.toggle': () => {
    const bm = state.project.basemap;
    bm.on = !bm.on;
    if (!bm.on && state.mode === 'map') state.mode = 'select';
    if (bm.on && provider(bm.provider).needsKey && !state.mapsKey) {
      state.flyout = 'map';
      toast('Per Google Maps serve la tua chiave API: incollala qui sotto', true);
    }
    commit();
    paintTools();
  },
  'map.lock': () => {
    const bm = state.project.basemap;
    bm.locked = !bm.locked;
    if (bm.locked && state.mode === 'map') state.mode = 'select';
    commit(); paintTools();
    toast(bm.locked ? 'Sfondo fissato: non si sposta più' : 'Sfondo sbloccato');
  },
  'map.move': () => {
    const bm = state.project.basemap;
    if (!bm.on) { actions['map.toggle'](); }
    if (bm.locked) { toast('Lo sfondo è fissato: sbloccalo per spostarlo', true); return; }
    state.mode = state.mode === 'map' ? 'select' : 'map';
    if (state.mode === 'map') { state.tool = null; state.ghost = null; state.measure = null; }
    paintPanel(); paint();
  },
  'map.drag': (which) => { state.mapDrag = which === 'rotate' ? 'rotate' : 'move'; paintPanel(); paintTools(); },
  'map.provider': (key) => {
    state.project.basemap.provider = key;
    if (provider(key).needsKey && !state.mapsKey) toast('Incolla la chiave della Static Maps API per vedere le tessere', true);
    commit(); paintTools();
  },
  'map.place': () => {
    const hit = parsePlace(state.placeText);
    if (!hit) { toast('Non riconosco il punto: incolla un link di Google Maps o le coordinate', true); return; }
    const bm = state.project.basemap;
    if (!bm.on) bm.on = true;
    placeBasemapAt(hit.lat, hit.lon, areaCenter());
    commit(); paintPanel(); paintTools();
    toast(`Sfondo posizionato su ${formatLatLon(hit.lat, hit.lon, 5)}`);
  },
  'map.here': () => {
    if (!navigator.geolocation) { toast('Questo browser non dà la posizione', true); return; }
    toast('Cerco la posizione…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const bm = state.project.basemap;
      bm.on = true;
      placeBasemapAt(pos.coords.latitude, pos.coords.longitude, areaCenter());
      commit(); paintPanel(); paintTools();
      toast(`Sfondo sulla tua posizione (±${Math.round(pos.coords.accuracy)} m)`);
    }, () => toast('Posizione non disponibile: incolla il link di Google Maps', true), { enableHighAccuracy: true, timeout: 8000 });
  },
  'map.rotateBy': (d) => { rotateBasemapTo((state.project.basemap.rotation || 0) + (+d || 0), areaCenter()); commit(); },
  'map.north': () => { rotateBasemapTo(0, areaCenter()); commit(); toast('Nord in alto'); },
  'map.openMaps': () => {
    const bm = state.project.basemap;
    const c = worldToLatLon(bm, areaCenter());
    window.open(mapsLink(c.lat, c.lon, 19), '_blank', 'noopener');
  },
  'map.clearKey': () => { state.mapsKey = ''; store.setMapsKey(''); paintPanel(); paintTools(); paint(); },

  /* --- area --- */
  'area.shape': (shape) => { regenerateArea(shape); commit(); fit(); },
  'area.apply': () => { regenerateArea(state.project.area.shape); commit(); fit(); },
  'area.toggleEdit': () => {
    state.flyout = null;
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
    if (!baked.elements.length) return toast('Disegna prima almeno un tratto', true);
    const width = state.project.track.defaultWidth;
    const radii = [...new Set([state.drawRadius, 2.5, 3, 4, 5, 6, 8, 10])].filter((r) => r >= 1);
    const ro = state.project.rules.finishMin || 0;
    // si preferisce chiudere con un rettilineo davanti all'arrivo; se non ci
    // sta, si accorcia e al limite si chiude senza
    let chosen = null, options = [];
    for (const runout of [...new Set([ro, ro / 2, 0])]) {
      options = closeToStartOptions(baked, width, radii, runout);
      for (const o of options.slice(0, 14)) {
        const clone = JSON.parse(JSON.stringify(state.project));
        clone.track.elements.push(...JSON.parse(JSON.stringify(o.elements)));
        const a2 = analyze(clone);
        if (!a2.stats.outsideRuns) { chosen = o; break; }
      }
      if (chosen) break;
    }
    if (!options.length) return toast('Non trovo un raccordo verso la partenza', true);
    const fallback = !chosen;
    if (!chosen) chosen = options[0];
    state.project.track.elements.push(...chosen.elements);
    state.project.track.closed = true;
    reanalyze();
    // se il giro è più corto del minimo, propone i giri necessari
    const st = state.analysis.stats;
    if (st.isClosed && state.project.discipline === 'roller' && st.totalLength < ROLLER.totalLengthMin) {
      // si ripassa solo per i metri che mancano, senza chiudere un secondo giro
      const target = state.project.genParams.targetLength
        || (ROLLER.totalLengthMin + ROLLER.totalLengthMax) / 2;
      if (st.totalLength * 2 >= target) {
        state.project.track.laps = 2;
        state.project.track.finishAt = G.round(target - st.totalLength, 1);
      } else {
        state.project.track.laps = 2;
        state.project.track.finishAt = null;
      }
    }
    commit();
    const s = state.analysis.stats;
    const passes = s.finishAt !== null
      ? ` · giro ${fmtM(s.totalLength, 1)} + ${fmtM(s.finishAt, 1)} = ${fmtM(s.raceLength, 1)}`
      : s.laps > 1 ? ` · ${s.laps} passaggi = ${fmtM(s.raceLength, 1)}` : '';
    toast(fallback
      ? `Anello chiuso, ma il raccordo esce dall'area: ${fmtM(chosen.length, 1)}`
      : `Anello chiuso con ${fmtM(chosen.length, 1)} di raccordo${passes}`,
      fallback);
  },
  'track.laps': (n) => { state.project.track.laps = G.clamp(Math.round(+n || 1), 1, 2); commit(); },
  'track.openLoop': () => { state.project.track.laps = 1; state.project.track.finishAt = null; commit(); toast('Tornato a un giro solo'); },
  'track.clearAll': () => {
    state.project.track.elements = [];
    state.project.track.laps = 1;
    state.project.track.finishAt = null;
    state.drawArmed = false;
    state.ghost = null;
    commit();
    toast('Percorso svuotato: con la matita clicca dove far partire il nuovo tracciato');
  },

  /* --- strutture --- */
  'st.pick': (key) => {
    state.tool = state.tool === 'add:' + key ? null : 'add:' + key;
    state.mode = 'select';
    state.flyout = null;                       // scelto l'ostacolo, il menù si chiude
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
  'st.clear': () => actions['clear.open']('structures'),

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
      const set = buildPlateSet(state.project, state.analysis, { ...state.project.plate, mapsKey: state.mapsKey });
      store.printPages(set.pages, set.size, state.project.name || 'Tavola');
      toast(`${set.pages.length} fogli pronti per la stampa (scala 1:${set.scale})`);
    } catch (err) { toast(err.message, true); }
  },
  'plate.svg': () => {
    const set = buildPlateSet(state.project, state.analysis, { ...state.project.plate, mapsKey: state.mapsKey });
    const base = (state.project.name || 'percorso').replace(/[^\w\-]+/g, '_');
    set.pages.forEach((pg, i) => {
      setTimeout(() => store.downloadSVGTextInlined(pg.svg, `${base}_tav${i + 1}_${pg.name}_1-${set.scale}.svg`), i * 350);
    });
    toast(`${set.pages.length} fogli SVG in scala 1:${set.scale}`);
  },
  'plate.png': async () => {
    const set = buildPlateSet(state.project, state.analysis, { ...state.project.plate, mapsKey: state.mapsKey });
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
      showEditor();
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
    showEditor();
    toast('Progetto aperto');
  },
  'loc.del': (id) => {
    store.deleteLocal(id);
    state.localProjects = store.listLocal();
    if (state.screen === 'home') paintHome(); else paintPanel();
    toast('Progetto eliminato');
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
      showEditor();
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

/* ------------------------------------------------- disegno con anteprima */

/**
 * Elementi che porterebbero il percorso fino a `wp`.
 * Se il tracciato è vuoto, il primo tocco definisce direzione e lunghezza del
 * rettilineo di partenza; dopo, si aggiunge una curva di raccordo più il
 * rettilineo tangente.
 */
function buildDrawElements(wp) {
  const p = state.project;
  const width = p.track.defaultWidth;
  if (!p.track.elements.length) {
    // finché la partenza non è fissata non si disegna nulla
    if (!state.drawArmed) return null;
    const s = { x: p.track.start.x, y: p.track.start.y };
    const v = G.sub(wp, s);
    const len = G.len(v);
    if (len < 0.5) return null;
    return {
      heading: G.round(Math.atan2(v.y, v.x) * G.RAD, 1),
      els: [makeElement('straight', { length: G.round(len, 2), widthStart: width, widthEnd: width })],
    };
  }
  const els = extendTo(state.analysis.baked, wp, state.drawRadius, width);
  return els.length ? { els } : null;
}

/** calcola l'anteprima: geometria del tratto e suo stato secondo le regole */
function computeGhost(wp) {
  if (!wp) { state.ghost = null; return; }
  const built = buildDrawElements(wp);
  if (!built) { state.ghost = null; return; }
  const clone = JSON.parse(JSON.stringify(state.project));
  if (built.heading !== undefined) clone.track.start.heading = built.heading;
  const base = clone.track.elements.length;
  clone.track.elements.push(...JSON.parse(JSON.stringify(built.els)));
  let a;
  try { a = analyze(clone); } catch (e) { state.ghost = null; return; }
  const first = a.baked.elements[base];
  if (!first) { state.ghost = null; return; }
  const from = first.startStation;
  const keep = (q) => q.s >= from - 1e-6;
  const { left, right } = edgePaths(a.baked);
  const rank = { ok: 0, warn: 1, bad: 2 };
  let level = 'ok';
  const reasons = [];
  for (const el of clone.track.elements.slice(base)) {
    const st = a.status[el.id];
    if (!st) continue;
    if (rank[st.level] > rank[level]) level = st.level;
    for (const r of st.reasons || []) reasons.push(r);
  }
  for (const o of a.outside || []) {
    if (o.to >= from - 1e-6) { level = 'bad'; reasons.push('Il tratto esce dall\'area disponibile'); break; }
  }
  // raccordo molto stretto: si vede prima di cliccare
  const tight = built.els.find((e) => e.type === 'arc' && e.radius < 1);
  if (tight) {
    if (level === 'ok') level = 'warn';
    reasons.push(`Curva molto stretta: raggio interno ${fmtM(tight.radius, 2)}`);
  }
  state.ghost = {
    left: left.filter(keep), right: right.filter(keep), samples: a.baked.samples.filter(keep),
    length: a.baked.totalLength - from, total: a.baked.totalLength,
    level, reasons: [...new Set(reasons)].slice(0, 2),
    turn: built.els.find((e) => e.type === 'arc') || null,
  };
}

let ghostPending = null, ghostRaf = false;
function previewTo(wp) {
  ghostPending = wp;
  if (ghostRaf) return;
  ghostRaf = true;
  requestAnimationFrame(() => {
    ghostRaf = false;
    computeGhost(ghostPending);
    paint();
  });
}
function clearGhost() { if (state.ghost) { state.ghost = null; paint(); } }

/** crea un progetto nuovo con l'area scelta; `withTrack` dà un tracciato di base */
function startNew(withTrack) {
  if (state.home.preset === 'custom' && state.home.shape === 'draw' && (state.home.points || []).length < 3) {
    return toast('Disegna almeno 3 vertici del contorno', true);
  }
  const area = homeArea();
  const b = G.polygonBounds(area.points);
  const p = createProject({
    area,
    discipline: state.home.discipline,
    name: `Percorso ${areaLabel()}`,
    elements: withTrack ? undefined : [],
  });
  p.rules = { ...p.rules, ...rulePreset(p.discipline) };
  if (p.discipline === 'skate') p.startRamp.enabled = true;
  p.track.start = { x: G.round(b.minX + Math.min(8, b.w * 0.12), 1), y: G.round(b.minY + Math.min(6, b.h * 0.15), 1), heading: 0 };
  state.project = p;
  state.tab = 'track';
  state.tool = withTrack ? null : 'draw';
  state.drawArmed = withTrack;
  state.selection = null;
  state.ghost = null;
  afterProjectLoad(false);
  showEditor();
  toast(withTrack
    ? 'Percorso di base creato: modificalo come vuoi'
    : 'Area pronta: clicca sulla mappa per fissare la partenza');
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
  if (t === nameInput) { state.project.name = t.value; commitQuiet(); schedulePanel(); return; }
  if (!t.getAttribute || !t.getAttribute('data-bind')) return;
  if (!applyBind(t)) return;
  if (t.tagName === 'SELECT' || t.type === 'checkbox') { commit(); return; }
  commitQuiet();
  schedulePanel();
});

document.addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  if (ev.key === 'Escape' && state.modal) { closeModal(); return; }
  if (ev.key === 'Escape' && state.flyout) { state.flyout = null; paintTools(); return; }
  if (ev.key === 'Escape') { state.tool = null; state.mode = 'select'; state.selection = null; state.ghost = null; state.measure = null; paintPanel(); paint(); return; }
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

/* ------------------------------------------------------- mini-mappa area */

(function initMinimap() {
  let dragIdx = -1;
  const toWorldMM = (svg, ev) => {
    const r = svg.getBoundingClientRect();
    const sc = +svg.dataset.scale, ox = +svg.dataset.ox, oy = +svg.dataset.oy;
    // le coordinate del riquadro sono in unità viewBox: va riportata la scala
    const vb = svg.viewBox.baseVal;
    const kx = vb.width / r.width, ky = vb.height / r.height;
    const px = (ev.clientX - r.left) * kx, py = (ev.clientY - r.top) * ky;
    return {
      x: G.clamp(Math.round((px - ox) / sc), 0, 150),
      y: G.clamp(Math.round((vb.height - oy - py) / sc), 0, 100),
    };
  };
  homeEl.addEventListener('pointerdown', (ev) => {
    const svg = ev.target.closest && ev.target.closest('#minimap');
    if (!svg) return;
    const vtx = ev.target.closest('[data-mmvtx]');
    state.home.points = state.home.points || [];
    if (vtx) {
      dragIdx = +vtx.getAttribute('data-mmvtx');
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    state.home.points.push(toWorldMM(svg, ev));
    paintHome();
  });
  homeEl.addEventListener('pointermove', (ev) => {
    if (dragIdx < 0) return;
    const svg = document.getElementById('minimap');
    if (!svg) return;
    state.home.points[dragIdx] = toWorldMM(svg, ev);
    paintHome();
  });
  const endMM = () => { dragIdx = -1; };
  homeEl.addEventListener('pointerup', endMM);
  homeEl.addEventListener('pointercancel', endMM);
})();

/* ------------------------------------------------------------- pannello */

const isNarrow = () => window.matchMedia('(max-width:860px)').matches;

function togglePanel() {
  if (isNarrow()) panel.classList.toggle('open');
  else {
    document.body.classList.toggle('panelHidden');
    setTimeout(resize, 220);
  }
}
$('#panelGrip').addEventListener('click', () => panel.classList.toggle('open'));
$('#panelToggle').addEventListener('click', togglePanel);
tabsEl.addEventListener('click', () => { if (isNarrow()) panel.classList.add('open'); });

/* larghezza del pannello regolabile trascinandone il bordo */
const PANEL_W_KEY = 'rc.panelWidth';
function applyPanelWidth(px) {
  const w = G.clamp(px, 280, Math.max(320, window.innerWidth - 420));
  document.documentElement.style.setProperty('--panel-w', w + 'px');
  try { localStorage.setItem(PANEL_W_KEY, String(Math.round(w))); } catch (e) { /* ignora */ }
  resize();
}
(function initPanelResizer() {
  try {
    const saved = +localStorage.getItem(PANEL_W_KEY);
    if (saved) document.documentElement.style.setProperty('--panel-w', G.clamp(saved, 280, 900) + 'px');
  } catch (e) { /* ignora */ }
  const grab = $('#panelGrab');
  if (!grab) return;
  let dragging = false;
  grab.addEventListener('pointerdown', (ev) => {
    if (isNarrow()) return;
    dragging = true;
    grab.setPointerCapture(ev.pointerId);
    document.body.classList.add('resizing');
    ev.preventDefault();
  });
  grab.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    applyPanelWidth(window.innerWidth - ev.clientX);
  });
  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    try { grab.releasePointerCapture(ev.pointerId); } catch (e) { /* ignora */ }
    document.body.classList.remove('resizing');
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  grab.addEventListener('dblclick', () => applyPanelWidth(380));
})();

/* ------------------------------------------------------------------ avvio */

/* ------------------------------------------------- sfondo georeferenziato */

/** sposta lo sfondo di `d` metri nel sistema del disegno */
function panBasemapBy(d) {
  const bm = state.project.basemap;
  const g = worldToLatLon(bm, { x: -d.x, y: -d.y });
  bm.lat = g.lat; bm.lon = g.lon;
}
/** porta il punto reale (lat, lon) sul punto `at` del disegno */
function placeBasemapAt(lat, lon, at) {
  const cur = latLonToWorld(state.project.basemap, lat, lon);
  panBasemapBy({ x: at.x - cur.x, y: at.y - cur.y });
}
/** ruota lo sfondo tenendo fermo il punto `pivot` del disegno */
function rotateBasemapTo(deg, pivot) {
  const bm = state.project.basemap;
  const g = worldToLatLon(bm, pivot);
  bm.rotation = ((deg % 360) + 360) % 360;
  const now = latLonToWorld(bm, g.lat, g.lon);
  panBasemapBy({ x: pivot.x - now.x, y: pivot.y - now.y });
}
const areaCenter = () => G.polygonCentroid(state.project.area.points);

/* punto misurato sull'asse della pista, con progressiva e larghezza */
function measurePoint(wp) {
  const baked = state.analysis.baked;
  const pr = projectPoint(baked, wp);
  const s = G.clamp(pr.station, 0, baked.totalLength);
  const f = frameAt(baked, s);
  return { station: s, point: f.point, width: f.width, side: pr.side };
}

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
    // primo clic su un percorso vuoto: fissa soltanto il punto di partenza
    if (!state.project.track.elements.length && !state.drawArmed) {
      state.project.track.start = { x: G.round(wp.x, 2), y: G.round(wp.y, 2), heading: state.project.track.start.heading || 0 };
      state.drawArmed = true;
      state.ghost = null;
      commit();
      toast('Partenza fissata: muovi il mouse e clicca per fissare la lunghezza');
      return;
    }
    const built = buildDrawElements(wp);
    if (!built) return;
    if (built.heading !== undefined) state.project.track.start.heading = built.heading;
    state.project.track.elements.push(...built.els);
    state.ghost = null;
    commit();
    const last = built.els[built.els.length - 1];
    const info = state.analysis.status[last.id];
    if (info && info.level === 'bad') toast(info.reasons[0] || 'Tratto fuori regola', true);
  },
  previewTo,
  /* trascinamento dello sfondo: sposta l'ancoraggio o lo ruota */
  dragBasemap(drag, wp) {
    const bm = state.project.basemap;
    bm.lat = drag.orig.lat; bm.lon = drag.orig.lon; bm.rotation = drag.orig.rotation;
    if (drag.kind === 'maprot') {
      const pivot = areaCenter();
      const a0 = Math.atan2(drag.from.y - pivot.y, drag.from.x - pivot.x);
      const a1 = Math.atan2(wp.y - pivot.y, wp.x - pivot.x);
      let deg = drag.orig.rotation + (a1 - a0) * G.RAD;
      if (state.snap) deg = Math.round(deg);
      rotateBasemapTo(deg, pivot);
    } else {
      panBasemapBy({ x: wp.x - drag.from.x, y: wp.y - drag.from.y });
    }
    live();
  },
  /* modalità quota: segue il puntatore sull'asse della pista */
  measureTo(wp) {
    const baked = state.analysis.baked;
    // uscendo dal disegno la lettura si spegne, ma il punto fissato resta
    if (!wp || !baked.elements.length) {
      if (state.measure && !state.measure.from) { state.measure = null; paint(); }
      return;
    }
    state.measure = { at: measurePoint(wp), from: state.measure ? state.measure.from : null };
    paint();
  },
  /* clic: fissa il primo punto, un secondo clic azzera la misura */
  measureFix(wp) {
    const baked = state.analysis.baked;
    if (!baked.elements.length) return;
    const at = measurePoint(wp);
    if (state.measure && state.measure.from) state.measure = { at, from: null };
    else state.measure = { at, from: at };
    paint();
  },
  /* posa della linea di arrivo sul percorso */
  setFinishAt(wp) {
    const baked = state.analysis.baked;
    if (!baked.elements.length) { toast('Disegna prima il percorso', true); return; }
    const pr = projectPoint(baked, wp);
    const t = state.project.track;
    const s = G.clamp(pr.station, 0.5, baked.totalLength);
    // a ridosso della fine del tracciato l'arrivo torna "alla fine"
    t.finishAt = s >= baked.totalLength - 0.5 ? null : G.round(s, 2);
    commit();
    const st2 = state.analysis.stats;
    toast(t.finishAt === null
      ? `Arrivo alla fine del tracciato · gara ${fmt(st2.raceLength, 1)} m`
      : `Arrivo alla progressiva ${fmt(t.finishAt, 1)} m${st2.laps > 1 ? ` del ${st2.laps}° passaggio` : ''} · gara ${fmt(st2.raceLength, 1)} m`);
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
  state.mapsKey = store.getMapsKey();
  state.onMapUpdate = () => paint();
  state.localProjects = store.listLocal();
  state.resume = saved || null;
  resize();
  afterProjectLoad();
  showHome();
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
  window.__editor = (fit = true) => showEditor(fit);
  window.__home = () => showHome();
  modalEl.addEventListener('click', (ev) => { if (ev.target === modalEl) closeModal(); });
}

boot();
