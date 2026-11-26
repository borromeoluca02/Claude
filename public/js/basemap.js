/* basemap.js — sfondo fotografico dall'alto, georeferenziato.
 *
 * Il disegno è in metri, con origine (0,0) arbitraria. Lo sfondo lega quella
 * origine a un punto reale (latitudine/longitudine) e ci appoggia sopra le
 * tessere della vista satellitare, alla scala giusta: un metro del disegno è
 * un metro sul terreno, quindi il percorso si può confrontare direttamente
 * con lo spazio disponibile.
 *
 * La proiezione è la Web Mercator usata da tutti i servizi a tessere. A quelle
 * latitudini le distanze risultano dilatate di 1/cos(lat): si compensa con la
 * risoluzione delle tessere, calcolata alla latitudine dell'ancoraggio. Su
 * un'area di qualche centinaio di metri l'errore resta sotto il centimetro.
 */

const TILE = 256;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export const PROVIDERS = {
  esri: {
    key: 'esri',
    name: 'Satellite (senza chiave)',
    credit: 'Immagini Esri, Maxar, Earthstar Geographics',
    maxZoom: 20,
    needsKey: false,
    block: 1,
    url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
  google: {
    key: 'google',
    name: 'Google Maps (con la tua chiave)',
    credit: 'Immagini © Google',
    maxZoom: 21,
    needsKey: true,
    // la Static Maps API non serve tessere: si chiede un'immagine centrata
    // sul blocco, grande quanto il blocco. Un blocco di 2×2 tessere (512 px,
    // il massimo utile a scale=2) riduce di quattro volte le chiamate, che
    // sulla chiave dell'utente si pagano a consumo.
    block: 2,
    url: (x, y, z, opts) => {
      const n = opts.block || 2;
      const c = blockCenter(x, y, z, n);
      return 'https://maps.googleapis.com/maps/api/staticmap'
        + `?center=${c.lat.toFixed(7)},${c.lon.toFixed(7)}`
        + `&zoom=${z}&size=${256 * n}x${256 * n}&scale=2&maptype=satellite&format=png`
        + `&key=${encodeURIComponent(opts.apiKey || '')}`;
    },
  },
  googleroad: {
    key: 'googleroad',
    name: 'Google Maps stradale (con la tua chiave)',
    credit: 'Mappa © Google',
    maxZoom: 21,
    needsKey: true,
    block: 2,
    url: (x, y, z, opts) => {
      const n = opts.block || 2;
      const c = blockCenter(x, y, z, n);
      return 'https://maps.googleapis.com/maps/api/staticmap'
        + `?center=${c.lat.toFixed(7)},${c.lon.toFixed(7)}`
        + `&zoom=${z}&size=${256 * n}x${256 * n}&scale=2&maptype=roadmap&format=png`
        + `&key=${encodeURIComponent(opts.apiKey || '')}`;
    },
  },
};

export function provider(key) { return PROVIDERS[key] || PROVIDERS.esri; }

/* ------------------------------------------------- proiezione Web Mercator */

export function lonToPx(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
export function latToPx(lat, z) {
  const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
}
export function pxToLon(px, z) { return px / (TILE * Math.pow(2, z)) * 360 - 180; }
export function pxToLat(py, z) {
  const n = Math.PI - 2 * Math.PI * py / (TILE * Math.pow(2, z));
  return R2D * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
/** metri di terreno per pixel di tessera, alla latitudine data */
export function metersPerPixel(lat, z) {
  return 156543.03392804097 * Math.cos(lat * D2R) / Math.pow(2, z);
}
function blockCenter(x, y, z, n = 1) {
  return { lat: pxToLat((y + n / 2) * TILE, z), lon: pxToLon((x + n / 2) * TILE, z) };
}

/* --------------------------------------------------------------- utilità */

const rot = (p, deg) => {
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/**
 * Converte un punto del disegno (metri) in latitudine/longitudine.
 * `rotation` è di quanti gradi lo sfondo è ruotato sotto il disegno.
 */
export function worldToLatLon(bm, p) {
  const z = 21;                                   // livello di riferimento
  const mpp = metersPerPixel(bm.lat, z);
  const q = rot({ x: p.x, y: p.y }, -(bm.rotation || 0));
  return {
    lat: pxToLat(latToPx(bm.lat, z) - q.y / mpp, z),
    lon: pxToLon(lonToPx(bm.lon, z) + q.x / mpp, z),
  };
}

/** Inverso: da coordinate reali al punto del disegno, in metri. */
export function latLonToWorld(bm, lat, lon) {
  const z = 21;
  const mpp = metersPerPixel(bm.lat, z);
  const q = {
    x: (lonToPx(lon, z) - lonToPx(bm.lon, z)) * mpp,
    y: -(latToPx(lat, z) - latToPx(bm.lat, z)) * mpp,
  };
  return rot(q, bm.rotation || 0);
}

/**
 * Tessere da disegnare per la vista corrente.
 * Restituisce { zoom, mpp, tiles:[{url,x,y,w,h}], rotation, anchor } con le
 * coordinate già in pixel dello schermo, da avvolgere in una rotazione
 * attorno al punto di ancoraggio.
 */
export function tileLayer(bm, view, W, H, opts = {}) {
  const prov = provider(bm.provider);
  if (prov.needsKey && !opts.apiKey) return null;

  // livello di dettaglio: una tessera ≈ un pixel dello schermo. Per la
  // stampa serve più definizione di quella che basta a video: `zoomBias`.
  const ideal = Math.log2(156543.03392804097 * Math.cos(bm.lat * D2R) * view.scale) + (opts.zoomBias || 0);
  const zoom = Math.max(1, Math.min(prov.maxZoom, Math.round(ideal)));
  const mpp = metersPerPixel(bm.lat, zoom);
  const p0 = { x: lonToPx(bm.lon, zoom), y: latToPx(bm.lat, zoom) };

  // rettangolo da coprire (tutto il disegno, o solo il riquadro indicato)
  const r = opts.rect || { x: 0, y: 0, w: W, h: H };
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / view.scale + view.cx, y: (H / 2 - sy) / view.scale + view.cy });
  const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
    .map(([sx, sy]) => rot(toWorld(sx, sy), -(bm.rotation || 0)));
  const xs = corners.map((c) => p0.x + c.x / mpp);
  const ys = corners.map((c) => p0.y - c.y / mpp);

  // le immagini si chiedono a blocchi di `blk` tessere
  const blk = Math.max(1, prov.block || 1);
  const step = TILE * blk;
  const bx0 = Math.floor(Math.min(...xs) / step), bx1 = Math.floor(Math.max(...xs) / step);
  const by0 = Math.floor(Math.min(...ys) / step), by1 = Math.floor(Math.max(...ys) / step);
  const count = (bx1 - bx0 + 1) * (by1 - by0 + 1);
  const out = { zoom, mpp, tiles: [], rotation: bm.rotation || 0, credit: prov.credit, block: blk };
  if (count <= 0 || count > (opts.maxTiles || 240)) { out.tooMany = count > 0; return out; }

  const max = 1 << zoom;                       // tessere per lato a questo livello
  const k = mpp * view.scale;                  // pixel di disegno per pixel di tessera
  const screenOf = (px, py) => ({
    x: ((px - p0.x) * mpp - view.cx) * view.scale + W / 2,
    y: H / 2 - (-(py - p0.y) * mpp - view.cy) * view.scale,
  });

  for (let bxi = bx0; bxi <= bx1; bxi++) {
    for (let byi = by0; byi <= by1; byi++) {
      const ty = byi * blk;
      if (ty >= max || ty + blk <= 0) continue;          // fuori dal mondo
      const tx = ((((bxi * blk) % max) + max) % max);     // il mondo gira su sé stesso
      const s = screenOf(bxi * step, byi * step);
      out.tiles.push({
        url: prov.url(tx, ty, zoom, { ...opts, block: blk }),
        // mezzo pixel di sovrapposizione: evita le righe chiare fra le immagini
        x: s.x, y: s.y, w: step * k + 0.6, h: step * k + 0.6,
      });
    }
  }
  return out;
}

/* --------------------------------------------- lettura di un punto da testo */

/**
 * Riconosce coordinate scritte a mano o copiate da Google Maps:
 *   45,123456 9,654321 · 45.123456, 9.654321
 *   https://www.google.com/maps/@45.1234,9.6543,19z
 *   https://maps.google.com/?q=45.1234,9.6543
 *   https://www.google.com/maps/place/.../@45.12,9.65,18z/data=...!3d45.12!4d9.65
 *   45°07'24.4"N 9°39'15.6"E
 * Restituisce {lat, lon, zoom?} oppure null.
 */
export function parsePlace(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // gradi, primi e secondi
  const dms = t.match(/(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*["″]?\s*([NSns])[\s,]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*["″]?\s*([EWOewo])/);
  if (dms) {
    const d = (g, m, s, h) => {
      const v = +g + +m / 60 + parseFloat(String(s).replace(',', '.')) / 3600;
      return /[SsWwOo]/.test(h) ? -v : v;
    };
    return { lat: d(dms[1], dms[2], dms[3], dms[4]), lon: d(dms[5], dms[6], dms[7], dms[8]) };
  }

  // link di Google Maps: prima i dati precisi (!3d lat !4d lon), poi @lat,lon,zoom
  const data = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const at = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (data) return { lat: +data[1], lon: +data[2], zoom: at && at[3] ? Math.round(+at[3]) : undefined };
  if (at) return { lat: +at[1], lon: +at[2], zoom: at[3] ? Math.round(+at[3]) : undefined };

  const q = t.match(/[?&](?:q|query|ll|center|daddr)=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i);
  if (q) return { lat: +q[1], lon: +q[2] };

  // coppia di numeri, con la virgola sia come separatore sia come decimale
  const plain = t.replace(/[()]/g, '').match(/^\s*(-?\d+[.,]?\d*)\s*[,;\s]\s*(-?\d+[.,]?\d*)\s*$/);
  if (plain) {
    const a = parseFloat(plain[1].replace(',', '.')), b = parseFloat(plain[2].replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  }
  return null;
}

/** testo breve delle coordinate, nel formato che Google Maps accetta */
export function formatLatLon(lat, lon, d = 6) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  return `${lat.toFixed(d)}, ${lon.toFixed(d)}`;
}

export function mapsLink(lat, lon, zoom = 19) {
  return `https://www.google.com/maps/@${lat.toFixed(7)},${lon.toFixed(7)},${Math.round(zoom)}z/data=!3m1!1e3`;
}
