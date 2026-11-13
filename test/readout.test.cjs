'use strict';
// SPEC 9.5 readout fixtures and the 10.1 readout.test.cjs cases.
const test = require('node:test');
const assert = require('node:assert');
const ro = require('../js/readout.js');
const stats = require('../js/stats.js');
const plan = require('../js/plan.js');
const validate = require('../js/validate.js');

function close(actual, expected, tol, label) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol, `${label || ''} got ${actual}, expected ${expected} (diff ${diff}, tolerance ${tol})`);
}
function closeRel(actual, expected, tol, label) {
  close(actual, expected, Math.abs(expected) * tol, label);
}
const TWO = { alpha: 0.05, sides: 2, dir: 1 };

test('9.5 two-proportion clean-win', () => {
  const r = ro.twoProportion({ n: 15400, x: 1540 }, { n: 15380, x: 1754 }, TWO);
  close(r.z, 3.985223505, 1e-8, 'z');
  closeRel(r.p, 6.741663850e-5, 1e-7, 'p');
  close(r.ci[0], 0.00713868, 1e-8, 'ci0');
  close(r.ci[1], 0.02094974, 1e-8, 'ci1');
  close(r.rel, 0.1404421, 1e-7, 'rel');
  close(r.relCi[0], 0.06899796, 1e-8, 'relCi0');
  close(r.relCi[1], 0.21666112, 1e-8, 'relCi1');
});

test('9.5 two-proportion peeking and trivial', () => {
  const pk = ro.twoProportion({ n: 5500, x: 550 }, { n: 5510, x: 632 }, TWO);
  close(pk.z, 2.491396853, 1e-8, 'z');
  close(pk.p, 0.0127241907, 1e-8, 'p');
  const tr = ro.twoProportion({ n: 210000, x: 21000 }, { n: 210200, x: 21546 }, TWO);
  close(tr.z, 2.688627568, 1e-8, 'z');
  close(tr.p, 0.00717464162, 1e-8, 'p');
  close(tr.ci[0], 0.00067821, 1e-8, 'ci0');
  close(tr.ci[1], 0.00432655, 1e-8, 'ci1');
});

test('9.5 Welch', () => {
  const w = ro.welch({ n: 400, mean: 50, sd: 12 }, { n: 380, mean: 52, sd: 15 }, TWO);
  close(w.t, 2.049686840, 1e-7, 't');
  close(w.df, 725.2917258, 1e-7, 'df');
  close(w.p, 0.04075411605, 1e-7, 'p');
  close(w.ci[0], 0.08435113, 1e-7, 'ci0');
  close(w.ci[1], 3.91564887, 1e-7, 'ci1');
  const tiny = ro.welch({ n: 5, mean: 10, sd: 2 }, { n: 6, mean: 13, sd: 4 }, TWO);
  close(tiny.t, 1.611258467, 1e-7, 't');
  close(tiny.df, 7.595505618, 1e-7, 'df');
  close(tiny.p, 0.1477956477, 1e-7, 'p');
  close(tiny.ci[0], -1.33367324, 1e-7, 'ci0');
  close(tiny.ci[1], 7.33367324, 1e-7, 'ci1');
});

test('9.5 SRM', () => {
  const a = ro.srmTest(5100, 4900, 0.5);
  close(a.chi2, 4, 1e-12);
  close(a.p, 0.0455002638963584, 1e-12);
  const b = ro.srmTest(15800, 14900, 0.5);
  close(b.chi2, 26.38436482, 1e-7);
  closeRel(b.p, 2.797962112e-7, 1e-6);
  const c = ro.srmTest(6800, 3200, 1 / 3);
  close(c.chi2, 8.0, 1e-9);
  close(c.p, 0.00467773498, 1e-9);
});

test('9.5 guardrail relative changes and OBF', () => {
  const z = stats.normInv(0.975);
  const k = ro.katzRelative({ n: 15400, x: 300 }, { n: 15380, x: 372 }, z);
  close(k.rel, 0.2416124837, 1e-8);
  close(k.relCi[0], 0.06819581, 1e-8);
  close(k.relCi[1], 0.44318255, 1e-8);
  const d = ro.deltaRelative({ n: 15400, mean: 1200, sd: 400 }, { n: 15380, mean: 1205, sd: 400 }, z);
  close(d.rel, 0.004166667, 1e-8);
  close(d.relCi[0], -0.00329656, 1e-8);
  close(d.relCi[1], 0.01162990, 1e-8);
  close(ro.alphaSpent(11010 / 29502, 0.05), 0.00133504, 1e-7);
});

