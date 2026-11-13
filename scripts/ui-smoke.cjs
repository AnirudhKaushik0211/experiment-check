'use strict';
// Browser smoke test (SPEC 10.3): scenarios S01-S17 in headless Edge (CDP) and Firefox (WebDriver BiDi),
// in file:// mode (double-click equivalent) and http mode (scripts/serve.cjs on 127.0.0.1).
// Usage: node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4391]
//                                  [--cdp-port 9391] [--bidi-port 9392] [--edge <path>] [--firefox <path>] [--keep]
// Exit codes: 0 = all passed in every browser that ran; 1 = a failure; 2 = no browser could run or invalid arguments.
// Only processes started here are ever stopped (taskkill /PID <pid> /T /F). Port 4317 is refused.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
const BROWSER = String(arg('--browser', 'all')).toLowerCase();
const MODE = String(arg('--mode', 'all')).toLowerCase();
const PORT = Number(arg('--port', '4391'));
const CDP_PORT = Number(arg('--cdp-port', '9391'));
const BIDI_PORT = Number(arg('--bidi-port', '9392'));
const KEEP = argv.includes('--keep');
const sleep = B.sleep;

function usage(msg) { console.error(msg); process.exit(2); }
if (typeof WebSocket !== 'function') usage('Node 22+ is required (global WebSocket).');
if (!['edge', 'firefox', 'all'].includes(BROWSER)) usage('--browser must be edge, firefox or all.');
if (!['file', 'http', 'all'].includes(MODE)) usage('--mode must be file, http or all.');
for (const [name, p] of [['--port', PORT], ['--cdp-port', CDP_PORT], ['--bidi-port', BIDI_PORT]]) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) usage(name + ' must be a port number.');
  if (p === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
}

const BROWSERS = BROWSER === 'all' ? ['edge', 'firefox'] : [BROWSER];
const MODES = MODE === 'all' ? ['file', 'http'] : [MODE];
const ORIGIN = 'http://127.0.0.1:' + PORT;
const SCENARIOS_DATA = require('../js/scenarios.js').list;
const CSP_META_NODE = require('../js/state.js').CSP_META;

const children = [];
const results = [];

// ---------------------------------------------------------------- test-only page hooks (SPEC 10.3 "Preload")
const HOOK = `(function () {
  if (window.__smokeHooked) return;
  window.__smokeHooked = true;
  window.__smokeBlobs = []; window.__smokeDownloads = []; window.__smokePrints = 0; window.__smokeCsp = 0;
  var orig = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var url = orig.apply(URL, arguments);
    try {
      if (obj && typeof obj.text === 'function') {
        var rec = { type: obj.type, size: obj.size, text: null };
        window.__smokeBlobs.push(rec);
        obj.text().then(function (t) { rec.text = t; });
      }
    } catch (e) { /* ignore */ }
    return url;
  };
  window.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a) { window.__smokeDownloads.push(a.download); e.preventDefault(); }
  }, true);
  window.print = function () { window.__smokePrints += 1; };
  window.addEventListener('securitypolicyviolation', function () { window.__smokeCsp += 1; }, true);
})();`;

// S03 only: window.localStorage throws a SecurityError on access.
const BLOCK_STORAGE = `(function () {
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  } catch (e) { /* ignore */ }
})();`;

// ---------------------------------------------------------------- helpers
function fail(msg) { throw new Error(msg); }
function check(cond, msg) { if (!cond) fail(msg); }
const J = JSON.stringify;
const byId = B.byId;

function baseUrl(mode) { return mode === 'file' ? pathToFileURL(path.join(ROOT, 'index.html')).href : ORIGIN + '/index.html'; }

