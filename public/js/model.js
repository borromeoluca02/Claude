/* model.js — schema del progetto, valori di default, libreria strutture. */

import * as G from './geometry.js';
import { ROLLER, SKATE, START_RAMP_REG, rulePreset, categoryInfo, CATEGORIES } from './regulation.js';

export const SCHEMA_VERSION = 1;

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* Regole di default: valori del Regolamento Tecnico FISR 2025-2026 per il
   roller cross (Art. 65). Restano tutte modificabili e nessuna è bloccante. */
export const DEFAULT_RULES = { ...rulePreset('roller') };

/* Partenza roller cross: 4 box da 1,00 x 1,25 m = 5 m totali + 5 m di corsie. */
export const DEFAULT_START_GATE = {
  enabled: true,
  lanes: ROLLER.startBoxes,          // 4 box di partenza
  laneWidth: ROLLER.startLaneWidth,  // minimo 1,25 m
  boxDepth: ROLLER.startBoxLength,   // 1 m di lunghezza
  runoutLength: ROLLER.startLanesLength, // 5 m di corsie separate
};

/* Partenza skate cross: rampa di lancio. */
/* Rampa di partenza (Allegato 3): piattaforma 2,00 m a quota 2,00 m e scivolo
   di 4,80 m inclinato 25° → ingombro a terra 6,35 m. Nello skate cross i 4 gate
   sono su rampa di altezza massima 2 m (Art. 102). */
export const DEFAULT_START_RAMP = {
  enabled: true,
  name: 'Rampa di partenza',
  length: G.round(START_RAMP_REG.groundLength, 2),
  width: 5,
  height: START_RAMP_REG.height,
  platformLength: START_RAMP_REG.platformLength,
  slopeLength: START_RAMP_REG.slopeLength,
  slopeAngle: START_RAMP_REG.slopeAngle,
};

/* Libreria ostacoli secondo il Regolamento Tecnico (Art. 64, tabella ostacoli)
   con le quote dei disegni dell'Allegato 3.
   length = sviluppo lungo il percorso, width = trasversale, height = altezza.
   `group` serve alle verifiche: almeno 1 Gimkana, 4 Barriere e 3 Rampe di
   almeno 2 tipologie diverse. */
export const STRUCTURE_LIBRARY = [
  // ---- GIMKANE
  { key: 'gimkana', name: 'Gimkana', group: 'gimkane', length: 8, width: 5, height: 0.08,
    note: 'Almeno 3 elementi, distanza 3–5 m, su rettilineo largo almeno 5 m' },
  { key: 'campominato', name: 'Campo minato', group: 'gimkane', length: 6, width: 5, height: 0.08,
    note: 'Elementi non facilmente abbattibili' },
  { key: 'imbuto', name: 'Imbuto', group: 'gimkane', length: 4, width: 5, height: 0.08 },

  // ---- BARRIERE
  { key: 'saltosecco', name: 'Salto a secco', group: 'barriere', length: 0.5, width: 5, height: 0.4,
    byCategory: 'dryJump', note: 'h 30/40/50 cm secondo la categoria (±2 cm)' },
  { key: 'sottopasso', name: 'Sottopasso', group: 'barriere', length: 1.2, width: 5, height: 1.1,
    byCategory: 'underpass', note: 'h 90 cm Gio/Eso, 110 cm altre categorie' },
  { key: 'tunnel', name: 'Tunnel', group: 'barriere', length: 3, width: 5, height: 1.1,
    note: 'Tipologia e dimensioni approvate dalla CDS' },
  { key: 'saltotriplo', name: 'Salto triplo', group: 'barriere', length: 10.4, width: 5, height: 0.3,
    note: '3 elementi a 5 m l\'uno dall\'altro, triangolo equilatero lato 35 cm, h 30 cm' },

  // ---- RAMPE (Allegato 3)
  { key: 'dritta150', name: 'Rampa dritta 1,50', group: 'rampe', length: 1.5, width: 5, height: 0.4, note: 'Inclinazione 16°' },
  { key: 'dritta200', name: 'Rampa dritta 2,00', group: 'rampe', length: 2, width: 5, height: 0.4, note: 'Inclinazione 12°' },
  { key: 'dritta290', name: 'Rampa dritta 2,90', group: 'rampe', length: 2.9, width: 5, height: 0.8, note: 'Inclinazione 16°' },
  { key: 'dritta280', name: 'Rampa non raccordata', group: 'rampe', length: 2.8, width: 5, height: 0.8, note: '16°, non raccordata al suolo' },
  { key: 'banktobank', name: 'Bank to bank', group: 'rampe', length: 6, width: 5, height: 0.75, note: '2,00 + 2,00 + 2,00 m · 22°' },
  { key: 'banktobankvar', name: 'Bank to bank var.', group: 'rampe', length: 6, width: 5, height: 0.85, note: 'Pendenza variabile 25° / 19°' },
  { key: 'curva45', name: 'Curva h 45', group: 'rampe', length: 6, width: 5, height: 0.45 },
  { key: 'spina', name: 'Spina', group: 'rampe', length: 6, width: 5, height: 1.4, note: 'h da 1,00 a 1,80 m · raccordi R 3,00 m' },
  { key: 'dosso', name: 'Dosso', group: 'rampe', length: 2.75, width: 5, height: 0.4 },
  { key: 'valle', name: 'Valle', group: 'rampe', length: 4, width: 5, height: 0.8 },
  { key: 'rialzo', name: 'Rialzo', group: 'rampe', length: 2.45, width: 1.8, height: 0.5,
    note: 'Lunghezza 2,30–2,60 m · h anteriore 15–30 cm · h posteriore 30–50 cm · largh. min 1,80 m' },
  { key: 'canadese', name: 'Canadese', group: 'rampe', length: 3.6, width: 5, height: 0.6, note: '1,80 + 1,80 m' },
  { key: 'parabolica', name: 'Parabolica', group: 'rampe', length: 8, width: 5, height: 1.15, note: 'Rampa di ingresso 2,00 m a 35°' },
  { key: 'funbox', name: 'Funbox', group: 'rampe', length: 6, width: 4, height: 1.75,
    note: 'Skate cross: h 1,50–2,00 m, larghezza 4,00 m' },

  // ---- ALTRO
  { key: 'generica', name: 'Struttura', group: 'altro', length: 4, width: 5, height: 1.0 },
];

