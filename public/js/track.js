/* track.js — costruzione geometrica del percorso e validazione delle regole.
   Il percorso è una catena di elementi (rettilinei e archi) con continuità di
   tangente: ogni elemento parte dove finisce il precedente. Le progressive
   ("station", in metri) sono misurate sull'asse della corsia.

   RAGGIO DELLE CURVE: il valore inserito dall'utente è il raggio INTERNO,
   cioè la distanza fra il centro della curva e il bordo interno della
   carreggiata, come si misura sulle planimetriche di gara. Il raggio dell'asse
   della corsia, che serve per la geometria, è quindi raggio interno + metà
   larghezza. Una curva "R5" larga 5 m ha asse a 7,50 m e bordo esterno a
   10 m dal centro. */

import * as G from './geometry.js';
import { libraryItem } from './model.js';
import { ROLLER, SKATE, categoryInfo } from './regulation.js';

/** numero formattato all'italiana, per i messaggi */
const n2 = (v, d = 2) => G.round(v, d).toString().replace('.', ',');

const { DEG, add, sub, mul, dirOf, leftOf, clamp } = G;

/* ---------------------------------------------------------------- baking */

export function bakeTrack(project) {
  const t = project.track;
  let s = 0;
  let p = { x: t.start.x, y: t.start.y };
  let h = (t.start.heading || 0) * DEG;
  const elements = [];

  for (const e of t.elements) {
    const startPoint = p, startHeading = h, startStation = s;
    let length, endPoint, endHeading, center = null, startAngle = 0, sweep = 0;

    if (e.type === 'arc') {
      // il raggio indicato è quello interno: l'asse corre mezza corsia più in là
      const meanW = (((+e.widthStart) || 0) + ((+e.widthEnd) || 0)) / 2;
      const rInner = Math.max(0, +e.radius || 0);
      const r = Math.max(0.2, rInner + meanW / 2);
      sweep = (e.dir === 'right' ? -1 : 1) * (e.angle || 0) * DEG;
      const n = leftOf(h);
      center = e.dir === 'right' ? sub(p, mul(n, r)) : add(p, mul(n, r));
      startAngle = Math.atan2(p.y - center.y, p.x - center.x);
      length = r * Math.abs(sweep);
      endHeading = h + sweep;
      const a1 = startAngle + sweep;
      endPoint = add(center, { x: r * Math.cos(a1), y: r * Math.sin(a1) });
    } else {
      length = Math.max(0.01, e.length || 0);
      endPoint = add(p, mul(dirOf(h), length));
      endHeading = h;
    }

    elements.push({
      ...e, length, startStation, endStation: startStation + length,
      startPoint, endPoint, startHeading, endHeading, center, startAngle, sweep,
      // `radius` resta quello interno dichiarato; qui si espone anche quello
      // geometrico dell'asse, usato dal disegno
      axisRadius: e.type === 'arc' ? Math.abs(length / (Math.abs(sweep) || 1)) : null,
    });
    s += length; p = endPoint; h = endHeading;
  }

  const baked = {
    elements,
    totalLength: s,
    startPoint: { x: t.start.x, y: t.start.y },
    startHeading: (t.start.heading || 0) * DEG,
    endPoint: p,
    endHeading: h,
  };
  baked.samples = sampleCenterline(baked, 0.4);
  return baked;
}

/** telaio locale (punto, direzione, larghezza) alla progressiva s */
export function frameAt(baked, s) {
  const els = baked.elements;
  if (!els.length) {
    return { point: baked.startPoint, heading: baked.startHeading, width: 5, element: null, t: 0 };
  }
  const sc = clamp(s, 0, baked.totalLength);
  let el = els[els.length - 1];
  for (const e of els) { if (sc <= e.endStation + 1e-9) { el = e; break; } }
  const t = el.length < 1e-9 ? 0 : clamp((sc - el.startStation) / el.length, 0, 1);
  const width = G.lerp(el.widthStart, el.widthEnd, t);
  if (el.type === 'arc') {
    const a = el.startAngle + el.sweep * t;
    // sull'arco conta il raggio dell'asse, non quello interno dichiarato
    const ra = el.axisRadius || (Math.max(0, +el.radius || 0) + width / 2);
    return {
      point: add(el.center, { x: ra * Math.cos(a), y: ra * Math.sin(a) }),
      heading: el.startHeading + el.sweep * t,
      width, element: el, t,
    };
  }
  return {
    point: add(el.startPoint, mul(dirOf(el.startHeading), el.length * t)),
    heading: el.startHeading, width, element: el, t,
  };
}

export function widthAt(baked, s) { return frameAt(baked, s).width; }

/**
 * Campiona l'asse elemento per elemento: [{x,y,s,heading,width,ei}].
 * Ogni elemento contribuisce sempre i propri due estremi, così i bordi
 * disegnati combaciano esattamente ai giunti e nessun tratto resta senza
 * campioni. Campionare a passo costante sull'intero percorso lasciava invece
 * buchi fino a mezzo metro, che si vedevano come carreggiate disallineate.
 */
export function sampleCenterline(baked, step = 0.4) {
  const out = [];
  if (!baked.elements.length) {
    out.push({ x: baked.startPoint.x, y: baked.startPoint.y, s: 0, heading: baked.startHeading, width: 5, ei: -1 });
    return out;
  }
  baked.elements.forEach((el, ei) => {
    const n = Math.max(2, Math.ceil(el.length / step) + 1);
    const rAxis = el.type === 'arc' ? el.length / Math.abs(el.sweep || 1) : 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const width = G.lerp(el.widthStart, el.widthEnd, t);
      let point, heading;
      if (el.type === 'arc') {
        const a = el.startAngle + el.sweep * t;
        point = add(el.center, { x: rAxis * Math.cos(a), y: rAxis * Math.sin(a) });
        heading = el.startHeading + el.sweep * t;
      } else {
        point = add(el.startPoint, mul(dirOf(el.startHeading), el.length * t));
        heading = el.startHeading;
      }
      out.push({ x: point.x, y: point.y, s: el.startStation + el.length * t, heading, width, ei });
    }
  });
  return out;
}

