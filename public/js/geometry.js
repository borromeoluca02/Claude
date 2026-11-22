/* geometry.js — matematica di base: vettori, poligoni, archi.
   Nessuna dipendenza dal DOM: importabile anche da Node per i test. */

export const EPS = 1e-9;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const vec = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
/** ruota di `ang` radianti */
export const rot = (a, ang) => ({
  x: a.x * Math.cos(ang) - a.y * Math.sin(ang),
  y: a.x * Math.sin(ang) + a.y * Math.cos(ang),
});
/** versore direzione dato un heading in radianti */
export const dirOf = (h) => ({ x: Math.cos(h), y: Math.sin(h) });
/** normale sinistra del versore direzione */
export const leftOf = (h) => ({ x: -Math.sin(h), y: Math.cos(h) });
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpP = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** normalizza un angolo in (-PI, PI] */
export function wrapPi(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
export const round = (v, d = 2) => {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
};

/* ------------------------------------------------------------------ poligoni */

/** area con segno (positiva = antiorario) */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonPerimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length]);
  return p;
}

export function polygonCentroid(pts) {
  const a = polygonArea(pts);
  if (Math.abs(a) < EPS) {
    // poligono degenere: media dei vertici
    return pts.reduce((acc, p) => add(acc, mul(p, 1 / pts.length)), vec());
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function polygonBounds(pts) {
  if (!pts || !pts.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** true se il punto è dentro il poligono (ray casting, bordo incluso con tolleranza) */
export function pointInPolygon(p, pts) {
  if (!pts || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (distPointSegment(p, a, b) <= 1e-6) return true; // sul bordo
    const intersect = (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || EPS) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return len(ap);
  const t = clamp(dot(ap, ab) / l2, 0, 1);
  return dist(p, add(a, mul(ab, t)));
}

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { point: a, t: 0 };
  const t = clamp(dot(ap, ab) / l2, 0, 1);
  return { point: add(a, mul(ab, t)), t };
}

/** distanza minima dal bordo del poligono (sempre >= 0) */
export function distToPolygonEdge(p, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    d = Math.min(d, distPointSegment(p, pts[i], pts[(i + 1) % pts.length]));
  }
  return d;
}

/** distanza con segno dal poligono: positiva dentro, negativa fuori */
export function signedDistToPolygon(p, pts) {
  const d = distToPolygonEdge(p, pts);
  return pointInPolygon(p, pts) ? d : -d;
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(sub(p2, p1), sub(p3, p1));
  const d2 = cross(sub(p2, p1), sub(p4, p1));
  const d3 = cross(sub(p4, p3), sub(p1, p3));
  const d4 = cross(sub(p4, p3), sub(p2, p3));
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** indici dei segmenti di una polilinea che si incrociano fra loro */
export function polylineSelfIntersections(pts, skip = 2) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + skip; j < pts.length - 1; j++) {
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) out.push([i, j]);
    }
  }
  return out;
}

/** poligono convesso? (utile per avvisi sull'area) */
export function isConvex(pts) {
  if (pts.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const z = cross(sub(b, a), sub(c, b));
    if (Math.abs(z) < EPS) continue;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** assicura ordine antiorario */
export function ensureCCW(pts) {
  return polygonArea(pts) < 0 ? [...pts].reverse() : pts.slice();
}

/* ----------------------------------------------------- forme d'area pronte */

export function rectPolygon(w, h, x0 = 0, y0 = 0) {
  return [vec(x0, y0), vec(x0 + w, y0), vec(x0 + w, y0 + h), vec(x0, y0 + h)];
}

/** trapezio: base inferiore b1, base superiore b2, altezza h, offset della base superiore */
export function trapezoidPolygon(b1, b2, h, offset = null) {
  const off = offset === null ? (b1 - b2) / 2 : offset;
  return [vec(0, 0), vec(b1, 0), vec(off + b2, h), vec(off, h)];
}

/** triangolo da base, altezza e posizione dell'apice (anche irregolare) */
export function trianglePolygon(base, h, apexX = null) {
  const ax = apexX === null ? base / 2 : apexX;
  return [vec(0, 0), vec(base, 0), vec(ax, h)];
}

/** poligono regolare a n lati inscritto in un cerchio di raggio r */
export function regularPolygon(n, r, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    out.push(vec(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return out;
}

/** offset "inward" approssimato di un poligono convesso (per corridoi di sicurezza) */
export function shrinkPolygon(pts, d) {
  const c = polygonCentroid(pts);
  return pts.map((p) => {
    const v = sub(p, c);
    const l = len(v) || 1;
    const k = Math.max(0, l - d) / l;
    return add(c, mul(v, k));
  });
}

/** erode: campiona una griglia e dice se un punto ha almeno `d` metri di margine */
export function insideWithMargin(p, pts, d) {
  return pointInPolygon(p, pts) && distToPolygonEdge(p, pts) >= d - 1e-6;
}

/* --------------------------------------------------------------- polilinee */

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** punto su una polilinea a distanza s dall'inizio */
export function polylineAt(pts, s) {
  if (!pts.length) return { point: vec(), heading: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = seg < EPS ? 0 : clamp((s - acc) / seg, 0, 1);
      const d = sub(pts[i], pts[i - 1]);
      return { point: lerpP(pts[i - 1], pts[i], t), heading: Math.atan2(d.y, d.x) };
    }
    acc += seg;
  }
  return { point: pts[pts.length - 1], heading: 0 };
}

/** proiezione del punto sulla polilinea → { s, dist, side } */
export function projectOnPolyline(p, pts) {
  let best = { s: 0, dist: Infinity, side: 0, point: pts[0] || vec() };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a, b);
    const { point, t } = closestPointOnSegment(p, a, b);
    const d = dist(p, point);
    if (d < best.dist) {
      const dir = norm(sub(b, a));
      const left = { x: -dir.y, y: dir.x };
      best = { s: acc + t * seg, dist: d, side: dot(sub(p, point), left), point };
    }
    acc += seg;
  }
  return best;
}
