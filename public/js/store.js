/* store.js — salvataggio su Firebase (Firestore + Auth) con fallback locale,
   più import/export JSON, SVG e PNG.
   Firebase è opzionale: senza configurazione l'app funziona in locale. */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const LS_CFG = 'rc.firebaseConfig';
const LS_PRJ = 'rc.projects';
const LS_CUR = 'rc.current';

let fb = null;          // { app, auth, db, mod }
let currentUser = null;
const userListeners = new Set();

/* ------------------------------------------------------- configurazione */

export function getConfig() {
  try {
    const ls = localStorage.getItem(LS_CFG);
    if (ls) return JSON.parse(ls);
  } catch (e) { /* ignora */ }
  if (typeof window !== 'undefined' && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
    return window.FIREBASE_CONFIG;
  }
  return null;
}

export function saveConfig(cfg) {
  if (!cfg) localStorage.removeItem(LS_CFG);
  else localStorage.setItem(LS_CFG, JSON.stringify(cfg));
}

export function hasFirebase() { return !!fb; }
export function user() { return currentUser; }
export function onUser(cb) { userListeners.add(cb); cb(currentUser); return () => userListeners.delete(cb); }
function emitUser(u) { currentUser = u; userListeners.forEach((cb) => { try { cb(u); } catch (e) { console.warn(e); } }); }

/* --------------------------------------------------------- inizializzazione */

export async function initFirebase() {
  const cfg = getConfig();
  if (!cfg || !cfg.apiKey) return null;
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = fsMod.getFirestore(app);
  }
  fb = { app, auth, db, authMod, fsMod };
  authMod.onAuthStateChanged(auth, (u) => emitUser(u ? { uid: u.uid, name: u.displayName || 'Utente', email: u.email, anon: u.isAnonymous } : null));
  return fb;
}

export async function signInGoogle() {
  const f = await initFirebase();
  if (!f) throw new Error('Firebase non configurato');
  const prov = new f.authMod.GoogleAuthProvider();
  try {
    await f.authMod.signInWithPopup(f.auth, prov);
  } catch (e) {
    // su mobile il popup può essere bloccato
    await f.authMod.signInWithRedirect(f.auth, prov);
  }
}

export async function signInAnon() {
  const f = await initFirebase();
  if (!f) throw new Error('Firebase non configurato');
  await f.authMod.signInAnonymously(f.auth);
}

export async function signInEmail(email, password, create = false) {
  const f = await initFirebase();
  if (!f) throw new Error('Firebase non configurato');
  if (create) await f.authMod.createUserWithEmailAndPassword(f.auth, email, password);
  else await f.authMod.signInWithEmailAndPassword(f.auth, email, password);
}

export async function signOutUser() {
  if (!fb) return;
  await fb.authMod.signOut(fb.auth);
}

/* ------------------------------------------------------------- locale */

function localAll() {
  try { return JSON.parse(localStorage.getItem(LS_PRJ) || '{}'); } catch (e) { return {}; }
}
function localWrite(map) { localStorage.setItem(LS_PRJ, JSON.stringify(map)); }