test('one-sided p and the 90% CI', () => {
  const one = ro.twoProportion({ n: 5500, x: 550 }, { n: 5510, x: 632 }, { alpha: 0.05, sides: 1, dir: 1 });
  const two = ro.twoProportion({ n: 5500, x: 550 }, { n: 5510, x: 632 }, TWO);
  close(one.p, two.p / 2, 1e-12);
  close(one.zc, 1.644853626951473, 1e-9);
  close(one.ci[0], one.diff - 1.644853626951473 * one.se, 1e-12);
  assert.strictEqual(ro.levelText(0.05, 1), '90%');
  assert.strictEqual(ro.levelText(0.05, 2), '95%');
  // One-sided in the "better" direction: an improvement against dir -1 gives a large p.
  const wrongWay = ro.twoProportion({ n: 5500, x: 550 }, { n: 5510, x: 632 }, { alpha: 0.05, sides: 1, dir: -1 });
  close(wrongWay.p, 1 - one.p, 1e-12);
  const w1 = ro.welch({ n: 400, mean: 50, sd: 12 }, { n: 380, mean: 52, sd: 15 }, { alpha: 0.05, sides: 1, dir: 1 });
  close(w1.p, 0.04075411605 / 2, 1e-7);
  close(w1.tc, stats.tInv(0.95, w1.df), 1e-12);
});

test('direction-adjusted e/lo/hi when lower is better', () => {
  const r = ro.adjust(ro.twoProportion({ n: 1000, x: 300 }, { n: 1000, x: 250 }, { alpha: 0.05, sides: 2, dir: -1 }), -1);
  close(r.e, 0.05, 1e-12);
  close(r.lo, -r.ci[1], 1e-15);
  close(r.hi, -r.ci[0], 1e-15);
  assert.ok(r.lo < r.e && r.e < r.hi);
});

test('no-variance cases', () => {
  const b = ro.twoProportion({ n: 1000, x: 0 }, { n: 1000, x: 0 }, TWO);
  assert.strictEqual(b.computable, false);
  assert.strictEqual(b.reason, 'no-variance');
  assert.ok(Number.isNaN(b.p));
  const w = ro.welch({ n: 50, mean: 3, sd: 0 }, { n: 50, mean: 4, sd: 0 }, TWO);
  assert.strictEqual(w.computable, false);
  assert.strictEqual(w.reason, 'no-variance');
  assert.strictEqual(ro.primaryCall(ro.adjust(b, 1), 0.01, 0.05, 2).reason, 'no-variance');
});

test('zero-conversion arm: relative n/a, z and p still computed', () => {
  const r = ro.twoProportion({ n: 1000, x: 0 }, { n: 1000, x: 5 }, TWO);
  close(r.z, 2.238868314, 1e-8);
  close(r.p, 0.0251644857, 1e-8);
  assert.ok(Number.isNaN(r.rel));
  assert.strictEqual(r.relNa, 'needs at least one conversion in each arm');
});

// Full audit helpers for check-level cases.
function rawPlan(over) {
  return Object.assign({
    name: 'X', metricName: 'M', type: 'binary', direction: 'increase', baselineRate: '10', baselineMean: '', baselineSd: '',
    mdeType: 'relative', mde: '10', alpha: '5', power: '80', sides: 'two', share: '50', daily: '2200', start: '2025-03-03',
    hypothesis: '', notes: '', guardrails: []
  }, over);
}
function arm(n, x, mean, sd) { return { n: String(n), x: x === undefined ? '' : String(x), mean: mean === undefined ? '' : String(mean), sd: sd === undefined ? '' : String(sd) }; }
function run(planOver, readout) {
  const pp = validate.parsePlan(rawPlan(planOver));
  assert.ok(pp.ok, JSON.stringify(pp.errors));
  const pr = plan.computePlan(pp.value);
  const r = validate.parseReadout(Object.assign({ through: '2025-03-16', looks: '1', srmThreshold: '0.001', guardrails: {} }, readout), pp.value);
  assert.ok(r.ok, JSON.stringify(r.errors));
  return ro.audit(pp, pr, r);
}
function check(a, id) { return a.checks.find(c => c.id === id); }

test('small-counts and small-n warnings', () => {
  const a = run({}, { control: arm(100, 5), treatment: arm(100, 12) });
  assert.strictEqual(check(a, 'assumptions').status, 'WARN');
  assert.strictEqual(check(a, 'assumptions').reasonId, 'small-counts');
  assert.ok(a.reasons.some(r => r.id === 'small-counts'));
  const contPlan = { type: 'continuous', baselineRate: '', baselineMean: '50', baselineSd: '10', mdeType: 'absolute', mde: '5' };
  const b = run(contPlan, { control: arm(20, '', 50, 10), treatment: arm(40, '', 55, 10) });
  assert.strictEqual(check(b, 'assumptions').status, 'WARN');
  assert.strictEqual(check(b, 'assumptions').reasonId, 'small-n');
  assert.strictEqual(check(b, 'assumptions').detail, 'Fewer than 30 users in an arm: the t-test is sensitive to skewed data at this size.');
  const c = run(contPlan, { control: arm(30, '', 50, 10), treatment: arm(30, '', 55, 10) });
  assert.strictEqual(check(c, 'assumptions').status, 'PASS');
  assert.strictEqual(check(c, 'assumptions').detail, 'Normal approximation reasonable (at least 30 users per arm).');
});