/** bordi destro/sinistro della corsia, con l'indice dell'elemento di origine */
export function edgePaths(baked, step = 0.4) {
  const left = [], right = [];
  for (const sm of baked.samples.length ? baked.samples : sampleCenterline(baked, step)) {
    const n = leftOf(sm.heading);
    left.push({ x: sm.x + n.x * sm.width / 2, y: sm.y + n.y * sm.width / 2, s: sm.s, ei: sm.ei });
    right.push({ x: sm.x - n.x * sm.width / 2, y: sm.y - n.y * sm.width / 2, s: sm.s, ei: sm.ei });
  }
  return { left, right };
}

/** proietta un punto sull'asse → { station, side, dist } */
export function projectPoint(baked, p) {
  const sm = baked.samples;
  let best = { station: 0, side: 0, dist: Infinity };
  for (let i = 1; i < sm.length; i++) {
    const a = sm[i - 1], b = sm[i];
    const { point, t } = G.closestPointOnSegment(p, a, b);
    const d = G.dist(p, point);
    if (d < best.dist) {
      const dir = G.norm(sub(b, a));
      const left = { x: -dir.y, y: dir.x };
      best = { station: G.lerp(a.s, b.s, t), side: G.dot(sub(p, point), left), dist: d };
    }
  }
  return best;
}

/* ------------------------------------------------------------- strutture */

/** posizione/orientamento assoluti di una struttura */
export function structureFrame(st, baked) {
  if (st.mode === 'free') {
    return { center: { x: st.x, y: st.y }, heading: (st.rotation || 0) * DEG, station: projectPoint(baked, { x: st.x, y: st.y }).station };
  }
  const f = frameAt(baked, st.station);
  const n = leftOf(f.heading);
  return {
    center: add(f.point, mul(n, st.side || 0)),
    heading: f.heading + (st.rotation || 0) * DEG,
    station: clamp(st.station, 0, baked.totalLength),
    laneWidth: f.width,
  };
}

export function footprint(st, baked) {
  const fr = structureFrame(st, baked);
  const d = dirOf(fr.heading), n = leftOf(fr.heading);
  const hl = st.length / 2, hw = st.width / 2;
  const c = fr.center;
  return {
    frame: fr,
    corners: [
      { x: c.x + d.x * hl + n.x * hw, y: c.y + d.y * hl + n.y * hw },
      { x: c.x + d.x * hl - n.x * hw, y: c.y + d.y * hl - n.y * hw },
      { x: c.x - d.x * hl - n.x * hw, y: c.y - d.y * hl - n.y * hw },
      { x: c.x - d.x * hl + n.x * hw, y: c.y - d.y * hl + n.y * hw },
    ],
  };
}

/* -------------------------------------------------------- zona di partenza */

/** geometria della griglia di partenza roller cross (4 box + 5 m di corsie) */
export function startGateGeometry(project, baked) {
  const sg = project.startGate;
  if (!sg || !sg.enabled || project.discipline !== 'roller') return null;
  const lanes = Math.max(1, Math.round(sg.lanes));
  const lw = sg.laneWidth, depth = sg.boxDepth, run = Math.max(0, sg.runoutLength);
  const totalW = lanes * lw;
  const p0 = baked.startPoint, h0 = baked.startHeading;
  const d = dirOf(h0), n = leftOf(h0);

  const at = (sAlong, lateral) => ({
    x: p0.x + d.x * sAlong + n.x * lateral,
    y: p0.y + d.y * sAlong + n.y * lateral,
  });

  const boxes = [];
  for (let i = 0; i < lanes; i++) {
    const l1 = totalW / 2 - i * lw, l2 = totalW / 2 - (i + 1) * lw;
    boxes.push({
      lane: i + 1,
      corners: [at(0, l1), at(0, l2), at(-depth, l2), at(-depth, l1)],
      center: at(-depth / 2, (l1 + l2) / 2),
    });
  }

  // corsie guidate: seguono l'asse per `run` metri (anche se il percorso curva)
  const laneLines = [];
  const steps = Math.max(2, Math.ceil(run / 0.5) + 1);
  for (let k = 0; k <= lanes; k++) {
    const lateral = totalW / 2 - k * lw;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const s = (i / (steps - 1)) * Math.min(run, baked.totalLength);
      const f = frameAt(baked, s);
      const nn = leftOf(f.heading);
      pts.push({ x: f.point.x + nn.x * lateral, y: f.point.y + nn.y * lateral });
    }
    laneLines.push(pts);
  }

  return {
    totalWidth: totalW, lanes, laneWidth: lw, depth, runout: run,
    boxes,
    startLine: [at(0, totalW / 2), at(0, -totalW / 2)],
    backLine: [at(-depth, totalW / 2), at(-depth, -totalW / 2)],
    laneLines,
    obstacleEnd: Math.min(run, baked.totalLength),
    center: at(-depth / 2, 0),
  };
}

/**
 * Rampa di partenza dello skate cross. Sta DIETRO la linea di partenza, come i
 * box del roller cross: il percorso disegnato comincia davanti alla rampa, non
 * sotto di essa. Conta come primo ostacolo, con l'uscita sulla progressiva 0.
 */
export function startRampGeometry(project, baked) {
  const sr = project.startRamp;
  if (!sr || !sr.enabled || project.discipline !== 'skate') return null;
  const L = Math.max(0.5, +sr.length || 6);
  const W = Math.max(0.5, +sr.width || 5);
  const p0 = baked.startPoint, h0 = baked.startHeading;
  const d = dirOf(h0), n = leftOf(h0);
  const center = add(p0, mul(d, -L / 2));
  const hl = L / 2, hw = W / 2;
  const corners = [
    { x: center.x + d.x * hl + n.x * hw, y: center.y + d.y * hl + n.y * hw },
    { x: center.x + d.x * hl - n.x * hw, y: center.y + d.y * hl - n.y * hw },
    { x: center.x - d.x * hl - n.x * hw, y: center.y - d.y * hl - n.y * hw },
    { x: center.x - d.x * hl + n.x * hw, y: center.y - d.y * hl + n.y * hw },
  ];
  const st = {
    id: '__startramp', key: 'rampa', name: sr.name || 'Rampa di partenza',
    height: sr.height, length: L, width: W,
    mode: 'path', station: 0, side: 0, rotation: 0,
  };
  return { struct: st, corners, frame: { center, heading: h0, station: 0, laneWidth: W }, sStart: 0, sEnd: 0 };
}

