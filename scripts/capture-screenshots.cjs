'use strict';
// Screenshot capture (SPEC 10.4):
//   node scripts/capture-screenshots.cjs [--out docs] [--edge <path>] [--cdp-port 9393]
// Headless Edge via CDP, file:// mode (no server), viewport 1440x900, deviceScaleFactor 1, fresh profile.
// Before each shot the page's visible text is checked against the deny-list terms (including .denylist.local when
// present) and the OS user name; any hit refuses the shot and exits 1 without printing the term.
// A human must still look at every image before publishing (pixels can't be scanned).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const deny = require('./denylist.cjs');
const scenarios = require('../js/scenarios.js');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
const OUT = path.resolve(ROOT, arg('--out', 'docs'));
const CDP_PORT = Number(arg('--cdp-port', '9393'));
const MAX_HEIGHT = 2400;
const J = JSON.stringify;
const byId = B.byId;
const sleep = B.sleep;

if (typeof WebSocket !== 'function') { console.error('Node 22+ is required (global WebSocket).'); process.exit(2); }
if (!Number.isInteger(CDP_PORT) || CDP_PORT < 1024 || CDP_PORT > 65535 || CDP_PORT === 4317) {
  console.error('--cdp-port must be an integer from 1024 to 65535 and not 4317.');
  process.exit(2);
}

function matchers() {
  const terms = deny.loadTerms({ root: ROOT }).terms.slice();
  let user = '';
  try { user = os.userInfo().username || ''; } catch (e) { /* no user name available */ }
  if (user) terms.push(user);
  return deny.buildMatchers(terms);
}

async function open(d, url) {
  await d.goto('about:blank');
  await d.goto(url);
  const ready = await B.waitFor(() => d.evaluate('!!(window.ExperimentCheck && window.ExperimentCheck.uiStarted && ' +
    byId('ec-share-url') + ' && ' + byId('ec-share-url') + '.value)'), 10000);
  if (!ready) throw new Error('the app did not start');
}

async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(350); }

async function loadExample(d, id) {
  await d.evaluate('(() => { const s = ' + byId('ec-example-select') + '; s.value = ' + J(id) + '; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()');
  await click(d, 'ec-example-load');
  await sleep(400);
}

const selectedTab = (d) => d.evaluate('(() => { const t = document.querySelector("[role=tab][aria-selected=true]"); return t ? t.id : null; })()');

// captureBeyondViewport grows the viewport to the page height, which removes the vertical scrollbar and moves the
// centred layout sideways after the clip was measured. Hiding the scrollbar (screenshot session only) keeps the
// layout identical in both states.
// A constructed stylesheet (CSSOM), because the page's CSP correctly blocks injected <style> elements.
const HIDE_SCROLLBAR = '(() => { if (window.__ecShotSheet) return true; const s = new CSSStyleSheet();' +
  ' s.replaceSync("html { scrollbar-width: none; } ::-webkit-scrollbar { width: 0; height: 0; }");' +
  ' document.adoptedStyleSheets = document.adoptedStyleSheets.concat([s]); window.__ecShotSheet = s; return true; })()';

async function shot(d, M, file, elId) {
  await d.evaluate(HIDE_SCROLLBAR);
  await d.evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  const visibleText = await d.evaluate('document.body.innerText');
  if (deny.textHasHit(visibleText, M)) {
    throw Object.assign(new Error('REFUSED: the visible text for ' + file + ' contains a deny-list term or the user name.'), { refused: true });
  }
  const box = await d.evaluate('(() => { const el = ' + byId(elId) + '; if (!el) return null; const r = el.getBoundingClientRect();' +
    ' return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })()');
  if (!box || !box.width || !box.height) throw new Error('#' + elId + ' is not visible for ' + file);
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.min(MAX_HEIGHT, Math.ceil(box.height)) };
  const png = await d.screenshot({ clip, captureBeyondViewport: true });
  const hits = [];
  deny.scanPng(file, png, M, hits);
  if (hits.length) throw Object.assign(new Error('REFUSED: ' + hits[0]), { refused: true });
  fs.writeFileSync(path.join(OUT, file), png);
  console.log('Saved ' + path.relative(ROOT, path.join(OUT, file)).replace(/\\/g, '/') + ' (' + clip.width + 'x' + clip.height + ')');
}

async function main() {
  const exe = B.resolveExe('edge', arg('--edge', null));
  if (!exe) { console.error('Microsoft Edge was not found. Pass --edge <path> or set EDGE_PATH.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const M = matchers();
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const d = await B.openEdge(exe, { cdpPort: CDP_PORT });
  let code = 0;
  try {
    console.log('Browser: ' + d.version);
    await d.setViewport(1440, 900);

    // Guide, first visit: clear storage in the app's own origin, then load without a hash.
    await open(d, url);
    await d.evaluate('localStorage.clear()');
    await open(d, url);
    if ((await selectedTab(d)) !== 'ec-tab-guide') throw new Error('first visit did not open the Guide');
    await shot(d, M, 'screenshot-guide.png', 'ec-main');

    // Plan: P14 with the g1 guardrail (the clean-win plan), sensitivity table and chart.
    await click(d, 'ec-tab-plan');
    await loadExample(d, 'clean-win');
    await click(d, 'ec-tab-plan');
    const rows = await d.evaluate('document.querySelectorAll("#ec-sens-table tbody tr").length');
    if ((await selectedTab(d)) !== 'ec-tab-plan' || rows !== 7) throw new Error('the Plan tab did not render the sensitivity table');
    await shot(d, M, 'screenshot-plan.png', 'ec-main');

    // Readouts, one per scenario.
    for (const s of scenarios.list) {
      await loadExample(d, s.id);
      const ok = await B.waitFor(async () => (await d.evaluate(byId('ec-verdict') + '.getAttribute("data-verdict")')) === s.expected.verdict, 5000);
      if (!ok || (await selectedTab(d)) !== 'ec-tab-readout') throw new Error('scenario ' + s.id + ' did not render its verdict');
      await shot(d, M, 'screenshot-readout-' + s.id + '.png', 'ec-main');
    }

    // Memo preview for guardrail-breach.
    await loadExample(d, 'guardrail-breach');
    await d.evaluate(byId('ec-memo-preview') + '.scrollIntoView({ block: "start" })');
    await shot(d, M, 'screenshot-memo.png', 'ec-memo-preview');

    if (d.errors.length) { console.error('Page errors: ' + d.errors.length + '; first: ' + String(d.errors[0]).slice(0, 120)); code = 1; }
    else console.log('Done: 9 screenshots, visible-text scan clean. Look at every image before publishing.');
  } catch (e) {
    console.error(e.refused ? e.message : 'ERROR: ' + e.message);
    code = 1;
  } finally {
    await d.close();
  }
  process.exit(code);
}

main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