test('guardrail statuses: PASS, at risk, FAIL, missing, n/a', () => {
  const g = (type, margin) => ({ id: 'g1', name: 'G', type: type, dir: -1, margin: margin });
  const ok = (c, t) => ({ state: 'ok', control: c, treatment: t });
  const pass = ro.guardrailCheck(g('continuous', 0.05), ok({ n: 15400, mean: 1200, sd: 400 }, { n: 15380, mean: 1205, sd: 400 }), 0.05);
  assert.strictEqual(pass.status, 'PASS');
  assert.strictEqual(pass.detail, 'Change +0.42% (95% CI -0.33% to +1.16%); lower is better; limit 5.00% worse. Within the limit.');
  const risk = ro.guardrailCheck(g('binary', 0.3), ok({ n: 15400, x: 300 }, { n: 15380, x: 372 }), 0.05);
  assert.strictEqual(risk.status, 'WARN');
  assert.strictEqual(risk.reasonId, 'guardrail-at-risk');
  assert.ok(risk.detail.endsWith('limit 30.00% worse. At risk: the CI reaches 44.32% worse.'), risk.detail);
  const fail = ro.guardrailCheck(g('binary', 0.1), ok({ n: 15400, x: 300 }, { n: 15380, x: 372 }), 0.05);
  assert.strictEqual(fail.status, 'FAIL');
  assert.strictEqual(fail.reasonId, 'guardrail-breach');
  assert.strictEqual(fail.detail, 'Change +24.16% (95% CI +6.82% to +44.32%); lower is better; limit 10.00% worse. Breached.');
  const missing = ro.guardrailCheck(g('binary', 0.1), { state: 'empty' }, 0.05);
  assert.deepStrictEqual([missing.status, missing.reasonId, missing.detail], ['WARN', 'guardrail-missing', 'No data entered.']);
  const naBin = ro.guardrailCheck(g('binary', 0.1), ok({ n: 100, x: 0 }, { n: 100, x: 3 }), 0.05);
  assert.deepStrictEqual([naBin.status, naBin.reasonId, naBin.detail], ['WARN', 'guardrail-na', "Relative change can't be computed with zero events in an arm."]);
  const naCont = ro.guardrailCheck(g('continuous', 0.1), ok({ n: 100, mean: 0, sd: 1 }, { n: 100, mean: 1, sd: 1 }), 0.05);
  assert.deepStrictEqual([naCont.status, naCont.reasonId, naCont.detail], ['WARN', 'guardrail-na', 'Relative change needs a positive control mean.']);
  // Higher is better: a drop is a degradation, worst bound = -relCi[0].
  const up = ro.guardrailCheck({ id: 'g2', name: 'H', type: 'binary', dir: 1, margin: 0.1 }, ok({ n: 15380, x: 372 }, { n: 15400, x: 300 }), 0.05);
  assert.strictEqual(up.status, 'FAIL');
  close(up.deg, 1 - 300 / 15400 / (372 / 15380), 1e-12);
});

test('looks table lookups', () => {
  assert.strictEqual(ro.looksFpr(1, 0.05, 2), '0.05');
  assert.strictEqual(ro.looksFpr(3, 0.05, 2), '0.107');
  assert.strictEqual(ro.looksFpr(7, 0.05, 2), 'between 0.142 and 0.193');
  assert.strictEqual(ro.looksFpr(100, 0.05, 2), '0.374');
  assert.strictEqual(ro.looksFpr(150, 0.05, 2), 'above 0.374');
  assert.strictEqual(ro.looksFpr(3, 0.01, 2), 'higher than alpha');
  assert.strictEqual(ro.looksFpr(3, 0.05, 1), 'higher than alpha');
});

test('pure functions never throw on junk', () => {
  assert.doesNotThrow(() => ro.audit(null, null, null));
  assert.strictEqual(ro.audit(null, null, null).verdict, 'none');
  assert.doesNotThrow(() => ro.twoProportion({ n: 0, x: 0 }, { n: 0, x: 0 }, TWO));
  assert.ok(Number.isNaN(ro.alphaSpent(0, 0.05)));
});
