/* render.js — disegno 2D del progetto in SVG (coordinate in metri → pixel).
   Tutto il disegno avviene in spazio schermo: le etichette restano quindi
   sempre leggibili e non vengono specchiate dall'asse Y rivolto in alto. */

import * as G from './geometry.js';
import { edgePaths, frameAt, footprint, startGateGeometry, startRampGeometry, finishBandCells } from './track.js';

const { leftOf, dirOf, add, mul, sub } = G;

/* -------------------------------------------------------------- formati */

export const fmt = (v, d = 2) => {
  const s = (Math.abs(v) < 0.005 ? 0 : v).toFixed(d).replace(/\.?0+$/, (m) => (d ? m.replace(/0+$/, '').replace(/\.$/, '') : m));
  return s.replace('.', ',');
};
export const fmtM = (v, d = 2) => fmt(v, d) + ' m';
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- vista */

export function makeView(scale = 10, cx = 0, cy = 0) { return { scale, cx, cy }; }

export function fitView(project, W, H, pad = 60) {
  pad = Math.min(pad, Math.max(18, Math.min(W, H) * 0.08));
  const pts = [...project.area.points];
  const b = G.polygonBounds(pts.length >= 3 ? pts : [G.vec(0, 0), G.vec(50, 50)]);
  const sx = (W - pad * 2) / Math.max(1, b.w);
  const sy = (H - pad * 2) / Math.max(1, b.h);
  const scale = G.clamp(Math.min(sx, sy), 0.5, 200);
  return { scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

export function toScreen(view, W, H, p) {
  return { x: (p.x - view.cx) * view.scale + W / 2, y: H / 2 - (p.y - view.cy) * view.scale };
}
export function toWorld(view, W, H, p) {
  return { x: (p.x - W / 2) / view.scale + view.cx, y: (H / 2 - p.y) / view.scale + view.cy };
}

/* --------------------------------------------------------------- helper */

function pathOf(S, pts, close = false) {
  if (!pts.length) return '';
  let d = `M${S(pts[0]).x.toFixed(1)},${S(pts[0]).y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const q = S(pts[i]);
    d += `L${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }
  return d + (close ? 'Z' : '');
}

function label(x, y, text, cls = '', angle = 0, extra = '') {
  const t = angle ? ` transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"` : '';
  return `<text class="lbl ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"${t}${extra}>${esc(text)}</text>`;
}

/** angolo schermo (gradi) di una direzione world, tenuto leggibile */
function screenAngle(headingRad) {
  let a = -headingRad * G.RAD;
  while (a > 90) a -= 180;
  while (a < -90) a += 180;
  return a;
}

/* ---------------------------------------------------------- disegno main */

/* rettangoli già occupati da etichette importanti (partenza, arrivo…):
   le quote di dettaglio che vi finiscono dentro non si disegnano, così non
   si sovrappongono. Si azzera a ogni disegno. */
let reserved = [];
/** ingombro approssimato di un'etichetta centrata in (x,y) e ruotata di `ang` */
function labelRect(x, y, text, ang = 0, chw = 6.3, lh = 14) {
  const w = Math.max(18, String(text).length * chw);
  const a = ((ang % 180) + 180) % 180;
  const vertical = a > 45 && a < 135;      // testo quasi verticale: ingombro ruotato
  const W = vertical ? lh : w, H = vertical ? w : lh;
  return { x: x - W / 2 - 2, y: y - H / 2 - 2, w: W + 4, h: H + 4 };
}
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const reserve = (x, y, text, ang = 0) => { reserved.push(labelRect(x, y, text, ang)); };
const isReserved = (rect) => reserved.some((b) => overlap(rect, b));

export function render(state) {
  reserved = [];
  const { project, analysis, view, W, H } = state;
  const S = (p) => toScreen(view, W, H, p);
  const k = view.scale;
  const out = [];
  const quota = state.mode === 'quota';
  const showLabels = state.showLabels !== false;
  const detail = k > 6;   // sotto questa scala le quote di dettaglio sono illeggibili

  out.push(grid(state, S));
  out.push(area(state, S));
  out.push(corridor(state, S));
  out.push(startZone(state, S));
  out.push(structures(state, S));
  out.push(ghost(state, S));
  if (showLabels && !quota) out.push(trackLabels(state, S, detail));
  if (quota) out.push(quotaLabels(state, S));
  if (!quota) out.push(handles(state, S));
  out.push(measureOverlay(state, S));
  out.push(scaleBar(state));
  return out.join('');
}

/* griglia metrica */
function grid(state, S) {
  const { view, W, H } = state;
  const k = view.scale;
  const step = k >= 14 ? 1 : k >= 7 ? 2 : k >= 3 ? 5 : k >= 1.2 ? 10 : 25;
  const tl = toWorld(view, W, H, { x: 0, y: 0 });
  const br = toWorld(view, W, H, { x: W, y: H });
  const x0 = Math.floor(tl.x / step) * step, x1 = Math.ceil(br.x / step) * step;
  const y0 = Math.floor(br.y / step) * step, y1 = Math.ceil(tl.y / step) * step;
  if ((x1 - x0) / step > 400 || (y1 - y0) / step > 400) return '';
  let s = '<g class="grid">';
  for (let x = x0; x <= x1; x += step) {
    const a = S({ x, y: y0 }), b = S({ x, y: y1 });
    const major = Math.abs(x % (step * 5)) < 1e-6;
    s += `<line class="${major ? 'g5' : 'g1'}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }
  for (let y = y0; y <= y1; y += step) {
    const a = S({ x: x0, y }), b = S({ x: x1, y });
    const major = Math.abs(y % (step * 5)) < 1e-6;
    s += `<line class="${major ? 'g5' : 'g1'}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }
  return s + '</g>';
}

/* area di lavoro + quote dei lati */
function area(state, S) {
  const { project, view, mode } = state;
  const pts = project.area.points;
  if (pts.length < 3) return '';
  let s = `<g class="area"><path class="areaFill" d="${pathOf(S, pts, true)}"/>`;
  // quote dei lati
  if (view.scale > 3) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const m = G.lerpP(a, b, 0.5);
      const dir = G.norm(sub(b, a));
      const nrm = { x: -dir.y, y: dir.x };
      const c = G.polygonCentroid(pts);
      const outward = G.dot(sub(m, c), nrm) > 0 ? 1 : -1;
      const p = S(add(m, mul(nrm, outward * 1.1)));
      s += label(p.x, p.y, fmtM(G.dist(a, b), 2), 'areaDim', screenAngle(Math.atan2(dir.y, dir.x)), ' text-anchor="middle"');
    }
  }
  if (mode === 'area') {
    pts.forEach((p, i) => {
      const q = S(p);
      s += `<circle class="vtx" data-pick="vertex" data-index="${i}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="9"/>`;
      s += label(q.x + 12, q.y - 10, `V${i + 1} (${fmt(p.x, 1)}; ${fmt(p.y, 1)})`, 'vtxLbl');
    });
  }
  return s + '</g>';
}

/* corridoio di gara */
function corridor(state, S) {
  const { project, analysis, view, selection } = state;
  const baked = analysis.baked;
  if (!baked.elements.length) return '';
  const { left, right } = edgePaths(baked);
  const band = [...left, ...right.slice().reverse()];
  let s = '<g class="corridor">';
  s += `<path class="lane" data-pick="lane" d="${pathOf(S, band, true)}"/>`;

  // tratti fuori area evidenziati
  for (const run of analysis.outside || []) {
    const seg = [];
    for (let t = run.from; t <= run.to; t += 0.4) {
      const f = frameAt(baked, t); seg.push(f.point);
    }
    if (seg.length > 1) s += `<path class="laneOut" d="${pathOf(S, seg)}"/>`;
  }

  // bordi, un path per elemento così da colorarli secondo lo stato
  baked.elements.forEach((el, ei) => {
    const lvl = (analysis.status[el.id] && analysis.status[el.id].level) || 'ok';
    const l = left.filter((p) => p.ei === ei);
    const r = right.filter((p) => p.ei === ei);
    const selCls = selection && selection.kind === 'element' && selection.id === el.id ? ' sel' : '';
    s += `<path class="edge ${lvl}${selCls}" data-pick="element" data-id="${el.id}" d="${pathOf(S, l)}"/>`;
    s += `<path class="edge ${lvl}${selCls}" data-pick="element" data-id="${el.id}" d="${pathOf(S, r)}"/>`;
  });

  // asse: in modalità quota non si disegna
  if (state.mode !== 'quota') s += `<path class="axis" d="${pathOf(S, baked.samples)}"/>`;
  // linea d'arrivo, posata dove finisce la gara
  if (baked.elements.length) s += finishBand(state, S);
  return s + '</g>';
}

/** testo dello sviluppo di gara: passaggi interi + la parte dell'ultimo */
export function raceSummary(s) {
  if (s.laps > 1) {
    const whole = s.laps === 2 ? fmtM(s.totalLength, 2) : `${fmtM(s.totalLength, 2)} × ${s.laps - 1}`;
    return s.finishAt !== null
      ? `${s.laps} passaggi · ${whole} + ${fmtM(s.finishStation, 2)} = ${fmtM(s.raceLength, 2)}`
      : `${s.laps} passaggi · ${fmtM(s.totalLength, 2)} × ${s.laps} = ${fmtM(s.raceLength, 2)}`;
  }
  return s.finishAt !== null
    ? `Gara ${fmtM(s.raceLength, 2)} · giro ${fmtM(s.totalLength, 2)}`
    : `Sviluppo asse ${fmtM(s.totalLength, 2)}`;
}

/* linea di arrivo a scacchi, sulla progressiva dove finisce la gara */
function finishBand(state, S) {
  const { analysis, view } = state;
  const baked = analysis.baked;
  const sts = analysis.stats;
  const fs = Math.min(sts.finishStation != null ? sts.finishStation : baked.totalLength, baked.totalLength);
  const band = finishBandCells(baked, fs);
  const poly = (pts) => pts.map(S).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') + 'Z';
  let s = '<g class="finishBand">';
  for (const c of band.cells) s += `<path class="fq ${c.dark ? 'dark' : 'light'}" d="${poly(c.corners)}"/>`;
  s += `<path class="finishEdge" d="${poly(band.outline)}"/>`;
  if (view.scale > 3) {
    const f = band.frame;
    const p = S(add(f.point, mul(leftOf(f.heading), -(f.width / 2 + 2.2))));
    const ftxt = sts.laps > 1 ? `ARRIVO · ${sts.laps}° passaggio` : 'ARRIVO';
    s += label(p.x, p.y, ftxt, 'finishLbl', screenAngle(f.heading), ' text-anchor="middle"');
    reserve(p.x, p.y, ftxt, screenAngle(f.heading));
  }
  return s + '</g>';
}

/* quote della modalità quota: solo i raggi delle curve */
function quotaLabels(state, S) {
  const { analysis, view } = state;
  const baked = analysis.baked;
  if (!baked.elements.length || view.scale < 2.5) return '';
  let s = '<g class="quotaLbl">';
  for (const el of baked.elements) {
    if (el.type !== 'arc') continue;
    const f = frameAt(baked, (el.startStation + el.endStation) / 2);
    const nn = leftOf(f.heading);
    const p = S(add(f.point, mul(nn, f.width / 2 + 1.4)));
    const lvl = (analysis.status[el.id] && analysis.status[el.id].level) || 'ok';
    s += label(p.x, p.y, `R ${fmt(el.radius, 2)}`, `elLbl ${lvl}`, screenAngle(f.heading), ' text-anchor="middle"');
  }
  return s + '</g>';
}

/* lettura delle misure in modalità quota */
function measureOverlay(state, S) {
  const m = state.measure;
  if (!m || !m.at) return '';
  const baked = state.analysis.baked;
  let s = '<g class="measure">';
  const here = S(m.at.point);
  // crocetta sul punto
  s += `<line class="mCross" x1="${(here.x - 7).toFixed(1)}" y1="${here.y.toFixed(1)}" x2="${(here.x + 7).toFixed(1)}" y2="${here.y.toFixed(1)}"/>`;
  s += `<line class="mCross" x1="${here.x.toFixed(1)}" y1="${(here.y - 7).toFixed(1)}" x2="${here.x.toFixed(1)}" y2="${(here.y + 7).toFixed(1)}"/>`;

  const rows = [];
  if (m.from) {
    const a = Math.min(m.from.station, m.at.station), b = Math.max(m.from.station, m.at.station);
    const seg = baked.samples.filter((q) => q.s >= a - 1e-6 && q.s <= b + 1e-6);
    if (seg.length > 1) s += `<path class="mPath" d="${pathOf(S, seg)}"/>`;
    const p0 = S(m.from.point);
    s += `<circle class="mDot" cx="${p0.x.toFixed(1)}" cy="${p0.y.toFixed(1)}" r="4"/>`;
    rows.push(['sull\'asse', fmtM(b - a, 2)]);
    rows.push(['in linea d\'aria', fmtM(G.dist(m.from.point, m.at.point), 2)]);
    rows.push(['da', `${fmt(a, 1)} a ${fmt(b, 1)} m`]);
  } else {
    rows.push(['progressiva', fmtM(m.at.station, 2)]);
    rows.push(['corsia', fmtM(m.at.width, 2)]);
    rows.push(['manca all\'arrivo', fmtM(Math.max(0, (state.analysis.stats.finishStation || baked.totalLength) - m.at.station), 2)]);
  }
  const bw = 168, bh = 16 + rows.length * 13;
  let bx = here.x + 14, by = here.y - bh - 10;
  if (bx + bw > state.W - 8) bx = here.x - bw - 14;
  if (by < 8) by = here.y + 14;
  s += `<rect class="mBox" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="${bh}" rx="7"/>`;
  rows.forEach(([k, v], i) => {
    s += label(bx + 9, by + 16 + i * 13, k, 'mKey');
    s += label(bx + bw - 9, by + 16 + i * 13, v, 'mVal', 0, ' text-anchor="end"');
  });
  if (!m.from) s += label(bx + 9, by + bh + 11, 'clicca per fissare il primo punto', 'mHint');
  return s + '</g>';
}

/* griglia di partenza (roller) o rampa di partenza (skate) */
function startZone(state, S) {
  const { project, analysis, view } = state;
  const baked = analysis.baked;
  let s = '<g class="start">';
  const gate = startGateGeometry(project, baked);
  if (gate) {
    const lvl = (analysis.status['__gate'] && analysis.status['__gate'].level) || 'ok';
    for (const b of gate.boxes) {
      s += `<path class="startBox ${lvl}" data-pick="gate" d="${pathOf(S, b.corners, true)}"/>`;
      if (view.scale > 7) {
        const c = S(b.center);
        s += label(c.x, c.y + 4, String(b.lane), 'boxNum', 0, ' text-anchor="middle"');
      }
    }
    for (const line of gate.laneLines) {
      s += `<path class="laneLine" d="${pathOf(S, line)}"/>`;
    }
    const a = S(gate.startLine[0]), b = S(gate.startLine[1]);
    s += `<line class="startLine" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
    if (view.scale > 5) {
      const ang0 = screenAngle(baked.startHeading);
      const up = S(add(gate.center, mul(leftOf(baked.startHeading), gate.totalWidth / 2 + 2.3)));
      const gateTxt = view.scale > 9
        ? `PARTENZA · ${gate.lanes} box ${fmt(gate.depth, 2)} × ${fmt(gate.laneWidth, 2)} m = fronte ${fmtM(gate.totalWidth, 2)}`
        : `PARTENZA · fronte ${fmtM(gate.totalWidth, 2)}`;
      s += label(up.x, up.y, gateTxt, 'startLbl', ang0, ' text-anchor="middle"');
      reserve(up.x, up.y, gateTxt, ang0);
      const runS = Math.min(gate.runout, baked.totalLength);
      const fr = frameAt(baked, runS / 2);
      const run = S(add(fr.point, mul(leftOf(fr.heading), -(gate.totalWidth / 2 + 1.5))));
      const runTxt = `corsie guidate ${fmtM(gate.runout, 2)}`;
      s += label(run.x, run.y, runTxt, 'startLbl dim', screenAngle(fr.heading), ' text-anchor="middle"');
      reserve(run.x, run.y, runTxt, screenAngle(fr.heading));
    }
  }
  const ramp = startRampGeometry(project, baked);
  if (ramp) {
    const lvl = (analysis.status['__startramp'] && analysis.status['__startramp'].level) || 'ok';
    s += `<path class="struct ${lvl} startRamp" data-pick="startramp" d="${pathOf(S, ramp.corners, true)}"/>`;
    s += structureText(state, S, ramp.struct, ramp, null);
  }
  return s + '</g>';
}

/* strutture viste dall'alto */
function structures(state, S) {
  const { project, analysis, selection, view } = state;
  const baked = analysis.baked;
  let s = '<g class="structs">';
  for (const st of project.structures) {
    const fp = footprint(st, baked);
    const info = analysis.status[st.id] || { level: 'ok' };
    const sel = selection && selection.kind === 'structure' && selection.id === st.id;
    s += `<path class="struct ${info.level}${sel ? ' sel' : ''}" data-pick="structure" data-id="${st.id}" d="${pathOf(S, fp.corners, true)}"/>`;
    // freccia del senso di marcia
    if (view.scale > 6 && state.mode !== 'quota') {
      const c = fp.frame.center, d = dirOf(fp.frame.heading);
      const a1 = S(add(c, mul(d, st.length / 2 - 0.35)));
      const a2 = S(add(c, mul(d, st.length / 2 - 1.1)));
      s += `<line class="arrow" x1="${a2.x.toFixed(1)}" y1="${a2.y.toFixed(1)}" x2="${a1.x.toFixed(1)}" y2="${a1.y.toFixed(1)}"/>`;
    }
    s += structureText(state, S, st, fp, info);
  }
  return s + '</g>';
}

/** accorcia il testo che non entra nella sagoma */
function fitText(txt, pxWidth, perChar = 5.6) {
  const maxChars = Math.max(3, Math.floor(pxWidth / perChar));
  return txt.length <= maxChars ? txt : txt.slice(0, maxChars - 1) + '…';
}

/** spezza il testo in righe sulle parole, senza mai troncare a metà */
function wrapWords(txt, maxChars, maxLines = 3) {
  const words = String(txt).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length <= maxChars || !cur) { cur = next; continue; }
    lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // se è rimasto fuori qualcosa lo si segnala sull'ultima riga
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:]?$/, '…');
  }
  return lines;
}

/* nome + altezza dentro la sagoma, quote sui lati, distanza dal precedente */
function structureText(state, S, st, fp, info) {
  const { view } = state;
  const k = view.scale;
  const quota = state.mode === 'quota';
  const c = fp.frame.center;
  const h = fp.frame.heading;
  const d = dirOf(h), n = leftOf(h);
  const pxLen = st.length * k, pxWid = st.width * k;
  let s = '';

  // il testo segue il lato più lungo della sagoma: così nome e altezza
  // entrano anche nelle strutture corte e larghe (gobbe, rampe)
  const across = pxWid > pxLen * 1.15;
  const avail = across ? pxWid : pxLen;          // spazio per il testo
  const thick = across ? pxLen : pxWid;          // spazio per le due righe
  const ang = across ? screenAngle(h + Math.PI / 2) : screenAngle(h);
  const lineAxis = across ? d : n;               // asse su cui separare le righe
  const sep = (across ? st.length : st.width) / 4;

  if (avail > 48 && thick > 26 && !quota) {
    const p1 = S(add(c, mul(lineAxis, sep)));
    const p2 = S(sub(c, mul(lineAxis, sep)));
    const small = st.name.length * 6.6 > avail;
    const nameTxt = fitText(st.name, avail);
    s += label(p1.x, p1.y + 4, nameTxt, 'stName' + (small ? ' small' : ''), ang, ' text-anchor="middle"');
    s += label(p2.x, p2.y + 4, `h ${fmtM(st.height, 2)}`, 'stH', ang, ' text-anchor="middle"');
    reserve(p1.x, p1.y + 4, nameTxt, ang);
  } else if (avail > 30 || (quota && avail > 24)) {
    const c0 = S(c);
    s += label(c0.x, c0.y + 3, fitText(st.name, avail), 'stName small', ang, ' text-anchor="middle"');
  }

  // quote sui lati: lunghezza lungo il percorso, larghezza in trasversale
  if (k > 8 && !quota) {
    const pL = S(sub(c, mul(n, st.width / 2 + 0.55)));
    s += label(pL.x, pL.y, fmtM(st.length, 2), 'stDim', screenAngle(h), ' text-anchor="middle"');
    const pW = S(sub(c, mul(d, st.length / 2 + 0.55)));
    s += label(pW.x, pW.y, fmtM(st.width, 2), 'stDim', screenAngle(h + Math.PI / 2), ' text-anchor="middle"');
  }

  // distanza dall'ostacolo precedente
  if (info && info.gap != null && k > 7 && !quota) {
    const p = S(add(add(c, mul(d, -(st.length / 2 + 1.6))), mul(n, st.width / 2 + 1.1)));
    const gTxt = `Δ ${fmtM(info.gap, 2)}`;
    s += label(p.x, p.y, gTxt, `gapLbl ${info.level}`, 0, ' text-anchor="middle"');
    reserve(p.x, p.y, gTxt);
  }
  return s;
}

/* quote del percorso: lunghezza totale al centro, lunghezze e raggi */
function trackLabels(state, S, detail) {
  const { analysis, view, project } = state;
  const baked = analysis.baked;
  if (!baked.elements.length) return '';
  const k = view.scale;
  const sts = analysis.stats;
  let s = '<g class="trackLbl">';

  /* riquadro dello sviluppo: si calcola prima per sapere dove cade, ma si
     disegna per ultimo così nessuna quota ci finisce sopra */
  const mid = frameAt(baked, baked.totalLength / 2);
  const n = leftOf(mid.heading);
  let cx = 0, cy = 0;
  for (const q of baked.samples) { cx += q.x; cy += q.y; }
  cx /= baked.samples.length; cy /= baked.samples.length;
  const toward = G.dot(sub({ x: cx, y: cy }, mid.point), n) >= 0 ? 1 : -1;
  const pm = S(add(mid.point, mul(n, toward * (mid.width / 2 + 2.6))));
  const mainTxt = raceSummary(sts);
  const subTxt = `corsia ${fmtM(sts.minWidth, 2)}–${fmtM(sts.maxWidth, 2)}${sts.isClosed ? ' · anello chiuso' : ''}`;
  const bw = Math.max(152, mainTxt.length * 7.3 + 26, subTxt.length * 5.8 + 26);
  const boxRect = { x: pm.x - bw / 2 - 6, y: pm.y - 22, w: bw + 12, h: 44 };
  // una quota si disegna solo se il suo ingombro non tocca il riquadro
  // dello sviluppo né le etichette già riservate (partenza, arrivo…)
  const inBox = (p, text = '', ang = 0) => {
    const rect = labelRect(p.x, p.y, text, ang);
    return overlap(rect, boxRect) || isReserved(rect);
  };

  if (detail) {
    let prevWidth = null;
    baked.elements.forEach((el, i) => {
      const lvl = (analysis.status[el.id] && analysis.status[el.id].level) || 'ok';
      // etichetta dell'elemento solo se c'è spazio e se non finisce sul riquadro
      if (el.length * k > 58) {
        const f = frameAt(baked, (el.startStation + el.endStation) / 2);
        const nn = leftOf(f.heading);
        const p = S(add(f.point, mul(nn, f.width / 2 + 1.5)));
        const txt = el.type === 'arc'
          ? `curva R${fmt(el.radius, 1)} · ${fmt(el.angle, 0)}° · ${fmtM(el.length, 2)}`
          : `rettilineo ${fmtM(el.length, 2)}`;
        const ang = screenAngle(f.heading);
        if (!inBox(p, txt, ang)) {
          s += label(p.x, p.y, txt, `elLbl ${lvl}`, screenAngle(f.heading), ' text-anchor="middle"');
          reserve(p.x, p.y, txt, ang);
        }
      }
      // quota di larghezza solo dove la corsia cambia (e all'inizio)
      const changed = prevWidth === null || Math.abs(el.widthStart - prevWidth) > 0.01;
      if (changed && k > 8) {
        const f0 = frameAt(baked, el.startStation);
        const n0 = leftOf(f0.heading);
        const a = S(add(f0.point, mul(n0, f0.width / 2)));
        const b = S(sub(f0.point, mul(n0, f0.width / 2)));
        s += `<line class="widthTick" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
        const pw = S(sub(f0.point, mul(n0, f0.width / 2 + 1.1)));
        const wTxt = fmtM(f0.width, 2), wAng = screenAngle(f0.heading + Math.PI / 2);
        if (!inBox(pw, wTxt, wAng)) {
          s += label(pw.x, pw.y, wTxt, `wLbl ${f0.width < project.rules.minWidth ? 'bad' : 'ok'}`, wAng, ' text-anchor="middle"');
          reserve(pw.x, pw.y, wTxt, wAng);
        }
        if (k > 12) {
          const ps = S(add(f0.point, mul(n0, f0.width / 2 + 1.1)));
          const sTxt = `${fmt(el.startStation, 1)} m`, sAng = screenAngle(f0.heading + Math.PI / 2);
          if (!inBox(ps, sTxt, sAng)) {
            s += label(ps.x, ps.y, sTxt, 'stationLbl', sAng, ' text-anchor="middle"');
            reserve(ps.x, ps.y, sTxt, sAng);
          }
        }
      }
      if (i === baked.elements.length - 1 && Math.abs(el.widthEnd - el.widthStart) > 0.01 && k > 8) {
        const f1 = frameAt(baked, el.endStation);
        const n1 = leftOf(f1.heading);
        const pw = S(sub(f1.point, mul(n1, f1.width / 2 + 1.1)));
        const wTxt1 = fmtM(f1.width, 2), wAng1 = screenAngle(f1.heading + Math.PI / 2);
        if (!inBox(pw, wTxt1, wAng1)) {
          s += label(pw.x, pw.y, wTxt1, `wLbl ${f1.width < project.rules.minWidth ? 'bad' : 'ok'}`, wAng1, ' text-anchor="middle"');
          reserve(pw.x, pw.y, wTxt1, wAng1);
        }
      }
      prevWidth = el.widthEnd;
    });
  }

  s += `<rect class="totalBg" x="${(pm.x - bw / 2).toFixed(1)}" y="${(pm.y - 16).toFixed(1)}" width="${bw.toFixed(1)}" height="32" rx="7"/>`;
  s += label(pm.x, pm.y - 1, mainTxt, 'totalLbl', 0, ' text-anchor="middle"');
  s += label(pm.x, pm.y + 12, subTxt, 'totalSub', 0, ' text-anchor="middle"');
  return s + '</g>';
}