/* ------------------------------------------------------------ validazione */

/** elenco ordinato degli ostacoli sull'asse (partenza, curve, strutture) */
/** quadretti della linea di arrivo: seguono la pista, così la banda resta
 *  dentro la carreggiata anche quando l'arrivo cade dentro una curva */
export function finishBandCells(baked, station, cell = 0.5) {
  const fs = G.clamp(station, 0, baked.totalLength);
  const f0 = frameAt(baked, fs);
  const cols = Math.max(2, Math.round(f0.width / cell));
  const cw = f0.width / cols;
  const at = (s, rel) => {
    const f = frameAt(baked, G.clamp(s, 0, baked.totalLength));
    const n = G.leftOf(f.heading);
    return add(f.point, mul(n, rel * f.width));   // rel: -0.5 .. +0.5
  };
  const cells = [];
  for (let row = 0; row < 2; row++) {
    const s0 = fs - cw + row * cw, s1 = s0 + cw;
    for (let c = 0; c < cols; c++) {
      const r0 = 0.5 - c / cols, r1 = r0 - 1 / cols;
      cells.push({
        dark: (row + c) % 2 === 0,
        corners: [at(s0, r0), at(s0, r1), at(s1, r1), at(s1, r0)],
      });
    }
  }
  const outline = [at(fs - cw, 0.5), at(fs - cw, -0.5), at(fs + cw, -0.5), at(fs + cw, 0.5)];
  return { cells, outline, frame: f0, cw };
}

export function collectObstacles(project, baked) {
  const out = [];
  const gate = startGateGeometry(project, baked);
  const ramp = startRampGeometry(project, baked);

  if (gate) {
    out.push({ kind: 'start', id: '__gate', label: 'Griglia di partenza', sStart: 0, sEnd: gate.obstacleEnd, fixed: true });
  } else if (ramp) {
    // la rampa è dietro la linea: la gara comincia alla progressiva 0
    out.push({ kind: 'start', id: '__startramp', label: ramp.struct.name, sStart: 0, sEnd: 0, fixed: true });
  }

  for (const el of baked.elements) {
    if (el.type !== 'arc') continue;
    out.push({
      kind: 'curve', id: el.id, label: `Curva R${n2(el.radius, 1)}`,
      sStart: el.startStation, sEnd: el.endStation, element: el,
    });
  }

  for (const st of project.structures) {
    const fr = structureFrame(st, baked);
    const sMid = fr.station;
    out.push({
      kind: 'structure', id: st.id, label: st.name,
      sStart: sMid - st.length / 2, sEnd: sMid + st.length / 2,
      structure: st, offTrack: st.mode === 'free' && G.dist(fr.center, G.polylineAt(baked.samples, sMid).point) > st.width,
    });
  }

  // la zona di partenza resta sempre il primo ostacolo
  out.sort((a, b) => {
    if (a.kind === 'start' && b.kind !== 'start') return -1;
    if (b.kind === 'start' && a.kind !== 'start') return 1;
    return (a.sStart - b.sStart) || (a.sEnd - b.sEnd);
  });
  return out;
}

/**
 * Analizza il progetto: restituisce stato (ok / rosso / avviso) per ogni
 * elemento, struttura e ostacolo, più le statistiche del percorso.
 * Nessun controllo è bloccante: serve solo a colorare e segnalare.
 */
