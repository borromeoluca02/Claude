/* generator.js — generazione automatica di varianti di percorso dentro l'area.
   Strategie: serpentina, ovale (stadium), spirale, organica (random greedy).
   Ogni candidato viene verificato (corridoio dentro l'area), "riparato"
   accorciando i tratti, e infine valutato con un punteggio. */

import * as G from './geometry.js';
import { uid, libraryItem, STRUCTURE_LIBRARY, makeStructure } from './model.js';
import { bakeTrack, analyze, collectObstacles } from './track.js';

const { DEG, add, mul, sub, dirOf, leftOf, clamp } = G;

/* ------------------------------------------------------- utilità di base */

function axes(headingDeg) {
  const h = headingDeg * DEG;
  return { d: dirOf(h), n: leftOf(h), h };
}

function projectRange(points, origin, v) {
  let min = Infinity, max = -Infinity;
  for (const p of points) {
    const t = G.dot(sub(p, origin), v);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max };
}

/** il punto è dentro l'area con almeno `margin` metri di margine? */
function okPoint(p, poly, margin) {
  if (!G.pointInPolygon(p, poly)) return false;
  return margin <= 0 || G.distToPolygonEdge(p, poly) >= margin;
}

/**
 * Trova il tratto continuo più lungo lungo la retta origin + d*t che resta
 * dentro l'area con margine. Restituisce { from, to } in metri.
 */
function longestChord(poly, origin, d, margin, tFrom, tTo, step = 0.25) {
  let best = null, cur = null;
  for (let t = tFrom; t <= tTo; t += step) {
    const p = add(origin, mul(d, t));
    if (okPoint(p, poly, margin)) {
      if (!cur) cur = { from: t, to: t }; else cur.to = t;
    } else if (cur) {
      if (!best || cur.to - cur.from > best.to - best.from) best = cur;
      cur = null;
    }
  }
  if (cur && (!best || cur.to - cur.from > best.to - best.from)) best = cur;
  return best;
}

/* ------------------------------------- verifica di un piano (plan) */

/** avanza di un elemento restituendo nuova posa e punti dei bordi */
function walk(pose, el, step = 1.0) {
  const pts = [];
  const push = (point, heading, w) => {
    const n = leftOf(heading);
    pts.push(add(point, mul(n, w / 2)));
    pts.push(sub(point, mul(n, w / 2)));
    pts.push(point);
  };
  let end, endHeading;
  if (el.type === 'arc') {
    const r = el.radius;
    const sweep = (el.dir === 'right' ? -1 : 1) * el.angle * DEG;
    const n = leftOf(pose.heading);
    const center = el.dir === 'right' ? sub(pose.point, mul(n, r)) : add(pose.point, mul(n, r));
    const a0 = Math.atan2(pose.point.y - center.y, pose.point.x - center.x);
    const length = r * Math.abs(sweep);
    const steps = Math.max(2, Math.ceil(length / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + sweep * t;
      push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) }, pose.heading + sweep * t, el.width);
    }
    const a1 = a0 + sweep;
    end = { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) };
    endHeading = pose.heading + sweep;
    return { pose: { point: end, heading: endHeading }, pts, length };
  }
  const length = el.length;
  const steps = Math.max(2, Math.ceil(length / step));
  for (let i = 0; i <= steps; i++) {
    push(add(pose.point, mul(dirOf(pose.heading), length * (i / steps))), pose.heading, el.width);
  }
  end = add(pose.point, mul(dirOf(pose.heading), length));
  return { pose: { point: end, heading: pose.heading }, pts, length };
}

function planGeometry(plan, start, step = 1.0) {
  let pose = { point: { x: start.x, y: start.y }, heading: (start.heading || 0) * DEG };
  const all = [], centers = [];
  let total = 0;
  for (const el of plan) {
    const r = walk(pose, el, step);
    all.push(...r.pts);
    centers.push(r.pose.point);
    pose = r.pose;
    total += r.length;
  }
  return { pts: all, total, endPose: pose, centers };
}

