/* ui.js — pannelli dell'interfaccia. Tutto l'HTML è generato da qui;
   gli eventi sono gestiti per delega in app.js tramite data-act / data-bind. */

import * as G from './geometry.js';
import { STRUCTURE_LIBRARY, GROUP_LABELS } from './model.js';
import { ROLLER, SKATE, CATEGORIES, categoryInfo, REG_SOURCE } from './regulation.js';
import { fmt, fmtM, thumbSVG } from './render.js';
import { buildPlateSet, autoScale, sheetSize, SHEETS, SCALES } from './plate.js';

/* ------------------------------------------------- lettura/scrittura path */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
export function setPath(obj, path, value) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = value;
}

const e = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const nv = (v) => (v == null || v === '' || Number.isNaN(+v) ? '' : String(Math.round(+v * 1000) / 1000));

/** campo numerico legato a una proprietà del progetto */
function num(labelTxt, bind, value, opts = {}) {
  const { step = 0.1, min = null, max = null, unit = 'm', hint = '', cls = '' } = opts;
  return `<label class="fld ${cls}"><span>${e(labelTxt)}</span>` +
    `<input type="number" inputmode="decimal" data-bind="${bind}" value="${nv(value)}" step="${step}"` +
    `${min !== null ? ` min="${min}"` : ''}${max !== null ? ` max="${max}"` : ''}${hint ? ` placeholder="${e(hint)}"` : ''}>` +
    `${unit ? `<i>${e(unit)}</i>` : ''}</label>`;
}
function txt(labelTxt, bind, value, opts = {}) {
  return `<label class="fld"><span>${e(labelTxt)}</span><input type="text" data-bind="${bind}" value="${e(value)}" ${opts.ph ? `placeholder="${e(opts.ph)}"` : ''}></label>`;
}
function sel(labelTxt, bind, value, options) {
  return `<label class="fld"><span>${e(labelTxt)}</span><select data-bind="${bind}">` +
    options.map(([v, t]) => `<option value="${e(v)}"${String(v) === String(value) ? ' selected' : ''}>${e(t)}</option>`).join('') +
    `</select></label>`;
}
function chk(labelTxt, bind, value) {
  return `<label class="fld chk"><input type="checkbox" data-bind="${bind}"${value ? ' checked' : ''}><span>${e(labelTxt)}</span></label>`;
}
function btn(act, labelTxt, cls = '', id = '') {
  return `<button class="btn ${cls}" data-act="${e(act)}"${id ? ` data-id="${e(id)}"` : ''}>${labelTxt}</button>`;
}
function badge(level, textTxt) {
  return `<span class="badge ${level}">${e(textTxt)}</span>`;
}

export const TABS = [
  ['area', 'Area'],
  ['track', 'Percorso'],
  ['structures', 'Strutture'],
  ['start', 'Partenza'],
  ['auto', 'Genera'],
  ['rules', 'Regole'],
  ['check', 'Verifica'],
  ['plate', 'Tavola'],
  ['cloud', 'Cloud'],
];

export function tabsHTML(state) {
  const counts = {
    structures: state.project.structures.length,
    check: state.analysis.issues.length,
  };
  return TABS.map(([k, t]) => {
    const c = counts[k];
    const bad = k === 'check' && state.analysis.issues.some((i) => i.level === 'bad');
    return `<button class="tab${state.tab === k ? ' on' : ''}" data-act="tab:${k}">${t}` +
      (c ? `<em class="${bad ? 'bad' : ''}">${c}</em>` : '') + `</button>`;
  }).join('');
}

/* ------------------------------------------------------------- pannelli */

export function panelHTML(state) {
  switch (state.tab) {
    case 'area': return areaPanel(state);
    case 'track': return trackPanel(state);
    case 'structures': return structPanel(state);
    case 'start': return startPanel(state);
    case 'auto': return autoPanel(state);
    case 'rules': return rulesPanel(state);
    case 'check': return checkPanel(state);
    case 'plate': return platePanel(state);
    case 'cloud': return cloudPanel(state);
    default: return '';
  }
}

/* --------------------------------------------------------------- AREA */

