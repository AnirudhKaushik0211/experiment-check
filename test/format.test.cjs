'use strict';
// SPEC 6.11 formatting rules of js/format.js.
const test = require('node:test');
const assert = require('node:assert');
const f = require('../js/format.js');

test('6.11 examples', () => {
  assert.strictEqual(f.int(15400), '15,400');
  assert.strictEqual(f.pct(0.1), '10.00%');
  assert.strictEqual(f.spct(0.1404421), '+14.04%');
  assert.strictEqual(f.pp(0.014044), '+1.40 pp');
  assert.strictEqual(f.ppAbs(0.01), '1.00 pp');
  assert.strictEqual(f.num(1205), '1,205');
  assert.strictEqual(f.num(0.0345), '0.0345');
  assert.strictEqual(f.num(1234567), '1,234,567');
  assert.strictEqual(f.num(12345.67), '12,345.7');
  assert.strictEqual(f.snum(2), '+2');
  assert.strictEqual(f.snum(-0.5), '-0.5');
  assert.strictEqual(f.pValue(0.0072), '0.0072');
  assert.strictEqual(f.pValue(0.013), '0.013');
  assert.strictEqual(f.pText(0.909), 'p = 0.909');
  assert.strictEqual(f.stat(3.985223505), '3.99');
  assert.strictEqual(f.df(725.2917258), '725.3');
});

test('pct with 0 decimals and grouping', () => {
  assert.strictEqual(f.pct(1.0433, 0), '104%');
  assert.strictEqual(f.pct(0.373, 0), '37%');
  assert.strictEqual(f.pct(123.456), '12,345.60%');
  assert.strictEqual(f.int(1234567.4), '1,234,567');
  assert.strictEqual(f.int(-29502), '-29,502');
});

test('signs: round first, then sign; ASCII minus', () => {
  assert.strictEqual(f.spct(-0.00001), '+0.00%');
  assert.strictEqual(f.spct(0), '+0.00%');
  assert.strictEqual(f.spct(-0.0033), '-0.33%');
  assert.strictEqual(f.pp(-0.0000001), '+0.00 pp');
  assert.strictEqual(f.pp(-0.0023), '-0.23 pp');
  assert.strictEqual(f.snum(0), '+0');
  assert.strictEqual(f.snum(-0), '+0');
  assert.strictEqual(f.ppAbs(-0.02), '2.00 pp');
  for (const s of [f.spct(-0.5), f.pp(-0.5), f.snum(-5), f.num(-1234.5), f.int(-7)]) {
    assert.ok(s.charAt(0) === '-', s);
    assert.ok(!/[\u2212]/.test(s));
  }
});

test('-0 prints as 0', () => {
  assert.strictEqual(f.int(-0), '0');
  assert.strictEqual(f.int(-0.4), '0');
  assert.strictEqual(f.pct(-0), '0.00%');
  assert.strictEqual(f.pct(-0.000001), '0.00%');
  assert.strictEqual(f.num(-0), '0');
  assert.strictEqual(f.stat(-0.001), '0.00');
  assert.strictEqual(f.df(-0.01), '0.0');
});

test('num: precision, plain notation and large values', () => {
  assert.strictEqual(f.num(0), '0');
  assert.strictEqual(f.num(0.0000001), '0.0000001');
  assert.strictEqual(f.num(1.23456789e-7), '0.000000123457');
  assert.strictEqual(f.num(99999.97), '100,000');
  assert.strictEqual(f.num(100000), '100,000');
  assert.strictEqual(f.num(-123456.7), '-123,457');
  assert.strictEqual(f.num(0.001335), '0.001335');
  assert.strictEqual(f.num(1.25), '1.25');
  assert.strictEqual(f.num(0.05), '0.05');
});

test('pValue thresholds', () => {
  assert.strictEqual(f.pValue(0.00009), '< 0.0001');
  assert.strictEqual(f.pValue(6.741663850e-5), '< 0.0001');
  assert.strictEqual(f.pValue(0.0001), '0.0001');
  assert.strictEqual(f.pValue(0.00999), '0.0100');
  assert.strictEqual(f.pValue(0.01), '0.010');
  assert.strictEqual(f.pValue(0.0127241907), '0.013');
  assert.strictEqual(f.pValue(0.90924), '0.909');
  assert.strictEqual(f.pText(0.00005), 'p < 0.0001');
  assert.strictEqual(f.pText(0.00717464162), 'p = 0.0072');
});

test('NaN and non-finite values print n/a in every function', () => {
  const fns = ['int', 'pct', 'spct', 'pp', 'ppAbs', 'num', 'snum', 'pValue', 'pText', 'stat', 'df'];
  for (const name of fns) {
    for (const v of [NaN, Infinity, -Infinity, undefined, null, 'abc']) {
      assert.strictEqual(f[name](v), 'n/a', name + '(' + String(v) + ')');
    }
  }
});