/* chiavi usate nelle versioni precedenti dell'app */
const LEGACY_KEYS = {
  rampa: 'dritta200', doppia: 'banktobank', tabletop: 'banktobank', stepup: 'dritta290',
  stepdown: 'dritta290', gobba: 'dosso', whoops: 'dosso', rollers: 'dosso',
  piramide: 'canadese', wall: 'spina', paraboliche: 'parabolica', chicane: 'gimkana',
  bank: 'curva45',
};

export const GROUP_LABELS = { gimkane: 'Gimkane', barriere: 'Barriere', rampe: 'Rampe', altro: 'Altro' };

export function libraryItem(key) {
  return STRUCTURE_LIBRARY.find((s) => s.key === key)
    || STRUCTURE_LIBRARY.find((s) => s.key === LEGACY_KEYS[key])
    || STRUCTURE_LIBRARY[STRUCTURE_LIBRARY.length - 1];
}

/* ------------------------------------------------------------------- area */

export const AREA_SHAPES = ['rect', 'trapezoid', 'triangle', 'polygon'];

export function makeArea(shape = 'rect', params = {}) {
  const p = { w: 60, h: 40, b1: 60, b2: 40, offset: null, base: 60, apexX: null, sides: 5, r: 25, ...params };
  let points;
  switch (shape) {
    case 'trapezoid': points = G.trapezoidPolygon(p.b1, p.b2, p.h, p.offset); break;
    case 'triangle':  points = G.trianglePolygon(p.base, p.h, p.apexX); break;
    case 'polygon':   points = p.points ? p.points.map((q) => ({ x: q.x, y: q.y })) : G.regularPolygon(p.sides, p.r, p.r, p.r); break;
    default:          points = G.rectPolygon(p.w, p.h);
  }
  return { shape, params: p, points: G.ensureCCW(points) };
}

/* --------------------------------------------------------------- progetto */

export function defaultTrackElements(width = 5) {
  return [
    { id: uid('el'), type: 'straight', length: 18, widthStart: width, widthEnd: width },
    { id: uid('el'), type: 'arc', radius: 8, angle: 180, dir: 'left', widthStart: width, widthEnd: width },
    { id: uid('el'), type: 'straight', length: 18, widthStart: width, widthEnd: width },
    { id: uid('el'), type: 'arc', radius: 8, angle: 180, dir: 'left', widthStart: width, widthEnd: width },
  ];
}