function areaPanel(state) {
  const a = state.project.area;
  const p = a.params;
  const areaVal = Math.abs(G.polygonArea(a.points));
  let shapeFields = '';
  if (a.shape === 'rect') {
    shapeFields = num('Larghezza', 'area.params.w', p.w, { step: 0.5 }) + num('Profondità', 'area.params.h', p.h, { step: 0.5 });
  } else if (a.shape === 'trapezoid') {
    shapeFields = num('Base inferiore', 'area.params.b1', p.b1, { step: 0.5 }) +
      num('Base superiore', 'area.params.b2', p.b2, { step: 0.5 }) +
      num('Altezza', 'area.params.h', p.h, { step: 0.5 }) +
      num('Sfalsamento base sup.', 'area.params.offset', p.offset, { step: 0.5, hint: 'centrato' });
  } else if (a.shape === 'triangle') {
    shapeFields = num('Base', 'area.params.base', p.base, { step: 0.5 }) +
      num('Altezza', 'area.params.h', p.h, { step: 0.5 }) +
      num('Posizione apice (x)', 'area.params.apexX', p.apexX, { step: 0.5, hint: 'centrato' });
  } else {
    shapeFields = num('Numero lati', 'area.params.sides', p.sides, { step: 1, unit: '', min: 3, max: 14 }) +
      num('Raggio', 'area.params.r', p.r, { step: 0.5 });
  }

  const rows = a.points.map((q, i) => `<tr>
      <th>V${i + 1}</th>
      <td><input type="number" inputmode="decimal" step="0.1" data-bind="area.points.${i}.x" value="${nv(q.x)}"></td>
      <td><input type="number" inputmode="decimal" step="0.1" data-bind="area.points.${i}.y" value="${nv(q.y)}"></td>
      <td>${btn('area.delVertex', '✕', 'mini danger', String(i))}${btn('area.splitEdge', '＋', 'mini', String(i))}</td>
    </tr>`).join('');

  return `
  <section class="grp">
    <h3>Forma dell'area</h3>
    <div class="seg">
      ${['rect', 'Rettangolo', 'trapezoid', 'Trapezio', 'triangle', 'Triangolo', 'polygon', 'Poligono']
      .reduce((acc, _, i, arr) => (i % 2 ? acc : [...acc, [arr[i], arr[i + 1]]]), [])
      .map(([k, t]) => `<button class="segb${a.shape === k ? ' on' : ''}" data-act="area.shape:${k}">${t}</button>`).join('')}
    </div>
    <div class="flds">${shapeFields}</div>
    ${btn('area.apply', 'Rigenera forma', 'primary')}
    <p class="hint">Qualsiasi forma va bene: anche trapezi o triangoli irregolari. Puoi sempre spostare i vertici a mano (anche trascinandoli sulla mappa con <b>Modifica area</b> attivo).</p>
  </section>
  <section class="grp">
    <h3>Vertici <span class="dim">${a.points.length} · ${fmt(areaVal, 1)} m² · perimetro ${fmtM(G.polygonPerimeter(a.points), 1)}</span></h3>
    <div class="tblWrap"><table class="tbl vtx">
      <thead><tr><th></th><th>X (m)</th><th>Y (m)</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="row">
      ${btn('area.addVertex', '+ Vertice')}
      ${btn('area.toggleEdit', state.mode === 'area' ? '✓ Modifica area' : 'Modifica area', state.mode === 'area' ? 'primary' : '')}
      ${btn('area.normalize', 'Porta a origine')}
    </div>
  </section>`;
}

/* -------------------------------------------------------------- PERCORSO */