/* anteprima del tratto che si sta disegnando */
function ghost(state, S) {
  const g = state.ghost;
  if (!g || !g.samples || g.samples.length < 2) return '';
  let s = `<g class="ghost ${g.level}">`;
  s += `<path class="ghostLane" d="${pathOf(S, [...g.left, ...g.right.slice().reverse()], true)}"/>`;
  s += `<path class="ghostEdge" d="${pathOf(S, g.left)}"/>`;
  s += `<path class="ghostEdge" d="${pathOf(S, g.right)}"/>`;
  s += `<path class="ghostAxis" d="${pathOf(S, g.samples)}"/>`;
  const end = S(g.samples[g.samples.length - 1]);
  const reasonLines = g.reasons.length ? wrapWords(g.reasons[0], 32, 3) : [];
  const bw = reasonLines.length ? 214 : 158;
  const bh = 34 + reasonLines.length * 12;
  // il riquadro resta dentro la finestra anche col puntatore sul bordo
  let bx = end.x + 16, by = end.y - bh - 10;
  if (bx + bw > state.W - 8) bx = end.x - bw - 16;
  if (bx < 8) bx = 8;
  if (by < 8) by = end.y + 16;
  if (by + bh > state.H - 8) by = state.H - bh - 8;
  s += `<rect class="ghostBg ${g.level}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="${bh}" rx="7"/>`;
  s += label(bx + 9, by + 15, `+ ${fmtM(g.length, 2)}${g.turn ? ` · curva R${fmt(g.turn.radius, 1)}` : ''}`, 'ghostLbl b');
  s += label(bx + 9, by + 28, `sviluppo totale ${fmtM(g.total, 2)}`, 'ghostLbl sub');
  reasonLines.forEach((ln, i) => {
    s += label(bx + 9, by + 40 + i * 12, ln, 'ghostLbl bad');
  });
  return s + '</g>';
}