const PAGE = `(() => {
  const g = (id) => document.getElementById(id);
  const sel = document.querySelector('[role=tab][aria-selected=true]');
  const li = document.querySelector('#ec-verdict-reasons li');
  const vis = (id) => { const el = g(id); return !!el && el.getClientRects().length > 0; };
  return {
    tab: sel ? sel.id : null,
    guideHidden: g('ec-panel-guide').hidden, planHidden: g('ec-panel-plan').hidden, readoutHidden: g('ec-panel-readout').hidden,
    guideVisible: vis('ec-panel-guide'),
    status: g('ec-status-msg').textContent,
    verdict: g('ec-verdict').getAttribute('data-verdict'),
    firstReason: li ? li.getAttribute('data-reason') : null,
    undo: vis('ec-undo'), banner: vis('ec-newhere'),
    active: document.activeElement ? document.activeElement.id : null,
    flag: (function () { try { return localStorage.getItem('experimentcheck.helpSeen.v1'); } catch (e) { return 'blocked'; } })()
  };
})()`;
const page = (d) => d.evaluate(PAGE);
const text = (d, id) => d.evaluate('(' + byId(id) + ' || {}).textContent');
const value = (d, id) => d.evaluate('(' + byId(id) + ' || {}).value');
const visible = (d, id) => d.evaluate('(() => { const el = ' + byId(id) + '; return !!el && el.getClientRects().length > 0; })()');

async function harvestCsp(d) {
  try { const n = await d.evaluate('typeof window.__smokeCsp === "number" ? window.__smokeCsp : 0'); d.cspTotal += Number(n) || 0; } catch (e) { /* no page */ }
}