export function createProject(opts = {}) {
  const width = opts.width ?? 5;
  const area = opts.area || makeArea('rect', { w: 60, h: 40 });
  const b = G.polygonBounds(area.points);
  return {
    schema: SCHEMA_VERSION,
    id: opts.id || uid('prj'),
    name: opts.name || 'Nuovo percorso',
    discipline: opts.discipline || 'roller', // 'roller' | 'skate'
    category: opts.category || 'ragallmas',  // altezze salti/sottopassi per categoria
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    area,
    track: {
      start: { x: b.minX + 10, y: b.minY + 8, heading: 0 },
      defaultWidth: width,
      closed: false,
      laps: 1,            // passaggi sul tracciato disegnato (massimo 2)
      finishAt: null,     // progressiva della linea di arrivo nell'ultimo passaggio
                          // (null = alla fine del tracciato disegnato)
      elements: opts.elements || defaultTrackElements(width),
    },
    structures: opts.structures || [],
    startGate: { ...DEFAULT_START_GATE },
    startRamp: { ...DEFAULT_START_RAMP },
    rules: { ...DEFAULT_RULES },
    genParams: {
      width,
      targetLength: null,      // m — vuoto = non vincolante
      curveReqs: [],           // [{radius, count}]
      minCurves: null,
      structureCount: null,
      margin: 1.5,             // m di margine dal bordo area
      strategy: 'auto',
      seedCount: 6,
      closedLoop: true,   // ammette anelli da ripetere a giri
    },
    // sfondo fotografico dall'alto: l'origine (0,0) del disegno sta in
    // (lat, lon); `rotation` orienta la foto sotto il disegno
    basemap: {
      on: false,
      provider: 'esri',
      lat: 45.0836, lon: 7.7064,     // Parco Colletta, Torino
      rotation: 0,
      opacity: 0.9,
      locked: false,
      onPlate: false,
      customUrl: '',                 // altro servizio a tessere: .../{z}/{x}/{y}.png
    },
    plate: {
      sheet: 'A3', orientation: 'landscape', scale: 'auto',
      grid: false, stationStep: 25, schedule: true, compliance: true,
      organization: '', location: '', author: '', surface: '', date: '', notes: '',
    },
    view: null,
  };
}

export function makeStructure(key, station = 0, opts = {}) {
  const lib = libraryItem(key);
  const catH = lib.byCategory && opts.category ? categoryInfo(opts.category)[lib.byCategory] : null;
  return {
    id: uid('st'),
    key: lib.key,
    group: lib.group,
    name: opts.name || lib.name,
    height: opts.height ?? catH ?? lib.height,
    length: opts.length ?? lib.length,
    width: opts.width ?? lib.width,
    mode: opts.mode || 'path',   // 'path' = ancorata al tracciato, 'free' = libera
    station,                     // m lungo l'asse del percorso (mode=path)
    side: opts.side ?? 0,        // m di scostamento laterale (+ = sinistra)
    rotation: opts.rotation ?? 0,// gradi, relativi al percorso (o assoluti se free)
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    locked: false,
  };
}

export function makeElement(type, opts = {}) {
  if (type === 'arc') {
    return {
      id: uid('el'), type: 'arc',
      radius: opts.radius ?? 8,
      angle: opts.angle ?? 90,
      dir: opts.dir || 'left',
      widthStart: opts.widthStart ?? 5,
      widthEnd: opts.widthEnd ?? opts.widthStart ?? 5,
    };
  }
  return {
    id: uid('el'), type: 'straight',
    length: opts.length ?? 10,
    widthStart: opts.widthStart ?? 5,
    widthEnd: opts.widthEnd ?? opts.widthStart ?? 5,
  };
}

/* Ripulisce / aggiorna un progetto letto da file o da Firestore. */
function normalizeBasemap(def, raw) {
  const b = { ...def, ...(raw || {}) };
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  b.lat = Math.max(-85, Math.min(85, num(b.lat, def.lat)));
  b.lon = Math.max(-180, Math.min(180, num(b.lon, def.lon)));
  b.rotation = ((num(b.rotation, 0) % 360) + 360) % 360;
  b.opacity = Math.max(0.1, Math.min(1, num(b.opacity, 0.9)));
  b.provider = ['esri', 'google', 'googleroad', 'custom'].includes(b.provider) ? b.provider : 'esri';
  b.customUrl = typeof b.customUrl === 'string' ? b.customUrl.slice(0, 500) : '';
  b.on = !!b.on; b.locked = !!b.locked; b.onPlate = !!b.onPlate;
  return b;
}

