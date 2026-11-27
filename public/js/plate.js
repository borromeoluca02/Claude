/* plate.js — tavola tecnica in scala con cartiglio.
   Produce fogli SVG autonomi con unità in MILLIMETRI (1 unità = 1 mm), così
   che stampati al 100% rispettino la scala dichiarata (es. 1:200 → 1 m = 5 mm).
   Fogli prodotti: planimetria quotata, distinta degli ostacoli e verifica di
   conformità al regolamento. */

import * as G from './geometry.js';
import { edgePaths, frameAt, footprint, startGateGeometry, startRampGeometry, finishBandCells } from './track.js';
import { tileLayer } from './basemap.js';
import { fmt, fmtM, raceSummary } from './render.js';
import { GROUP_LABELS } from './model.js';
import { REG_SOURCE } from './regulation.js';

const { add, sub, mul, dirOf, leftOf } = G;

/* formati in mm (verticali: larghezza × altezza) */
export const SHEETS = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
};
export const SCALES = [50, 100, 200, 250, 500, 1000, 2000];

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const n1 = (v) => fmt(v, 1);
const n2 = (v) => fmt(v, 2);

export function sheetSize(sheet = 'A3', orientation = 'landscape') {
  const [w, h] = SHEETS[sheet] || SHEETS.A3;
  return orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

/* -------------------------------------------------------- impaginazione */

function layout(sheet, orientation) {
  const { w, h } = sheetSize(sheet, orientation);
  const small = Math.min(w, h) < 250;
  const margin = { left: small ? 12 : 20, right: small ? 8 : 10, top: small ? 8 : 10, bottom: small ? 8 : 10 };
  const frame = { x: margin.left, y: margin.top, w: w - margin.left - margin.right, h: h - margin.top - margin.bottom };
  const title = { w: Math.min(frame.w, small ? 150 : 185), h: small ? 44 : 50 };
  title.x = frame.x + frame.w - title.w;
  title.y = frame.y + frame.h - title.h;
  const draw = { x: frame.x, y: frame.y, w: frame.w, h: frame.h - title.h - 3 };
  return { w, h, frame, title, draw, small };
}

/** scala più ricca che fa stare il disegno nell'area utile */
export function autoScale(project, sheet, orientation, pad = 16) {
  const { draw } = layout(sheet, orientation);
  const b = G.polygonBounds(project.area.points);
  for (const s of SCALES) {
    const wmm = (b.w * 1000) / s, hmm = (b.h * 1000) / s;
    if (wmm + pad * 2 <= draw.w && hmm + pad * 2 <= draw.h) return s;
  }
  return SCALES[SCALES.length - 1];
}

/* --------------------------------------------------------------- stili */

const STYLE = `
svg.plate text{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;fill:#111;paint-order:stroke fill;stroke:#fff;stroke-width:.5;stroke-linejoin:round}
svg.plate .thin{stroke:#111;stroke-width:.18;fill:none}
svg.plate .med{stroke:#111;stroke-width:.35;fill:none}
svg.plate .thick{stroke:#111;stroke-width:.6;fill:none}
svg.plate .frame{stroke:#111;stroke-width:.7;fill:none}
svg.plate .grid{stroke:#c9d3de;stroke-width:.1}
svg.plate .area{fill:#fff;stroke:#111;stroke-width:.5;stroke-dasharray:4 2}
svg.plate .lane{fill:#e9eef4;stroke:none}
svg.plate .edge{fill:none;stroke:#111;stroke-width:.5}
svg.plate .axis{fill:none;stroke:#444;stroke-width:.25;stroke-dasharray:3 1.6}
svg.plate .obst{fill:#d8e6db;stroke:#111;stroke-width:.4}
svg.plate .obst.bad{fill:#f4dada}
svg.plate .gate{fill:#fdf6d8;stroke:#111;stroke-width:.35}
svg.plate .gateline{fill:none;stroke:#111;stroke-width:.25;stroke-dasharray:2.2 1.6}
svg.plate .startline{stroke:#111;stroke-width:.9}
svg.plate .fqd{fill:#111;stroke:none}
svg.plate .fql{fill:#fff;stroke:none}
svg.plate .fqbox{fill:none;stroke:#111;stroke-width:.35}
svg.plate .dim{stroke:#111;stroke-width:.18;fill:none}
svg.plate .tagc{fill:#fff;stroke:#111;stroke-width:.35}
svg.plate .cell{stroke:#111;stroke-width:.18;fill:none}
svg.plate .hdr{fill:#e8eef5;stroke:#111;stroke-width:.18}
svg.plate .row{fill:#fff;stroke:#111;stroke-width:.18}
svg.plate .t2{font-size:2px}
svg.plate .t22{font-size:2.2px}
svg.plate .t25{font-size:2.5px}
svg.plate .t3{font-size:3px}
svg.plate .t35{font-size:3.5px}
svg.plate .t5{font-size:5px}
svg.plate .t7{font-size:7px}
svg.plate .b{font-weight:700}
svg.plate .c{text-anchor:middle}
svg.plate .r{text-anchor:end}
svg.plate .gray{fill:#555}
svg.plate .ok{fill:#1f7a3f}
svg.plate .no{fill:#c01f1f}
`;

const T = (x, y, s, cls = 't25', extra = '') =>
  `<text x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" class="${cls}"${extra}>${esc(s)}</text>`;
const L = (x1, y1, x2, y2, cls = 'thin') =>
  `<line x1="${+x1.toFixed(2)}" y1="${+y1.toFixed(2)}" x2="${+x2.toFixed(2)}" y2="${+y2.toFixed(2)}" class="${cls}"/>`;
const R = (x, y, w, h, cls = 'thin', extra = '') =>
  `<rect x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" width="${+w.toFixed(2)}" height="${+h.toFixed(2)}" class="${cls}"${extra}/>`;

function poly(pts, cls, close = true) {
  if (!pts.length) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + (close ? 'Z' : '');
  return `<path class="${cls}" d="${d}"/>`;
}

/* ------------------------------------------------------- foglio e cornice */

function sheetOpen(lay, extraDefs = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="plate" width="${lay.w}mm" height="${lay.h}mm" viewBox="0 0 ${lay.w} ${lay.h}">` +
    `<style>${STYLE}</style>${extraDefs}<rect width="${lay.w}" height="${lay.h}" fill="#fff"/>` +
    R(lay.frame.x, lay.frame.y, lay.frame.w, lay.frame.h, 'frame');
}

/* ------------------------------------------------------------- cartiglio */

function titleBlock(project, analysis, lay, opts, pageNo, pageTot, scale, sheetTitle) {
  const t = lay.title;
  const pl = project.plate || {};
  const s = analysis.stats;
  const reg = analysis.regulation || [];
  const regKo = reg.filter((c) => !c.ok).length;
  const bad = analysis.issues.filter((i) => i.level === 'bad').length;
  const date = pl.date || new Date().toLocaleDateString('it-IT');
  let o = R(t.x, t.y, t.w, t.h, 'frame');

  // griglia interna: 3 fasce
  const r1 = t.y + 11, r2 = t.y + 30;
  o += L(t.x, r1, t.x + t.w, r1, 'med');
  o += L(t.x, r2, t.x + t.w, r2, 'med');
  const colW = t.w / 3;
  o += L(t.x + colW, r1, t.x + colW, r2, 'thin');
  o += L(t.x + colW * 2, r1, t.x + colW * 2, r2, 'thin');
  const r3 = t.y + t.h - 11;
  o += L(t.x, r3, t.x + t.w, r3, 'med');

  // intestazione
  o += T(t.x + 2.5, t.y + 5, (project.discipline === 'roller' ? 'ROLLER CROSS' : 'SKATE CROSS') + ' — ' + (sheetTitle || 'PLANIMETRIA PERCORSO DI GARA'), 't3 b');
  o += T(t.x + 2.5, t.y + 9.2, (project.name || 'Percorso') + (pl.location ? ' · ' + pl.location : ''), 't25');

  // colonna 1: dati del tracciato
  const c1 = t.x + 2.5;
  const line = (x, i, label, val, cls = 't22') =>
    T(x, r1 + 4.2 + i * 3.6, label, cls + ' gray') + T(x + 26, r1 + 4.2 + i * 3.6, val, cls + ' b');
  o += s.laps > 1 || s.finishAt !== null
    ? line(c1, 0, 'Sviluppo di gara', `${n2(s.raceLength)} m${s.laps > 1 ? ` (${s.laps} passaggi)` : ` (giro ${n2(s.totalLength)} m)`}`)
    : line(c1, 0, 'Sviluppo asse', `${n2(s.totalLength)} m`);
  o += line(c1, 1, 'Rettilinei / curve', `${n1(s.straightLength)} / ${n1(s.curveLength)} m`);
  o += line(c1, 2, 'Curve (dx / sx)', `${s.curveCount} (${s.curvesRight} / ${s.curvesLeft})`);
  o += line(c1, 3, 'Larghezza corsia', `${n2(s.minWidth)} – ${n2(s.maxWidth)} m`);

  // colonna 2: ostacoli e area
  const c2 = t.x + colW + 2.5;
  o += line(c2, 0, 'Ostacoli', `${s.structureCount}`);
  o += line(c2, 1, 'Categoria', categoryLabel(project));
  o += line(c2, 2, 'Superficie area', `${n1(s.areaValue)} m²`);
  o += line(c2, 3, 'Pavimentazione', pl.surface || '—');

  // colonna 3: conformità
  const c3 = t.x + colW * 2 + 2.5;
  o += T(c3, r1 + 4.2, 'VERIFICA REGOLAMENTO', 't2 gray b');
  o += T(c3, r1 + 8.4, regKo ? `${regKo} controlli non soddisfatti` : 'Conforme a tutti i controlli', 't22 b ' + (regKo ? 'no' : 'ok'));
  o += T(c3, r1 + 12.2, bad ? `${bad} elementi fuori regola nel disegno` : 'Nessun elemento fuori regola', 't2 ' + (bad ? 'no' : 'gray'));
  o += T(c3, r1 + 16.4, 'FISR 2025-2026 · Art. 65/102', 't2 gray');

  // fascia inferiore: scala, formato, data, firme
  const b1 = t.x + 2.5, by = r3 + 4;
  o += T(b1, by, 'SCALA', 't2 gray') + T(b1, by + 4.6, `1:${scale}`, 't35 b');
  o += T(b1 + 22, by, 'FORMATO', 't2 gray') + T(b1 + 22, by + 4.6, `${opts.sheet} ${opts.orientation === 'portrait' ? 'vert.' : 'oriz.'}`, 't25 b');
  o += T(b1 + 48, by, 'DATA', 't2 gray') + T(b1 + 48, by + 4.6, date, 't25 b');
  o += T(b1 + 74, by, 'REDATTO DA', 't2 gray') + T(b1 + 74, by + 4.6, pl.author || '', 't25 b');
  o += T(b1 + 112, by, 'ORGANIZZAZIONE', 't2 gray') + T(b1 + 112, by + 4.6, pl.organization || '', 't25 b');
  o += T(t.x + t.w - 2.5, by + 4.6, `Foglio ${pageNo}/${pageTot}`, 't25 b r');
  return o;
}

function categoryLabel(project) {
  const map = { gioeso: 'Gio./Eso.', ragallmas: 'Rag./All./Mas.', junsen: 'Jun./Sen.' };
  return map[project.category] || '—';
}

/* ------------------------------------------------- quote (linee di misura) */

function dimLine(a, b, off, text, flip = false) {
  // a,b in mm; linea di quota parallela spostata di `off` mm
  const d = G.norm(sub(b, a));
  const n = { x: -d.y, y: d.x };
  const s = flip ? -1 : 1;
  const A = add(a, mul(n, off * s)), B = add(b, mul(n, off * s));
  let o = L(a.x, a.y, A.x + n.x * 1.5 * s, A.y + n.y * 1.5 * s, 'dim');
  o += L(b.x, b.y, B.x + n.x * 1.5 * s, B.y + n.y * 1.5 * s, 'dim');
  o += L(A.x, A.y, B.x, B.y, 'dim');
  // trattini a 45° alle estremità
  const t1 = mul(G.rot(d, Math.PI / 4), 1.4);
  o += L(A.x - t1.x, A.y - t1.y, A.x + t1.x, A.y + t1.y, 'dim');
  o += L(B.x - t1.x, B.y - t1.y, B.x + t1.x, B.y + t1.y, 'dim');
  const m = G.lerpP(A, B, 0.5);
  let ang = Math.atan2(B.y - A.y, B.x - A.x) * G.RAD;
  if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  o += `<text x="${m.x.toFixed(2)}" y="${(m.y - 1.1).toFixed(2)}" class="t25 c" transform="rotate(${ang.toFixed(1)} ${m.x.toFixed(2)} ${m.y.toFixed(2)})">${esc(text)}</text>`;
  return o;
}

/* -------------------------------------------------- foglio 1: planimetria */

export function platePlan(project, analysis, opts = {}) {
  const sheet = opts.sheet || 'A3';
  const orientation = opts.orientation || 'landscape';
  const lay = layout(sheet, orientation);
  const scale = opts.scale && opts.scale !== 'auto' ? +opts.scale : autoScale(project, sheet, orientation);
  const mm = (m) => (m * 1000) / scale;             // metri → mm
  const baked = analysis.baked;

  const b = G.polygonBounds(project.area.points);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const ox = lay.draw.x + lay.draw.w / 2;
  const oy = lay.draw.y + lay.draw.h / 2;
  const P = (p) => ({ x: ox + mm(p.x - cx), y: oy - mm(p.y - cy) });
  const fits = mm(b.w) + 24 <= lay.draw.w && mm(b.h) + 24 <= lay.draw.h;

  let o = sheetOpen(lay);
  o += `<clipPath id="dc"><rect x="${lay.draw.x}" y="${lay.draw.y}" width="${lay.draw.w}" height="${lay.draw.h}"/></clipPath>`;
  o += `<g clip-path="url(#dc)">`;

  // sfondo fotografico, sotto a tutto e dentro il riquadro di disegno
  const bm = project.basemap;
  if (bm && bm.on && bm.onPlate) {
    const view = { scale: 1000 / scale, cx, cy };
    const L = tileLayer(bm, view, ox * 2, oy * 2, {
      apiKey: opts.mapsKey, customUrl: bm.customUrl, rect: lay.draw, maxTiles: 200, zoomBias: 3, probe: false,
    });
    if (L && L.tiles.length) {
      // sopra la foto le campiture devono lasciar vedere il terreno
      o += '<style>svg.plate .area{fill:none} svg.plate .lane{fill:#eaf0f6;fill-opacity:.55}</style>';
      const a = P({ x: 0, y: 0 });
      o += `<g opacity="${(bm.opacity || 0.9).toFixed(2)}" transform="rotate(${(-L.rotation).toFixed(3)} ${a.x.toFixed(2)} ${a.y.toFixed(2)})">`;
      for (const t of L.tiles) {
        o += `<image href="${t.url.replace(/&/g, '&amp;')}" xlink:href="${t.url.replace(/&/g, '&amp;')}" crossorigin="anonymous" preserveAspectRatio="none"`
          + ` x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" width="${t.w.toFixed(2)}" height="${t.h.toFixed(2)}"/>`;
      }
      o += '</g>';
    }
  }

  // griglia metrica opzionale
  if (opts.grid) {
    const step = opts.gridStep || (scale >= 500 ? 20 : 10);
    const x0 = Math.floor(b.minX / step) * step, x1 = Math.ceil(b.maxX / step) * step;
    const y0 = Math.floor(b.minY / step) * step, y1 = Math.ceil(b.maxY / step) * step;
    for (let x = x0; x <= x1; x += step) {
      const a = P({ x, y: y0 }), c = P({ x, y: y1 });
      o += L(a.x, a.y, c.x, c.y, 'grid');
    }
    for (let y = y0; y <= y1; y += step) {
      const a = P({ x: x0, y }), c = P({ x: x1, y });
      o += L(a.x, a.y, c.x, c.y, 'grid');
    }
  }

  // area di gara
  const apts = project.area.points.map(P);
  o += poly(apts, 'area');

  // corridoio
  if (baked.elements.length) {
    const { left, right } = edgePaths(baked);
    o += poly([...left, ...right.slice().reverse()].map(P), 'lane');
    o += poly(left.map(P), 'edge', false);
    o += poly(right.map(P), 'edge', false);
    o += poly(baked.samples.map(P), 'axis', false);
  }

  // griglia di partenza / rampa
  const gate = startGateGeometry(project, baked);
  if (gate) {
    const boxReadable = mm(gate.laneWidth) > 4 && mm(gate.depth) > 3;
    for (const bx of gate.boxes) {
      o += poly(bx.corners.map(P), 'gate');
      if (boxReadable) {
        const c = P(bx.center);
        o += T(c.x, c.y + 1, String(bx.lane), 't25 c b');
      }
    }
    for (const ln of gate.laneLines) o += poly(ln.map(P), 'gateline', false);
    const a = P(gate.startLine[0]), c = P(gate.startLine[1]);
    o += L(a.x, a.y, c.x, c.y, 'startline');
    // etichetta dietro ai box, dove di solito c'è spazio libero
    const lab = P(add(gate.center, mul(dirOf(baked.startHeading), -(gate.depth / 2 + 2))));
    let ang = -baked.startHeading * G.RAD;
    while (ang > 90) ang -= 180; while (ang < -90) ang += 180;
    o += `<text x="${lab.x.toFixed(2)}" y="${lab.y.toFixed(2)}" class="t25 b r" transform="rotate(${ang.toFixed(1)} ${lab.x.toFixed(2)} ${lab.y.toFixed(2)})">PARTENZA — ${gate.lanes} box ${n2(gate.depth)}×${n2(gate.laneWidth)} m · fronte ${n2(gate.totalWidth)} m</text>`;
  }
  const ramp = startRampGeometry(project, baked);
  if (ramp) {
    o += poly(ramp.corners.map(P), 'obst');
    const c = P(ramp.frame.center);
    o += T(c.x, c.y, ramp.struct.name, 't25 c b');
    o += T(c.x, c.y + 3, `h ${n2(ramp.struct.height)} m`, 't22 c');
  }

  // ostacoli numerati
  const list = orderedObstacles(project, analysis);
  for (const it of list) {
    if (it.kind !== 'structure') continue;
    const fp = footprint(it.structure, baked);
    const bad = (analysis.status[it.id] || {}).level === 'bad';
    o += poly(fp.corners.map(P), 'obst' + (bad ? ' bad' : ''));
    const c = P(fp.frame.center);
    o += `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="2.6" class="tagc"/>`;
    o += T(c.x, c.y + 1, String(it.n), 't25 c b');
  }

  // linea di arrivo a scacchi, dove finisce la gara
  if (baked.totalLength) {
    const fs = Math.min(analysis.stats.finishStation || baked.totalLength, baked.totalLength);
    const band = finishBandCells(baked, fs);
    for (const c of band.cells) o += poly(c.corners.map(P), c.dark ? 'fqd' : 'fql');
    o += poly(band.outline.map(P), 'fqbox');
    const f = band.frame;
    const lp = P(add(f.point, mul(leftOf(f.heading), -(f.width / 2 + 2.6))));
    let fa = -f.heading * G.RAD;
    while (fa > 90) fa -= 180; while (fa < -90) fa += 180;
    const ftxt = analysis.stats.laps > 1 ? `ARRIVO — ${analysis.stats.laps}° passaggio` : 'ARRIVO';
    o += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}" class="t25 b c" transform="rotate(${fa.toFixed(1)} ${lp.x.toFixed(2)} ${lp.y.toFixed(2)})">${ftxt}</text>`;
  }

  // progressive ogni N metri
  const stationStep = opts.stationStep || 25;
  if (stationStep > 0 && baked.totalLength) {
    for (let s = 0; s <= baked.totalLength + 1e-6; s += stationStep) {
      const f = frameAt(baked, Math.min(s, baked.totalLength));
      const n = leftOf(f.heading);
      const a = P(add(f.point, mul(n, f.width / 2)));
      const c = P(add(f.point, mul(n, f.width / 2 + 2.2)));
      o += L(a.x, a.y, c.x, c.y, 'med');
      o += T(c.x, c.y + 0.7, `${fmt(s, 0)}`, 't2 c');
    }
  }

  // sviluppo totale al centro
  if (baked.totalLength) {
    const f = frameAt(baked, baked.totalLength / 2);
    let cxm = 0, cym = 0;
    for (const q of baked.samples) { cxm += q.x; cym += q.y; }
    cxm /= baked.samples.length; cym /= baked.samples.length;
    const nn = leftOf(f.heading);
    const tw = G.dot(sub({ x: cxm, y: cym }, f.point), nn) >= 0 ? 1 : -1;
    const p = P(add(f.point, mul(nn, tw * (f.width / 2 + 4))));
    const rs = raceSummary(analysis.stats);
    const bw = Math.max(48, rs.length * 1.35 + 8);
    o += R(p.x - bw / 2, p.y - 4.4, bw, 8.8, 'med', ' style="fill:#fff"');
    o += T(p.x, p.y - 0.6, rs, 't25 c b');
    o += T(p.x, p.y + 3, `corsia ${n2(analysis.stats.minWidth)}–${n2(analysis.stats.maxWidth)} m`, 't2 c gray');
  }
  o += `</g>`;

  // quote dei lati dell'area (fuori dal clip, con rientro)
  const cptMM = P(G.polygonCentroid(project.area.points));
  for (let i = 0; i < project.area.points.length; i++) {
    const a = project.area.points[i], c = project.area.points[(i + 1) % project.area.points.length];
    const A = P(a), C = P(c);
    const d = G.norm(sub(C, A));
    const nrm = { x: -d.y, y: d.x };
    const mid = G.lerpP(A, C, 0.5);
    const outward = G.dot(sub(mid, cptMM), nrm) > 0;   // verso l'esterno sul foglio
    o += dimLine(A, C, 5.5, `${n2(G.dist(a, c))} m`, !outward);
  }

  // scala grafica
  o += graphicScale(lay.draw.x + 3, lay.draw.y + lay.draw.h - 3, scale, mm);
  o += T(lay.draw.x + 3, lay.draw.y + 4, 'Quote in metri salvo diversa indicazione', 't22 gray');
  if (!fits) o += T(lay.draw.x + 3, lay.draw.y + 8, `ATTENZIONE: a 1:${scale} il disegno eccede l'area utile del foglio`, 't22 no b');

  o += titleBlock(project, analysis, lay, { sheet, orientation }, 1, opts.pageTot || 1, scale, 'PLANIMETRIA PERCORSO DI GARA');
  return { svg: o + '</svg>', scale, fits, lay };
}