function trackPanel(state) {
  const t = state.project.track;
  const st = state.analysis.status;
  const baked = state.analysis.baked;
  const st2 = state.analysis.stats;

  const rows = t.elements.map((el, i) => {
    const b = baked.elements[i] || {};
    const lvl = (st[el.id] && st[el.id].level) || 'ok';
    const selCls = state.selection && state.selection.id === el.id ? ' sel' : '';
    const head = `<div class="elHead"><b>${i + 1}. ${el.type === 'arc' ? 'Curva' : 'Rettilineo'}</b>
        <span class="dim">${fmtM(b.length || 0, 2)} · da ${fmt(b.startStation || 0, 1)} a ${fmt(b.endStation || 0, 1)} m</span>
        ${lvl !== 'ok' ? badge(lvl, lvl === 'bad' ? 'fuori regola' : 'da verificare') : ''}
      </div>`;
    const fields = el.type === 'arc'
      ? num('Raggio', `track.elements.${i}.radius`, el.radius, { step: 0.5, min: 0.5 }) +
        num('Angolo', `track.elements.${i}.angle`, el.angle, { step: 5, unit: '°', min: 1, max: 350 }) +
        sel('Senso', `track.elements.${i}.dir`, el.dir, [['left', 'Sinistra'], ['right', 'Destra']])
      : num('Lunghezza', `track.elements.${i}.length`, el.length, { step: 0.5, min: 0.2 });
    const widths = num('Largh. inizio', `track.elements.${i}.widthStart`, el.widthStart, { step: 0.25, min: 0.5 }) +
      num('Largh. fine', `track.elements.${i}.widthEnd`, el.widthEnd, { step: 0.25, min: 0.5 });
    const reasons = (st[el.id] && st[el.id].reasons || []).map((r) => `<li>${e(r)}</li>`).join('');
    return `<div class="elCard ${lvl}${selCls}" data-el="${el.id}">
      ${head}
      <div class="flds">${fields}${widths}</div>
      ${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}
      <div class="row tight">
        ${btn('el.up', '↑', 'mini', el.id)}${btn('el.down', '↓', 'mini', el.id)}
        ${btn('el.dup', 'Duplica', 'mini', el.id)}
        ${btn('el.insStraight', '+ rett. dopo', 'mini', el.id)}
        ${btn('el.insArc', '+ curva dopo', 'mini', el.id)}
        ${btn('el.del', 'Elimina', 'mini danger', el.id)}
      </div>
    </div>`;
  }).join('');

  return `
  <section class="grp">
    <h3>Strumenti</h3>
    <div class="row">
      ${btn('tool:draw', state.tool === 'draw' ? '✓ Sto disegnando' : '✏️ Disegna percorso', state.tool === 'draw' ? 'primary' : '')}
      ${btn('el.addStraight', '+ Rettilineo')}
      ${btn('el.addArc', '+ Curva')}
      ${btn('track.closeLoop', 'Chiudi verso la partenza')}
      ${btn('track.clear', 'Svuota', 'danger')}
    </div>
    <p class="hint">${state.tool === 'draw'
      ? (!baked.elements.length && !state.drawArmed
        ? '<b>Passo 1:</b> clicca sulla mappa dove deve partire il percorso. Poi muovendo il puntatore la corsia si allunga e un secondo clic ne fissa la lunghezza.'
        : 'Muovi il puntatore sulla mappa: vedi in tempo reale il tratto che stai per aggiungere, con la sua lunghezza e lo sviluppo totale. Clicca per fissarlo. Se le distanze o le misure non tornano il tratto resta verde o diventa rosso, ma il clic vale comunque. Esc per uscire.')
      : 'Trascina i pallini bianchi per allungare i rettilinei; sul pallino di una curva selezionata controlli insieme raggio e angolo. Le strutture si trascinano direttamente, anche prendendole dal nome.'}</p>
  </section>
  <section class="grp">
    <h3>Partenza del tracciato</h3>
    <div class="flds">
      ${num('X', 'track.start.x', t.start.x, { step: 0.5 })}
      ${num('Y', 'track.start.y', t.start.y, { step: 0.5 })}
      ${num('Direzione', 'track.start.heading', t.start.heading, { step: 5, unit: '°' })}
    </div>
  </section>
  <section class="grp">
    <h3>Anello e giri</h3>
    <p class="hint">${st2.isClosed
      ? `<b class="cOk">Anello chiuso</b>: il percorso rientra in partenza con la stessa direzione, quindi si può ripetere a giri.`
      : `<b>Anello aperto</b>: il percorso finisce lontano dalla partenza${baked.elements.length ? ` (${fmtM(st2.closeGap, 1)}, ${fmt(st2.closeTurn, 0)}° di scarto)` : ''}.`}</p>
    <div class="flds">
      ${num('Giri completi', 'track.laps', t.laps || 1, { step: 1, unit: '×', min: 1, max: 2 })}
      ${num('Secondo passaggio', 'track.extra', t.extra || 0, { step: 5, min: 0, hint: 'nessuno' })}
      ${num('Raggio del raccordo', 'ui.drawRadius', state.drawRadius, { step: 0.5, min: 1 })}
    </div>
    ${st2.isClosed && st2.raceLength > st2.totalLength + 0.5
      ? `<p class="hint">Sviluppo di gara: <b>${st2.extra > 0
          ? `${fmtM(st2.totalLength, 2)} + ${fmtM(st2.extra, 2)} = ${fmtM(st2.raceLength, 2)}</b>, con l'arrivo alla progressiva ${fmtM(st2.finishStation, 1)} del secondo passaggio`
          : `${fmtM(st2.totalLength, 2)} × ${st2.laps} = ${fmtM(st2.raceLength, 2)}</b>`}. Le distanze sono controllate anche a cavallo della partenza.</p>`
      : '<p class="hint">Utile sulle aree piccole: si chiude l\'anello e si ripassa quanto basta per arrivare alla lunghezza richiesta. <b>Secondo passaggio</b> sono i metri da ripetere dopo il giro completo: non serve concludere un secondo giro intero.</p>'}
    <div class="row">${btn('track.closeLoop', 'Chiudi l\'anello alla partenza', 'primary')}${st2.raceLength > st2.totalLength + 0.5 ? btn('track.openLoop', 'Torna a un giro solo') : ''}</div>
  </section>
  <section class="grp">
    <h3>Larghezza corsia</h3>
    <div class="flds">${num('Larghezza predefinita', 'track.defaultWidth', t.defaultWidth, { step: 0.25, min: 0.5 })}</div>
    <div class="row">${btn('track.applyWidthAll', 'Applica a tutti i tratti', 'primary')}${btn('track.taperTo3', 'Restringi a 3 m il tratto selezionato')}</div>
    <p class="hint">Nominale 5 m, si può restringere fino a 3 m (e anche meno: sotto il minimo impostato il tratto diventa rosso, ma resta modificabile).</p>
  </section>
  <section class="grp">
    <h3>Elementi <span class="dim">${t.elements.length} · sviluppo ${fmtM(baked.totalLength, 2)}</span></h3>
    ${rows || '<p class="hint">Nessun elemento: aggiungi un rettilineo o usa "Disegna percorso".</p>'}
  </section>`;
}

/* ------------------------------------------------------------- STRUTTURE */

