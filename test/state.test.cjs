'use strict';
// SPEC 7 raw state, sanitize and URL hash (10.1 state.test.cjs row).
const test = require('node:test');
const assert = require('node:assert');
const state = require('../js/state.js');
const scenarios = require('../js/scenarios.js');

function b64url(str) { return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function hashOf(json) { return '#s=' + b64url(json); }

test('defaults and constants', () => {
  const d = state.defaults();
  assert.strictEqual(d.v, 1);
  assert.strictEqual(d.tab, 'plan');
  assert.strictEqual(d.plan.daily, '1000');
  assert.deepStrictEqual(d.readout.control, { n: '', x: '', mean: '', sd: '' });
  assert.notStrictEqual(state.defaults().plan, d.plan);
  assert.strictEqual(state.VERSION, '1.0.0');
  assert.strictEqual(state.CSP_META, true);
});

test('encode/decode round trip, including non-ASCII text', () => {
  const s = state.defaults();
  s.plan.name = 'Prueba ñ 测试';
  s.plan.hypothesis = 'line one\nline two';
  const h = state.encode(s);
  assert.ok(h.startsWith('#s='));
  assert.ok(!/[+/=]/.test(h.slice(3)));
  const r = state.decode(h);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state, s);
});

test('every decode error code', () => {
  assert.deepStrictEqual(state.decode(''), { ok: false, error: 'empty' });
  assert.deepStrictEqual(state.decode('#'), { ok: false, error: 'empty' });
  assert.deepStrictEqual(state.decode(undefined), { ok: false, error: 'empty' });
  assert.deepStrictEqual(state.decode('#x=abc'), { ok: false, error: 'format' });
  assert.deepStrictEqual(state.decode('#s=' + 'A'.repeat(63998)), { ok: false, error: 'too-long' });
  assert.strictEqual(('#s=' + 'A'.repeat(63998)).length, 64001);
  assert.deepStrictEqual(state.decode('#s=ab$c'), { ok: false, error: 'base64' });
  assert.deepStrictEqual(state.decode('#s=abcde'), { ok: false, error: 'base64' });
  assert.deepStrictEqual(state.decode('#s=' + Buffer.from([0xff, 0xfe, 0x41]).toString('base64url')), { ok: false, error: 'utf8' });
  assert.deepStrictEqual(state.decode(hashOf('{not json')), { ok: false, error: 'json' });
  assert.deepStrictEqual(state.decode(hashOf('[1]')), { ok: false, error: 'json' });
  assert.deepStrictEqual(state.decode(hashOf('{"v":2}')), { ok: false, error: 'version' });
  assert.deepStrictEqual(state.decode(hashOf('{}')), { ok: false, error: 'version' });
  assert.doesNotThrow(() => state.decode(12));
});

test('sanitize: truncation, bad enums and wrong types', () => {
  const s = state.sanitize({
    v: 1, tab: 'evil', plan: {
      name: 'n'.repeat(100), metricName: 'm'.repeat(90), type: 'poisson', direction: 'up', mdeType: 5, sides: 'three',
      mde: '1'.repeat(40), start: '2025-03-030', hypothesis: 'h'.repeat(700), notes: 42, extra: 'dropped'
    },
    readout: { looks: 7, through: '2025-03-16xx', control: { n: '9'.repeat(40), bogus: 'x' } },
    unknown: true
  });
  assert.strictEqual(s.tab, 'plan');
  assert.strictEqual(s.plan.name.length, 80);
  assert.strictEqual(s.plan.metricName.length, 80);
  assert.strictEqual(s.plan.type, 'binary');
  assert.strictEqual(s.plan.direction, 'increase');
  assert.strictEqual(s.plan.mdeType, 'relative');
  assert.strictEqual(s.plan.sides, 'two');
  assert.strictEqual(s.plan.mde.length, 32);
  assert.strictEqual(s.plan.start, '2025-03-03');
  assert.strictEqual(s.plan.hypothesis.length, 600);
  assert.strictEqual(s.plan.notes, '');
  assert.ok(!('extra' in s.plan));
  assert.ok(!('unknown' in s));
  assert.strictEqual(s.readout.looks, '1');
  assert.strictEqual(s.readout.through, '2025-03-16');
  assert.deepStrictEqual(s.readout.control, { n: '9'.repeat(32), x: '', mean: '', sd: '' });
  assert.deepStrictEqual(state.sanitize(null), state.defaults());
  assert.deepStrictEqual(state.sanitize([1, 2]), state.defaults());
});

