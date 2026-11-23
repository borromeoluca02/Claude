/* home.js — schermata iniziale: da qui si crea un percorso nuovo o si
   riapre uno dei propri. I progetti stanno nel browser di chi apre l'app,
   quindi ciascuno vede soltanto i suoi (con Firebase collegato si ritrovano
   anche da altri dispositivi). */

import * as G from './geometry.js';
import { analyze } from './track.js';
import { thumbSVG, fmt, fmtM } from './render.js';
import { normalizeProject } from './model.js';

const e = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* misure di partenza suggerite, dalle planimetrie reali di gara */
export const AREA_PRESETS = [
  { key: 'gara', label: 'Campo gara', w: 93, h: 37, note: 'misura di una pista da competizione' },
  { key: 'medio', label: 'Area media', w: 60, h: 30, note: 'un giro solo arriva a ~275 m' },
  { key: 'piccolo', label: 'Area piccola', w: 45, h: 25, note: 'serve un secondo passaggio' },
  { key: 'mini', label: 'Area ridotta', w: 40, h: 20, note: 'per allenamento o prove' },
];

const dateFmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const oggi = new Date();
  const same = d.toDateString() === oggi.toDateString();
  return same
    ? 'oggi alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
};

function projectCard(p, source) {
  let stats = null, thumb = '';
  try {
    const norm = normalizeProject(p);
    const a = analyze(norm);
    stats = a.stats;
    thumb = thumbSVG(norm, a, 260, 170);
  } catch (err) {
    thumb = '<div class="thumbErr">anteprima non disponibile</div>';
  }
  const race = stats ? (stats.raceLength || stats.totalLength) : 0;
  return `<article class="wcard">
    <div class="wthumb" data-act="${source}.open" data-id="${e(p.id)}">${thumb}</div>
    <div class="wbody">
      <h4>${e(p.name || 'Senza nome')}</h4>
      <p class="wmeta">
        <span class="chip ${p.discipline === 'skate' ? 'skate' : 'roller'}">${p.discipline === 'skate' ? 'Skate cross' : 'Roller cross'}</span>
        ${stats ? `<span>${fmtM(race, 0)}</span><span>${stats.structureCount} ostacoli</span>` : ''}
      </p>
      <p class="wdate">${dateFmt(p.updatedAt)}</p>
      <div class="wact">
        <button class="btn primary mini" data-act="${source}.open" data-id="${e(p.id)}">Apri</button>
        <button class="btn mini" data-act="${source}.dup" data-id="${e(p.id)}">Duplica</button>
        <button class="btn mini danger" data-act="${source}.del" data-id="${e(p.id)}">Elimina</button>
      </div>
    </div>
  </article>`;
}

/* mini-mappa: si clicca per aggiungere i vertici del contorno */
export const MAP_W = 150, MAP_H = 100;   // metri rappresentati

export function minimapSVG(points, w = 520, h = 340) {
  const sc = Math.min((w - 20) / MAP_W, (h - 20) / MAP_H);
  const ox = (w - MAP_W * sc) / 2, oy = (h - MAP_H * sc) / 2;
  const P = (p) => ({ x: ox + p.x * sc, y: h - oy - p.y * sc });
  let s = `<svg class="minimap" id="minimap" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-scale="${sc}" data-ox="${ox}" data-oy="${oy}" data-h="${h}">`;
  s += `<rect class="mmBg" x="0" y="0" width="${w}" height="${h}"/>`;
  for (let x = 0; x <= MAP_W; x += 10) {
    const a = P({ x, y: 0 }), b = P({ x, y: MAP_H });
    s += `<line class="${x % 50 === 0 ? 'mm50' : 'mm10'}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }
  for (let y = 0; y <= MAP_H; y += 10) {
    const a = P({ x: 0, y }), b = P({ x: MAP_W, y });
    s += `<line class="${y % 50 === 0 ? 'mm50' : 'mm10'}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }
  if (points.length >= 2) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${P(p).x.toFixed(1)},${P(p).y.toFixed(1)}`).join('') + (points.length >= 3 ? 'Z' : '');
    s += `<path class="mmPoly" d="${d}"/>`;
  }
  points.forEach((p, i) => {
    const q = P(p);
    s += `<circle class="mmVtx" data-mmvtx="${i}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="7"/>`;
    s += `<text class="mmNum" x="${q.x.toFixed(1)}" y="${(q.y + 3.5).toFixed(1)}" text-anchor="middle">${i + 1}</text>`;
  });
  if (!points.length) {
    s += `<text class="mmHint" x="${w / 2}" y="${h / 2}" text-anchor="middle">clicca per aggiungere i vertici del contorno</text>`;
  }
  const grid = `<text class="mmScale" x="10" y="${h - 8}">quadretti da 10 m · area rappresentata ${MAP_W} × ${MAP_H} m</text>`;
  return s + grid + '</svg>';
}