export function analyze(project) {
  const baked = bakeTrack(project);
  const rules = project.rules;
  const obstacles = collectObstacles(project, baked);
  const issues = [];

  /* anello: il tracciato torna in partenza con la stessa direzione? */
  const closeGap = G.dist(baked.endPoint, baked.startPoint);
  const closeTurn = Math.abs(G.wrapPi(baked.endHeading - baked.startHeading)) * G.RAD;
  const isClosed = baked.elements.length > 1 && closeGap <= 1.2 && closeTurn <= 8;
  // passaggi sul tracciato: più di uno solo se l'anello è chiuso
  const laps = isClosed ? G.clamp(Math.round(project.track.laps || 1), 1, 2) : 1;
  // la linea di arrivo può stare su una progressiva qualsiasi dell'ultimo
  // passaggio; se non è stata posata, cade alla fine del tracciato
  const fa = project.track.finishAt;
  const finishAt = (fa === null || fa === undefined || !(fa > 0) || fa >= baked.totalLength - 1e-6)
    ? null : G.clamp(+fa, 0.5, baked.totalLength - 0.5);
  const finishStation = finishAt === null ? baked.totalLength : finishAt;
  const raceLength = baked.totalLength * (laps - 1) + finishStation;

  const status = {};  // id → { level:'ok'|'bad'|'warn', gap, reasons:[] }

  const setStatus = (id, level, reason) => {
    const cur = status[id] || { level: 'ok', reasons: [], gap: null };
    const rank = { ok: 0, warn: 1, bad: 2 };
    if (rank[level] > rank[cur.level]) cur.level = level;
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
    status[id] = cur;
    return cur;
  };

  /* 1. distanze fra ostacoli consecutivi (min 3 m / max 25 m di default) */
  let prev = null;
  for (const ob of obstacles) {
    if (ob.kind === 'start') { prev = ob; setStatus(ob.id, 'ok'); continue; }
    if (!prev) {
      setStatus(ob.id, 'ok');
      status[ob.id].gap = null;
      prev = ob;
      continue;
    }
    // il primo ostacolo si misura dalla LINEA di partenza (Art. 65: minimo 12 m),
    // gli altri dalla fine dell'ostacolo precedente
    const fromStart = prev.kind === 'start' && rules.firstObstacleMin > 0;
    const gap = fromStart ? ob.sStart : ob.sStart - prev.sEnd;
    const minGap = fromStart ? rules.firstObstacleMin : rules.minGap;
    const prevLabel = fromStart ? 'linea di partenza' : prev.label;
    const st = setStatus(ob.id, 'ok');
    st.gap = gap;
    st.prevLabel = prevLabel;
    st.fromStart = fromStart;
    if (gap < minGap - 1e-6) {
      setStatus(ob.id, 'bad', `Distanza da "${prevLabel}" di ${n2(gap, 2)} m: sotto il minimo di ${n2(minGap)} m`);
      issues.push({ level: 'bad', target: ob.id, text: `${ob.label}: solo ${n2(gap, 2)} m da ${prevLabel} (min ${n2(minGap)} m)` });
    } else if (gap > rules.maxGap + 1e-6) {
      setStatus(ob.id, 'bad', `Distanza da "${prevLabel}" di ${n2(gap, 2)} m: oltre il massimo di ${n2(rules.maxGap)} m`);
      issues.push({ level: 'bad', target: ob.id, text: `${ob.label}: ${n2(gap, 2)} m da ${prevLabel} (max ${n2(rules.maxGap)} m)` });
    }
    if (ob.offTrack) {
      setStatus(ob.id, 'warn', 'Struttura lontana dall\'asse del percorso');
      issues.push({ level: 'warn', target: ob.id, text: `${ob.label}: posizionata fuori dall'asse del percorso` });
    }
    prev = ob;
  }

  /* 1b. distanza dell'ultimo ostacolo dalla linea di arrivo.
         Su un anello l'arrivo cade sulla progressiva dell'ultimo passaggio,
         quindi l'ostacolo da controllare è l'ultimo prima di quel punto. */
  if (rules.finishMin > 0) {
    const fc = finishClearance(baked, obstacles, { isClosed, finishStation });
    const target = fc && fc.target;
    const d = fc ? fc.distance : null;
    if (fc && d < rules.finishMin - 1e-6) {
      setStatus(target.id, 'bad', `Distanza dall'arrivo di ${n2(d, 2)} m: sotto il minimo di ${n2(rules.finishMin)} m`);
      issues.push({ level: 'bad', target: target.id, text: `${target.label}: ${n2(d, 2)} m dall'arrivo (min ${n2(rules.finishMin)} m)` });
    }
  }

  /* 1c. nei percorsi a più giri conta anche la distanza attraverso la giunzione */
  const realObs = obstacles.filter((o) => o.kind !== 'start');
  if (isClosed && laps > 1 && realObs.length) {
    const first = realObs[0], last = realObs[realObs.length - 1];
    const wrap = (baked.totalLength - last.sEnd) + first.sStart;
    if (wrap < rules.minGap - 1e-6) {
      setStatus(first.id, 'bad', `A cavallo della partenza restano ${n2(wrap)} m da "${last.label}": sotto il minimo di ${n2(rules.minGap)} m`);
      issues.push({ level: 'bad', target: first.id, text: `Fra ${last.label} e ${first.label}, passando dalla partenza, ci sono ${n2(wrap)} m (min ${n2(rules.minGap)} m)` });
    } else if (wrap > rules.maxGap + 1e-6) {
      setStatus(first.id, 'warn', `A cavallo della partenza ci sono ${n2(wrap)} m senza ostacoli`);
      issues.push({ level: 'warn', target: first.id, text: `Fra ${last.label} e ${first.label}, passando dalla partenza, ci sono ${n2(wrap)} m (max ${n2(rules.maxGap)} m)` });
    }
  }

  /* 2. larghezza corsia */
  let minW = Infinity, maxW = -Infinity;
  for (const el of baked.elements) {
    const w0 = el.widthStart, w1 = el.widthEnd;
    minW = Math.min(minW, w0, w1); maxW = Math.max(maxW, w0, w1);
    if (Math.min(w0, w1) < rules.minWidth - 1e-6) {
      setStatus(el.id, 'bad', `Larghezza ${n2(Math.min(w0, w1), 2)} m sotto il minimo di ${n2(rules.minWidth)} m`);
      issues.push({ level: 'bad', target: el.id, text: `Tratto largo ${n2(Math.min(w0, w1), 2)} m (min ${n2(rules.minWidth)} m)` });
    } else setStatus(el.id, 'ok');
    if (Math.max(w0, w1) > rules.maxWidth + 1e-6) {
      setStatus(el.id, 'warn', `Larghezza ${n2(Math.max(w0, w1), 2)} m oltre la nominale di ${n2(rules.maxWidth)} m`);
    }
    if (el.type === 'arc' && rules.minRadius > 0 && el.radius < rules.minRadius - 1e-6) {
      setStatus(el.id, 'bad', `Raggio ${n2(el.radius, 2)} m sotto il minimo di ${n2(rules.minRadius)} m`);
      issues.push({ level: 'bad', target: el.id, text: `Curva R${n2(el.radius, 2)} sotto il raggio minimo (${n2(rules.minRadius)} m)` });
    }
  }
  if (!baked.elements.length) { minW = project.track.defaultWidth; maxW = minW; }

  /* 3. corridoio dentro l'area */
  const areaPts = project.area.points;
  const outside = [];
  if (rules.checkArea && areaPts.length >= 3) {
    const { left, right } = edgePaths(baked);
    let run = null;
    for (let i = 0; i < left.length; i++) {
      const bad = !G.pointInPolygon(left[i], areaPts) || !G.pointInPolygon(right[i], areaPts);
      if (bad && !run) run = { from: left[i].s, to: left[i].s };
      else if (bad) run.to = left[i].s;
      else if (run) { outside.push(run); run = null; }
    }
    if (run) outside.push(run);
    for (const o of outside) {
      issues.push({ level: 'bad', target: null, text: `Il percorso esce dall'area fra ${n2(o.from, 1)} m e ${n2(o.to, 1)} m` });
    }
    // strutture fuori area
    for (const st of project.structures) {
      const fp = footprint(st, baked);
      if (fp.corners.some((c) => !G.pointInPolygon(c, areaPts))) {
        setStatus(st.id, 'bad', 'La struttura esce dall\'area disponibile');
        issues.push({ level: 'bad', target: st.id, text: `${st.name}: esce dall'area disponibile` });
      }
    }
    const gate = startGateGeometry(project, baked);
    if (gate && gate.boxes.some((b) => b.corners.some((c) => !G.pointInPolygon(c, areaPts)))) {
      issues.push({ level: 'warn', target: '__gate', text: 'La griglia di partenza esce dall\'area disponibile' });
      setStatus('__gate', 'warn', 'Griglia fuori area');
    }
  }

  /* 4. struttura più larga della corsia */
  for (const st of project.structures) {
    if (st.mode !== 'path') continue;
    const fr = structureFrame(st, baked);
    if (fr.laneWidth && st.width > fr.laneWidth + 0.01) {
      setStatus(st.id, 'warn', `Struttura larga ${n2(st.width, 2)} m su una corsia di ${n2(fr.laneWidth, 2)} m`);
    }
    if (st.station < -1e-6 || st.station > baked.totalLength + 1e-6) {
      setStatus(st.id, 'warn', 'Progressiva fuori dal percorso');
    }
  }

  /* 5. incroci del tracciato */
  const crossings = G.polylineSelfIntersections(baked.samples.map((p) => ({ x: p.x, y: p.y })), 6);
  if (crossings.length) {
    issues.push({ level: 'warn', target: null, text: `Il tracciato si incrocia in ${crossings.length} punto(i)` });
  }

  /* statistiche */
  const curves = baked.elements.filter((e) => e.type === 'arc');
  const byRadius = {};
  for (const c of curves) {
    const k = G.round(c.radius, 1);
    byRadius[k] = (byRadius[k] || 0) + 1;
  }
  const areaVal = Math.abs(G.polygonArea(areaPts));
  const stats = {
    totalLength: baked.totalLength,
    isClosed, closeGap, closeTurn, laps, finishAt, raceLength, finishStation,
    straightLength: baked.elements.filter((e) => e.type === 'straight').reduce((a, e) => a + e.length, 0),
    curveLength: curves.reduce((a, e) => a + e.length, 0),
    curveCount: curves.length,
    curvesRight: curves.filter((c) => c.dir === 'right').length,
    curvesLeft: curves.filter((c) => c.dir === 'left').length,
    curvesByRadius: byRadius,
    structureCount: project.structures.length,
    minWidth: minW, maxWidth: maxW,
    areaValue: areaVal,
    areaUsed: baked.samples.reduce((a, p, i, arr) => i ? a + G.dist(arr[i - 1], p) * p.width : 0, 0),
    crossings: crossings.length,
    badCount: Object.values(status).filter((s) => s.level === 'bad').length,
    warnCount: Object.values(status).filter((s) => s.level === 'warn').length,
    outsideRuns: outside.length,
  };

  /* verifica dei parametri richiesti (target lunghezza, curve per raggio) */
  const gp = project.genParams || {};
  const checks = [];
  if (gp.targetLength) {
    const d = baked.totalLength - gp.targetLength;
    checks.push({
      label: `Lunghezza obiettivo ${gp.targetLength} m`,
      ok: Math.abs(d) <= Math.max(5, gp.targetLength * 0.05),
      detail: `${n2(baked.totalLength, 1)} m (${d >= 0 ? '+' : ''}${n2(d, 1)} m)`,
    });
  }
  if (gp.minCurves) {
    checks.push({ label: `Curve minime ${gp.minCurves}`, ok: curves.length >= gp.minCurves, detail: `${curves.length} curve` });
  }
  for (const req of gp.curveReqs || []) {
    if (!req || !req.radius) continue;
    const n = curves.filter((c) => Math.abs(c.radius - req.radius) <= 0.51).length;
    checks.push({
      label: `${req.count || 1} curva(e) con R≈${req.radius} m`,
      ok: n >= (req.count || 1), detail: `trovate ${n}`,
    });
  }

  const regulation = rules.regCheck === false ? [] : regulationChecks(project, baked, obstacles, stats);
  return { baked, obstacles, status, issues, stats, checks, outside, regulation };
}