function countOutside(plan, start, poly, margin, step = 1.0) {
  const { pts } = planGeometry(plan, start, step);
  let bad = 0;
  for (const p of pts) if (!okPoint(p, poly, margin)) bad++;
  return { bad, total: pts.length };
}

/* --------------------------------------------- riparazione del candidato */

function repair(cand, poly, margin, rules) {
  let { plan, start } = cand;
  for (let iter = 0; iter < 14; iter++) {
    const { bad } = countOutside(plan, start, poly, margin);
    if (!bad) return { plan, start, repaired: iter > 0 };
    // prima si accorciano solo i rettilinei: i raggi richiesti vanno preservati
    const touchRadii = iter >= 8;
    plan = plan.map((el) => {
      if (el.type === 'straight') {
        return { ...el, length: Math.max(rules.minGap, el.length - Math.max(0.8, el.length * 0.08)) };
      }
      if (touchRadii && el.radius > 4) return { ...el, radius: Math.max(4, el.radius - 0.4) };
      return el;
    });
  }
  // ultimo tentativo: taglia gli elementi finali che escono
  for (let cut = plan.length - 1; cut >= 2; cut--) {
    const sub = plan.slice(0, cut);
    if (!countOutside(sub, start, poly, margin).bad) return { plan: sub, start, repaired: true, trimmed: true };
  }
  return { plan, start, repaired: true, failed: true };
}

/* --------------------------------------------------------- strategie */

/** serpentina: rettilinei paralleli collegati da tornanti a 180° */
function serpentine(poly, opt) {
  const out = [];
  const { width, margin, radii, target, rules } = opt;
  const inset = margin + width / 2;
  for (const headingDeg of opt.headings) {
    for (const R of radii) {
      for (const firstDir of ['left', 'right']) {
        const { d, n } = axes(headingDeg);
        const b = G.polygonBounds(poly);
        const origin = { x: b.minX, y: b.minY };
        const rangeN = projectRange(poly, origin, n);
        const rangeD = projectRange(poly, origin, d);
        const lanes = [];
        const spacing = Math.max(2 * R, width + 0.5);
        // dal lato "basso" verso l'alto se firstDir = left
        const startLat = firstDir === 'left' ? rangeN.min + inset : rangeN.max - inset;
        const sign = firstDir === 'left' ? 1 : -1;
        for (let k = 0; k < 40; k++) {
          const lat = startLat + sign * k * spacing;
          if (lat < rangeN.min + inset - 1e-6 || lat > rangeN.max - inset + 1e-6) break;
          const lineOrigin = add(origin, mul(n, lat));
          const ch = longestChord(poly, lineOrigin, d, inset, rangeD.min - 5, rangeD.max + 5);
          if (!ch) break;
          const usable = ch.to - ch.from - 2 * R;
          if (usable < Math.max(rules.minGap, 3)) break;
          lanes.push({ lat, from: ch.from + R, to: ch.to - R, len: usable });
        }
        if (lanes.length < 2) continue;

        // primo tratto: percorre la corsia 0 nel senso +d
        const plan = [];
        let turnDir = firstDir;
        let laneCount = 0;
        for (let k = 0; k < lanes.length; k++) {
          const L = lanes[k].len;
          plan.push({ type: 'straight', length: L, width });
          laneCount++;
          if (k < lanes.length - 1) plan.push({ type: 'arc', radius: R, angle: 180, dir: turnDir, width });
          turnDir = turnDir === 'left' ? 'right' : 'left';
          const partial = plan.reduce((a, e) => a + (e.type === 'arc' ? e.radius * e.angle * DEG : e.length), 0);
          if (target && partial >= target) break;
        }
        if (laneCount < 2) continue;
        const l0 = lanes[0];
        const startPoint = add(add(origin, mul(n, l0.lat)), mul(d, l0.from));
        out.push({
          strategy: 'serpentina', name: `Serpentina R${G.round(R, 1)} · ${headingDeg}°`,
          plan, start: { x: startPoint.x, y: startPoint.y, heading: headingDeg },
        });
      }
    }
  }
  return out;
}