export function saveLocal(project) {
  const map = localAll();
  map[project.id] = { ...project, updatedAt: Date.now() };
  localWrite(map);
  return project.id;
}
export function listLocal() {
  return Object.values(localAll()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export function loadLocal(id) { return localAll()[id] || null; }
export function deleteLocal(id) { const m = localAll(); delete m[id]; localWrite(m); }

export function autosave(project) {
  try { localStorage.setItem(LS_CUR, JSON.stringify(project)); } catch (e) { /* quota */ }
}
export function loadAutosave() {
  try { const s = localStorage.getItem(LS_CUR); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

/* ------------------------------------------------------------- cloud */

function col() {
  const { fsMod, db } = fb;
  return fsMod.collection(db, 'users', currentUser.uid, 'projects');
}

export async function cloudSave(project) {
  if (!fb || !currentUser) throw new Error('Non connesso');
  const { fsMod } = fb;
  const data = JSON.parse(JSON.stringify({ ...project, updatedAt: Date.now(), ownerUid: currentUser.uid }));
  await fsMod.setDoc(fsMod.doc(col(), project.id), data, { merge: false });
  return project.id;
}

export async function cloudList() {
  if (!fb || !currentUser) return [];
  const { fsMod } = fb;
  const q = fsMod.query(col(), fsMod.orderBy('updatedAt', 'desc'), fsMod.limit(100));
  const snap = await fsMod.getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function cloudLoad(id) {
  if (!fb || !currentUser) return null;
  const { fsMod } = fb;
  const snap = await fsMod.getDoc(fsMod.doc(col(), id));
  return snap.exists() ? snap.data() : null;
}

export async function cloudDelete(id) {
  if (!fb || !currentUser) return;
  const { fsMod } = fb;
  await fsMod.deleteDoc(fsMod.doc(col(), id));
}

/* ------------------------------------------------------ import / export */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportJSON(project) {
  const safe = (project.name || 'percorso').replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safe}.json`);
}

export function pickJSON() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return reject(new Error('nessun file'));
      const fr = new FileReader();
      fr.onload = () => { try { resolve(JSON.parse(String(fr.result))); } catch (e) { reject(e); } };
      fr.onerror = () => reject(fr.error);
      fr.readAsText(f);
    };
    inp.click();
  });
}

let svgCssCache = null;
async function svgCss() {
  if (svgCssCache != null) return svgCssCache;
  try { svgCssCache = await fetch('css/svg.css').then((r) => r.text()); }
  catch (e) { svgCssCache = ''; }
  return svgCssCache;
}

/** SVG autonomo (con stili incorporati) del disegno corrente */
export async function buildStandaloneSVG(svgEl, W, H, title = 'Percorso') {
  const css = await svgCss();
  const inner = svgEl.innerHTML;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<title>${title}</title><style>${css}\nsvg{background:#fff}</style>` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>${inner}</svg>`;
}

export async function exportSVG(svgEl, W, H, project) {
  const txt = await buildStandaloneSVG(svgEl, W, H, project.name);
  const safe = (project.name || 'percorso').replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob([txt], { type: 'image/svg+xml' }), `${safe}.svg`);
}

export async function exportPNG(svgEl, W, H, project, scale = 2) {
  const txt = await buildStandaloneSVG(svgEl, W, H, project.name);
  const blob = new Blob([txt], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0);
    const out = await new Promise((res) => c.toBlob(res, 'image/png'));
    const safe = (project.name || 'percorso').replace(/[^\w\-]+/g, '_');
    downloadBlob(out, `${safe}.png`);
  } finally { URL.revokeObjectURL(url); }
}

/** distinta delle strutture in CSV */
export function exportCSV(project, analysis) {
  const rows = [['#', 'Struttura', 'Altezza (m)', 'Lunghezza (m)', 'Larghezza (m)', 'Progressiva (m)', 'Scostamento (m)', 'Distanza dal precedente (m)', 'Stato']];
  project.structures
    .slice()
    .sort((a, b) => a.station - b.station)
    .forEach((s, i) => {
      const st = analysis.status[s.id] || {};
      rows.push([i + 1, s.name, s.height, s.length, s.width, s.station, s.side,
        st.gap == null ? '' : Math.round(st.gap * 100) / 100,
        st.level === 'bad' ? 'FUORI REGOLA' : st.level === 'warn' ? 'da verificare' : 'ok']);
    });
  rows.push([]);
  rows.push(['Sviluppo asse (m)', Math.round(analysis.stats.totalLength * 100) / 100]);
  rows.push(['Curve', analysis.stats.curveCount]);
  rows.push(['Larghezza min/max (m)', analysis.stats.minWidth, analysis.stats.maxWidth]);
  const csv = rows.map((r) => r.map((c) => (typeof c === 'string' && /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
  const safe = (project.name || 'percorso').replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${safe}_distinta.csv`);
}