/* maniglie di editing */
function handles(state, S) {
  const { analysis, mode, selection, project } = state;
  const baked = analysis.baked;
  if (mode === 'area' || mode === 'view') return '';
  let s = '<g class="handles">';

  // maniglia di partenza + rotazione
  const sp = S(baked.startPoint);
  s += `<circle class="h start" data-pick="trackstart" cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="9"/>`;
  const rp = S(add(baked.startPoint, mul(dirOf(baked.startHeading), -3.2)));
  s += `<line class="hLink" x1="${sp.x.toFixed(1)}" y1="${sp.y.toFixed(1)}" x2="${rp.x.toFixed(1)}" y2="${rp.y.toFixed(1)}"/>`;
  s += `<circle class="h rot" data-pick="trackrot" cx="${rp.x.toFixed(1)}" cy="${rp.y.toFixed(1)}" r="8"/>`;

  // maniglie di fine elemento
  for (const el of baked.elements) {
    const q = S(el.endPoint);
    const sel = selection && selection.kind === 'element' && selection.id === el.id;
    s += `<circle class="h node${sel ? ' sel' : ''}" data-pick="node" data-id="${el.id}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${sel ? 8 : 6}"/>`;
    if (el.type === 'arc' && sel) {
      const c = S(el.center);
      s += `<circle class="arcCenter" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3"/>`;
      s += `<line class="hLink" x1="${c.x.toFixed(1)}" y1="${c.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"/>`;
    }
  }
  return s + '</g>';
}