function structPanel(state) {
  const p = state.project;
  const st = state.analysis.status;
  const groups = ['gimkane', 'barriere', 'rampe', 'altro'];
  const counts = { gimkane: 0, barriere: 0, rampe: 0, altro: 0 };
  const rampTypes = new Set();
  for (const s of p.structures) {
    const g = s.group || 'altro';
    if (counts[g] !== undefined) counts[g]++;
    if (g === 'rampe') rampTypes.add(s.key);
  }
  const need = p.discipline === 'roller'
    ? { gimkane: ROLLER.groups.gimkane, barriere: ROLLER.groups.barriere, rampe: ROLLER.groups.rampe }
    : {};

  const lib = groups.map((g) => {
    const items = STRUCTURE_LIBRARY.filter((s) => s.group === g);
    if (!items.length) return '';
    const q = need[g];
    const head = `<div class="libHead">${e(GROUP_LABELS[g])}` +
      (q ? ` <span class="${counts[g] >= q ? 'cOk' : 'cBad'}">${counts[g]}/${q}</span>` : '') +
      (g === 'rampe' && q ? ` <span class="dim">· ${rampTypes.size}/${ROLLER.groups.rampeTipologie} tipologie</span>` : '') +
      `</div>`;
    const btns = items.map((s) =>
      `<button class="libb${state.tool === 'add:' + s.key ? ' on' : ''}" data-act="st.pick:${s.key}" title="${e(s.note || s.name)}">
        <b>${e(s.name)}</b><i>${fmt(s.length, 2)}×${fmt(s.width, 2)} · h ${fmt(s.height, 2)}</i></button>`).join('');
    return head + `<div class="lib">${btns}</div>`;
  }).join('');

  const list = p.structures
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.station - b.s.station)
    .map(({ s, i }) => {
      const info = st[s.id] || { level: 'ok' };
      const selCls = state.selection && state.selection.id === s.id ? ' sel' : '';
      const reasons = (info.reasons || []).map((r) => `<li>${e(r)}</li>`).join('');
      const libIt = STRUCTURE_LIBRARY.find((x) => x.key === s.key);
      return `<div class="elCard ${info.level}${selCls}" data-st="${s.id}">
        <div class="elHead"><b>${e(s.name)}</b>
          <span class="badge">${e(GROUP_LABELS[s.group] || 'Altro')}</span>
          <span class="dim">prog. ${fmt(s.station, 1)} m${info.gap != null ? ` · Δ ${fmt(info.gap, 2)} m da ${e(info.prevLabel || '—')}` : ''}</span>
          ${badge(info.level, info.level === 'bad' ? 'posizione non valida' : info.level === 'warn' ? 'da verificare' : 'ok')}
        </div>
        ${libIt && libIt.note ? `<p class="hint small">${e(libIt.note)}</p>` : ''}
        <div class="flds">
          ${txt('Nome', `structures.${i}.name`, s.name)}
          ${num('Altezza', `structures.${i}.height`, s.height, { step: 0.05 })}
          ${num('Lunghezza', `structures.${i}.length`, s.length, { step: 0.1, min: 0.2 })}
          ${num('Larghezza', `structures.${i}.width`, s.width, { step: 0.1, min: 0.2 })}
          ${s.mode === 'path'
          ? num('Progressiva', `structures.${i}.station`, s.station, { step: 0.5 }) + num('Scostamento', `structures.${i}.side`, s.side, { step: 0.25 })
          : num('X', `structures.${i}.x`, s.x, { step: 0.5 }) + num('Y', `structures.${i}.y`, s.y, { step: 0.5 })}
          ${num('Rotazione', `structures.${i}.rotation`, s.rotation, { step: 5, unit: '°' })}
          ${sel('Ancoraggio', `structures.${i}.mode`, s.mode, [['path', 'Sul percorso'], ['free', 'Libera']])}
        </div>
        ${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}
        <div class="row tight">
          ${btn('st.center', 'Centra in corsia', 'mini', s.id)}
          ${btn('st.snapValid', 'Porta in posizione valida', 'mini', s.id)}
          ${btn('st.dup', 'Duplica', 'mini', s.id)}
          ${btn('st.del', 'Elimina', 'mini danger', s.id)}
        </div>
      </div>`;
    }).join('');

  return `
  <section class="grp">
    <h3>Libreria ostacoli <span class="dim">${p.discipline === 'roller' ? 'Art. 64' : 'Art. 102'}</span></h3>
    ${lib}
    <p class="hint">${state.tool && state.tool.startsWith('add:')
      ? 'Tocca la mappa per posizionare la struttura. Tocca di nuovo la voce della libreria per annullare.'
      : 'Scegli un ostacolo e poi tocca la mappa. Dentro ogni sagoma vedi nome e altezza, sui lati le dimensioni. Le quote sono quelle dell\'Allegato 3 (indicative) e restano modificabili.'}</p>
    <div class="row">${btn('st.auto', 'Piazza automaticamente', 'primary')}${btn('st.clear', 'Rimuovi tutte', 'danger')}</div>
  </section>
  <section class="grp">
    <h3>Ostacoli sul percorso <span class="dim">${p.structures.length}</span></h3>
    ${list || '<p class="hint">Ancora nessun ostacolo.</p>'}
  </section>`;
}

/* ------------------------------------------------------------- PARTENZA */

