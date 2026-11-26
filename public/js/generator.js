/* generator.js — generazione automatica di varianti di percorso dentro l'area.
   Strategie: serpentina, ovale (stadium), spirale, organica (random greedy).
   Ogni candidato viene verificato (corridoio dentro l'area), "riparato"
   accorciando i tratti, e infine valutato con un punteggio. */

import * as G from './geometry.js';
import { uid, libraryItem, STRUCTURE_LIBRARY, makeStructure } from './model.js';
import { ROLLER } from './regulation.js';
import { bakeTrack, analyze, collectObstacles, closeToStartOptions } from './track.js';

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
    // il raggio degli elementi è quello interno: la geometria usa l'asse
    const r = (el.radius || 0) + (el.width || 5) / 2;
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
      if (touchRadii && el.radius > 2) return { ...el, radius: Math.max(2, el.radius - 0.4) };
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

/** il tracciato deve finire con un rettilineo: serve spazio fra ultimo ostacolo e arrivo */
function ensureFinishRunout(plan, start, poly, margin, rules) {
  const need = (rules.finishMin || 0) + 2;
  if (need <= 2) return plan;
  let p = plan.slice();
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = p[p.length - 1];
    if (last && last.type === 'straight' && last.length >= need) return p;
    const width = last ? last.width : 5;
    if (last && last.type === 'straight') {
      // prova ad allungare il rettilineo finale
      const grown = p.slice(0, -1).concat([{ ...last, length: need }]);
      if (!countOutside(grown, start, poly, margin).bad) return grown;
    } else {
      for (let L = need + 4; L >= need; L -= 1) {
        const ext = p.concat([{ type: 'straight', length: L, width }]);
        if (!countOutside(ext, start, poly, margin).bad) return ext;
      }
    }
    // non c'è spazio: togli l'ultimo elemento e riprova
    p = p.slice(0, -1);
    if (p.length < 2) break;
  }
  return p;
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
        const rA = R + width / 2;        // raggio dell'asse della curva
        const { d, n } = axes(headingDeg);
        const b = G.polygonBounds(poly);
        const origin = { x: b.minX, y: b.minY };
        const rangeN = projectRange(poly, origin, n);
        const rangeD = projectRange(poly, origin, d);
        const lanes = [];
        // passo fra corsie: mai meno della larghezza della corsia più un franco
        const spacing = Math.max(2 * rA, width + 0.6);
        const connector = spacing - 2 * rA;          // raccordo dritto nel tornante
        const turnLength = rA * Math.PI + connector;
        // dal lato "basso" verso l'alto se firstDir = left
        const startLat = firstDir === 'left' ? rangeN.min + inset : rangeN.max - inset;
        const sign = firstDir === 'left' ? 1 : -1;
        for (let k = 0; k < 40; k++) {
          const lat = startLat + sign * k * spacing;
          if (lat < rangeN.min + inset - 1e-6 || lat > rangeN.max - inset + 1e-6) break;
          const lineOrigin = add(origin, mul(n, lat));
          const ch = longestChord(poly, lineOrigin, d, inset, rangeD.min - 5, rangeD.max + 5);
          if (!ch) break;
          const usable = ch.to - ch.from - 2 * rA;
          if (usable < Math.max(rules.minGap, 3)) break;
          lanes.push({ lat, from: ch.from + rA, to: ch.to - rA, len: usable });
        }
        if (lanes.length < 2) continue;

        // quante corsie usare: almeno quelle che servono per le curve
        // obbligatorie, poi si taglia (e si scalano i rettilinei) sul target
        const minLanes = Math.max(2, (opt.minTurns || 0) + 1);
        let useLanes = lanes.length;
        if (target) {
          let acc = 0, n = 0;
          for (let k = 0; k < lanes.length; k++) {
            acc += lanes[k].len + (k ? turnLength : 0);
            n = k + 1;
            if (acc >= target && n >= minLanes) break;
          }
          useLanes = Math.min(lanes.length, Math.max(minLanes, n));
        }
        if (useLanes < 2) continue;
        const used = lanes.slice(0, useLanes);
        const turnTotal = (useLanes - 1) * turnLength;
        const straightTotal = used.reduce((a, l) => a + l.len, 0);
        let scale = 1;
        if (target && straightTotal + turnTotal > target && straightTotal > 0) {
          scale = G.clamp((target - turnTotal) / straightTotal, 0.15, 1);
        }
        const minStraight = Math.max(rules.minGap, 4);
        if (straightTotal * scale / useLanes < minStraight) continue;

        const plan = [];
        let turnDir = firstDir;
        for (let k = 0; k < used.length; k++) {
          plan.push({ type: 'straight', length: Math.max(minStraight, used[k].len * scale), width });
          if (k < used.length - 1) {
            if (connector > 0.05) {
              // tornante a U con un breve raccordo, come nei percorsi reali
              plan.push({ type: 'arc', radius: R, angle: 90, dir: turnDir, width });
              plan.push({ type: 'straight', length: G.round(connector, 2), width });
              plan.push({ type: 'arc', radius: R, angle: 90, dir: turnDir, width });
            } else {
              plan.push({ type: 'arc', radius: R, angle: 180, dir: turnDir, width });
            }
            turnDir = turnDir === 'left' ? 'right' : 'left';
          }
        }
        const l0 = lanes[0];
        const startPoint = add(add(origin, mul(n, l0.lat)), mul(d, l0.from));
        out.push({
          strategy: 'serpentina',
          name: `Serpentina R${G.round(R, 1)} · ${headingDeg}° · ${firstDir === 'left' ? 'sx' : 'dx'}`,
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
      const rA = R + width / 2;
      const { d, n } = axes(headingDeg);
      const b = G.polygonBounds(poly);
      const origin = { x: b.minX, y: b.minY };
      const rangeN = projectRange(poly, origin, n);
      const rangeD = projectRange(poly, origin, d);
      const lat0 = rangeN.min + inset;
      const lat1 = lat0 + 2 * rA;
      if (lat1 > rangeN.max - inset) continue;
      const c0 = longestChord(poly, add(origin, mul(n, lat0)), d, inset, rangeD.min - 5, rangeD.max + 5);
      const c1 = longestChord(poly, add(origin, mul(n, lat1)), d, inset, rangeD.min - 5, rangeD.max + 5);
      if (!c0 || !c1) continue;
      const from = Math.max(c0.from, c1.from) + rA;
      const to = Math.min(c0.to, c1.to) - rA;
      let L = to - from;
      if (L < 4) continue;
      if (target) {
        const want = (target - 2 * Math.PI * rA) / 2;
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
      const rA = R + width / 2;
      const { d, n } = axes(headingDeg);
      const b = G.polygonBounds(poly);
      const origin = { x: b.minX, y: b.minY };
      const rN = projectRange(poly, origin, n), rD = projectRange(poly, origin, d);
      let w = (rD.max - rD.min) - 2 * inset - 2 * rA;
      let hh = (rN.max - rN.min) - 2 * inset - 2 * rA;
      if (w < 6 || hh < 6) continue;
      const plan = [];
      const shrink = 2 * rA + Math.max(width, 3);
      let total = 0;
      for (let loop = 0; loop < 6; loop++) {
        const segs = [w, hh, w - shrink / 2, hh - shrink / 2];
        let stop = false;
        for (const L of segs) {
          if (L < Math.max(6, 2 * rA)) { stop = true; break; }
          plan.push({ type: 'straight', length: L, width });
          plan.push({ type: 'arc', radius: R, angle: 90, dir: 'left', width });
          total += L + rA * Math.PI / 2;
          if (target && total >= target) { stop = true; break; }
        }
        w -= shrink; hh -= shrink;
        if (stop || w < 6 || hh < 6) break;
      }
      if (plan.length < 4) continue;
      const sp = add(add(origin, mul(n, rN.min + inset + rA)), mul(d, rD.min + inset + rA));
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

  // rettilineo di partenza (Art. 65: almeno 20 m nel roller cross)
  if (opt.startStraightMin > 0) {
    let placedStart = false;
    for (let L = opt.startStraightMin + 6; L >= opt.startStraightMin; L -= 1) {
      const r = walk(pose, { type: 'straight', length: L, width }, 1.0);
      if (r.pts.every((q) => okPoint(q, poly, margin))) {
        plan.push({ type: 'straight', length: L, width });
        pose = r.pose; total += L; placedStart = true; break;
      }
    }
    if (!placedStart) return null;
  }

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
      total += straightLen + (R + width / 2) * ang * DEG;
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
/**
 * Inserisce ostacoli nei tratti liberi rispettando le distanze (minima, massima,
 * 12 m dalla linea di partenza, 10 m dall'arrivo) e, per il roller cross,
 * cercando di coprire le quote dell'Art. 64: almeno 1 Gimkana, 4 Barriere e
 * 3 Rampe di almeno 2 tipologie.
 */
export function autoPlaceStructures(project, opts = {}) {
  const rules = project.rules;
  const wanted = opts.count ?? project.genParams?.structureCount ?? null;
  const roller = project.discipline === 'roller';
  const cat = project.category;

  // ordine di preferenza: prima si coprono le quote obbligatorie
  const barriere = ['saltosecco', 'sottopasso', 'saltotriplo', 'tunnel'];
  const rampe = ['dritta200', 'banktobank', 'dosso', 'valle', 'canadese', 'dritta290', 'parabolica', 'spina'];
  const skatePool = ['funbox', 'banktobank', 'curva45', 'dritta290', 'valle', 'parabolica'];

  const count = { gimkane: 0, barriere: 0, rampe: 0, altro: 0 };
  const rampTypes = new Set();
  for (const s of project.structures) {
    const grp = s.group || libraryItem(s.key).group;
    if (count[grp] !== undefined) count[grp]++;
    if (grp === 'rampe') rampTypes.add(s.key);
  }

  const nextKey = (i) => {
    if (!roller) return skatePool[i % skatePool.length];
    if (count.gimkane < ROLLER.groups.gimkane) return 'gimkana';
    if (count.barriere < ROLLER.groups.barriere) return barriere[count.barriere % barriere.length];
    if (count.rampe < ROLLER.groups.rampe || rampTypes.size < ROLLER.groups.rampeTipologie) {
      return rampe[count.rampe % rampe.length];
    }
    return [...rampe, ...barriere][i % (rampe.length + barriere.length)];
  };

  // ripieghi quando l'ostacolo preferito non entra nel tratto: dal più corto
  const fallbackKeys = (roller
    ? ['gimkana', 'campominato', 'imbuto', ...barriere, ...rampe]
    : skatePool)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .sort((a, b) => libraryItem(a).length - libraryItem(b).length);
  const shortest = Math.min(...fallbackKeys.map((k) => libraryItem(k).length));
  const threshold = opts.targetSpacing ?? (2 * rules.minGap + shortest);
  const placed = [];
  let guard = 0;

  while (guard++ < 80) {
    const baked = bakeTrack(project);
    const finishLimit = baked.totalLength - (rules.finishMin || 0);
    const obs = collectObstacles(project, baked).sort((a, b) => a.sStart - b.sStart);

    // tutti i buchi disponibili, dal più ampio al più stretto
    const holes = [];
    const add = (from, to, after, afterStart, afterKey) => {
      if (to - from > 0) holes.push({ gap: to - from, from, to, after, afterStart, afterKey });
    };
    const keyOf = (o) => (o.structure ? o.structure.key : null);
    for (let i = 0; i < obs.length - 1; i++) {
      const h = { gap: obs[i + 1].sStart - obs[i].sEnd, from: obs[i].sEnd, to: obs[i + 1].sStart,
        after: obs[i].label, afterStart: obs[i].kind === 'start', afterKey: keyOf(obs[i]), beforeKey: keyOf(obs[i + 1]) };
      if (h.gap > 0) holes.push(h);
    }
    if (obs.length) {
      const last = obs[obs.length - 1];
      add(last.sEnd, finishLimit, last.label, last.kind === 'start', keyOf(last));
    } else add(0, finishLimit, 'partenza', true, null);
    holes.sort((a, b) => b.gap - a.gap);
    if (!holes.length) break;

    const needMore = wanted === null ? holes[0].gap > threshold : placed.length < wanted;
    if (!needMore) break;

    // ordine di preferenza: prima le quote obbligatorie, poi il resto
    const preferred = nextKey(placed.length);
    const pool2 = [preferred, ...fallbackKeys.filter((k) => k !== preferred)];

    let done = false;
    for (const hole of holes) {
      if (wanted === null && hole.gap <= threshold) break;
      const firstMin = hole.afterStart ? (rules.firstObstacleMin || 0) : 0;
      const sStart = Math.max(hole.from + rules.minGap, firstMin);
      for (const key of pool2) {
        const lib = libraryItem(key);
        const slack = hole.to - rules.minGap - lib.length - sStart;
        if (slack < -1e-6) continue;                     // non ci sta: prova un altro tipo
        // due salti a secco di fila vogliono almeno 10 m fra loro, da una parte e dall'altra
        const dryMin = ROLLER.dryJumpConsecutiveMin;
        const dryPrev = roller && key === 'saltosecco' && hole.afterKey === 'saltosecco';
        const dryNext = roller && key === 'saltosecco' && hole.beforeKey === 'saltosecco';
        if ((dryPrev || dryNext) && hole.gap < dryMin + lib.length + (dryPrev && dryNext ? dryMin : rules.minGap)) continue;
        const minFromPrev = dryPrev ? dryMin : rules.minGap;
        const minToNext = dryNext ? dryMin : rules.minGap;
        const sStartK = Math.max(sStart, hole.from + minFromPrev);
        const sEndMax = hole.to - minToNext;             // fine massima dell'ostacolo
        if (sEndMax - sStartK - lib.length < -1e-6) continue;
        let sMid = sStartK + lib.length / 2 + Math.min(Math.max(0, (sEndMax - sStartK - lib.length) / 2), Math.max(0, rules.maxGap - rules.minGap));
        sMid = Math.min(sMid, sEndMax - lib.length / 2);
        sMid = clamp(sMid, lib.length / 2, Math.max(lib.length / 2, finishLimit - lib.length / 2));

        // le gimkane vogliono un rettilineo: se cade in curva si sposta o si scarta
        let el = baked.elements.find((e) => sMid >= e.startStation && sMid <= e.endStation);
        if (el && el.type === 'arc') {
          const alt = el.endStation + rules.minGap + lib.length / 2;
          if (alt + lib.length / 2 > hole.to || alt > finishLimit) continue;
          sMid = alt;
          el = baked.elements.find((e) => sMid >= e.startStation && sMid <= e.endStation);
        }
        const lane = el ? G.lerp(el.widthStart, el.widthEnd, el.length ? (sMid - el.startStation) / el.length : 0) : project.track.defaultWidth;
        const width = G.round(Math.min(lib.width, Math.max(lib.key === 'rialzo' ? ROLLER.rampWidthMin : 1, lane)), 2);
        project.structures.push(makeStructure(lib.key, G.round(sMid, 2), { width, category: cat }));
        if (count[lib.group] !== undefined) count[lib.group]++;
        if (lib.group === 'rampe') rampTypes.add(lib.key);
        placed.push(lib.key);
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) break;     // nessun tipo entra in nessun buco
  }
  return placed.length;
}

/**
 * Progressiva su cui chiudere il secondo passaggio: la più vicina a quella
 * ideale che lascia davanti a sé i metri richiesti dall'ultimo ostacolo.
 */
function bestFinishStation(project, ideal, finishMin) {
  const lapLen = bakeTrack(project).totalLength;
  const a = analyze(project);
  const obs = a.obstacles.filter((o) => o.kind !== 'start').sort((x, y) => x.sEnd - y.sEnd);
  const clearance = (s) => {
    const prev = obs.filter((o) => o.sEnd <= s + 1e-6).slice(-1)[0];
    return prev ? s - prev.sEnd : s;
  };
  const cands = [ideal, ...obs.map((o) => o.sEnd + finishMin + 0.5)]
    .map((s) => G.clamp(s, 1, lapLen - 0.5))
    .filter((s) => clearance(s) >= finishMin - 1e-6);
  if (!cands.length) return G.round(ideal, 1);
  cands.sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal));
  return G.round(cands[0], 1);
}

/** il raccordo di chiusura resta dentro l'area? */
function closureFits(o, baked, opt) {
  const plan = o.elements.map((e) => (e.type === 'arc'
    ? { type: 'arc', radius: e.radius, angle: e.angle, dir: e.dir, width: opt.width }
    : { type: 'straight', length: e.length, width: opt.width }));
  let pose = { point: baked.endPoint, heading: baked.endHeading };
  for (const el of plan) {
    const r = walk(pose, el, 1.0);
    for (const q of r.pts) if (!okPoint(q, opt.poly, opt.margin)) return false;
    pose = r.pose;
  }
  return true;
}

/**
 * Da un percorso aperto ricava la variante ad anello: aggiunge il raccordo di
 * Dubins verso la partenza, calcola quanti giri servono per avvicinarsi alla
 * lunghezza richiesta e ridistribuisce gli ostacoli.
 */
function makeLoopVariant(openProject, opt) {
  const rules = opt.rules;
  const base = JSON.parse(JSON.stringify(openProject));
  base.structures = [];
  const baked = bakeTrack(base);
  if (baked.elements.length < 2) return null;
  if (G.dist(baked.endPoint, baked.startPoint) < 1.2) return null;   // già chiuso

  // il tratto d'arrivo prima della linea è preferibile ma non sempre ci sta:
  // si prova a ridurlo e, in ultima istanza, si chiude senza
  const runouts = [...new Set([opt.runout || 0, (opt.runout || 0) / 2, 0])].filter((v) => v >= 0);
  let options = [];
  for (const ro of runouts) {
    options = closeToStartOptions(baked, opt.width, opt.radii, ro);
    const fits = options.slice(0, 12).some((o) => closureFits(o, baked, opt));
    if (fits) break;
  }
  let chosen = null;
  for (const o of options.slice(0, 12)) {
    if (closureFits(o, baked, opt)) { chosen = o; break; }
  }
  if (!chosen) return null;

  base.track.elements.push(...JSON.parse(JSON.stringify(chosen.elements)));
  base.track.closed = true;
  const lap = bakeTrack(base).totalLength;
  const target = opt.target || ((ROLLER.totalLengthMin + ROLLER.totalLengthMax) / 2);
  // Un giro solo quando basta. Se non basta si ripassa una seconda volta, ma
  // solo per il tratto necessario: niente giri interi in più del dovuto, e in
  // ogni caso mai più di due passaggi.
  if (lap >= target * 0.92) {
    base.track.laps = 1; base.track.finishAt = null;
  } else if (lap * 2 >= target) {
    base.track.laps = 2; base.track.finishAt = G.round(target - lap, 1);
  } else {
    base.track.laps = 2; base.track.finishAt = null;
  }
  autoPlaceStructures(base, { count: base.genParams ? base.genParams.structureCount ?? null : null });

  // l'arrivo del secondo passaggio non deve cadere subito dopo un ostacolo
  if (base.track.finishAt > 0 && rules.finishMin > 0) {
    base.track.finishAt = bestFinishStation(base, base.track.finishAt, rules.finishMin);
  }
  return base;
}

/* ------------------------------------------------------------- punteggio */

function scoreCandidate(project, cand) {
  const a = analyze(project);
  const gp = project.genParams || {};
  let score = 0;
  const notes = [];

  // lunghezza: nei percorsi ad anello conta lo sviluppo di gara (giri compresi)
  const L = a.stats.raceLength || a.stats.totalLength;
  if (gp.targetLength) {
    const err = Math.abs(L - gp.targetLength);
    score -= err * 2.5;
    if (err > gp.targetLength * 0.1) notes.push(`lunghezza ${G.round(L, 0)} m invece di ${gp.targetLength} m`);
  } else if (project.discipline === 'roller') {
    // senza obiettivo esplicito si punta all'intervallo di regolamento 250–300 m
    const off = L < ROLLER.totalLengthMin ? ROLLER.totalLengthMin - L
      : L > ROLLER.totalLengthMax ? L - ROLLER.totalLengthMax : 0;
    score -= off * 2.5;
    score += off ? 0 : 150;
    if (off) notes.push(`lunghezza ${G.round(L, 0)} m, fuori dall'intervallo 250–300 m`);
    if (a.stats.laps > 1 && a.stats.finishAt === null) notes.push(`${a.stats.laps} passaggi sul giro da ${G.round(a.stats.totalLength, 0)} m`);
    if (a.stats.finishAt !== null) notes.push(`un giro da ${G.round(a.stats.totalLength, 0)} m più ${G.round(a.stats.finishAt, 0)} m di secondo passaggio`);
  } else {
    score += L * 0.8;
  }
  // rettilineo di partenza (Art. 65.4)
  if (project.discipline === 'roller') {
    const first = a.baked.elements[0];
    const sl = first && first.type === 'straight' ? first.length : 0;
    if (sl < ROLLER.startStraightMinLength) {
      score -= 130;
      notes.push(`rettilineo di partenza ${G.round(sl, 0)} m invece di ${ROLLER.startStraightMinLength} m`);
    }
  }
  // curve obbligatorie a destra e a sinistra (roller cross)
  if (project.discipline === 'roller') {
    const arcs = a.baked.elements.filter((e) => e.type === 'arc');
    const nR = arcs.filter((e) => e.dir === 'right').length;
    const nL = arcs.filter((e) => e.dir === 'left').length;
    const missing = Math.max(0, ROLLER.curvesRightMin - nR) + Math.max(0, ROLLER.curvesLeftMin - nL);
    score -= missing * 110;
    if (missing) notes.push(`servono almeno 2 curve a destra e 2 a sinistra (ora ${nR}/${nL})`);
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
  // i percorsi reali usano molte curve strette: senza queste non si sfrutta
  // lo spazio delle aree piccole
  const stdRadii = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12].filter((r) => !reqRadii.some((q) => Math.abs(q - r) < 0.5));
  // i raggi richiesti restano in testa (e pesano di più nelle scelte casuali)
  // i raggi richiesti pesano di più nelle scelte casuali della strategia libera
  const radii = [...reqRadii, ...reqRadii, ...reqRadii, ...stdRadii];
  const geoRadii = [...new Set([...reqRadii, ...stdRadii])].sort((a, b) => a - b);
  const headings = options.headings || [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];

  const isRoller = project.discipline === 'roller';
  const startStraightMin = isRoller ? ROLLER.startStraightMinLength : 0;
  // senza obiettivo esplicito, nel roller cross si punta al centro dell'intervallo
  const workTarget = gp.targetLength || (isRoller ? (ROLLER.totalLengthMin + ROLLER.totalLengthMax) / 2 : null);
  const minTurns = isRoller ? ROLLER.curvesRightMin + ROLLER.curvesLeftMin : 0;
  const opt = { width, margin, radii, target: workTarget, rules, headings, startStraightMin, minTurns };
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
    const plan = ensureFinishRunout(fixed.plan, fixed.start, poly, margin, rules);
    if (plan.length < 2) continue;
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

  /* Anelli a più passaggi: si usano soltanto se con un giro solo la lunghezza
     richiesta non si raggiunge. Prima si verifica, poi semmai si ripassa. */
  const wantLength = gp.targetLength || (isRoller ? ROLLER.totalLengthMin : 0);
  const inRange = (r) => {
    const L = r.stats.raceLength || r.stats.totalLength;
    if (gp.targetLength) return Math.abs(L - gp.targetLength) <= Math.max(5, gp.targetLength * 0.05);
    if (!isRoller) return true;
    return L >= ROLLER.totalLengthMin && L <= ROLLER.totalLengthMax;
  };
  const singleLapEnough = results.some(inRange);
  if (gp.closedLoop !== false && wantLength > 0 && !singleLapEnough) {
    const seeds = results.slice().sort((a, b) => b.score - a.score).slice(0, 8);
    for (const r of seeds) {
      const loop = makeLoopVariant(r.project, {
        width, margin, poly, radii: geoRadii, target: gp.targetLength, rules,
        runout: rules.finishMin || 0,
      });
      if (!loop) continue;
      const sc2 = scoreCandidate(loop, r);
      const st2 = sc2.analysis.stats;
      const passes = st2.finishAt !== null ? `giro + ${G.round(st2.finishAt, 0)} m` : `${st2.laps} passaggi`;
      results.push({
        id: uid('cand'),
        name: `${r.name} · anello (${passes})`,
        strategy: r.strategy,
        closed: true,
        project: loop,
        score: sc2.score + (inRange({ stats: st2 }) ? 60 : 0),
        notes: sc2.notes,
        stats: st2,
        checks: sc2.analysis.checks,
      });
    }
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