/**
 * Conformità al Regolamento Tecnico FISR 2025-2026.
 * Restituisce un elenco di controlli { label, ok, detail, ref }: è una
 * fotografia, non un blocco. I controlli non applicabili vengono omessi.
 */
/**
 * Distanza fra l'ultimo ostacolo e la linea di arrivo.
 * Su un anello con secondo passaggio l'arrivo non è alla fine del giro ma
 * sulla progressiva dove finisce la gara, quindi va cercato l'ostacolo che
 * precede quel punto.
 */
export function finishClearance(baked, obstacles, stats) {
  const obs = obstacles.filter((o) => o.kind !== 'start');
  if (!obs.length) return null;
  const fin = stats && stats.finishStation != null ? stats.finishStation : baked.totalLength;
  const closed = stats && stats.isClosed;
  if (!closed && fin >= baked.totalLength - 1e-6) {
    const last = obs[obs.length - 1];
    return { target: last, distance: baked.totalLength - last.sEnd };
  }
  const before = obs.filter((o) => o.sEnd <= fin + 1e-6);
  if (before.length) {
    const target = before[before.length - 1];
    return { target, distance: fin - target.sEnd };
  }
  const last = obs[obs.length - 1];
  return { target: last, distance: closed ? (baked.totalLength - last.sEnd) + fin : fin };
}