function startPanel(state) {
  const p = state.project;
  const g = p.startGate, r = p.startRamp;
  const isRoller = p.discipline === 'roller';
  return `
  <section class="grp">
    <h3>Disciplina</h3>
    <div class="seg">
      <button class="segb${isRoller ? ' on' : ''}" data-act="discipline:roller">Roller cross</button>
      <button class="segb${!isRoller ? ' on' : ''}" data-act="discipline:skate">Skate cross</button>
    </div>
    <p class="hint">${isRoller
      ? 'Roller cross (Art. 65): griglia con box di partenza e corsie guidate dopo la linea.'
      : 'Skate cross (Art. 102): 4 gate su rampa di partenza alta al massimo 2 m.'}</p>
  </section>
  <section class="grp">
    <h3>Categoria</h3>
    <div class="seg col">
      ${CATEGORIES.map((c) => `<button class="segb${p.category === c.key ? ' on' : ''}" data-act="cat:${c.key}">${e(c.label)}</button>`).join('')}
    </div>
    <p class="hint">Determina le altezze normate: salti a secco <b>${fmt(categoryInfo(p.category).dryJump * 100, 0)} cm</b> (±2 cm) e sottopassi <b>${fmt(categoryInfo(p.category).underpass * 100, 0)} cm</b>. Cambiando categoria le altezze degli ostacoli interessati vengono aggiornate.</p>
  </section>
  ${isRoller ? `
  <section class="grp">
    <h3>Griglia di partenza</h3>
    ${chk('Mostra la griglia', 'startGate.enabled', g.enabled)}
    <div class="flds">
      ${num('Numero corsie', 'startGate.lanes', g.lanes, { step: 1, unit: '', min: 1, max: 12 })}
      ${num('Larghezza corsia', 'startGate.laneWidth', g.laneWidth, { step: 0.05 })}
      ${num('Profondità box', 'startGate.boxDepth', g.boxDepth, { step: 0.05 })}
      ${num('Corsie guidate dopo la linea', 'startGate.runoutLength', g.runoutLength, { step: 0.5 })}
    </div>
    <p class="hint">Totale fronte di partenza: <b>${fmtM(g.lanes * g.laneWidth, 2)}</b> (${g.lanes} × ${fmtM(g.laneWidth, 2)}).
    Box ${fmt(g.boxDepth, 2)} × ${fmt(g.laneWidth, 2)} m ciascuno. Dopo la linea, ${fmtM(g.runoutLength, 2)} di corsie separate.
    <br>Regolamento: 4 box di 1 m di lunghezza e larghezza pari alle corsie, corsie separate di almeno 1,25 m per 5 m dopo la linea, rettilineo di partenza largo almeno 5 m e lungo almeno 20 m.
    Il <b>primo ostacolo</b> non può stare a meno di <b>12 m dalla linea di partenza</b>.</p>
    ${btn('start.preset', 'Riporta allo standard (4 × 1,25 m)', 'primary')}
  </section>` : `
  <section class="grp">
    <h3>Rampa di partenza</h3>
    ${chk('Rampa di partenza attiva', 'startRamp.enabled', r.enabled)}
    <div class="flds">
      ${txt('Nome', 'startRamp.name', r.name)}
      ${num('Lunghezza', 'startRamp.length', r.length, { step: 0.5, min: 0.5 })}
      ${num('Larghezza', 'startRamp.width', r.width, { step: 0.25, min: 0.5 })}
      ${num('Altezza', 'startRamp.height', r.height, { step: 0.1 })}
    </div>
    <p class="hint">La rampa occupa i primi ${fmtM(r.length, 2)} del tracciato e conta come primo ostacolo.
    <br>Allegato 3: piattaforma 2,00 m a quota 2,00 m e scivolo di 4,80 m inclinato 25° (ingombro a terra 6,35 m).
    Art. 102: 4 gate su rampa di altezza massima 2 m.</p>
  </section>`}`;
}

/* --------------------------------------------------------------- GENERA */