function graphicScale(x, y, scale, mm) {
  const target = scale >= 1000 ? 100 : scale >= 500 ? 50 : scale >= 200 ? 20 : 10;
  const seg = target / 5;
  let o = T(x, y - 6.5, `Scala 1:${scale}`, 't22 b');
  for (let i = 0; i < 5; i++) {
    const x0 = x + mm(seg * i), w = mm(seg);
    o += R(x0, y - 4, w, 1.6, 'thin', ` style="fill:${i % 2 ? '#111' : '#fff'}"`);
  }
  o += T(x, y, '0', 't2 c');
  o += T(x + mm(target), y, `${target} m`, 't2 c');
  return o;
}

/* ------------------------------ elenco ordinato degli ostacoli (numerato) */

export function orderedObstacles(project, analysis) {
  const out = [];
  let n = 0;
  for (const ob of analysis.obstacles) {
    if (ob.kind === 'structure') {
      n++;
      out.push({ ...ob, n, structure: ob.structure });
    } else {
      out.push({ ...ob, n: null });
    }
  }
  return out;
}

/* ---------------------------------------- fogli 2+: distinta e conformità */

function normCols(cols, W) {
  const sum = cols.reduce((a, c) => a + c.w, 0);
  return cols.map((c) => ({ ...c, w: (c.w / sum) * W }));
}

