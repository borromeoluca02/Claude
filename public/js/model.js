/* model.js — schema del progetto, valori di default, libreria strutture. */

import * as G from './geometry.js';

export const SCHEMA_VERSION = 1;

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* Regole di default (tutte modificabili dall'utente, nessuna è bloccante). */
export const DEFAULT_RULES = {
  minGap: 3,        // m — distanza minima fra ostacoli consecutivi
  maxGap: 25,       // m — distanza massima fra ostacoli consecutivi
  minWidth: 3,      // m — larghezza minima della corsia
  maxWidth: 5,      // m — larghezza nominale della corsia
  minRadius: 3,     // m — raggio minimo di curva (0 = regola disattivata)
  checkArea: true,  // segnala in rosso ciò che esce dall'area
};

/* Partenza roller cross: 4 box da 1,00 x 1,25 m = 5 m totali + 5 m di corsie. */
export const DEFAULT_START_GATE = {
  enabled: true,
  lanes: 4,
  laneWidth: 1.25,
  boxDepth: 1.0,
  runoutLength: 5.0,
};

/* Partenza skate cross: rampa di lancio. */
export const DEFAULT_START_RAMP = {
  enabled: true,
  name: 'Rampa di partenza',
  length: 6,
  width: 5,
  height: 1.8,
};

/* Libreria strutture: length = sviluppo lungo il percorso, width = trasversale. */
export const STRUCTURE_LIBRARY = [
  { key: 'rampa',      name: 'Rampa',            length: 4,   width: 5, height: 1.2, cat: 'salto' },
  { key: 'doppia',     name: 'Doppia',           length: 8,   width: 5, height: 1.4, cat: 'salto' },
  { key: 'tabletop',   name: 'Table top',        length: 7,   width: 5, height: 1.5, cat: 'salto' },
  { key: 'stepup',     name: 'Step up',          length: 6,   width: 5, height: 1.8, cat: 'salto' },
  { key: 'stepdown',   name: 'Step down',        length: 6,   width: 5, height: 1.8, cat: 'salto' },
  { key: 'gobba',      name: 'Gobba',            length: 3,   width: 5, height: 0.6, cat: 'ritmo' },
  { key: 'whoops',     name: 'Whoops (3 gobbe)', length: 6,   width: 5, height: 0.5, cat: 'ritmo' },
  { key: 'rollers',    name: 'Rollers',          length: 9,   width: 5, height: 0.4, cat: 'ritmo' },
  { key: 'piramide',   name: 'Piramide',         length: 8,   width: 5, height: 1.6, cat: 'salto' },
  { key: 'wall',       name: 'Wall',             length: 5,   width: 5, height: 2.0, cat: 'tecnico' },
  { key: 'paraboliche',name: 'Parabolica',       length: 6,   width: 5, height: 1.0, cat: 'tecnico' },
  { key: 'chicane',    name: 'Chicane',          length: 6,   width: 5, height: 0.3, cat: 'tecnico' },
  { key: 'bank',       name: 'Curva sopraelevata', length: 8, width: 5, height: 1.2, cat: 'curva' },
  { key: 'generica',   name: 'Struttura',        length: 4,   width: 5, height: 1.0, cat: 'altro' },
];

export function libraryItem(key) {
  return STRUCTURE_LIBRARY.find((s) => s.key === key) || STRUCTURE_LIBRARY[STRUCTURE_LIBRARY.length - 1];
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
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    area,
    track: {
      start: { x: b.minX + 10, y: b.minY + 8, heading: 0 },
      defaultWidth: width,
      closed: false,
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
    },
    view: null,
  };
}

export function makeStructure(key, station = 0, opts = {}) {
  const lib = libraryItem(key);
  return {
    id: uid('st'),
    key: lib.key,
    name: opts.name || lib.name,
    height: opts.height ?? lib.height,
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
export function normalizeProject(raw) {
  const p = createProject({});
  if (!raw || typeof raw !== 'object') return p;
  const out = { ...p, ...raw };
  out.schema = SCHEMA_VERSION;
  out.discipline = raw.discipline === 'skate' ? 'skate' : 'roller';
  out.rules = { ...DEFAULT_RULES, ...(raw.rules || {}) };
  out.startGate = { ...DEFAULT_START_GATE, ...(raw.startGate || {}) };
  out.startRamp = { ...DEFAULT_START_RAMP, ...(raw.startRamp || {}) };
  out.genParams = { ...p.genParams, ...(raw.genParams || {}) };

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

export const cloneProject = (p) => JSON.parse(JSON.stringify(p));
