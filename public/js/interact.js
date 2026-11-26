/* interact.js — gestione puntatore: pan, zoom, pinch, trascinamenti,
   strumento "disegna percorso". Funziona con mouse e con il touch. */

import * as G from './geometry.js';
import { toWorld, toScreen } from './render.js';
import { projectPoint, dropStructureAt, extendTo, bakeTrack } from './track.js';

const { add, sub, mul, leftOf, dirOf, clamp } = G;

export function attachInteractions(svg, api) {
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let moved = false;

  const dims = () => {
    const r = svg.getBoundingClientRect();
    return { W: r.width, H: r.height, rect: r };
  };
  const toLocal = (e) => {
    const { rect } = dims();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const world = (e) => {
    const st = api.state(); const { W, H } = dims();
    return toWorld(st.view, W, H, toLocal(e));
  };

  function pickOf(e) {
    const t = e.target.closest && e.target.closest('[data-pick]');
    if (!t) return null;
    return { pick: t.getAttribute('data-pick'), id: t.getAttribute('data-id'), index: +t.getAttribute('data-index') };
  }

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toLocal(e));
    moved = false;
    const st = api.state();

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        scale: st.view.scale, cx: st.view.cx, cy: st.view.cy,
      };
      drag = null;
      return;
    }

    const hit = pickOf(e);
    const wp = world(e);

    // modalità sfondo: il trascinamento sposta (o ruota) la foto aerea
    if (st.mode === 'map' && !st.project.basemap.locked) {
      const bm = st.project.basemap;
      drag = {
        kind: (st.mapDrag === 'rotate' || e.shiftKey) ? 'maprot' : 'mappan',
        from: wp, orig: { lat: bm.lat, lon: bm.lon, rotation: bm.rotation },
      };
      return;
    }

    // modalità quota: niente si afferra e niente si modifica; il tocco secco
    // misura, il trascinamento sposta soltanto la vista
    if (st.mode === 'quota') {
      drag = { kind: 'pan', from: toLocal(e), cx: st.view.cx, cy: st.view.cy, tap: { measure: wp } };
      return;
    }
    // posa della linea di arrivo in un punto qualsiasi del percorso
    if (st.tool === 'finish') {
      drag = { kind: 'pan', from: toLocal(e), cx: st.view.cx, cy: st.view.cy, tap: { finish: wp } };
      return;
    }

    // con uno strumento attivo il tocco "secco" agisce, il trascinamento sposta la vista
    if (st.tool === 'draw' || (st.tool && st.tool.startsWith('add:'))) {
      drag = { kind: 'pan', from: toLocal(e), cx: st.view.cx, cy: st.view.cy, tap: { wp, tool: st.tool } };
      return;
    }

    if (hit) {
      switch (hit.pick) {
        case 'vertex':
          drag = { kind: 'vertex', index: hit.index, orig: { ...st.project.area.points[hit.index] }, from: wp };
          api.select({ kind: 'vertex', id: String(hit.index) });
          return;
        case 'structure': {
          const s = st.project.structures.find((x) => x.id === hit.id);
          api.select({ kind: 'structure', id: hit.id });
          if (s && !s.locked) drag = { kind: 'structure', id: hit.id, orig: { ...s }, from: wp };
          return;
        }
        case 'node': {
          const el = st.project.track.elements.find((x) => x.id === hit.id);
          api.select({ kind: 'element', id: hit.id });
          if (el) drag = { kind: 'node', id: hit.id, orig: { ...el }, from: wp };
          return;
        }
        case 'element':
          // prendere il percorso in un punto qualsiasi lo sposta tutto intero
          api.select({ kind: 'element', id: hit.id });
          drag = { kind: 'track', orig: { ...st.project.track.start }, from: wp };
          return;
        case 'lane':
          drag = { kind: 'track', orig: { ...st.project.track.start }, from: wp };
          return;
        case 'trackstart':
          drag = { kind: 'start', orig: { ...st.project.track.start }, from: wp };
          api.select({ kind: 'start', id: 'start' });
          return;
        case 'trackrot':
          drag = { kind: 'rot', orig: { ...st.project.track.start }, from: wp };
          api.select({ kind: 'start', id: 'start' });
          return;
        case 'gate':
        case 'startramp':
          // la zona di partenza è ancorata all'inizio del tracciato:
          // trascinandola si sposta il punto di partenza, non la vista
          api.select({ kind: 'start', id: 'start' });
          drag = { kind: 'start', orig: { ...st.project.track.start }, from: wp };
          return;
      }
    }
    drag = { kind: 'pan', from: toLocal(e), cx: st.view.cx, cy: st.view.cy };
  });

  svg.addEventListener('pointermove', (e) => {
    const st = api.state();
    // l'anteprima del disegno va aggiornata anche senza pulsante premuto,
    // quindi prima del filtro sui puntatori attivi
    if (!drag && !pinch && st.tool === 'draw' && api.previewTo) api.previewTo(world(e));
    // lettura delle misure: in modalità quota e mentre si posa l'arrivo
    if (!drag && !pinch && (st.mode === 'quota' || st.tool === 'finish') && api.measureTo) api.measureTo(world(e));
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, toLocal(e));
    const { W, H } = dims();

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = clamp(d / Math.max(10, pinch.dist), 0.2, 6);
      const newScale = clamp(pinch.scale * ratio, 0.5, 240);
      // mantiene fermo il punto medio
      const before = toWorld({ ...st.view, scale: pinch.scale, cx: pinch.cx, cy: pinch.cy }, W, H, pinch.mid);
      st.view.scale = newScale;
      const after = toWorld({ ...st.view, cx: pinch.cx, cy: pinch.cy }, W, H, mid);
      st.view.cx = pinch.cx + (before.x - after.x);
      st.view.cy = pinch.cy + (before.y - after.y);
      api.render();
      return;
    }
    if (!drag) return;
    const loc = toLocal(e);
    if (!moved && drag.from && drag.from.x !== undefined && typeof drag.from.x === 'number' && drag.kind === 'pan') {
      if (Math.hypot(loc.x - drag.from.x, loc.y - drag.from.y) < 5) return; // tolleranza del tocco
    }
    moved = true;
    const wp = world(e);

    if (drag.kind === 'pan') {
      const p = toLocal(e);
      st.view.cx = drag.cx - (p.x - drag.from.x) / st.view.scale;
      st.view.cy = drag.cy + (p.y - drag.from.y) / st.view.scale;
      api.render();
      return;
    }
    if (drag.kind === 'mappan' || drag.kind === 'maprot') {
      api.dragBasemap(drag, wp);
      return;
    }
    if (drag.kind === 'vertex') {
      const p = st.project.area.points[drag.index];
      const snap = st.snap ? 0.25 : 0;
      p.x = snap ? Math.round(wp.x / snap) * snap : wp.x;
      p.y = snap ? Math.round(wp.y / snap) * snap : wp.y;
      st.project.area.shape = 'polygon';
      api.live();
      return;
    }
    if (drag.kind === 'structure') {
      const s = st.project.structures.find((x) => x.id === drag.id);
      if (s) {
        dropStructureAt(s, st.analysis.baked, wp);
        if (st.snap) { s.station = Math.round(s.station * 4) / 4; s.side = Math.round(s.side * 4) / 4; }
      }
      api.live();
      return;
    }
    if (drag.kind === 'track' || drag.kind === 'start') {
      st.project.track.start.x = drag.orig.x + (wp.x - drag.from.x);
      st.project.track.start.y = drag.orig.y + (wp.y - drag.from.y);
      if (st.snap) {
        st.project.track.start.x = Math.round(st.project.track.start.x * 4) / 4;
        st.project.track.start.y = Math.round(st.project.track.start.y * 4) / 4;
      }
      api.live();
      return;
    }
    if (drag.kind === 'rot') {
      const s = st.project.track.start;
      const a = Math.atan2(s.y - wp.y, s.x - wp.x) * G.RAD;
      s.heading = st.snap ? Math.round(a / 5) * 5 : Math.round(a * 10) / 10;
      api.live();
      return;
    }
    if (drag.kind === 'node') {
      const el = st.project.track.elements.find((x) => x.id === drag.id);
      const baked = st.analysis.baked;
      const bel = baked.elements.find((x) => x.id === drag.id);
      if (!el || !bel) return;
      if (el.type === 'straight') {
        const d = dirOf(bel.startHeading);
        let L = G.dot(sub(wp, bel.startPoint), d);
        L = clamp(L, 0.3, 500);
        el.length = st.snap ? Math.round(L * 4) / 4 : Math.round(L * 100) / 100;
      } else {
        // un solo punto controlla raggio e angolo dell'arco
        const S0 = bel.startPoint, h0 = bel.startHeading;
        const v = sub(wp, S0);
        const nL = leftOf(h0);
        const den = 2 * G.dot(v, nL);
        if (Math.abs(den) > 1e-4) {
          const r = G.dot(v, v) / den;
          const dir = r > 0 ? 'left' : 'right';
          const radiusAxis = clamp(Math.abs(r), 0.6, 400);
          const laneW = ((+el.widthStart || 0) + (+el.widthEnd || 0)) / 2;
          const radius = Math.max(0, radiusAxis - laneW / 2);   // si memorizza il raggio interno
          const sgn = r > 0 ? 1 : -1;
          const C = add(S0, mul(nL, sgn * radiusAxis));
          const a0 = Math.atan2(S0.y - C.y, S0.x - C.x);
          const a1 = Math.atan2(wp.y - C.y, wp.x - C.x);
          let sweep = (a1 - a0) * sgn;
          while (sweep < 0) sweep += 2 * Math.PI;
          while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
          el.dir = dir;
          el.radius = st.snap ? Math.round(radius * 2) / 2 : Math.round(radius * 100) / 100;
          el.angle = clamp(st.snap ? Math.round(sweep * G.RAD / 5) * 5 : Math.round(sweep * G.RAD * 10) / 10, 1, 350);
        }
      }
      api.live();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (moved) {
      if (d.kind === 'mappan' || d.kind === 'maprot') api.commit('sfondo');
      else if (d.kind !== 'pan') api.commit('modifica');
      return;
    }
    // tocco senza trascinamento
    if (d.tap) {
      if (d.tap.measure) { api.measureFix(d.tap.measure); return; }
      if (d.tap.finish) { api.setFinishAt(d.tap.finish); return; }
      if (d.tap.tool === 'draw') api.drawTo(d.tap.wp);
      else api.addStructureAt(d.tap.tool.slice(4), d.tap.wp);
      return;
    }
    if (d.kind === 'pan') api.select(null);
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('lostpointercapture', endPointer);

  svg.addEventListener('pointerleave', () => {
    if (api.previewTo) api.previewTo(null);
    if (api.measureTo) api.measureTo(null);
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const st = api.state();
    const { W, H } = dims();
    const local = toLocal(e);
    const before = toWorld(st.view, W, H, local);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    st.view.scale = clamp(st.view.scale * f, 0.5, 240);
    const after = toWorld(st.view, W, H, local);
    st.view.cx += before.x - after.x;
    st.view.cy += before.y - after.y;
    api.render();
  }, { passive: false });

  svg.addEventListener('dblclick', (e) => {
    if (api.state().mode === 'quota') return;
    const hit = pickOf(e);
    if (hit && hit.pick === 'structure') api.openStructure(hit.id);
    else if (hit && hit.pick === 'element') api.openElement(hit.id);
  });

  return {
    zoomBy(f) {
      const st = api.state();
      st.view.scale = clamp(st.view.scale * f, 0.5, 240);
      api.render();
    },
  };
}

/* esportato per l'uso dall'app */
export { extendTo, projectPoint, bakeTrack };