function tableHeader(x, y, w, cols, h = 6) {
  let o = R(x, y, w, h, 'hdr');
  let cx = x;
  for (const c of cols) {
    o += T(cx + 1.4, y + h - 2, c.label, 't22 b');
    cx += c.w;
    if (cx < x + w - 0.01) o += L(cx, y, cx, y + h, 'cell');
  }
  return o;
}

function tableRow(x, y, w, cols, vals, h = 5.4, cls = '') {
  let o = R(x, y, w, h, 'row');
  let cx = x;
  cols.forEach((c, i) => {
    const v = vals[i] == null ? '' : String(vals[i]);
    const anchor = c.align === 'r' ? ' r' : c.align === 'c' ? ' c' : '';
    const tx = c.align === 'r' ? cx + c.w - 1.4 : c.align === 'c' ? cx + c.w / 2 : cx + 1.4;
    o += T(tx, y + h - 1.8, v, `t22${anchor} ${cls}`);
    cx += c.w;
    if (cx < x + w - 0.01) o += L(cx, y, cx, y + h, 'cell');
  });
  return o;
}

export function plateSchedule(project, analysis, opts = {}, pageNo = 2, pageTot = 2, scale = 200) {
  const sheet = opts.sheet || 'A3';
  const orientation = opts.orientation || 'landscape';
  const lay = layout(sheet, orientation);
  const W = lay.draw.w;
  const cols = [
    { label: 'N.', w: W * 0.045, align: 'c' },
    { label: 'Tipo', w: W * 0.085 },
    { label: 'Ostacolo / elemento', w: W * 0.2 },
    { label: 'Gruppo', w: W * 0.09 },
    { label: 'Progr. inizio (m)', w: W * 0.09, align: 'r' },
    { label: 'Progr. fine (m)', w: W * 0.09, align: 'r' },
    { label: 'Dist. dal prec. (m)', w: W * 0.095, align: 'r' },
    { label: 'Lungh. (m)', w: W * 0.08, align: 'r' },
    { label: 'Largh. (m)', w: W * 0.08, align: 'r' },
    { label: 'Altezza (m)', w: W * 0.08, align: 'r' },
    { label: 'Esito', w: W * 0.075 },
  ];
  const cols2 = normCols(cols, W);
  const totW = W;

  let o = sheetOpen(lay);
  o += T(lay.draw.x, lay.draw.y + 6, 'DISTINTA DEGLI OSTACOLI E SEQUENZA DI PERCORRENZA', 't5 b');
  o += T(lay.draw.x, lay.draw.y + 11, `${project.name || 'Percorso'} — le distanze sono misurate sull'asse della corsia fra la fine di un ostacolo e l'inizio del successivo`, 't22 gray');

  let y = lay.draw.y + 15;
  o += tableHeader(lay.draw.x, y, totW, cols2);
  y += 6;

  const list = orderedObstacles(project, analysis);
  for (const it of list) {
    const st = analysis.status[it.id] || {};
    const s = it.structure;
    const tipo = it.kind === 'curve' ? 'Curva' : it.kind === 'start' ? 'Partenza' : 'Ostacolo';
    const grp = s ? (GROUP_LABELS[s.group] || '—') : (it.kind === 'curve' ? 'Tracciato' : '—');
    const el = it.element;
    const dims = s ? [n2(s.length), n2(s.width), n2(s.height)]
      : el ? [n2(el.length), n2(Math.min(el.widthStart, el.widthEnd)), '—'] : ['—', '—', '—'];
    const label = s ? s.name : it.label + (el ? ` · ${fmt(el.angle, 0)}° ${el.dir === 'right' ? 'destra' : 'sinistra'}` : '');
    const esito = st.level === 'bad' ? 'FUORI REGOLA' : st.level === 'warn' ? 'da verificare' : 'ok';
    o += tableRow(lay.draw.x, y, totW, cols2, [
      it.n || '', tipo, label, grp, n1(it.sStart), n1(it.sEnd),
      st.gap == null ? '—' : n2(st.gap), ...dims, esito,
    ], 5.4, st.level === 'bad' ? 'no' : '');
    y += 5.4;
    if (y > lay.title.y - 8) break;
  }

  // riepilogo
  y += 4;
  const s = analysis.stats;
  o += T(lay.draw.x, y + 3, `Totale: ${s.structureCount} ostacoli, ${s.curveCount} curve (${s.curvesRight} destra / ${s.curvesLeft} sinistra), sviluppo asse ${n2(s.totalLength)} m, corsia ${n2(s.minWidth)}–${n2(s.maxWidth)} m.`, 't25 b');

  o += titleBlock(project, analysis, lay, { sheet, orientation }, pageNo, pageTot, scale, 'DISTINTA DEGLI OSTACOLI');
  return { svg: o + '</svg>', lay };
}