export function regulationChecks(project, baked, obstacles, stats) {
  const out = [];
  const add = (label, ok, detail, ref) => out.push({ label, ok: !!ok, detail, ref });
  const structs = project.structures;
  const els = baked.elements;
  const arcs = els.filter((e) => e.type === 'arc');

  if (project.discipline === 'roller') {
    const R = ROLLER;
    const race = stats.raceLength;
    add('Lunghezza totale 250–300 m',
      race >= R.totalLengthMin && race <= R.totalLengthMax,
      stats.laps > 1 || stats.finishAt !== null
        ? `${n2(race, 1)} m (giro ${n2(baked.totalLength, 1)} m × ${stats.laps} passaggi, arrivo a ${n2(stats.finishStation, 1)} m)`
        : `${n2(race, 1)} m`, 'Art. 65.4');

    // rettilineo di partenza: primo elemento rettilineo, almeno 20 m
    const first = els[0];
    const startStraight = first && first.type === 'straight' ? first.length : 0;
    add('Rettilineo di partenza ≥ 20 m', startStraight >= R.startStraightMinLength,
      first ? (first.type === 'straight' ? `${n2(startStraight, 1)} m` : 'il percorso inizia con una curva') : 'percorso vuoto', 'Art. 65.4');

    // larghezza: 5 m su partenza e prima curva, 3,5 m sul resto
    const firstCurveIdx = els.findIndex((e) => e.type === 'arc');
    const startZone = firstCurveIdx < 0 ? els : els.slice(0, firstCurveIdx + 1);
    const restZone = firstCurveIdx < 0 ? [] : els.slice(firstCurveIdx + 1);
    const minStart = startZone.length ? Math.min(...startZone.map((e) => Math.min(e.widthStart, e.widthEnd))) : null;
    const minRest = restZone.length ? Math.min(...restZone.map((e) => Math.min(e.widthStart, e.widthEnd))) : null;
    if (minStart !== null) {
      add('Larghezza partenza e prima curva ≥ 5 m', minStart >= R.startLaneWidthMin - 1e-6, `${n2(minStart, 2)} m`, 'Art. 65.4');
    }
    if (minRest !== null) {
      add('Larghezza del resto del percorso ≥ 3,5 m', minRest >= R.laneWidthMin - 1e-6, `${n2(minRest, 2)} m`, 'Art. 65.4');
    }

    // curve: almeno 2 a destra e 2 a sinistra
    const nR = arcs.filter((a) => a.dir === 'right').length;
    const nL = arcs.filter((a) => a.dir === 'left').length;
    add('Almeno 2 curve a destra e 2 a sinistra', nR >= R.curvesRightMin && nL >= R.curvesLeftMin,
      `${nR} a destra, ${nL} a sinistra`, 'Art. 65.4');

    // prima curva vicina al rettilineo iniziale
    if (firstCurveIdx >= 0 && first && first.type === 'straight') {
      const c = els[firstCurveIdx];
      const distFromStraightEnd = c.startStation - first.endStation;
      if (firstCurveIdx === 1 || distFromStraightEnd <= R.firstCurveWindow + 1e-6) {
        const w = Math.min(c.widthStart, c.widthEnd);
        add(`Curva entro ${R.firstCurveWindow} m dal rettilineo: largh. ≥ 5 m e ampiezza > 50°`,
          w >= R.firstCurveMinWidth - 1e-6 && c.angle > R.firstCurveMinAngle,
          `R${n2(c.radius, 1)} · ${n2(c.angle, 0)}° · larga ${n2(w, 2)} m`, 'Art. 65.4');
      }
    }

    // primo ostacolo e arrivo
    const obs = obstacles.filter((o) => o.kind !== 'start');
    if (obs.length) {
      add('Partenza → primo ostacolo ≥ 12 m', obs[0].sStart >= R.firstObstacleMin - 1e-6,
        `${n2(obs[0].sStart, 1)} m (${obs[0].label})`, 'Art. 65.6');
      const fc = finishClearance(baked, obstacles, stats);
      if (fc) {
        add('Ultimo ostacolo → arrivo ≥ 10 m', fc.distance >= R.finishMin - 1e-6,
          `${n2(fc.distance, 1)} m (${fc.target.label})`, 'Art. 65.4');
      }
    }

    // gruppi di ostacoli
    const byGroup = { gimkane: 0, barriere: 0, rampe: 0 };
    const rampTypes = new Set();
    for (const s of structs) {
      const g = s.group || libraryItem(s.key).group;
      if (byGroup[g] !== undefined) byGroup[g]++;
      if (g === 'rampe') rampTypes.add(s.key);
    }
    add('Almeno 1 ostacolo del gruppo Gimkane', byGroup.gimkane >= R.groups.gimkane, `${byGroup.gimkane}`, 'Art. 64');
    add('Almeno 4 ostacoli del gruppo Barriere', byGroup.barriere >= R.groups.barriere, `${byGroup.barriere}`, 'Art. 64');
    add('Almeno 3 Rampe di almeno 2 tipologie',
      byGroup.rampe >= R.groups.rampe && rampTypes.size >= R.groups.rampeTipologie,
      `${byGroup.rampe} rampe, ${rampTypes.size} tipologie`, 'Art. 64');

    // misure minime delle rampe
    const ramps = structs.filter((s) => (s.group || libraryItem(s.key).group) === 'rampe');
    if (ramps.length) {
      const badW = ramps.filter((s) => s.width < R.rampWidthMin - 1e-6);
      const badH = ramps.filter((s) => s.height < R.rampHeightMin - 1e-6);
      add('Rampe: larghezza ≥ 1,80 m e altezza ≥ 0,40 m', !badW.length && !badH.length,
        badW.length || badH.length ? `${badW.length} strette, ${badH.length} basse` : `${ramps.length} rampe a norma`, 'Art. 65.4');
    }

    // altezze per categoria
    const cat = categoryInfo(project.category);
    const jumps = structs.filter((s) => s.key === 'saltosecco');
    if (jumps.length) {
      const okJ = jumps.every((s) => Math.abs(s.height - cat.dryJump) <= 0.02 + 1e-6);
      add(`Salti a secco a ${n2(cat.dryJump * 100, 0)} cm (${cat.label})`, okJ,
        jumps.map((s) => n2(s.height * 100, 0) + ' cm').join(', '), 'Art. 65.4');
      // due salti a secco consecutivi: minimo 10 m
      const sorted = jumps.slice().sort((a, b) => a.station - b.station);
      for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i].station - sorted[i - 1].station;
        const between = obstacles.some((o) => o.kind !== 'start' && o.sStart > sorted[i - 1].station && o.sEnd < sorted[i].station);
        if (!between && d < ROLLER.dryJumpConsecutiveMin) {
          add('Due salti a secco consecutivi ≥ 10 m', false, `${n2(d, 1)} m fra loro`, 'Art. 65.4');
          break;
        }
      }
    }
    const unders = structs.filter((s) => s.key === 'sottopasso' || s.key === 'tunnel');
    if (unders.length) {
      const okU = unders.every((s) => s.height >= cat.underpass - 0.02);
      add(`Sottopassi ≥ ${n2(cat.underpass * 100, 0)} cm (${cat.label})`, okU,
        unders.map((s) => n2(s.height * 100, 0) + ' cm').join(', '), 'Art. 65.4');
    }

    // gimkane: rettilineo largo almeno 5 m (o curva con R ≥ 5 e largh. ≥ 4)
    const gimk = structs.filter((s) => (s.group || libraryItem(s.key).group) === 'gimkane');
    if (gimk.length) {
      const okG = gimk.every((s) => {
        const f = frameAt(baked, s.station);
        const el = f.element;
        if (!el) return false;
        if (el.type === 'arc') return el.radius >= R.gimkana.inCurveRadiusMin && f.width >= R.gimkana.inCurveWidthMin;
        return f.width >= R.gimkana.laneWidthMin - 1e-6;
      });
      add('Gimkane su rettilineo largo ≥ 5 m (o curva R ≥ 5 m e largh. ≥ 4 m)', okG,
        `${gimk.length} gimkana/e`, 'Art. 65.4');
    }
  } else {
    const S = SKATE;
    const minW = els.length ? Math.min(...els.map((e) => Math.min(e.widthStart, e.widthEnd))) : null;
    if (minW !== null) add('Larghezza minima 5 m', minW >= S.laneWidthMin - 1e-6, `${n2(minW, 2)} m`, 'Art. 102.2');
    const sr = project.startRamp || {};
    add('4 gate su rampa di partenza, h max 2 m', !!sr.enabled && sr.height <= S.startRampMaxHeight + 1e-6,
      sr.enabled ? `rampa h ${n2(sr.height, 2)} m` : 'rampa disattivata', 'Art. 102.2');
    const tight = arcs.filter((a) => a.radius < S.tightCurves.radiusMax).length;
    add('Almeno 2 curve con raggio < 5 m', tight >= S.tightCurves.count, `${tight} curve`, 'Art. 102.2');
    const ramps = structs.filter((s) => (s.group || libraryItem(s.key).group) === 'rampe' && s.height >= S.ramps.heightMin - 1e-6).length;
    add('Almeno 3 rampe/curve/bank to bank con h ≥ 0,50 m', ramps >= S.ramps.count, `${ramps}`, 'Art. 102.2');
    const fun = structs.filter((s) => (s.key === 'funbox' || s.key === 'banktobank' || s.key === 'banktobankvar')
      && s.height >= S.funbox.heightMin - 1e-6 && s.height <= S.funbox.heightMax + 1e-6
      && s.width >= S.funbox.width - 1e-6).length;
    add('Almeno 2 funbox o bank to bank h 1,50–2 m e largh. 4 m', fun >= S.funbox.count, `${fun}`, 'Art. 102.2');
  }
  return out;
}