/* barra di scala */
function scaleBar(state) {
  const { view, H } = state;
  const targets = [1, 2, 5, 10, 20, 50, 100];
  let m = targets[0];
  for (const t of targets) if (t * view.scale <= 150) m = t;
  const px = m * view.scale;
  const y = H - 22;
  return `<g class="scaleBar"><line x1="18" y1="${y}" x2="${18 + px}" y2="${y}"/>` +
    `<line x1="18" y1="${y - 5}" x2="18" y2="${y + 5}"/>` +
    `<line x1="${18 + px}" y1="${y - 5}" x2="${18 + px}" y2="${y + 5}"/>` +
    `<text class="lbl scaleTxt" x="${18 + px / 2}" y="${y - 9}" text-anchor="middle">${fmtM(m, 0)}</text></g>`;
}

/* ------------------------------------------------- miniatura (candidati) */

export function thumbSVG(project, analysis, w = 220, h = 150) {
  const b = G.polygonBounds(project.area.points);
  const pad = 8;
  const scale = Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h));
  const view = { scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
  const S = (p) => toScreen(view, w, h, p);
  const baked = analysis.baked;
  let s = `<svg class="thumb" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
  s += `<path class="areaFill" d="${pathOf(S, project.area.points, true)}"/>`;
  if (baked.elements.length) {
    const { left, right } = edgePaths(baked);
    s += `<path class="lane" d="${pathOf(S, [...left, ...right.slice().reverse()], true)}"/>`;
    s += `<path class="axis" d="${pathOf(S, baked.samples)}"/>`;
  }
  for (const st of project.structures) {
    const fp = footprint(st, baked);
    const lvl = (analysis.status[st.id] && analysis.status[st.id].level) || 'ok';
    s += `<path class="struct ${lvl}" d="${pathOf(S, fp.corners, true)}"/>`;
  }
  const gate = startGateGeometry(project, baked);
  if (gate) for (const bx of gate.boxes) s += `<path class="startBox ok" d="${pathOf(S, bx.corners, true)}"/>`;
  const ramp = startRampGeometry(project, baked);
  if (ramp) s += `<path class="struct ok" d="${pathOf(S, ramp.corners, true)}"/>`;
  return s + '</svg>';
}
