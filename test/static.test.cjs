'use strict';
// SPEC 10.1 static.test.cjs row: markup, CSP, URL ban, banned APIs, ids and focus styles.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const state = require('../js/state.js');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function listDir(rel, ext) {
  return fs.readdirSync(path.join(ROOT, rel)).filter((n) => n.endsWith(ext)).map((n) => rel + '/' + n);
}

const html = read('index.html');
const css = read('css/app.css');
const jsFiles = listDir('js', '.js');
const cssFiles = listDir('css', '.css');

const SCRIPTS = ['stats', 'format', 'validate', 'plan', 'readout', 'memo', 'scenarios', 'state', 'ui'].map((n) => 'js/' + n + '.js');
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' file:; ' +
  'style-src \'self\' file:; img-src \'self\' data: file:; connect-src \'none\'; font-src \'none\'; object-src \'none\'; ' +
  'base-uri \'none\'; form-action \'none\'">';
const PRIVACY_CSP = 'No network requests (blocked by a Content Security Policy and checked by automated tests).';
const PRIVACY_NO_CSP = 'No network requests (the code makes none, which automated tests check).';
const NS_SVG = 'http' + '://www.w3.org/2000/svg';
const NS_XLINK = 'http' + '://www.w3.org/1999/xlink';

function tags(s) { return s.match(/<[^>]+>/g) || []; }

test('index.html loads exactly the 9 classic scripts in order, each deferred', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.deepStrictEqual(scripts.map((m) => (/\ssrc="([^"]+)"/.exec(m[1]) || [])[1]), SCRIPTS);
  for (const m of scripts) {
    assert.match(m[1], /\sdefer(\s|$)/, 'defer missing: ' + m[1]);
    assert.doesNotMatch(m[1], /type\s*=\s*"?module/i);
    assert.strictEqual(m[2].trim(), '', 'inline script body');
  }
  assert.doesNotMatch(html, /type\s*=\s*["']?module/i);
});

test('no on* attributes, style attributes or style elements in index.html', () => {
  for (const t of tags(html)) {
    assert.doesNotMatch(t, /\son[a-z]+\s*=/i, 'on* attribute: ' + t);
    assert.doesNotMatch(t, /\sstyle\s*=/i, 'style attribute: ' + t);
  }
  assert.doesNotMatch(html, /<style\b/i);
});

test('no http(s) URLs in index.html, css/ or js/ (XML namespace identifiers excepted)', () => {
  for (const rel of ['index.html'].concat(cssFiles, jsFiles)) {
    const text = read(rel).split(NS_SVG).join('').split(NS_XLINK).join('');
    assert.doesNotMatch(text, /https?:/i, 'URL in ' + rel);
  }
});

test('js/ui.js defines the SVG namespace exactly once and uses the string nowhere else', () => {
  const ui = read('js/ui.js');
  const decl = 'var SVG_NS = \'' + NS_SVG + '\';';
  assert.strictEqual(ui.split(decl).length - 1, 1);
  assert.strictEqual(ui.split(NS_SVG).length - 1, 1);
});

test('js/ contains no banned APIs', () => {
  const banned = ['fe' + 'tch(', 'XMLHttp' + 'Request', 'Web' + 'Socket', 'Event' + 'Source', 'send' + 'Beacon', 'imp' + 'ort(',
    'inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document.' + 'write'];
  for (const rel of jsFiles) {
    const text = read(rel);
    for (const b of banned) assert.ok(!text.includes(b), b + ' in ' + rel);
    assert.doesNotMatch(text, /^\s*(import|export)\s/m, 'import/export statement in ' + rel);
  }
});

test('every id starts with ec- and is unique; every for= points to an existing id', () => {
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 50);
  for (const id of ids) assert.ok(id.startsWith('ec-'), 'id without ec- prefix: ' + id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dup, []);
  const fors = [...html.matchAll(/\sfor="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(fors.length > 20);
  for (const f of fors) assert.ok(ids.includes(f), 'for= target missing: ' + f);
});

test('CSP meta tag matches state.CSP_META', () => {
  if (state.CSP_META) {
    assert.ok(html.includes(CSP), 'CSP meta tag differs from SPEC 2.3');
    const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1];
    const first = tags(head).slice(0, 2);
    assert.strictEqual(first[0], '<meta charset="utf-8">');
    assert.strictEqual(first[1], CSP);
  } else {
    assert.doesNotMatch(html, /Content-Security-Policy/i);
  }
});

test('the Guide privacy sentence matches state.CSP_META', () => {
  const want = state.CSP_META ? PRIVACY_CSP : PRIVACY_NO_CSP;
  const other = state.CSP_META ? PRIVACY_NO_CSP : PRIVACY_CSP;
  assert.ok(html.includes(want));
  assert.ok(!html.includes(other));
});

test('css/app.css has the focus-visible rule and never removes outlines', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid #1d4ed8/);
  assert.doesNotMatch(css, /outline:\s*none/i);
  assert.doesNotMatch(css, /outline:\s*0/i);
});