export function plateCompliance(project, analysis, opts = {}, pageNo = 3, pageTot = 3, scale = 200) {
  const sheet = opts.sheet || 'A3';
  const orientation = opts.orientation || 'landscape';
  const lay = layout(sheet, orientation);
  const W = lay.draw.w;
  const cols = [
    { label: 'Esito', w: W * 0.07, align: 'c' },
    { label: 'Controllo', w: W * 0.47 },
    { label: 'Valore rilevato', w: W * 0.3 },
    { label: 'Riferimento', w: W * 0.16 },
  ];
  const cols2 = normCols(cols, W);
  const totW = W;
  let o = sheetOpen(lay);
  o += T(lay.draw.x, lay.draw.y + 6, 'VERIFICA DI CONFORMITÀ AL REGOLAMENTO TECNICO', 't5 b');
  o += T(lay.draw.x, lay.draw.y + 11, REG_SOURCE, 't22 gray');

  let y = lay.draw.y + 15;
  o += tableHeader(lay.draw.x, y, totW, cols2);
  y += 6;
  for (const c of analysis.regulation || []) {
    o += tableRow(lay.draw.x, y, totW, cols2, [c.ok ? '✓' : '✕', c.label, c.detail, c.ref || ''], 5.4, c.ok ? 'ok' : 'no');
    y += 5.4;
    if (y > lay.title.y - 30) break;
  }

  // segnalazioni del disegno
  const issues = analysis.issues.filter((i) => i.level === 'bad');
  y += 10;
  o += T(lay.draw.x, y, issues.length ? 'SEGNALAZIONI SUL TRACCIATO' : 'Nessuna segnalazione sul tracciato.', 't3 b');
  y += 4.5;
  for (const i of issues.slice(0, 12)) {
    o += T(lay.draw.x + 2, y, '• ' + i.text, 't22 no');
    y += 4;
    if (y > lay.title.y - 6) break;
  }
  if (project.plate && project.plate.notes) {
    y += 3;
    o += T(lay.draw.x, y, 'NOTE', 't3 b'); y += 4.5;
    for (const lineTxt of String(project.plate.notes).split('\n').slice(0, 8)) {
      o += T(lay.draw.x + 2, y, lineTxt, 't22'); y += 4;
    }
  }
  o += titleBlock(project, analysis, lay, { sheet, orientation }, pageNo, pageTot, scale, 'VERIFICA DI CONFORMITÀ');
  return { svg: o + '</svg>', lay };
}

/* -------------------------------------------------------- set completo */

export function buildPlateSet(project, analysis, opts = {}) {
  const pages = [];
  const wantSchedule = opts.schedule !== false && analysis.obstacles.length;
  const wantCompliance = opts.compliance !== false && (analysis.regulation || []).length;
  const tot = 1 + (wantSchedule ? 1 : 0) + (wantCompliance ? 1 : 0);
  const plan = platePlan(project, analysis, { ...opts, pageTot: tot });
  pages.push({ name: 'planimetria', svg: plan.svg });
  let n = 2;
  if (wantSchedule) pages.push({ name: 'distinta', svg: plateSchedule(project, analysis, opts, n++, tot, plan.scale).svg });
  if (wantCompliance) pages.push({ name: 'conformita', svg: plateCompliance(project, analysis, opts, n++, tot, plan.scale).svg });
  return { pages, scale: plan.scale, fits: plan.fits, size: sheetSize(opts.sheet || 'A3', opts.orientation || 'landscape') };
}