/** ovale / stadium: due rettilinei e due tornanti */
function oval(poly, opt) {
  const out = [];
  const { width, margin, radii, target } = opt;
  const inset = margin + width / 2;
  for (const headingDeg of opt.headings) {
    for (const R of radii) {
      const { d, n } = axes(headingDeg);
      const b = G.polygonBounds(poly);
      const origin = { x: b.minX, y: b.minY };
      const rangeN = projectRange(poly, origin, n);
      const rangeD = projectRange(poly, origin, d);
      const lat0 = rangeN.min + inset;
      const lat1 = lat0 + 2 * R;
      if (lat1 > rangeN.max - inset) continue;
      const c0 = longestChord(poly, add(origin, mul(n, lat0)), d, inset, rangeD.min - 5, rangeD.max + 5);
      const c1 = longestChord(poly, add(origin, mul(n, lat1)), d, inset, rangeD.min - 5, rangeD.max + 5);
      if (!c0 || !c1) continue;
      const from = Math.max(c0.from, c1.from) + R;
      const to = Math.min(c0.to, c1.to) - R;
      let L = to - from;
      if (L < 4) continue;
      if (target) {
        const want = (target - 2 * Math.PI * R) / 2;
        if (want > 2 && want < L) L = want;
      }
      const sp = add(add(origin, mul(n, lat0)), mul(d, from));
      out.push({
        strategy: 'ovale', name: `Ovale R${G.round(R, 1)} · ${headingDeg}°`,
        plan: [
          { type: 'straight', length: L, width },
          { type: 'arc', radius: R, angle: 180, dir: 'left', width },
          { type: 'straight', length: L, width },
          { type: 'arc', radius: R, angle: 180, dir: 'left', width },
        ],
        start: { x: sp.x, y: sp.y, heading: headingDeg },
        closedLoop: true,
      });
    }
  }
  return out;
}

/** spirale rettangolare con curve a 90° */
function spiral(poly, opt) {
  const out = [];
  const { width, margin, radii, target } = opt;
  const inset = margin + width / 2;
  for (const headingDeg of opt.headings.slice(0, 3)) {
    for (const R of radii) {
      const { d, n } = axes(headingDeg);
      const b = G.polygonBounds(poly);
      const origin = { x: b.minX, y: b.minY };
      const rN = projectRange(poly, origin, n), rD = projectRange(poly, origin, d);
      let w = (rD.max - rD.min) - 2 * inset - 2 * R;
      let hh = (rN.max - rN.min) - 2 * inset - 2 * R;
      if (w < 6 || hh < 6) continue;
      const plan = [];
      const shrink = 2 * R + Math.max(width, 3);
      let total = 0;
      for (let loop = 0; loop < 6; loop++) {
        const segs = [w, hh, w - shrink / 2, hh - shrink / 2];
        let stop = false;
        for (const L of segs) {
          if (L < Math.max(6, 2 * R)) { stop = true; break; }
          plan.push({ type: 'straight', length: L, width });
          plan.push({ type: 'arc', radius: R, angle: 90, dir: 'left', width });
          total += L + R * Math.PI / 2;
          if (target && total >= target) { stop = true; break; }
        }
        w -= shrink; hh -= shrink;
        if (stop || w < 6 || hh < 6) break;
      }
      if (plan.length < 4) continue;
      const sp = add(add(origin, mul(n, rN.min + inset + R)), mul(d, rD.min + inset + R));
      out.push({
        strategy: 'spirale', name: `Spirale R${G.round(R, 1)} · ${headingDeg}°`,
        plan, start: { x: sp.x, y: sp.y, heading: headingDeg },
      });
    }
  }
  return out;
}