function autoPanel(state) {
  const gp = state.project.genParams;
  const reqs = (gp.curveReqs || []).map((rq, i) => `<div class="reqRow">
      ${num('Raggio', `genParams.curveReqs.${i}.radius`, rq.radius, { step: 0.5, min: 0.5 })}
      ${num('Quante', `genParams.curveReqs.${i}.count`, rq.count, { step: 1, unit: '×', min: 1 })}
      ${btn('gen.delReq', '✕', 'mini danger', String(i))}
    </div>`).join('');

  const cands = (state.candidates || []).map((c, i) => `
    <div class="cand${state.candidateIndex === i ? ' on' : ''}">
      <div class="candThumb">${thumbSVG(c.project, c.analysisCache, 240, 160)}</div>
      <div class="candBody">
        <b>${e(c.name)}</b>
        <div class="dim">${fmtM(c.stats.totalLength, 1)} · ${c.stats.curveCount} curve · ${c.stats.structureCount} strutture</div>
        <div class="candTags">
          ${c.stats.badCount ? badge('bad', `${c.stats.badCount} fuori regola`) : badge('ok', 'regole rispettate')}
          ${c.stats.outsideRuns ? badge('bad', 'esce dall\'area') : ''}
          ${c.trimmed ? badge('warn', 'adattata all\'area') : ''}
        </div>
        ${c.notes.length ? `<ul class="reasons">${c.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : ''}
        <div class="row tight">${btn('gen.use', 'Usa questa opzione', 'primary', String(i))}</div>
      </div>
    </div>`).join('');

  return `
  <section class="grp">
    <h3>Parametri</h3>
    <p class="hint">I campi vuoti non sono vincolanti: vengono usati solo i parametri che compili.
    <br><b>Varianti da proporre</b> è quante proposte diverse vuoi vedere in fondo alla scheda: ne calcola molte e ti mostra le migliori, da confrontare e scegliere.</p>
    <div class="flds">
      ${num('Larghezza percorso', 'genParams.width', gp.width, { step: 0.25, min: 0.5 })}
      ${num('Lunghezza totale', 'genParams.targetLength', gp.targetLength, { step: 10, hint: 'libera' })}
      ${num('Curve minime', 'genParams.minCurves', gp.minCurves, { step: 1, unit: '', hint: 'libere' })}
      ${num('Numero strutture', 'genParams.structureCount', gp.structureCount, { step: 1, unit: '', hint: 'auto' })}
      ${num('Margine dal bordo', 'genParams.margin', gp.margin, { step: 0.25, min: 0 })}
      ${num('Varianti da proporre', 'genParams.seedCount', gp.seedCount, { step: 1, unit: '', min: 1, max: 12 })}
      ${sel('Schema', 'genParams.strategy', gp.strategy, [['auto', 'Tutti gli schemi'], ['serpentina', 'Serpentina'], ['ovale', 'Ovale'], ['spirale', 'Spirale'], ['organica', 'Libera']])}
    </div>
    ${chk('Ammetti anelli con un secondo passaggio', 'genParams.closedLoop', gp.closedLoop !== false)}
    <p class="hint">Prima il generatore prova a far stare tutto in <b>un giro solo</b>. Se con l'area e i parametri dati non ci sta, e questa opzione è attiva, propone percorsi che <b>rientrano in partenza</b> e ripassano una seconda volta: solo per i metri che mancano, senza chiudere per forza un secondo giro (per esempio «giro da 160 m + 115 m»). Mai più di due passaggi. Le proposte sono marcate «anello».</p>
  </section>
  <section class="grp">
    <h3>Curve richieste</h3>
    ${reqs || '<p class="hint">Nessun vincolo di raggio.</p>'}
    ${btn('gen.addReq', '+ Aggiungi raggio')}
    <p class="hint">Esempio: 4 curve con raggio 8 m. Il generatore le preferisce e, se non riesce a inserirle tutte nell'area, te lo scrive nella scheda dell'opzione.</p>
  </section>
  <section class="grp">
    <h3>Generazione</h3>
    <div class="row">${btn('gen.run', '⚙️ Genera opzioni', 'primary')}${btn('gen.runMore', 'Altre varianti')}</div>
    ${state.generating ? '<p class="hint">Sto calcolando…</p>' : ''}
    <div class="cands">${cands || '<p class="hint">Nessuna opzione ancora generata.</p>'}</div>
  </section>`;
}

/* --------------------------------------------------------------- REGOLE */

function rulesPanel(state) {
  const r = state.project.rules;
  const roller = state.project.discipline === 'roller';
  return `
  <section class="grp">
    <h3>Distanze fra ostacoli</h3>
    <div class="flds">
      ${num('Distanza minima', 'rules.minGap', r.minGap, { step: 0.5, min: 0 })}
      ${num('Distanza massima', 'rules.maxGap', r.maxGap, { step: 0.5, min: 0 })}
      ${num('Partenza → 1° ostacolo', 'rules.firstObstacleMin', r.firstObstacleMin, { step: 0.5, min: 0 })}
      ${num('Ultimo ostacolo → arrivo', 'rules.finishMin', r.finishMin, { step: 0.5, min: 0 })}
    </div>
    <p class="hint">Valgono fra due ostacoli consecutivi: <b>anche una curva è un ostacolo</b>. Fuori intervallo la struttura diventa <b class="cBad">rossa</b>, dentro <b class="cOk">verde</b>. Nessun blocco: puoi comunque lasciarla lì.
    ${roller ? '<br>Regolamento roller cross: minima <b>5 m</b>, massima <b>25 m</b>, <b>12 m</b> dalla linea di partenza al primo ostacolo e <b>10 m</b> fra ultimo ostacolo e arrivo.' : '<br>Per lo skate cross il regolamento non fissa distanze fra gli ostacoli: questi valori sono solo di lavoro.'}</p>
  </section>
  <section class="grp">
    <h3>Corsia e curve</h3>
    <div class="flds">
      ${num('Larghezza minima', 'rules.minWidth', r.minWidth, { step: 0.25, min: 0 })}
      ${num('Larghezza nominale', 'rules.maxWidth', r.maxWidth, { step: 0.25, min: 0 })}
      ${num('Raggio minimo curva', 'rules.minRadius', r.minRadius, { step: 0.5, min: 0, hint: '0 = libero' })}
    </div>
    <p class="hint">${roller
      ? 'Regolamento: larghezza minima <b>3,5 m</b>, ma <b>5 m</b> sul rettilineo di partenza e sulla prima curva; servono almeno <b>2 curve a destra e 2 a sinistra</b>; lunghezza totale <b>250–300 m</b>.'
      : 'Regolamento skate cross: larghezza minima <b>5 m</b> e almeno <b>2 curve con raggio inferiore a 5 m</b>.'}</p>
    ${chk('Segnala ciò che esce dall\'area', 'rules.checkArea', r.checkArea)}
    ${chk('Mostra la verifica di conformità al regolamento', 'rules.regCheck', r.regCheck !== false)}
    <div class="row">
      ${btn('rules.preset', 'Valori di regolamento', 'primary')}
      ${btn('rules.reset', 'Ripristina predefiniti')}
    </div>
  </section>`;
}

/* -------------------------------------------------------------- VERIFICA */

function checkPanel(state) {
  const a = state.analysis;
  const s = a.stats;
  const issues = a.issues.map((i) => `<li class="iss ${i.level}"${i.target ? ` data-act="focus" data-id="${e(i.target)}"` : ''}>${e(i.text)}</li>`).join('');
  const checks = (a.checks || []).map((c) =>
    `<li class="iss ${c.ok ? 'ok' : 'bad'}">${e(c.label)} — <span class="dim">${e(c.detail)}</span></li>`).join('');
  const radii = Object.entries(s.curvesByRadius).map(([r, n]) => `${n}× R${r}`).join(' · ') || '—';
  const regList = a.regulation || [];
  const regKo = regList.filter((c) => !c.ok).length;
  const reg = regList.map((c) =>
    `<li class="iss ${c.ok ? 'ok' : 'bad'}"><b>${c.ok ? '✓' : '✕'}</b> ${e(c.label)} — <span class="dim">${e(c.detail)}${c.ref ? ' · ' + e(c.ref) : ''}</span></li>`).join('');
  return `
  <section class="grp">
    <h3>Dati del percorso</h3>
    <table class="tbl kv">
      <tr><th>Sviluppo asse</th><td>${fmtM(s.totalLength, 2)}</td></tr>
      <tr><th>di cui rettilinei</th><td>${fmtM(s.straightLength, 2)}</td></tr>
      <tr><th>di cui curve</th><td>${fmtM(s.curveLength, 2)}</td></tr>
      <tr><th>Curve</th><td>${s.curveCount} (${radii})</td></tr>
      <tr><th>di cui destra / sinistra</th><td>${s.curvesRight} / ${s.curvesLeft}</td></tr>
      <tr><th>Strutture</th><td>${s.structureCount}</td></tr>
      <tr><th>Larghezza corsia</th><td>${fmtM(s.minWidth, 2)} – ${fmtM(s.maxWidth, 2)}</td></tr>
      <tr><th>Superficie area</th><td>${fmt(s.areaValue, 1)} m²</td></tr>
      <tr><th>Superficie pista</th><td>${fmt(s.areaUsed, 1)} m² (${fmt(s.areaValue ? (s.areaUsed / s.areaValue) * 100 : 0, 0)}%)</td></tr>
      <tr><th>Incroci</th><td>${s.crossings}</td></tr>
    </table>
  </section>
  ${reg ? `<section class="grp">
    <h3>Conformità al regolamento <span class="dim">${regKo ? regKo + ' da sistemare' : 'tutto a posto'}</span></h3>
    <ul class="issues">${reg}</ul>
    <p class="hint">${e(REG_SOURCE)}. Le quote dei disegni (Allegato 3) sono dichiarate indicative dal regolamento stesso.</p>
  </section>` : ''}
  ${checks ? `<section class="grp"><h3>Parametri richiesti</h3><ul class="issues">${checks}</ul></section>` : ''}
  <section class="grp">
    <h3>Segnalazioni <span class="dim">${a.issues.length}</span></h3>
    ${issues ? `<ul class="issues">${issues}</ul>` : '<p class="hint cOk">Tutto nei limiti impostati.</p>'}
  </section>
  <section class="grp">
    <h3>Esporta</h3>
    <div class="row">
      ${btn('exp.png', 'PNG')}${btn('exp.svg', 'SVG')}${btn('exp.csv', 'Distinta CSV')}${btn('exp.json', 'Progetto JSON')}
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- TAVOLA */

function ta(labelTxt, bind, value, rows = 3) {
  return `<label class="fld area"><span>${e(labelTxt)}</span><textarea data-bind="${bind}" rows="${rows}">${e(value || '')}</textarea></label>`;
}

function platePanel(state) {
  const pl = state.project.plate;
  const auto = autoScale(state.project, pl.sheet, pl.orientation);
  const scale = pl.scale === 'auto' ? auto : +pl.scale;
  const size = sheetSize(pl.sheet, pl.orientation);
  const b = G.polygonBounds(state.project.area.points);
  const wmm = (b.w * 1000) / scale, hmm = (b.h * 1000) / scale;
  let preview = '', pages = 1, fits = true;
  try {
    const set = buildPlateSet(state.project, state.analysis, pl);
    preview = set.pages[0].svg.replace(/^<\?xml[^>]*\?>\s*/, '');
    pages = set.pages.length;
    fits = set.fits;
  } catch (err) {
    preview = `<p class="hint cBad">Anteprima non disponibile: ${e(err.message)}</p>`;
  }

  return `
  <section class="grp">
    <h3>Foglio e scala</h3>
    <div class="flds">
      ${sel('Formato', 'plate.sheet', pl.sheet, Object.keys(SHEETS).map((k) => [k, `${k} (${SHEETS[k][0]}×${SHEETS[k][1]} mm)`]))}
      ${sel('Orientamento', 'plate.orientation', pl.orientation, [['landscape', 'Orizzontale'], ['portrait', 'Verticale']])}
      ${sel('Scala', 'plate.scale', pl.scale, [['auto', `Automatica (1:${auto})`], ...SCALES.map((s) => [String(s), `1:${s}`])])}
      ${num('Progressive ogni', 'plate.stationStep', pl.stationStep, { step: 5, min: 0, hint: '0 = nessuna' })}
    </div>
    <p class="hint">Foglio ${fmt(size.w, 0)}×${fmt(size.h, 0)} mm · a <b>1:${scale}</b> l'area di ${fmtM(b.w, 1)}×${fmtM(b.h, 1)} occupa <b>${fmt(wmm, 0)}×${fmt(hmm, 0)} mm</b>.
    ${fits ? 'Stampando al 100% le misure sul foglio sono in scala.' : '<b class="cBad">A questa scala il disegno non entra nel foglio: scegli una scala più piccola o un formato più grande.</b>'}</p>
    ${chk('Griglia metrica di riferimento', 'plate.grid', pl.grid)}
    ${chk('Includi la distinta degli ostacoli', 'plate.schedule', pl.schedule !== false)}
    ${chk('Includi la verifica di conformità', 'plate.compliance', pl.compliance !== false)}
  </section>
  <section class="grp">
    <h3>Cartiglio</h3>
    <div class="flds">
      ${txt('Organizzazione', 'plate.organization', pl.organization, { ph: 'A.S.D. ...' })}
      ${txt('Località', 'plate.location', pl.location, { ph: 'Campo, città' })}
      ${txt('Redatto da', 'plate.author', pl.author)}
      ${txt('Data', 'plate.date', pl.date, { ph: 'oggi' })}
      ${txt('Pavimentazione', 'plate.surface', pl.surface, { ph: 'asfalto, cemento…' })}
    </div>
    ${ta('Note', 'plate.notes', pl.notes)}
  </section>
  <section class="grp">
    <h3>Produci la tavola <span class="dim">${pages} fogli</span></h3>
    <div class="row">
      ${btn('plate.print', '🖨 Stampa / PDF', 'primary')}
      ${btn('plate.svg', 'SVG')}
      ${btn('plate.png', 'PNG 200 dpi')}
    </div>
    <p class="hint">Per il PDF in scala: <b>Stampa → Salva come PDF</b>, formato ${pl.sheet} ${pl.orientation === 'portrait' ? 'verticale' : 'orizzontale'}, margini <b>nessuno</b> e scala <b>100%</b> (non "adatta alla pagina").</p>
  </section>
  <section class="grp">
    <h3>Anteprima foglio 1</h3>
    <div class="platePrev">${preview}</div>
  </section>`;
}

/* ----------------------------------------------------------------- CLOUD */

function cloudPanel(state) {
  const u = state.user;
  const cfg = state.firebaseConfig;
  const cloudList = (state.cloudProjects || []).map((p) => `<li>
      <b>${e(p.name)}</b><span class="dim">${new Date(p.updatedAt || 0).toLocaleString('it-IT')}</span>
      <span class="row tight">${btn('cloud.open', 'Apri', 'mini', p.id)}${btn('cloud.del', '✕', 'mini danger', p.id)}</span>
    </li>`).join('');
  const localList = (state.localProjects || []).map((p) => `<li>
      <b>${e(p.name)}</b><span class="dim">${new Date(p.updatedAt || 0).toLocaleString('it-IT')}</span>
      <span class="row tight">${btn('loc.open', 'Apri', 'mini', p.id)}${btn('loc.del', '✕', 'mini danger', p.id)}</span>
    </li>`).join('');

  return `
  <section class="grp">
    <h3>Account</h3>
    ${!cfg ? `<p class="hint">Firebase non è ancora configurato: l'app sta salvando <b>solo in questo browser</b>.</p>`
      : u ? `<p class="hint cOk">Connesso come <b>${e(u.name || u.email || 'utente anonimo')}</b>${u.anon ? ' (accesso anonimo)' : ''}.</p>`
        : `<p class="hint">Firebase configurato. Accedi per salvare sul cloud.</p>`}
    <div class="row">
      ${!u ? btn('cloud.google', 'Accedi con Google', 'primary') + btn('cloud.anon', 'Accesso anonimo') : btn('cloud.signout', 'Esci')}
      ${u ? btn('cloud.save', 'Salva sul cloud', 'primary') + btn('cloud.list', 'Aggiorna elenco') : ''}
    </div>
  </section>
  ${u ? `<section class="grp"><h3>Progetti sul cloud</h3><ul class="plist">${cloudList || '<li class="dim">nessuno</li>'}</ul></section>` : ''}
  <section class="grp">
    <h3>Progetti in questo browser</h3>
    <div class="row">${btn('loc.save', 'Salva qui', 'primary')}${btn('proj.new', 'Nuovo progetto')}${btn('imp.json', 'Importa JSON')}</div>
    <ul class="plist">${localList || '<li class="dim">nessuno</li>'}</ul>
  </section>
  <section class="grp">
    <h3>Configurazione Firebase</h3>
    <p class="hint">Incolla qui l'oggetto <code>firebaseConfig</code> della tua app web (Console Firebase → Impostazioni progetto → Le tue app). Resta salvato in questo browser.</p>
    <textarea id="cfgBox" rows="8" spellcheck="false" placeholder='{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'>${cfg ? e(JSON.stringify(cfg, null, 2)) : ''}</textarea>
    <div class="row">${btn('cloud.saveCfg', 'Salva configurazione', 'primary')}${btn('cloud.clearCfg', 'Rimuovi', 'danger')}</div>
  </section>`;
}

/* ------------------------------------------------------------ barra stato */

export function statusHTML(state) {
  const s = state.analysis.stats;
  const regKo = (state.analysis.regulation || []).filter((c) => !c.ok).length;
  const bad = state.analysis.issues.filter((i) => i.level === 'bad').length;
  const warn = state.analysis.issues.filter((i) => i.level === 'warn').length;
  return `<span><b>${fmtM(s.totalLength, 2)}</b> asse</span>
    <span>${s.curveCount} curve</span>
    <span>${s.structureCount} strutture</span>
    <span>corsia ${fmt(s.minWidth, 2)}–${fmt(s.maxWidth, 2)} m</span>
    ${bad ? `<span class="badge bad" data-act="tab:check">${bad} fuori regola</span>` : `<span class="badge ok">ok</span>`}
    ${warn ? `<span class="badge warn" data-act="tab:check">${warn} da verificare</span>` : ''}
    ${regKo ? `<span class="badge warn" data-act="tab:check">regolamento: ${regKo}</span>` : (state.analysis.regulation || []).length ? '<span class="badge ok" data-act="tab:check">regolamento ✓</span>' : ''}`;
}