export function normalizeProject(raw) {
  const p = createProject({});
  if (!raw || typeof raw !== 'object') return p;
  const out = { ...p, ...raw };
  out.schema = SCHEMA_VERSION;
  out.discipline = raw.discipline === 'skate' ? 'skate' : 'roller';
  out.category = CATEGORIES.some((c) => c.key === raw.category) ? raw.category : 'ragallmas';
  out.rules = { ...DEFAULT_RULES, ...(raw.rules || {}) };
  out.startGate = { ...DEFAULT_START_GATE, ...(raw.startGate || {}) };
  out.startRamp = { ...DEFAULT_START_RAMP, ...(raw.startRamp || {}) };
  out.genParams = { ...p.genParams, ...(raw.genParams || {}) };
  out.basemap = normalizeBasemap(p.basemap, raw.basemap);
  out.plate = { ...p.plate, ...(raw.plate || {}) };

  const a = raw.area || {};
  const pts = Array.isArray(a.points) && a.points.length >= 3
    ? a.points.map((q) => ({ x: +q.x || 0, y: +q.y || 0 }))
    : p.area.points;
  out.area = { shape: AREA_SHAPES.includes(a.shape) ? a.shape : 'polygon', params: { ...p.area.params, ...(a.params || {}) }, points: G.ensureCCW(pts) };

  const t = raw.track || {};
  out.track = {
    start: {
      x: +(t.start?.x ?? p.track.start.x),
      y: +(t.start?.y ?? p.track.start.y),
      heading: +(t.start?.heading ?? 0),
    },
    defaultWidth: +(t.defaultWidth ?? 5),
    closed: !!t.closed,
    ...migrateLapsFinish(t),
    elements: (Array.isArray(t.elements) ? t.elements : []).map((e) => {
      const w0 = +(e.widthStart ?? t.defaultWidth ?? 5);
      const w1 = +(e.widthEnd ?? w0);
      if (e.type === 'arc') {
        return {
          id: e.id || uid('el'), type: 'arc',
          radius: Math.max(0.5, +e.radius || 8),
          angle: G.clamp(+e.angle || 90, 1, 350),
          dir: e.dir === 'right' ? 'right' : 'left',
          widthStart: w0, widthEnd: w1,
        };
      }
      return {
        id: e.id || uid('el'), type: 'straight',
        length: Math.max(0.2, +e.length || 10),
        widthStart: w0, widthEnd: w1,
      };
    }),
  };
  if (!out.track.elements.length) out.track.elements = defaultTrackElements(out.track.defaultWidth);

  out.structures = (Array.isArray(raw.structures) ? raw.structures : []).map((s) => ({
    ...makeStructure(s.key || 'generica'),
    ...s,
    id: s.id || uid('st'),
    group: s.group || libraryItem(s.key || 'generica').group,
    height: +(s.height ?? 1),
    length: Math.max(0.2, +(s.length ?? 4)),
    width: Math.max(0.2, +(s.width ?? 5)),
    station: +(s.station ?? 0),
    side: +(s.side ?? 0),
    rotation: +(s.rotation ?? 0),
    mode: s.mode === 'free' ? 'free' : 'path',
  }));
  return out;
}

/**
 * Passaggi e arrivo. Nelle versioni precedenti si usava `extra` (metri di
 * secondo passaggio); ora il modello è: `laps` = quanti passaggi si fanno sul
 * tracciato (al massimo 2) e `finishAt` = su quale progressiva cade l'arrivo
 * nell'ultimo passaggio. Un progetto vecchio con laps 1 ed extra 40 diventa
 * quindi laps 2 e finishAt 40.
 */
function migrateLapsFinish(t) {
  let laps = G.clamp(Math.round(+(t.laps ?? 1) || 1), 1, 2);
  let finishAt = t.finishAt === null || t.finishAt === undefined ? null : Math.max(0, +t.finishAt || 0);
  const legacyExtra = Math.max(0, +(t.extra ?? 0) || 0);
  if (finishAt === null && legacyExtra > 0) {
    finishAt = legacyExtra;
    laps = Math.min(2, laps + 1);
  }
  return { laps, finishAt };
}

export const cloneProject = (p) => JSON.parse(JSON.stringify(p));

export { ROLLER, SKATE, CATEGORIES, categoryInfo, rulePreset, START_RAMP_REG };
