import { chromium, devices } from 'playwright';
const OUT = process.env.OUT || '/tmp/shots';
const URL = 'http://127.0.0.1:8099/index.html';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function newPage(opts) {
  const ctx = await browser.newContext({ locale: 'it-IT', ...opts });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  p.on('dialog', (dlg) => dlg.accept());
  return p;
}
const log = (tag, obj) => console.log(tag.padEnd(16), typeof obj === 'string' ? obj : JSON.stringify(obj));

/* ================================ DESKTOP ================================ */
const d = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await d.goto(URL, { waitUntil: 'networkidle' });
await d.waitForTimeout(500);
// l'app si apre sulla schermata dei progetti: si entra nell'editor
await d.evaluate(() => window.__editor && window.__editor());
await d.waitForTimeout(400);
await d.screenshot({ path: `${OUT}/01-desktop-start.png` });

log('START', await d.evaluate(() => {
  const s = window.__state;
  return {
    len: +s.analysis.stats.totalLength.toFixed(1),
    curves: s.analysis.stats.curveCount,
    structs: s.project.structures.length,
    issues: s.analysis.issues.length,
    svgGroups: document.querySelector('#canvas').childElementCount,
    gapLabels: document.querySelectorAll('.gapLbl').length,
    names: [...document.querySelectorAll('.stName')].map((e) => e.textContent),
    heights: [...document.querySelectorAll('.stH')].map((e) => e.textContent),
    dims: document.querySelectorAll('.stDim').length,
    totalLbl: (document.querySelector('.totalLbl') || {}).textContent,
    startBoxes: document.querySelectorAll('.startBox').length,
    laneLines: document.querySelectorAll('.laneLine').length,
    areaDims: [...document.querySelectorAll('.areaDim')].map((e) => e.textContent),
  };
}));

await d.click('.tab[data-act="tab:check"]'); await d.waitForTimeout(250);
await d.screenshot({ path: `${OUT}/02-desktop-check.png` });

/* ---- generazione automatica con parametri ---- */
await d.click('.tab[data-act="tab:auto"]'); await d.waitForTimeout(200);
await d.fill('input[data-bind="genParams.targetLength"]', '220');
await d.dispatchEvent('input[data-bind="genParams.targetLength"]', 'change');
await d.waitForTimeout(200);
await d.click('[data-act="gen.addReq"]'); await d.waitForTimeout(250);
await d.fill('input[data-bind="genParams.curveReqs.0.radius"]', '8');
await d.dispatchEvent('input[data-bind="genParams.curveReqs.0.radius"]', 'change');
await d.waitForTimeout(200);
await d.fill('input[data-bind="genParams.curveReqs.0.count"]', '4');
await d.dispatchEvent('input[data-bind="genParams.curveReqs.0.count"]', 'change');
await d.waitForTimeout(250);
log('PARAMS', await d.evaluate(() => window.__state.project.genParams));
await d.click('[data-act="gen.run"]');
await d.waitForTimeout(3000);
log('GEN', await d.evaluate(() => ({
  n: window.__state.candidates.length,
  thumbs: document.querySelectorAll('.candThumb svg').length,
  list: window.__state.candidates.map((c) => `${c.name} | L=${c.stats.totalLength.toFixed(0)} curve=${c.stats.curveCount} str=${c.stats.structureCount} bad=${c.stats.badCount}`),
})));
await d.screenshot({ path: `${OUT}/03-desktop-generate.png` });

if (await d.locator('.cand .btn.primary').count()) {
  await d.locator('.cand .btn.primary').first().click();
  await d.waitForTimeout(800);
  log('APPLIED', await d.evaluate(() => ({
    len: +window.__state.analysis.stats.totalLength.toFixed(1),
    str: window.__state.project.structures.length,
    issues: window.__state.analysis.issues.map((i) => i.level),
  })));
  await d.screenshot({ path: `${OUT}/04-desktop-applied.png` });
}