async function open(d, url) {
  await harvestCsp(d);
  await d.goto('about:blank');
  await d.goto(url);
  const ready = await B.waitFor(() => d.evaluate('!!(window.ExperimentCheck && window.ExperimentCheck.uiStarted && ' +
    byId('ec-share-url') + ' && ' + byId('ec-share-url') + '.value)'), 10000);
  check(ready, 'the app did not start at ' + url.replace(/#.*/, '#...'));
}

// Clears localStorage in the app's own origin (SPEC 10.3 preamble). Returns 'ok' or the problem.
async function clearStorage(d, mode) {
  await open(d, baseUrl(mode));
  return d.evaluate('(() => { try { localStorage.clear(); return localStorage.length === 0 ? "ok" : "length " + localStorage.length; } catch (e) { return "threw " + e.name; } })()');
}

function setValues(values) {
  return `(() => {
    const v = ${J(values)};
    for (const id of Object.keys(v)) {
      const el = document.getElementById(id);
      if (!el) throw new Error('missing ' + id);
      if (el.type === 'radio' || el.type === 'checkbox') { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else { el.value = v[id]; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    return true;
  })()`;
}
async function setInputs(d, values) { await d.evaluate(setValues(values)); await sleep(450); }

const P14 = {
  'ec-plan-type-binary': true, 'ec-plan-dir-increase': true, 'ec-plan-baseline-rate': '10', 'ec-plan-mde-type-relative': true,
  'ec-plan-mde': '10', 'ec-plan-alpha': '5', 'ec-plan-power': '80', 'ec-plan-sides-two': true, 'ec-plan-share': '50',
  'ec-plan-daily': '2200', 'ec-plan-start': '2025-03-03'
};

// Waits past the app's 150 ms recompute debounce, so the next click hits a settled layout.
async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(300); }

async function loadExample(d, id) {
  await d.evaluate('(() => { const s = ' + byId('ec-example-select') + '; s.value = ' + J(id) + '; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()');
  await click(d, 'ec-example-load');
  await sleep(250);
}

async function waitStatus(d, accepted, ms) {
  return B.waitFor(async () => { const s = await text(d, 'ec-status-msg'); return accepted.includes(s) ? s : null; }, ms || 5000, 100);
}

const MSG_COPIED = 'Copied to the clipboard.';
const MSG_COPY_FAIL = 'Copy did not work in this browser. The text is selected; press Ctrl+C (Cmd+C on a Mac).';
const MSG_BAD_START = 'This link could not be read, so the defaults were loaded.';

// ---------------------------------------------------------------- scenarios
const SCENARIOS = [
  { id: 'S01', name: 'first visit', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    await open(d, baseUrl(mode));
    const p = await page(d);
    check(p.tab === 'ec-tab-guide', 'selected tab ' + p.tab);
    check(p.guideVisible && !p.guideHidden, 'Guide panel not visible');
    check(p.planHidden && p.readoutHidden, 'other panels not hidden');
    check(await d.evaluate(byId('ec-tab-guide') + '.getAttribute("aria-selected")') === 'true', 'aria-selected');
    ctx.noErrors();
  } },
  { id: 'S02', name: 'help seen persists', fn: async (d, mode) => {
    await click(d, 'ec-guide-start');
    let p = await page(d);
    check(p.tab === 'ec-tab-plan', 'after Start planning: ' + p.tab);
    await open(d, baseUrl(mode));
    p = await page(d);
    check(p.tab === 'ec-tab-plan', 'after reload: ' + p.tab);
    check(p.flag === '1', 'flag = ' + p.flag);
  } },
  { id: 'S03', name: 'storage blocked', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    const h = await d.addPreload(BLOCK_STORAGE);
    try {
      await open(d, baseUrl(mode));
      const blocked = await d.evaluate('(() => { try { void window.localStorage; return false; } catch (e) { return e.name; } })()');
      check(blocked === 'SecurityError', 'storage was not blocked: ' + blocked);
      let p = await page(d);
      check(p.tab === 'ec-tab-guide', 'selected tab ' + p.tab);
      await click(d, 'ec-tab-plan');
      await sleep(300);
      p = await page(d);
      check(p.tab === 'ec-tab-plan', 'Plan not selected: ' + p.tab);
      const n = await text(d, 'ec-out-n-control');
      check(/^\d[\d,]*$/.test(n), 'plan figures did not render: ' + J(n));
      ctx.noErrors();
    } finally {
      await d.removePreload(h);
    }
  } },
  { id: 'S04', name: 'plan figures', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await click(d, 'ec-tab-plan');
    await setInputs(d, P14);
    const got = { c: await text(d, 'ec-out-n-control'), t: await text(d, 'ec-out-n-total'), r: await text(d, 'ec-out-days-rec'), e: await text(d, 'ec-out-end') };
    check(got.c === '14,751', 'n control ' + got.c);
    check(got.t === '29,502', 'n total ' + got.t);
    check(got.r.startsWith('14 days'), 'recommended ' + got.r);
    check(got.e === '2025-03-16', 'end ' + got.e);
  } },
  { id: 'S05', name: 'validation', fn: async (d) => {
    await setInputs(d, { 'ec-plan-baseline-rate': '0' });
    const bad = await d.evaluate(`(() => {
      const err = document.getElementById('ec-plan-baseline-rate-err');
      return { errVisible: !err.hidden && err.getClientRects().length > 0, msg: err.textContent,
        invalid: document.getElementById('ec-plan-baseline-rate').getAttribute('aria-invalid'),
        outputHidden: document.getElementById('ec-plan-output').hidden,
        boxVisible: !document.getElementById('ec-plan-summary-errors').hidden,
        items: document.querySelectorAll('#ec-plan-summary-list li').length,
        title: document.getElementById('ec-plan-summary-title').textContent };
    })()`);
    check(bad.errVisible, 'error not visible');
    check(bad.msg === 'The baseline rate must be above 0% and below 100%.', 'message ' + J(bad.msg));
    check(bad.invalid === 'true', 'aria-invalid ' + bad.invalid);
    check(bad.outputHidden, 'results not hidden');
    check(bad.boxVisible && bad.items === 1, 'summary box items ' + bad.items);
    check(bad.title === 'Fix 1 field(s) to see the plan.', 'summary title ' + J(bad.title));
    await setInputs(d, { 'ec-plan-baseline-rate': '10' });
    const good = await d.evaluate(`(() => ({
      errHidden: document.getElementById('ec-plan-baseline-rate-err').hidden,
      invalid: document.getElementById('ec-plan-baseline-rate').getAttribute('aria-invalid'),
      outputHidden: document.getElementById('ec-plan-output').hidden,
      boxHidden: document.getElementById('ec-plan-summary-errors').hidden,
      jumpHidden: document.getElementById('ec-plan-errors-jump').hidden }))()`);
    check(good.errHidden && good.invalid === null && !good.outputHidden && good.boxHidden && good.jumpHidden, 'not cleared: ' + J(good));
  } },
  { id: 'S06', name: 'sensitivity', fn: async (d) => {
    const s = await d.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#ec-sens-table tbody tr')];
      const plan = rows.filter((r) => r.classList.contains('ec-row-plan'));
      const svg = document.getElementById('ec-sens-chart');
      const pl = svg.querySelector('polyline');
      return { rows: rows.length, plan: plan.length, planText: plan.length ? plan[0].textContent : '',
        points: pl ? pl.getAttribute('points').trim().split(/\\s+/).length : 0,
        role: svg.getAttribute('role'), title: !!svg.querySelector('title'), desc: (document.getElementById('ec-sens-desc') || {}).textContent };
    })()`);
    check(s.rows === 7, 'rows ' + s.rows);
    check(s.plan === 1 && s.planText.includes('(plan)'), 'plan row ' + J(s.planText));
    check(s.points === 7, 'polyline points ' + s.points);
    check(s.role === 'img' && s.title, 'svg role/title');
    check(/^At 1 week the test can detect [\d.]+% relative; at 12 weeks, [\d.]+% relative\.$/.test(s.desc), 'desc ' + J(s.desc));
  } },
  { id: 'S07', name: 'guardrails', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await click(d, 'ec-tab-plan');
    const rows = () => d.evaluate('[...document.querySelectorAll("#ec-plan-guardrails .ec-gr-row")].map((r) => r.getAttribute("data-gid"))');
    const active = () => d.evaluate('document.activeElement ? document.activeElement.id : null');
    for (let i = 1; i <= 3; i++) {
      await click(d, 'ec-plan-guardrail-add');
      const a = await active();
      check(a === 'ec-gr-g' + i + '-name', 'focus after add ' + i + ': ' + a);
    }
    check(J(await rows()) === J(['g1', 'g2', 'g3']), 'rows ' + J(await rows()));
    await click(d, 'ec-gr-g2-remove');
    check(await active() === 'ec-plan-guardrail-add', 'focus after remove: ' + (await active()));
    check(J(await rows()) === J(['g1', 'g3']), 'rows after remove ' + J(await rows()));
    await click(d, 'ec-plan-guardrail-add');
    check(await active() === 'ec-gr-g4-name', 'focus after re-add: ' + (await active()));
    check(J(await rows()) === J(['g1', 'g3', 'g4']), 'ids ' + J(await rows()));
    for (let i = 0; i < 7; i++) await click(d, 'ec-plan-guardrail-add');
    const n = (await rows()).length;
    check(n === 10, 'rows at the limit: ' + n);
    check(await d.evaluate(byId('ec-plan-guardrail-add') + '.disabled') === true, 'add button not disabled at 10');
    await sleep(200);
    const dups = await d.evaluate(DUP_IDS);
    check(dups.length === 0, 'duplicate ids ' + dups.join(','));
  } },
  { id: 'S08', name: 'pre-registration export', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await click(d, 'ec-tab-plan');
    await setInputs(d, Object.assign({ 'ec-plan-name': 'Smoke Plan: Alpha' }, P14));
    const md = await value(d, 'ec-prereg-md');
    check(md.includes('## Decision rule') && md.includes('14,751'), 'prereg markdown incomplete');
    await click(d, 'ec-prereg-download');
    const dl = await B.waitFor(() => d.evaluate('window.__smokeDownloads.length && window.__smokeBlobs.length ? { names: window.__smokeDownloads, type: window.__smokeBlobs[0].type } : null'), 3000);
    check(dl, 'no download recorded');
    check(dl.type.startsWith('text/markdown'), 'blob type ' + dl.type);
    check(J(dl.names) === J(['prereg-smoke-plan-alpha.md']), 'download names ' + J(dl.names));
    await click(d, 'ec-prereg-copy');
    const s = await waitStatus(d, [MSG_COPIED, MSG_COPY_FAIL], 6000);
    check(s, 'no copy status: ' + J(await text(d, 'ec-status-msg')));
  } },
  { id: 'S09', name: 'examples', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    for (const sc of SCENARIOS_DATA) {
      const prev = (await page(d)).verdict;
      await loadExample(d, sc.id);
      const p = await page(d);
      check(p.tab === 'ec-tab-readout', sc.id + ': tab ' + p.tab);
      check(p.verdict === sc.expected.verdict, sc.id + ': verdict ' + p.verdict);
      check(p.firstReason === sc.expected.decisive, sc.id + ': first reason ' + p.firstReason);
      check(p.undo, sc.id + ': undo not visible');
      await click(d, 'ec-undo');
      await sleep(150);
      const after = await page(d);
      check(after.verdict === prev, sc.id + ': undo gave ' + after.verdict + ', expected ' + prev);
      check(!after.undo, sc.id + ': undo still visible');
    }
  } },
  { id: 'S10', name: 'memo export', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await loadExample(d, 'guardrail-breach');
    const md = await value(d, 'ec-memo-md');
    check(md.includes("**Verdict: Don't ship.**"), 'memo verdict line missing');
    check(md.includes('| Guardrail: Refund rate | FAIL |'), 'memo guardrail row missing');
    await click(d, 'ec-memo-download');
    const names = await B.waitFor(() => d.evaluate('window.__smokeDownloads.length ? window.__smokeDownloads : null'), 3000);
    check(names && names.includes('decision-memo-express-checkout-button.md'), 'download names ' + J(names));
    const before = await d.evaluate('window.__smokePrints');
    await click(d, 'ec-memo-print');
    const after = await d.evaluate('window.__smokePrints');
    check(after === before + 1, 'prints ' + before + ' -> ' + after);
    if (d.emulateMedia) {
      await d.emulateMedia('print');
      try {
        const pr = await d.evaluate(`(() => {
          const p = document.getElementById('ec-memo-preview'), h = document.getElementById('ec-header');
          return { preview: p.getClientRects().length > 0 && getComputedStyle(p).display !== 'none' && p.textContent.length > 0,
            header: h.getClientRects().length > 0 && getComputedStyle(h).display !== 'none' };
        })()`);
        check(pr.preview, 'memo preview not visible in print media');
        check(!pr.header, 'header visible in print media');
      } finally {
        await d.emulateMedia('');
      }
    }
  } },
  { id: 'S11', name: 'hash restore', fn: async (d, mode) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'pre-S11 localStorage.clear() did not succeed: ' + c);
    await open(d, baseUrl(mode));
    await loadExample(d, 'peeking');
    await sleep(700);
    const href = await d.evaluate('location.href');
    check(/#s=[A-Za-z0-9_-]+$/.test(href), 'no state hash in the URL');
    await harvestCsp(d);
    await d.goto('about:blank');
    await open(d, href);
    const p = await page(d);
    check(p.tab === 'ec-tab-readout', 'tab ' + p.tab);
    check(p.verdict === 'inconclusive', 'verdict ' + p.verdict);
    const looks = await value(d, 'ec-ro-looks');
    check(looks === '3', 'looks ' + J(looks));
    check(p.banner === (p.flag !== '1'), 'banner ' + p.banner + ' with help flag ' + J(p.flag));
  } },
  { id: 'S12', name: 'bad hash', fn: async (d, mode, ctx) => {
    await open(d, baseUrl(mode) + '#s=not-valid!');
    const p = await page(d);
    check(p.tab === 'ec-tab-plan', 'tab ' + p.tab);
    check(p.status === MSG_BAD_START, 'status ' + J(p.status));
    const vals = { daily: await value(d, 'ec-plan-daily'), rate: await value(d, 'ec-plan-baseline-rate'), mde: await value(d, 'ec-plan-mde') };
    check(vals.daily === '1000' && vals.rate === '10' && vals.mde === '10', 'defaults not loaded ' + J(vals));
    ctx.noErrors();
  } },
  { id: 'S13', name: 'keyboard', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await click(d, 'ec-title');
    await d.evaluate(byId('ec-tab-guide') + '.focus()');
    const state = () => d.evaluate('(() => { const a = document.activeElement; const sel = document.querySelector("[role=tab][aria-selected=true]"); return { active: a ? a.id : null, selected: sel ? sel.id : null, inGuide: !!(a && document.getElementById("ec-panel-guide").contains(a)) }; })()');
    await d.press('ArrowRight');
    let s = await state();
    check(s.active === 'ec-tab-plan' && s.selected === 'ec-tab-plan', 'ArrowRight ' + J(s));
    await d.press('End');
    s = await state();
    check(s.active === 'ec-tab-readout' && s.selected === 'ec-tab-readout', 'End ' + J(s));
    await d.press('Home');
    s = await state();
    check(s.active === 'ec-tab-guide' && s.selected === 'ec-tab-guide', 'Home ' + J(s));
    await d.press('Tab');
    s = await state();
    check(s.inGuide, 'Tab did not move into the Guide panel: ' + J(s));
  } },
  { id: 'S14', name: 'responsive', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await loadExample(d, 'clean-win');
    await d.setViewport(375, 800);
    try {
      await sleep(300);
      const fits = () => d.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })');
      let r = await fits();
      check(r.iw <= 400, 'viewport not applied: innerWidth ' + r.iw);
      check(r.sw <= r.iw + 1, 'Readout overflows: scrollWidth ' + r.sw + ' > ' + r.iw);
      await click(d, 'ec-tab-plan');
      await sleep(200);
      r = await fits();
      check(r.sw <= r.iw + 1, 'Plan overflows: scrollWidth ' + r.sw + ' > ' + r.iw);
    } finally {
      await d.setViewport(1400, 1000);
    }
  } },
  { id: 'S15', name: 'accessibility basics', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await loadExample(d, 'clean-win');
    const a = await d.evaluate(`(() => {
      const unlabelled = [];
      for (const el of document.querySelectorAll('input, select, textarea')) {
        const named = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label') ||
          el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        if (!named) unlabelled.push(el.id || el.name || el.tagName);
      }
      const panels = [...document.querySelectorAll('[role=tabpanel]')].filter((p) => {
        const ref = p.getAttribute('aria-labelledby'); const t = ref && document.getElementById(ref);
        return !(t && t.textContent.trim()) && !p.getAttribute('aria-label');
      }).map((p) => p.id);
      return { unlabelled, panels, lang: document.documentElement.getAttribute('lang'), h1: document.querySelectorAll('h1').length };
    })()`);
    check(a.unlabelled.length === 0, 'unlabelled controls ' + a.unlabelled.join(','));
    check(a.panels.length === 0, 'panels without a name ' + a.panels.join(','));
    check(a.lang === 'en', 'lang ' + a.lang);
    check(a.h1 === 1, 'h1 count ' + a.h1);
    const dups = await d.evaluate(DUP_IDS);
    check(dups.length === 0, 'duplicate ids ' + dups.join(','));

    const CONTROLS = 'button, input, select, textarea';
    const FOCUS = `(() => { const el = document.activeElement; if (!el) return null; const cs = getComputedStyle(el);
      const p = el.closest('[role=tabpanel]');
      const key = el.id || (p ? 'idx' + [...p.querySelectorAll('${CONTROLS}')].indexOf(el) : el.tagName);
      return { id: el.id || '', key, tag: el.tagName.toLowerCase(), type: el.type || '', style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0,
        panel: p ? p.id : null }; })()`;
    const problems = [];
    const look = async (expect) => {
      const fx = await d.evaluate(FOCUS);
      if (!fx) { problems.push('no focus'); return null; }
      if (fx.style === 'none' || fx.width < 2) problems.push((fx.id || fx.tag) + ' outline ' + fx.style + ' ' + fx.width);
      if (expect && fx.id !== expect) problems.push('expected focus on ' + expect + ', got ' + (fx.id || fx.tag));
      return fx;
    };
    // Tab buttons, reached with real arrow keys (keyboard focus matches :focus-visible).
    // Precondition: the document must have focus, or no :focus rule can match in any browser (harness state, not the app).
    check(await d.evaluate('document.hasFocus()'), 'the browser window has no focus (document.hasFocus() false)');
    await click(d, 'ec-title');
    await d.evaluate(byId('ec-tab-readout') + '.focus()');
    await d.press('ArrowRight'); await look('ec-tab-guide');
    await d.press('ArrowRight'); await look('ec-tab-plan');
    await d.press('ArrowRight'); await look('ec-tab-readout');
    // Visible = rendered and not inside a closed <details> (checkVisibility covers content-visibility).
    const VISIBLE = (panel) => `(() => [...document.getElementById('${panel}').querySelectorAll('${CONTROLS}')]
      .map((el, i) => ({ el, key: el.id || 'idx' + i }))
      .filter(({ el }) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0) &&
        !el.disabled && el.tabIndex >= 0 && !(el.type === 'radio' && !el.checked))
      .map(({ key }) => key))()`;
    for (const t of ['plan', 'readout']) {
      const panel = 'ec-panel-' + t;
      await d.evaluate(byId(t === 'plan' ? 'ec-tab-guide' : 'ec-tab-plan') + '.focus()');
      await d.press('ArrowRight');
      await look('ec-tab-' + t);
      const want = await d.evaluate(VISIBLE(panel));
      const reached = new Set();
      for (let i = 0; i < 300; i++) {
        await d.press('Tab');
        const fx = await d.evaluate(FOCUS);
        if (!fx || fx.panel !== panel) break;
        if (fx.style === 'none' || fx.width < 2) problems.push((fx.id || fx.tag) + ' outline ' + fx.style + ' ' + fx.width);
        reached.add(fx.key);
      }
      const missed = want.filter((id) => !reached.has(id));
      if (missed.length) problems.push(t + ': not reached by Tab: ' + missed.join(','));
      if (reached.size < 5) problems.push(t + ': only ' + reached.size + ' elements reached');
    }
    check(problems.length === 0, problems.slice(0, 8).join('; '));
  } },
  { id: 'S16', name: 'no network, no CSP violations', fn: async (d, mode, ctx) => {
    await harvestCsp(d);
    const allowed = mode === 'file' ? (u) => u.startsWith('file:') : (u) => u.startsWith(ORIGIN + '/');
    const bad = d.requests.slice(ctx.requestStart).filter((u) => !/\/favicon\.ico(\?|$)/.test(u) && u !== 'about:blank' && !allowed(u));
    check(bad.length === 0, 'unexpected requests: ' + bad.slice(0, 5).map((u) => u.slice(0, 80)).join(', '));
    // Sanity check that the recorder works. Firefox's BiDi network module reports no file:// loads, so file mode is exempt.
    if (mode === 'http') check(d.requests.length > ctx.requestStart, 'no requests recorded');
    const cspMeta = await d.evaluate('window.ExperimentCheck && window.ExperimentCheck.state ? window.ExperimentCheck.state.CSP_META : null');
    check(cspMeta === CSP_META_NODE, 'CSP_META in page ' + cspMeta);
    if (cspMeta) check(d.cspTotal === ctx.cspStart, 'securitypolicyviolation events: ' + (d.cspTotal - ctx.cspStart));
  } }
];

const DUP_IDS = '(() => { const seen = Object.create(null), dup = []; for (const el of document.querySelectorAll("[id]")) { if (seen[el.id]) dup.push(el.id); seen[el.id] = 1; } return dup; })()';

// ---------------------------------------------------------------- runner
function report(browser, mode, id, name, ok, detail) {
  results.push({ browser, mode, id, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + browser + ' ' + mode + ' ' + id + ' ' + name + (ok ? '' : ' - ' + detail));
}

async function runMode(d, mode) {
  const ctx = { requestStart: d.requests.length, cspStart: d.cspTotal };
  const s17 = [];
  for (const sc of SCENARIOS) {
    const errStart = d.errors.length;
    ctx.noErrors = () => { const e = d.errors.slice(errStart); check(e.length === 0, 'errors: ' + e.slice(0, 3).join(' | ')); };
    let ok = true, detail = '';
    try {
      await sc.fn(d, mode, ctx);
    } catch (e) { ok = false; detail = String(e && e.message || e).split('\n')[0]; }
    await sleep(100);
    const errs = d.errors.slice(errStart);
    let dups = [];
    try { dups = await d.evaluate(DUP_IDS); } catch (e) { /* page gone */ }
    if (errs.length) s17.push(sc.id + ' errors: ' + errs.slice(0, 3).join(' | '));
    if (dups && dups.length) s17.push(sc.id + ' duplicate ids: ' + dups.join(','));
    report(d.name, mode, sc.id, sc.name, ok, detail);
  }
  report(d.name, mode, 'S17', 'no errors', s17.length === 0, s17.join('; '));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const probe = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      reject(new Error('port ' + PORT + ' is already in use; choose another --port'));
    });
    probe.on('timeout', () => probe.destroy(new Error('timeout')));
    probe.on('error', () => {
      const proc = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), '--port', String(PORT), '--root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(proc);
      let out = '';
      proc.stdout.on('data', (c) => { out += c; });
      proc.stderr.on('data', (c) => { out += c; });
      B.waitFor(() => new Promise((ok) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (res) => { res.resume(); ok(res.statusCode === 200); });
        r.on('error', () => ok(false));
        r.on('timeout', () => { r.destroy(); ok(false); });
      }), 8000, 200).then((up) => (up ? resolve(proc) : reject(new Error('serve.cjs did not start: ' + out.slice(-200)))));
    });
  });
}

function cleanup() { for (const p of children) B.killTree(p); }

async function main() {
  const watchdog = setTimeout(() => { console.error('Smoke test timed out after 20 minutes.'); cleanup(); process.exit(1); }, 20 * 60 * 1000);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  if (MODES.includes('http')) {
    try { await startServer(); } catch (e) { console.error('Cannot run http mode: ' + e.message); cleanup(); process.exit(2); }
  }
  let ran = 0;
  for (const name of BROWSERS) {
    const exe = B.resolveExe(name, arg('--' + name));
    if (!exe) { console.log('SKIP ' + name + ': executable not found'); continue; }
    let d;
    try {
      d = name === 'edge' ? await B.openEdge(exe, { cdpPort: CDP_PORT, keep: KEEP }) : await B.openFirefox(exe, { bidiPort: BIDI_PORT, keep: KEEP });
    } catch (e) {
      console.log('SKIP ' + name + ': could not start (' + String(e.message).split('\n')[0] + ')');
      continue;
    }
    children.push(d.proc);
    ran++;
    d.cspTotal = 0;
    console.log('# ' + name + ': ' + (d.version || d.label));
    try {
      await d.addPreload(HOOK); // registered once per browser, never removed
      for (const mode of MODES) await runMode(d, mode);
    } catch (e) {
      report(name, '-', 'S00', 'driver', false, String(e.message).split('\n')[0]);
    } finally {
      try { await d.close(); } catch (e) { /* killed in cleanup */ }
    }
  }
  cleanup();
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('Summary: ' + results.length + ' checks, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed; browsers run: ' + ran + '.');
  if (ran === 0) { console.log('No browser could run.'); process.exit(2); }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); cleanup(); process.exit(1); });