/** organica: catena casuale greedy che resta dentro l'area */
function organic(poly, opt, seed) {
  const { width, margin, radii, target, rules } = opt;
  const rnd = mulberry(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const b = G.polygonBounds(poly);
  // posizione di partenza: punto interno con margine
  let start = null;
  for (let i = 0; i < 400 && !start; i++) {
    const p = { x: b.minX + rnd() * b.w, y: b.minY + rnd() * b.h };
    if (okPoint(p, poly, margin + width)) start = p;
  }
  if (!start) return null;
  const headingDeg = Math.floor(rnd() * 36) * 10;
  const plan = [];
  let pose = { point: start, heading: headingDeg * DEG };
  let total = 0;
  const goal = target || Math.max(80, Math.min(400, Math.sqrt(Math.abs(G.polygonArea(poly))) * 6));
  const maxGap = rules.maxGap || 25;
  const minGap = rules.minGap || 3;

  for (let step = 0; step < 140 && total < goal; step++) {
    let placed = false;
    for (let attempt = 0; attempt < 44 && !placed; attempt++) {
      const straightLen = clamp(minGap + rnd() * (maxGap - minGap), 4, maxGap);
      const R = pick(radii);
      const ang = pick([30, 45, 60, 90, 90, 120, 135, 180]);
      const dir = rnd() < 0.5 ? 'left' : 'right';
      const trial = [
        { type: 'straight', length: straightLen, width },
        { type: 'arc', radius: R, angle: ang, dir, width },
      ];
      let ok = true;
      let p2 = pose;
      for (const el of trial) {
        const r = walk(p2, el, 1.0);
        for (const q of r.pts) if (!okPoint(q, poly, margin)) { ok = false; break; }
        if (!ok) break;
        p2 = r.pose;
      }
      if (!ok) continue;
      // evita di ripiegarsi addosso al tracciato già costruito
      const geo = planGeometry([...plan, ...trial], { ...start, heading: headingDeg });
      const line = geo.pts.filter((_, i) => i % 3 === 2);
      if (G.polylineSelfIntersections(line, 8).length > 0) continue;
      plan.push(...trial);
      total += straightLen + R * ang * DEG;
      pose = p2;
      placed = true;
    }
    if (!placed) break;
  }
  // chiudi con un rettilineo
  for (let L = Math.min(maxGap, 15); L >= 4; L -= 2) {
    const r = walk(pose, { type: 'straight', length: L, width }, 1.0);
    if (r.pts.every((q) => okPoint(q, poly, margin))) { plan.push({ type: 'straight', length: L, width }); break; }
  }
  if (plan.length < 3) return null;
  return {
    strategy: 'organica', name: `Organica #${seed % 1000}`,
    plan, start: { x: start.x, y: start.y, heading: headingDeg },
  };
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------- piazzamento automatico strutture */

/**
 * Inserisce strutture nei tratti rettilinei rispettando le distanze
 * minime/massime dagli ostacoli precedenti. Riempie i buchi > maxGap.
 */
export function autoPlaceStructures(project, opts = {}) {
  const rules = project.rules;
  const wanted = opts.count ?? project.genParams?.structureCount ?? null;
  const pool = (opts.keys && opts.keys.length ? opts.keys : ['rampa', 'tabletop', 'gobba', 'doppia', 'whoops', 'stepup', 'rollers', 'wall'])
    .map(libraryItem);
  const shortest = Math.min(...pool.map((s) => s.length));
  // in automatico si riempiono i tratti più lunghi di questa soglia
  // in automatico si riempie ogni tratto in cui una struttura entra rispettando le distanze
  const threshold = opts.targetSpacing ?? (2 * rules.minGap + shortest);
  const placed = [];
  let guard = 0;

  while (guard++ < 80) {
    const baked = bakeTrack(project);
    const obs = collectObstacles(project, baked).sort((a, b) => a.sStart - b.sStart);
    let hole = null;
    const consider = (gap, from, to, after) => {
      if (!hole || gap > hole.gap) hole = { gap, from, to, after };
    };
    if (!obs.length) consider(baked.totalLength, 0, baked.totalLength, 'partenza');
    for (let i = 0; i < obs.length - 1; i++) {
      consider(obs[i + 1].sStart - obs[i].sEnd, obs[i].sEnd, obs[i + 1].sStart, obs[i].label);
    }
    if (obs.length) {
      const last = obs[obs.length - 1];
      consider(baked.totalLength - last.sEnd, last.sEnd, baked.totalLength, last.label);
    }
    if (!hole) break;

    const needMore = wanted === null ? hole.gap > threshold : placed.length < wanted;
    if (!needMore) break;

    const room = hole.gap - 2 * rules.minGap;
    const cands = pool.filter((s) => s.length <= Math.max(0.5, room));
    if (!cands.length) break;
    const lib = cands[placed.length % cands.length];

    // posizione: a minGap dall'ostacolo precedente, centrata nel buco se c'è spazio
    const slack = Math.max(0, hole.gap - 2 * rules.minGap - lib.length);
    let sMid = hole.from + rules.minGap + lib.length / 2 + Math.min(slack / 2, Math.max(0, rules.maxGap - rules.minGap - lib.length));
    sMid = clamp(sMid, lib.length / 2, baked.totalLength - lib.length / 2);

    // preferisci un tratto rettilineo
    let el = baked.elements.find((e) => sMid >= e.startStation && sMid <= e.endStation);
    if (el && el.type === 'arc') {
      const after = el.endStation + rules.minGap + lib.length / 2;
      const before = el.startStation - rules.minGap - lib.length / 2;
      const altAfter = after + lib.length / 2 <= hole.to ? after : null;
      const altBefore = before - lib.length / 2 >= hole.from ? before : null;
      const alt = altAfter ?? altBefore;
      if (alt === null) break;
      sMid = alt;
      el = baked.elements.find((e) => sMid >= e.startStation && sMid <= e.endStation);
    }
    const lane = el ? G.lerp(el.widthStart, el.widthEnd, el.length ? (sMid - el.startStation) / el.length : 0) : project.track.defaultWidth;
    project.structures.push(makeStructure(lib.key, G.round(sMid, 2), { width: G.round(Math.min(lib.width, lane), 2) }));
    placed.push(lib.key);
  }
  return placed.length;
}

/* ------------------------------------------------------------- punteggio */

function scoreCandidate(project, cand) {
  const a = analyze(project);
  const gp = project.genParams || {};
  let score = 0;
  const notes = [];

  // lunghezza
  if (gp.targetLength) {
    const err = Math.abs(a.stats.totalLength - gp.targetLength);
    score -= err * 2.5;
    if (err > gp.targetLength * 0.1) notes.push(`lunghezza ${G.round(a.stats.totalLength, 0)} m invece di ${gp.targetLength} m`);
  } else {
    score += a.stats.totalLength * 0.8; // senza obiettivo premia lo sfruttamento dello spazio
  }
  // curve richieste
  for (const req of gp.curveReqs || []) {
    if (!req || !req.radius) continue;
    const n = a.baked.elements.filter((e) => e.type === 'arc' && Math.abs(e.radius - req.radius) <= 0.51).length;
    const missing = Math.max(0, (req.count || 1) - n);
    score -= missing * 60;
    if (missing) notes.push(`mancano ${missing} curve R${req.radius}`);
  }
  if (gp.minCurves) {
    const missing = Math.max(0, gp.minCurves - a.stats.curveCount);
    score -= missing * 50;
    if (missing) notes.push(`mancano ${missing} curve`);
  }
  // violazioni
  score -= a.stats.badCount * 45;
  score -= a.stats.outsideRuns * 220;
  score -= a.stats.crossings * 35;
  score -= a.stats.warnCount * 8;
  if (a.stats.outsideRuns) notes.push('esce dall\'area');
  if (a.stats.badCount) notes.push(`${a.stats.badCount} elementi fuori regola`);

  return { score, analysis: a, notes };
}

/* ------------------------------------------------------------- pubblico */

/**
 * Genera varianti di percorso. Restituisce un array di progetti completi
 * (già con strutture piazzate) ordinati per punteggio.
 */
export function generateCandidates(baseProject, options = {}) {
  const project = JSON.parse(JSON.stringify(baseProject));
  const gp = { ...project.genParams, ...options };
  const poly = project.area.points;
  const width = clamp(+gp.width || project.track.defaultWidth || 5, 1, 20);
  const margin = Math.max(0, +gp.margin ?? 1.5);
  const rules = project.rules;

  // raggi da usare: quelli richiesti + alcuni standard
  const reqRadii = (gp.curveReqs || []).map((r) => +r.radius).filter((r) => r > 0.5);
  const stdRadii = [5, 6, 8, 10, 12].filter((r) => !reqRadii.some((q) => Math.abs(q - r) < 0.5));
  // i raggi richiesti restano in testa (e pesano di più nelle scelte casuali)
  // i raggi richiesti pesano di più nelle scelte casuali della strategia libera
  const radii = [...reqRadii, ...reqRadii, ...reqRadii, ...stdRadii];
  const geoRadii = [...new Set([...reqRadii, ...stdRadii])].sort((a, b) => a - b);
  const headings = options.headings || [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];

  const opt = { width, margin, radii, target: gp.targetLength || null, rules, headings };
  const geoOpt = { ...opt, radii: geoRadii };
  const strategy = gp.strategy || 'auto';

  let raw = [];
  if (strategy === 'auto' || strategy === 'serpentina') raw.push(...serpentine(poly, geoOpt));
  if (strategy === 'auto' || strategy === 'ovale') raw.push(...oval(poly, geoOpt));
  if (strategy === 'auto' || strategy === 'spirale') raw.push(...spiral(poly, geoOpt));
  if (strategy === 'auto' || strategy === 'organica') {
    const n = strategy === 'organica' ? 48 : (reqRadii.length ? 36 : 24);
    for (let i = 0; i < n; i++) {
      const c = organic(poly, opt, (options.seed || 12345) + i * 7919);
      if (c) raw.push(c);
    }
  }

  // riparazione + costruzione progetto + punteggio
  const results = [];
  for (const cand of raw) {
    const fixed = repair(cand, poly, margin, rules);
    if (fixed.failed) continue;
    const plan = fixed.plan;
    if (!plan.length) continue;
    const elements = plan.map((p) => p.type === 'arc'
      ? { id: uid('el'), type: 'arc', radius: G.round(p.radius, 2), angle: G.round(p.angle, 1), dir: p.dir, widthStart: width, widthEnd: width }
      : { id: uid('el'), type: 'straight', length: G.round(p.length, 2), widthStart: width, widthEnd: width });

    const p2 = JSON.parse(JSON.stringify(project));
    p2.track.start = { x: G.round(fixed.start.x, 3), y: G.round(fixed.start.y, 3), heading: fixed.start.heading };
    p2.track.defaultWidth = width;
    p2.track.elements = elements;
    p2.structures = [];
    p2.genParams = gp;
    autoPlaceStructures(p2, { count: gp.structureCount ?? null });

    const sc = scoreCandidate(p2, cand);
    results.push({
      id: uid('cand'),
      name: cand.name,
      strategy: cand.strategy,
      project: p2,
      score: sc.score,
      notes: sc.notes,
      stats: sc.analysis.stats,
      checks: sc.analysis.checks,
      repaired: !!fixed.repaired,
      trimmed: !!fixed.trimmed,
    });
  }

  results.sort((a, b) => b.score - a.score);

  // diversifica: non più di 2 risultati per strategia nella testa della lista
  const perStrategy = {};
  const diverse = [];
  for (const r of results) {
    perStrategy[r.strategy] = (perStrategy[r.strategy] || 0) + 1;
    if (perStrategy[r.strategy] <= 2) diverse.push(r);
  }
  const rest = results.filter((r) => !diverse.includes(r));
  const want = clamp(+gp.seedCount || 6, 1, 12);
  return [...diverse, ...rest].slice(0, want);
}

export { STRUCTURE_LIBRARY };