test('sanitize: guardrail limits and ids', () => {
  const rows = [];
  for (let i = 1; i <= 12; i++) rows.push({ id: 'g' + i, name: 'G' + i, type: 'continuous', direction: 'increase', margin: '3' });
  const s = state.sanitize({ plan: { guardrails: rows } });
  assert.strictEqual(s.plan.guardrails.length, 10);
  assert.deepStrictEqual(s.plan.guardrails[0], { id: 'g1', name: 'G1', type: 'continuous', direction: 'increase', margin: '3' });
  const bad = state.sanitize({ plan: { guardrails: [
    { id: 'g2', name: 'A' }, { id: 'g2', name: 'B' }, { id: 'g0', name: 'C' }, { id: 'x1', name: 'D' },
    { id: 'g12345', name: 'E' }, { id: 7, name: 'F' }, { id: '__proto__', name: 'G' }, 'not an object'
  ] } });
  const ids = bad.plan.guardrails.map(g => g.id);
  assert.strictEqual(ids.length, 7);
  assert.strictEqual(ids[0], 'g2');
  assert.strictEqual(new Set(ids).size, ids.length);
  ids.forEach(id => assert.match(id, /^g[1-9][0-9]{0,3}$/));
  assert.deepStrictEqual(bad.plan.guardrails[1], { id: ids[1], name: 'B', type: 'binary', direction: 'decrease', margin: '5' });
});

test('sanitize: readout guardrails for unknown gids are dropped', () => {
  const s = state.sanitize({
    plan: { guardrails: [{ id: 'g1', name: 'A' }] },
    readout: { guardrails: { g1: { control: { n: '5' } }, g9: { control: { n: '1' } }, constructor: {} } }
  });
  assert.deepStrictEqual(Object.keys(s.readout.guardrails), ['g1']);
  assert.deepStrictEqual(s.readout.guardrails.g1, {
    control: { n: '5', x: '', mean: '', sd: '' }, treatment: { n: '', x: '', mean: '', sd: '' }
  });
  assert.strictEqual(Object.getPrototypeOf(s.readout.guardrails), Object.prototype);
});

test('sanitize: control characters stripped', () => {
  const s = state.sanitize({ plan: {
    name: 'a\nb\tc\u0007d\u007f', hypothesis: 'x\ny\r\u0000z', notes: 'n\n\u001fo',
    guardrails: [{ id: 'g1', name: 'G\nH' }]
  } });
  assert.strictEqual(s.plan.name, 'abcd');
  assert.strictEqual(s.plan.hypothesis, 'x\nyz');
  assert.strictEqual(s.plan.notes, 'n\no');
  assert.strictEqual(s.plan.guardrails[0].name, 'GH');
});

test('prototype pollution is impossible', () => {
  const json = '{"v":1,"__proto__":{"polluted":1},"plan":{"__proto__":{"polluted":2},"guardrails":[{"id":"g1","__proto__":{"polluted":3}}]},' +
    '"readout":{"__proto__":{"polluted":4},"guardrails":{"__proto__":{"polluted":5},"g1":{"__proto__":{"polluted":6}}}}}';
  const r = state.decode(hashOf(json));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(r.state.polluted, undefined);
  assert.strictEqual(r.state.plan.polluted, undefined);
  assert.strictEqual(r.state.readout.guardrails.polluted, undefined);
  assert.strictEqual(r.state.readout.guardrails.g1.polluted, undefined);
  state.sanitize(JSON.parse(json));
  assert.strictEqual(({}).polluted, undefined);
});

// Worst case: 10 guardrails and every string field at its maximum length, filled with `ch`.
function worstState(ch) {
  const fill = (n) => ch.repeat(n);
  const armFull = () => ({ n: fill(32), x: fill(32), mean: fill(32), sd: fill(32) });
  const s = state.defaults();
  Object.assign(s.plan, {
    name: fill(80), metricName: fill(80), baselineRate: fill(32), baselineMean: fill(32), baselineSd: fill(32),
    mde: fill(32), alpha: fill(32), power: fill(32), share: fill(32), daily: fill(32), start: fill(10),
    hypothesis: fill(600), notes: fill(600)
  });
  for (let i = 1; i <= 10; i++) {
    s.plan.guardrails.push({ id: 'g' + i, name: fill(60), type: 'continuous', direction: 'increase', margin: fill(32) });
    s.readout.guardrails['g' + i] = { control: armFull(), treatment: armFull() };
  }
  Object.assign(s.readout, { control: armFull(), treatment: armFull(), through: fill(10), looks: fill(32), srmThreshold: fill(32) });
  return s;
}

test('worst-case states fit in 64,000 characters and round-trip', () => {
  const sizes = {};
  for (const ch of ['\u6d4b', '"', '\ud800']) {
    const s = worstState(ch);
    assert.deepStrictEqual(state.sanitize(s), s);
    const h = state.encode(s);
    sizes[ch] = h.length;
    assert.ok(h.length <= 64000, 'length ' + h.length);
    const r = state.decode(h);
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(r.state, s);
  }
  assert.ok(sizes['\ud800'] > sizes['\u6d4b'] && sizes['\ud800'] > sizes['"']);
});

test('every scenario state survives encode -> decode -> sanitize unchanged', () => {
  for (const sc of scenarios.list) {
    const r = state.decode(state.encode(sc.state));
    assert.strictEqual(r.ok, true, sc.id);
    assert.deepStrictEqual(r.state, sc.state, sc.id);
    assert.deepStrictEqual(state.sanitize(r.state), sc.state, sc.id);
  }
});
