/* track.js — costruzione geometrica del percorso e validazione delle regole.
   Il percorso è una catena di elementi (rettilinei e archi) con continuità di
   tangente: ogni elemento parte dove finisce il precedente. Le progressive
   ("station", in metri) sono misurate sull'asse della corsia. */

import * as G from './geometry.js';
import { libraryItem } from './model.js';

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
      const r = Math.max(0.2, e.radius);
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
    return {
      point: add(el.center, { x: el.radius * Math.cos(a), y: el.radius * Math.sin(a) }),
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

/** campiona l'asse: [{x,y,s,heading,width}] */
export function sampleCenterline(baked, step = 0.4) {
  const out = [];
  const n = Math.max(2, Math.ceil(baked.totalLength / step) + 1);
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * baked.totalLength;
    const f = frameAt(baked, s);
    out.push({ x: f.point.x, y: f.point.y, s, heading: f.heading, width: f.width });
  }
  return out;
}

/** bordi destro/sinistro della corsia */
export function edgePaths(baked, step = 0.4) {
  const left = [], right = [];
  for (const sm of baked.samples.length ? baked.samples : sampleCenterline(baked, step)) {
    const n = leftOf(sm.heading);
    left.push({ x: sm.x + n.x * sm.width / 2, y: sm.y + n.y * sm.width / 2, s: sm.s });
    right.push({ x: sm.x - n.x * sm.width / 2, y: sm.y - n.y * sm.width / 2, s: sm.s });
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

/** rampa di partenza skate cross, trattata come primo ostacolo */
export function startRampGeometry(project, baked) {
  const sr = project.startRamp;
  if (!sr || !sr.enabled || project.discipline !== 'skate') return null;
  const st = {
    id: '__startramp', key: 'rampa', name: sr.name || 'Rampa di partenza',
    height: sr.height, length: sr.length, width: sr.width,
    mode: 'path', station: sr.length / 2, side: 0, rotation: 0,
  };
  return { struct: st, ...footprint(st, baked), sStart: 0, sEnd: sr.length };
}

/* ------------------------------------------------------------ validazione */

/** elenco ordinato degli ostacoli sull'asse (partenza, curve, strutture) */
export function collectObstacles(project, baked) {
  const out = [];
  const gate = startGateGeometry(project, baked);
  const ramp = startRampGeometry(project, baked);

  if (gate) {
    out.push({ kind: 'start', id: '__gate', label: 'Griglia di partenza', sStart: 0, sEnd: gate.obstacleEnd, fixed: true });
  } else if (ramp) {
    out.push({ kind: 'start', id: '__startramp', label: ramp.struct.name, sStart: 0, sEnd: ramp.sEnd, fixed: true });
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
    const gap = ob.sStart - prev.sEnd;
    const st = setStatus(ob.id, 'ok');
    st.gap = gap;
    st.prevLabel = prev.label;
    if (gap < rules.minGap - 1e-6) {
      setStatus(ob.id, 'bad', `Distanza da "${prev.label}" di ${n2(gap, 2)} m: sotto il minimo di ${rules.minGap} m`);
      issues.push({ level: 'bad', target: ob.id, text: `${ob.label}: solo ${n2(gap, 2)} m da ${prev.label} (min ${rules.minGap} m)` });
    } else if (gap > rules.maxGap + 1e-6) {
      setStatus(ob.id, 'bad', `Distanza da "${prev.label}" di ${n2(gap, 2)} m: oltre il massimo di ${rules.maxGap} m`);
      issues.push({ level: 'bad', target: ob.id, text: `${ob.label}: ${n2(gap, 2)} m da ${prev.label} (max ${rules.maxGap} m)` });
    }
    if (ob.offTrack) {
      setStatus(ob.id, 'warn', 'Struttura lontana dall\'asse del percorso');
      issues.push({ level: 'warn', target: ob.id, text: `${ob.label}: posizionata fuori dall'asse del percorso` });
    }
    prev = ob;
  }

  /* 2. larghezza corsia */
  let minW = Infinity, maxW = -Infinity;
  for (const el of baked.elements) {
    const w0 = el.widthStart, w1 = el.widthEnd;
    minW = Math.min(minW, w0, w1); maxW = Math.max(maxW, w0, w1);
    if (Math.min(w0, w1) < rules.minWidth - 1e-6) {
      setStatus(el.id, 'bad', `Larghezza ${n2(Math.min(w0, w1), 2)} m sotto il minimo di ${rules.minWidth} m`);
      issues.push({ level: 'bad', target: el.id, text: `Tratto largo ${n2(Math.min(w0, w1), 2)} m (min ${rules.minWidth} m)` });
    } else setStatus(el.id, 'ok');
    if (Math.max(w0, w1) > rules.maxWidth + 1e-6) {
      setStatus(el.id, 'warn', `Larghezza ${n2(Math.max(w0, w1), 2)} m oltre la nominale di ${rules.maxWidth} m`);
    }
    if (el.type === 'arc' && rules.minRadius > 0 && el.radius < rules.minRadius - 1e-6) {
      setStatus(el.id, 'bad', `Raggio ${n2(el.radius, 2)} m sotto il minimo di ${rules.minRadius} m`);
      issues.push({ level: 'bad', target: el.id, text: `Curva R${n2(el.radius, 2)} sotto il raggio minimo (${rules.minRadius} m)` });
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
    straightLength: baked.elements.filter((e) => e.type === 'straight').reduce((a, e) => a + e.length, 0),
    curveLength: curves.reduce((a, e) => a + e.length, 0),
    curveCount: curves.length,
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

  return { baked, obstacles, status, issues, stats, checks, outside };
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
  let r = Math.max(0.5, R);
  const n = leftOf(h);
  let C = add(S, mul(n, sgn * r));
  let d = G.dist(P, C);
  // il punto è dentro il cerchio di volta: stringi il raggio
  if (d < r * 1.02) {
    r = Math.max(0.6, G.len(v) / 2.4);
    C = add(S, mul(n, sgn * r));
    d = G.dist(P, C);
    if (d < r * 1.02) {
      // ripiegamento su posto: arco secco di 150°
      return [mk('arc', { radius: G.round(r, 2), angle: 150, dir: dirSide })];
    }
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
  const els = [mk('arc', { radius: G.round(r, 2), angle: G.round(angle, 1), dir: dirSide })];
  if (tanLen > 0.3) els.push(mk('straight', { length: G.round(tanLen, 2) }));
  return els;
}

export { libraryItem };