export function statusLevel(status, id) {
  return (status && status[id] && status[id].level) || 'ok';
}

/* --------------------------------------------------- utilità di editing */

/** sposta la struttura seguendo il puntatore (in metri) */
export function dropStructureAt(st, baked, worldPoint) {
  if (st.mode === 'free') { st.x = worldPoint.x; st.y = worldPoint.y; return st; }
  const pr = projectPoint(baked, worldPoint);
  st.station = clamp(pr.station, 0, baked.totalLength);
  st.side = clamp(pr.side, -20, 20);
  return st;
}

/** distanza disponibile fra due ostacoli (per suggerire posizioni valide) */
export function validStationRanges(project, baked, excludeId = null) {
  const rules = project.rules;
  const obs = collectObstacles(project, baked).filter((o) => o.id !== excludeId);
  const ranges = [];
  for (let i = 0; i < obs.length; i++) {
    const a = obs[i], b = obs[i + 1];
    // 1 cm di franco per non finire esattamente sul limite dopo gli arrotondamenti
    const from = a.sEnd + rules.minGap + 0.01;
    const to = (b ? b.sStart - rules.minGap : Math.min(baked.totalLength, a.sEnd + rules.maxGap)) - 0.01;
    if (to > from) ranges.push({ from, to, after: a.label });
  }
  return ranges;
}

/** crea la catena di elementi che riproduce una polilinea (usato dal generatore) */
export function chainFromPlan(plan, width) {
  return plan.map((p) => p.type === 'arc'
    ? { id: 'el_' + Math.random().toString(36).slice(2, 9), type: 'arc', radius: p.radius, angle: p.angle, dir: p.dir, widthStart: p.width ?? width, widthEnd: p.width ?? width }
    : { id: 'el_' + Math.random().toString(36).slice(2, 9), type: 'straight', length: p.length, widthStart: p.width ?? width, widthEnd: p.width ?? width });
}

/**
 * Elementi da accodare per portare il percorso fino al punto P:
 * un arco di raccordo (raggio R) + un rettilineo tangente.
 * È la base dello strumento "disegna percorso": si tocca dove si vuole andare.
 */