/** blocco "su misura": misure numeriche oppure contorno disegnato a mano */
function customBlock(state, h) {
  const shape = h.shape || 'rect';
  const pts = h.points || [];
  const shapeSel = `<label class="fld"><span>Forma</span>
      <select data-bind="home.shape">
        ${[['rect', 'Rettangolo'], ['trapezoid', 'Trapezio'], ['triangle', 'Triangolo'], ['draw', 'Contorno disegnato']]
    .map(([v, t]) => `<option value="${v}"${shape === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></label>`;

  if (shape === 'draw') {
    const b = pts.length ? G.polygonBounds(pts) : null;
    const area = pts.length >= 3 ? Math.abs(G.polygonArea(pts)) : 0;
    return `<div class="wcustom">
      <div class="flds">${shapeSel}</div>
      <p class="hint">Clicca sulla mappa per segnare i vertici, uno dopo l'altro: il contorno si chiude da solo. I vertici si possono anche trascinare. Serve per i campi che non sono né rettangoli né trapezi.</p>
      <div class="mmWrap">${minimapSVG(pts)}</div>
      <div class="wrow">
        ${pts.length ? `<span class="mmInfo">${pts.length} vertici${b ? ` · ingombro ${fmt(b.w, 1)} × ${fmt(b.h, 1)} m` : ''}${area ? ` · ${fmt(area, 0)} m²` : ''}</span>` : '<span class="mmInfo dim">nessun vertice</span>'}
        <button class="btn mini" data-act="home.undoVtx">Annulla ultimo</button>
        <button class="btn mini danger" data-act="home.clearVtx">Svuota</button>
        <button class="btn mini" data-act="home.vtxPreset:rect">Parti da un rettangolo</button>
      </div>
      ${pts.length < 3 ? '<p class="hint cBad">Servono almeno 3 vertici per creare l\u2019area.</p>' : ''}
    </div>`;
  }

  return `<div class="wcustom">
    <div class="flds">
      ${shapeSel}
      <label class="fld"><span>Larghezza</span><input type="number" inputmode="decimal" step="1" min="10" data-bind="home.w" value="${h.w || 60}"><i>m</i></label>
      <label class="fld"><span>Profondità</span><input type="number" inputmode="decimal" step="1" min="10" data-bind="home.h" value="${h.h || 30}"><i>m</i></label>
      ${shape === 'trapezoid' ? `<label class="fld"><span>Base superiore</span><input type="number" inputmode="decimal" step="1" min="5" data-bind="home.b2" value="${h.b2 || Math.round((h.w || 60) * 0.7)}"><i>m</i></label>` : ''}
    </div>
  </div>`;
}

export function homeHTML(state) {
  const h = state.home || {};
  const disc = h.discipline || 'roller';
  const preset = h.preset || 'gara';
  const custom = preset === 'custom';
  const locals = state.localProjects || [];
  const clouds = state.cloudProjects || [];
  const resume = state.resume;

  const presets = AREA_PRESETS.map((p) => `
    <button class="preset${preset === p.key ? ' on' : ''}" data-act="home.preset:${p.key}">
      <b>${p.label}</b>
      <span class="dim">${p.w} × ${p.h} m</span>
      <i>${e(p.note)}</i>
    </button>`).join('') + `
    <button class="preset${custom ? ' on' : ''}" data-act="home.preset:custom">
      <b>Su misura</b>
      <span class="dim">la decidi tu</span>
      <i>rettangolo, trapezio, triangolo o contorno disegnato a mano</i>
    </button>`;

  return `
  <aside class="wrail">
    <div class="wbrand"><span class="logo">⛸</span><span>Cross<b>Builder</b></span></div>
    <nav class="wnav">
      <button class="wnavb on" data-act="home.scroll:new">✏️ Nuovo percorso</button>
      <button class="wnavb" data-act="home.scroll:mine">📂 I miei lavori <em>${locals.length}</em></button>
      ${resume ? `<button class="wnavb" data-act="home.resume">↩︎ Riprendi l'ultimo</button>` : ''}
    </nav>
    <div class="wsep"></div>
    <nav class="wnav">
      <button class="wnavb" data-act="imp.json">⬆︎ Importa da file</button>
      <button class="wnavb" data-act="home.cloud">☁︎ ${state.user ? 'Il mio cloud' : 'Collega il cloud'}</button>
    </nav>
    <div class="wfoot">
      <p>${state.user
        ? `Connesso come <b>${e(state.user.name || state.user.email || 'utente')}</b>: i progetti si sincronizzano fra i tuoi dispositivi.`
        : 'I progetti restano in <b>questo browser</b>. Chi apre l&rsquo;app da un altro dispositivo vede i propri.'}</p>
      <p class="dim">Regole e quote dal Regolamento Tecnico FISR 2025-2026.</p>
    </div>
  </aside>

  <div class="wmain">
    <section class="wsec" id="wnew">
      <h2>Nuovo percorso</h2>
      <p class="wlead">Scegli disciplina e area: si apre un foglio vuoto, poi disegni il percorso partendo dal punto che vuoi.</p>

      <div class="wrow">
        <div class="seg big">
          <button class="segb${disc === 'roller' ? ' on' : ''}" data-act="home.disc:roller">Roller cross</button>
          <button class="segb${disc === 'skate' ? ' on' : ''}" data-act="home.disc:skate">Skate cross</button>
        </div>
      </div>

      <div class="presets">${presets}</div>

      ${custom ? customBlock(state, h) : ''}

      <div class="wrow">
        <button class="btn primary big" data-act="home.create">Crea e inizia a disegnare</button>
        <button class="btn big" data-act="home.createFull">Crea con un percorso già pronto</button>
      </div>
      <p class="hint">«Crea e inizia a disegnare» apre l'area vuota con lo strumento matita già attivo: il primo clic fissa la partenza, muovendo il mouse allunghi la corsia e il secondo clic la conferma.</p>
    </section>

    ${resume ? `<section class="wsec">
      <h2>Riprendi</h2>
      <div class="wgrid">${projectCard({ ...resume, id: '__resume' }, 'resume')}</div>
    </section>` : ''}

    <section class="wsec" id="wmine">
      <h2>I miei lavori <span class="dim">${locals.length ? locals.length + ' in questo browser' : ''}</span></h2>
      ${locals.length
      ? `<div class="wgrid">${locals.map((p) => projectCard(p, 'loc')).join('')}</div>`
      : `<p class="wempty">Non hai ancora salvato nessun percorso. Creane uno qui sopra: lo ritroverai in questo elenco ogni volta che apri l'app da questo browser.</p>`}
    </section>

    ${state.user && clouds.length ? `<section class="wsec">
      <h2>Sul cloud <span class="dim">${clouds.length}</span></h2>
      <div class="wgrid">${clouds.map((p) => projectCard(p, 'cloud')).join('')}</div>
    </section>` : ''}
  </div>`;
}