/* ---- strumento disegno ---- */
await d.evaluate(() => {
  const s = window.__state;
  s.project.track.elements = [];
  s.project.structures = [];
  s.project.track.start = { x: 6, y: 6, heading: 0 };
  window.__commit();
});
await d.click('.tab[data-act="tab:track"]'); await d.waitForTimeout(150);
await d.click('[data-act="tool:draw"]'); await d.waitForTimeout(150);
const box = await d.locator('#canvas').boundingBox();
for (const [fx, fy] of [[0.45, 0.35], [0.62, 0.62], [0.36, 0.74], [0.22, 0.45]]) {
  await d.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await d.waitForTimeout(260);
}
log('DRAW', await d.evaluate(() => ({
  els: window.__state.project.track.elements.length,
  types: window.__state.project.track.elements.map((e) => e.type[0]).join(''),
  len: +window.__state.analysis.stats.totalLength.toFixed(1),
})));
await d.screenshot({ path: `${OUT}/05-desktop-draw.png` });
await d.click('[data-act="tool:none"]');

/* ---- struttura toccando la mappa + verifica colore distanze ---- */
await d.click('.tab[data-act="tab:structures"]'); await d.waitForTimeout(150);
await d.click('[data-act="st.pick:dritta200"]'); await d.waitForTimeout(150);
await d.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
await d.waitForTimeout(400);
await d.click('[data-act="tool:none"]');
log('ADD-STRUCT', await d.evaluate(() => {
  const s = window.__state;
  const st = s.project.structures[0];
  const info = st ? s.analysis.status[st.id] : null;
  return st ? { name: st.name, station: +st.station.toFixed(2), level: info.level, gap: info.gap == null ? null : +info.gap.toFixed(2), reasons: info.reasons } : 'nessuna';
}));

/* la porto a 1 m dalla partenza: deve diventare rossa */
await d.evaluate(() => {
  const s = window.__state;
  s.project.structures[0].station = 2;
  window.__commit();
});
await d.waitForTimeout(300);
log('TOO-CLOSE', await d.evaluate(() => {
  const s = window.__state; const st = s.project.structures[0];
  return { level: s.analysis.status[st.id].level, redShapes: document.querySelectorAll('.struct.bad').length, reasons: s.analysis.status[st.id].reasons };
}));
/* ora in posizione valida */
await d.click('[data-act="st.snapValid"]');
await d.waitForTimeout(400);
log('SNAP-VALID', await d.evaluate(() => {
  const s = window.__state; const st = s.project.structures[0];
  return { station: +st.station.toFixed(2), level: s.analysis.status[st.id].level, green: document.querySelectorAll('.struct.ok').length };
}));
await d.screenshot({ path: `${OUT}/06-desktop-structure.png` });

/* ---- restringimento corsia sotto i 3 m ---- */
await d.evaluate(() => {
  const s = window.__state;
  const el = s.project.track.elements[1];
  el.widthStart = 3; el.widthEnd = 2.4;
  window.__commit();
});
await d.waitForTimeout(300);
log('NARROW', await d.evaluate(() => ({
  minW: window.__state.analysis.stats.minWidth,
  redEdges: document.querySelectorAll('.edge.bad').length,
  issues: window.__state.analysis.issues.filter((i) => /larg/i.test(i.text)).map((i) => i.text),
})));
await d.screenshot({ path: `${OUT}/07-desktop-narrow.png` });

/* ---- area irregolare: trascino un vertice ---- */
await d.click('.tab[data-act="tab:area"]'); await d.waitForTimeout(150);
await d.click('[data-act="area.toggleEdit"]'); await d.waitForTimeout(250);
const nv = await d.locator('circle.vtx').count();
if (nv > 2) {
  const vb = await d.locator('circle.vtx').nth(2).boundingBox();
  await d.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await d.mouse.down();
  await d.mouse.move(vb.x - 150, vb.y + 90, { steps: 12 });
  await d.mouse.up();
  await d.waitForTimeout(350);
}
log('AREA-DRAG', await d.evaluate(() => ({
  verts: window.__state.project.area.points.length,
  shape: window.__state.project.area.shape,
  m2: Math.round(window.__state.analysis.stats.areaValue),
  outside: window.__state.analysis.stats.outsideRuns,
})));
await d.screenshot({ path: `${OUT}/08-desktop-area.png` });
await d.click('[data-act="area.toggleEdit"]');