export function extendTo(baked, P, R = 8, width = 5) {
  // R è il raggio interno: la geometria lavora su quello dell'asse.
  // L'asse non può stare sotto mezza corsia, altrimenti il bordo interno si
  // rovescia e il tracciato si spezza.
  const minAxis = width / 2 + 0.25;
  const rAxis = Math.max(minAxis, R + width / 2);
  const S = baked.elements.length ? baked.endPoint : baked.startPoint;
  const h = baked.elements.length ? baked.endHeading : baked.startHeading;
  const v = sub(P, S);
  const distSP = G.len(v);
  if (distSP < 0.4) return [];
  const bearing = Math.atan2(v.y, v.x);
  const turn = G.wrapPi(bearing - h);
  const mk = (type, o) => ({ id: 'el_' + Math.random().toString(36).slice(2, 9), type, widthStart: width, widthEnd: width, ...o });

  if (Math.abs(turn) < 0.5 * DEG) return [mk('straight', { length: G.round(distSP, 2) })];

  const dirSide = turn > 0 ? 'left' : 'right';
  const sgn = turn > 0 ? 1 : -1;
  let r = rAxis;
  const n = leftOf(h);
  let C = add(S, mul(n, sgn * r));
  let d = G.dist(P, C);
  // il punto è dentro il cerchio di volta: stringi il raggio
  if (d < r * 1.02) {
    // il punto è dentro il cerchio di volta: invece di stringere a caso, si usa
    // l'unico arco che parte tangente e passa esattamente per il punto
    const den = 2 * G.dot(v, n);
    if (Math.abs(den) > 1e-6) {
      const rExact = G.dot(v, v) / den;              // positivo = curva a sinistra
      const side = rExact > 0 ? 'left' : 'right';
      const rr = Math.max(minAxis, Math.abs(rExact));
      const sg = rExact > 0 ? 1 : -1;
      const Cc = add(S, mul(n, sg * rr));
      const a0 = Math.atan2(S.y - Cc.y, S.x - Cc.x);
      const a1 = Math.atan2(P.y - Cc.y, P.x - Cc.x);
      let sw = (a1 - a0) * sg;
      while (sw < 0) sw += 2 * Math.PI;
      while (sw > 2 * Math.PI) sw -= 2 * Math.PI;
      const ang = sw * G.RAD;
      // un arco esatto va bene finché non obbliga a girare su se stessi:
      // oltre i 200° conviene virare stretto e poi proseguire dritto
      if (ang <= 200) {
        return [mk('arc', { radius: G.round(rr - width / 2, 2), angle: G.round(G.clamp(ang, 1, 200), 1), dir: side })];
      }
    }
    r = minAxis;
    C = add(S, mul(n, sgn * r));
    d = G.dist(P, C);
    if (d < r * 1.02) return [mk('arc', { radius: G.round(r - width / 2, 2), angle: 150, dir: dirSide })];
  }
  const tanLen = Math.sqrt(Math.max(0, d * d - r * r));
  const a0 = Math.atan2(S.y - C.y, S.x - C.x);
  const aP = Math.atan2(P.y - C.y, P.x - C.x);
  const off = Math.acos(G.clamp(r / d, -1, 1));
  const aT = aP - sgn * off;
  let sweep = (aT - a0) * sgn;
  while (sweep < 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  const angle = G.clamp(sweep * G.RAD, 0.5, 350);
  const els = [mk('arc', { radius: G.round(r - width / 2, 2), angle: G.round(angle, 1), dir: dirSide })];
  if (tanLen > 0.3) els.push(mk('straight', { length: G.round(tanLen, 2) }));
  return els;
}

/* --------------------------------------------------- chiusura ad anello */

const mod2pi = (a) => { const r = a % (2 * Math.PI); return r < 0 ? r + 2 * Math.PI : r; };

/**
 * Percorsi di Dubins (curva-rettilineo-curva) che portano dalla posa corrente
 * alla posa di partenza con tangenza continua: servono a chiudere l'anello in
 * modo che l'innesto sulla partenza sia percorribile, non uno spigolo.
 * Restituisce le quattro combinazioni valide ordinate per lunghezza.
 */
export function dubinsPaths(from, to, r) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const D = Math.hypot(dx, dy);
  const d = D / r;
  const theta = mod2pi(Math.atan2(dy, dx));
  const a = mod2pi(from.heading - theta);
  const b = mod2pi(to.heading - theta);
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b);
  const cab = Math.cos(a - b);
  const out = [];

  // LSL
  let psq = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (psq >= 0) {
    const tmp = Math.atan2(cb - ca, d + sa - sb);
    out.push({ type: 'LSL', t: mod2pi(-a + tmp), p: Math.sqrt(psq), q: mod2pi(b - tmp), dirs: ['left', 'left'] });
  }
  // RSR
  psq = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (psq >= 0) {
    const tmp = Math.atan2(ca - cb, d - sa + sb);
    out.push({ type: 'RSR', t: mod2pi(a - tmp), p: Math.sqrt(psq), q: mod2pi(-b + tmp), dirs: ['right', 'right'] });
  }
  // LSR
  psq = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (psq >= 0) {
    const p = Math.sqrt(psq);
    const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
    out.push({ type: 'LSR', t: mod2pi(-a + tmp), p, q: mod2pi(-mod2pi(b) + tmp), dirs: ['left', 'right'] });
  }
  // RSL
  psq = -2 + d * d + 2 * cab - 2 * d * (sa + sb);
  if (psq >= 0) {
    const p = Math.sqrt(psq);
    const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
    out.push({ type: 'RSL', t: mod2pi(a - tmp), p, q: mod2pi(b - tmp), dirs: ['right', 'left'] });
  }
  return out
    .map((s) => ({ ...s, length: (s.t + s.q) * r + s.p * r, radius: r }))
    .filter((s) => Number.isFinite(s.length))
    .sort((x, y) => x.length - y.length);
}

/** traduce un percorso di Dubins negli elementi del tracciato */
export function dubinsElements(sol, width) {
  const mk = (type, o) => ({ id: 'el_' + Math.random().toString(36).slice(2, 9), type, widthStart: width, widthEnd: width, ...o });
  const els = [];
  const degT = sol.t * G.RAD, degQ = sol.q * G.RAD;
  // sol.radius è il raggio dell'asse: si riporta a raggio interno
  const rIn = G.round(Math.max(0.1, sol.radius - width / 2), 2);
  if (degT > 0.3) els.push(mk('arc', { radius: rIn, angle: G.round(degT, 1), dir: sol.dirs[0] }));
  const straight = sol.p * sol.radius;
  if (straight > 0.3) els.push(mk('straight', { length: G.round(straight, 2) }));
  if (degQ > 0.3) els.push(mk('arc', { radius: rIn, angle: G.round(degQ, 1), dir: sol.dirs[1] }));
  return els;
}

/**
 * Elementi che riportano la fine del tracciato sulla linea di partenza con la
 * stessa direzione, così il percorso si può ripetere a giri.
 * Prova più raggi e restituisce le soluzioni dalla più corta alla più lunga.
 */
export function closeToStartOptions(baked, width, radii = [3, 4, 5, 6, 8, 10], runout = 0) {
  // i raggi richiesti sono interni: la geometria usa quelli dell'asse
  const axisRadii = radii.map((r) => Math.max(width / 2 + 0.25, r + width / 2));
  const from = { x: baked.endPoint.x, y: baked.endPoint.y, heading: baked.endHeading };
  // con `runout` il raccordo punta a un punto arretrato rispetto alla partenza,
  // così l'anello si chiude con un rettilineo davanti alla linea d'arrivo
  const d0 = dirOf(baked.startHeading);
  const to = {
    x: baked.startPoint.x - d0.x * runout,
    y: baked.startPoint.y - d0.y * runout,
    heading: baked.startHeading,
  };
  const sols = [];
  for (const r of axisRadii) {
    for (const s of dubinsPaths(from, to, r)) sols.push(s);
  }
  return sols
    .sort((a, b) => a.length - b.length)
    .map((s) => {
      const elements = dubinsElements(s, width);
      if (runout > 0.2 && elements.length) {
        elements.push({ id: 'el_' + Math.random().toString(36).slice(2, 9), type: 'straight', length: G.round(runout, 2), widthStart: width, widthEnd: width });
      }
      return { ...s, length: s.length + runout, elements };
    })
    .filter((s) => s.elements.length);
}

export { libraryItem };