/* ---- skate cross ---- */
await d.click('.tab[data-act="tab:start"]'); await d.waitForTimeout(150);
await d.click('[data-act="discipline:skate"]'); await d.waitForTimeout(450);
log('SKATE', await d.evaluate(() => ({
  disc: window.__state.project.discipline,
  startRamp: document.querySelectorAll('.struct.startRamp').length,
  boxes: document.querySelectorAll('.startBox').length,
  firstObstacle: window.__state.analysis.obstacles[0] && window.__state.analysis.obstacles[0].label,
})));
await d.screenshot({ path: `${OUT}/09-desktop-skate.png` });
await d.click('[data-act="discipline:roller"]'); await d.waitForTimeout(350);

/* ---- undo/redo + zoom ---- */
await d.click('[data-act="undo"]'); await d.waitForTimeout(250);
await d.click('[data-act="redo"]'); await d.waitForTimeout(250);
await d.click('[data-act="view.zoomIn"]'); await d.click('[data-act="view.zoomIn"]'); await d.waitForTimeout(250);
await d.screenshot({ path: `${OUT}/10-desktop-zoom.png` });
await d.click('[data-act="view.fit"]');

/* ---- export PNG (verifica che non lanci) ---- */
const dl = d.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await d.click('.tab[data-act="tab:check"]'); await d.waitForTimeout(200);
await d.click('[data-act="exp.png"]');
const got = await dl;
log('EXPORT-PNG', got ? got.suggestedFilename() : 'nessun download');

/* ================================ MOBILE ================================ */
const m = await newPage({ ...devices['iPhone 13'] });
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForTimeout(600);
await m.evaluate(() => window.__editor && window.__editor());
await m.waitForTimeout(400);
await m.screenshot({ path: `${OUT}/20-mobile-start.png` });
await m.click('#panelToggle'); await m.waitForTimeout(400);
await m.screenshot({ path: `${OUT}/21-mobile-panel.png` });
await m.click('.tab[data-act="tab:structures"]'); await m.waitForTimeout(400);
await m.screenshot({ path: `${OUT}/22-mobile-structures.png` });
await m.click('.tab[data-act="tab:auto"]'); await m.waitForTimeout(300);
await m.screenshot({ path: `${OUT}/23-mobile-auto.png` });
log('MOBILE', await m.evaluate(() => ({
  w: innerWidth, h: innerHeight,
  panelOpen: document.querySelector('#panel').classList.contains('open'),
  overflowX: document.documentElement.scrollWidth > innerWidth,
  len: +window.__state.analysis.stats.totalLength.toFixed(1),
})));
/* pinch-zoom simulato con due dita */
await m.click('#panelToggle'); await m.waitForTimeout(300);
await m.touchscreen.tap(200, 300);
await m.waitForTimeout(200);
await m.screenshot({ path: `${OUT}/24-mobile-canvas.png` });

/* ---- tavola in scala ---- */
await d.click('.tab[data-act="tab:plate"]'); await d.waitForTimeout(900);
log('TAVOLA', await d.evaluate(() => ({
  anteprima: !!document.querySelector('.platePrev svg'),
  viewBox: (document.querySelector('.platePrev svg') || {}).getAttribute
    ? document.querySelector('.platePrev svg').getAttribute('viewBox') : null,
  scala: window.__state.project.plate.scale,
})));
await d.screenshot({ path: `${OUT}/11-desktop-tavola.png` });
const dls = [];
d.on('download', (x) => dls.push(x.suggestedFilename()));
await d.click('[data-act="plate.svg"]');
await d.waitForTimeout(2200);
log('TAVOLA-SVG', dls);
const [popup] = await Promise.all([
  d.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
  d.click('[data-act="plate.print"]'),
]);
if (popup) {
  await popup.waitForTimeout(1000);
  log('STAMPA', await popup.evaluate(() => ({
    fogli: document.querySelectorAll('.pg').length,
    mm: getComputedStyle(document.querySelector('.pg')).width,
  })));
  await popup.close();
} else log('STAMPA', 'popup bloccato');

console.log('\n--- ERRORI JS ---');
console.log(errors.length ? errors.join('\n') : 'nessuno');
await browser.close();
