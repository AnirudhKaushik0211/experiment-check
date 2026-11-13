'use strict';
// SPEC 9.4 sample-size and duration fixtures, plus the 10.1 plan.test.cjs cases.
const test = require('node:test');
const assert = require('node:assert');
const plan = require('../js/plan.js');
const validate = require('../js/validate.js');

function close(actual, expected, tol) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol, `got ${actual}, expected ${expected} (diff ${diff}, tolerance ${tol})`);
}

// A parsed plan (SPEC 5.1 shape) with defaults that the cases override.
function mk(over) {
  return Object.assign({
    name: '', metricName: '', type: 'binary', dir: 1, p1: 0.1, mean: null, sd: null,
    mdeType: 'absolute', mde: 0.01, alpha: 0.05, power: 0.8, sides: 2, share: 0.5,
    daily: 1000, start: null, hypothesis: '', notes: '', guardrails: []
  }, over);
}
function bin(p1, p2, over) {
  return mk(Object.assign({ p1: p1, dir: p2 > p1 ? 1 : -1, mde: Math.abs(p2 - p1) }, over));
}
function cont(sd, delta, over) {
  return mk(Object.assign({ type: 'continuous', p1: null, mean: 100, sd: sd, mde: delta }, over));
}

// Raw plan P14 (SPEC 8.4) as typed in the UI.
function rawP14(over) {
  return Object.assign({
    name: 'P14', metricName: 'Conversion', type: 'binary', direction: 'increase',
    baselineRate: '10', baselineMean: '', baselineSd: '', mdeType: 'relative', mde: '10',
    alpha: '5', power: '80', sides: 'two', share: '50', daily: '2200', start: '2025-03-03',
    hypothesis: '', notes: '', guardrails: []
  }, over);
}
function parsed(raw) {
  const r = validate.parsePlan(raw);
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.value;
}

const cases = [
  ['S1', bin(0.5, 0.75, { power: 0.9 }), 76.707, 77],
  ['S2', bin(0.10, 0.12), 3840.85, 3841],
  ['S3', bin(0.10, 0.11), 14750.79, 14751],
  ['S4', bin(0.05, 0.06), 8157.73, 8158],
  ['S5', bin(0.10, 0.11, { sides: 1 }), 11619.07, 11620],
  ['S6', bin(0.20, 0.25, { alpha: 0.01, power: 0.9 }), 2073.20, 2074],
  ['S7', bin(0.10, 0.12, { share: 0.25 }), 7555.61, 7556, 2518.54, 2519],
  ['S8', bin(0.30, 0.27), 3553.06, 3554],
  ['S9', bin(0.10, 0.105), 57762.65, 57763],
  ['C1', cont(1, 0.5), 62.791, 63],
  ['C2', cont(1, 1, { power: 0.9 }), 21.015, 22],
  ['C3', cont(40, 2), 6279.10, 6280],
  ['C4', cont(40, 2, { sides: 1 }), 4946.05, 4947],
  ['C5', cont(10, 1, { share: 1 / 3 }), 2354.66, 2355, 1177.33, 1178],
  ['C6', cont(1, 0.2, { alpha: 0.01, power: 0.95 }), 890.708, 891]
];

for (const [id, p, n1, nC, n2, nT] of cases) {
  test('9.4 ' + id, () => {
    const r = plan.computePlan(p);
    assert.strictEqual(r.ok, true);
    close(r.n1Raw, n1, 0.01);
    assert.strictEqual(r.nControl, nC);
    if (n2 !== undefined) {
      close(r.n2Raw, n2, 0.01);
      assert.strictEqual(r.nTreatment, nT);
    } else {
      assert.strictEqual(r.nTreatment, nC);
    }
    assert.strictEqual(r.total, r.nControl + r.nTreatment);
    assert.strictEqual(r.test, p.type === 'binary' ? 'z' : 'welch');
  });
}

test('9.4 P14 duration, plannedEnd and sensitivity', () => {
  const r = plan.computePlan(parsed(rawP14()));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.nControl, 14751);
  assert.strictEqual(r.nTreatment, 14751);
  assert.strictEqual(r.total, 29502);
  close(r.rawDays, 13.41, 1e-9);
  assert.strictEqual(r.daysNeeded, 14);
  assert.strictEqual(r.recommendedDays, 14);
  assert.strictEqual(r.weeks, 2);
  assert.strictEqual(r.plannedEnd, '2025-03-16');
  const expected = [0.013955, 0.009782, 0.007957, 0.006875, 0.005598, 0.004840, 0.003944];
  assert.strictEqual(r.sensitivity.length, 7);
  r.sensitivity.forEach((row, i) => {
    assert.strictEqual(row.days, plan.SENS_DAYS[i]);
    assert.strictEqual(row.weeks, row.days / 7);
    assert.strictEqual(row.nC, row.days * 1100);
    assert.strictEqual(row.nT, row.days * 1100);
    close(row.mdeAbs, expected[i], 2e-6);
    close(row.mdeRel, row.mdeAbs / 0.1, 1e-12);
    assert.strictEqual(row.isPlan, row.days === 14);
  });
  assert.deepStrictEqual(r.advice, [
    'Run whole weeks so every weekday is represented equally, and at least 7 days to dampen novelty effects.'
  ]);
});

test('9.4 trivial plan: 7 recommended days, daysNeeded 2', () => {
  const r = plan.computePlan(parsed(rawP14({ mde: '5', daily: '60000' })));
  assert.strictEqual(r.nControl, 57763);
  assert.strictEqual(r.total, 115526);
  assert.strictEqual(r.daysNeeded, 2);
  assert.strictEqual(r.recommendedDays, 7);
  assert.strictEqual(r.plannedEnd, '2025-03-09');
  assert.strictEqual(r.advice[1], 'The sample needs only 2 day(s) of traffic, but run 7 days anyway so every weekday is covered.');
  assert.strictEqual(r.sensitivity.length, 7);
  assert.strictEqual(r.sensitivity.filter((x) => x.isPlan).length, 1);
});

test('9.4 continuous closed form: n 1000 per arm', () => {
  const m = plan.mdeForSample(cont(1, 0.1, { alpha: 0.05, power: 0.8 }), 1000);
  close(m, 0.125290699849, 1e-9);
});

test('target and mdeAbs for relative and absolute MDEs', () => {
  const rel = plan.computePlan(parsed(rawP14()));
  close(rel.mdeAbs, 0.01, 1e-15);
  close(rel.mdeRel, 0.1, 1e-12);
  close(rel.target, 0.11, 1e-15);
  assert.strictEqual(rel.baselinePositive, true);
  const abs = plan.computePlan(parsed(rawP14({ mdeType: 'absolute', mde: '2' })));
  close(abs.mdeAbs, 0.02, 1e-15);
  close(abs.mdeRel, 0.2, 1e-12);
  close(abs.target, 0.12, 1e-15);
  const down = plan.computePlan(parsed(rawP14({ direction: 'decrease', baselineRate: '30', mdeType: 'absolute', mde: '3' })));
  close(down.target, 0.27, 1e-15);
  assert.strictEqual(down.nControl, 3554);
  const contRel = plan.computePlan(cont(40, 0.02, { mdeType: 'relative', mean: 100 }));
  close(contRel.mdeAbs, 2, 1e-12);
  close(contRel.target, 102, 1e-12);
  assert.strictEqual(contRel.nControl, 6280);
});

test('rounding: ceil with the 1e-9 epsilon', () => {
  assert.strictEqual(plan.ceilEps(3841), 3841);
  assert.strictEqual(plan.ceilEps(3841 + 1e-10), 3841);
  assert.strictEqual(plan.ceilEps(3841 + 1e-6), 3842);
  assert.strictEqual(plan.ceilEps(3840.85), 3841);
});

test('duration rules', () => {
  let d = plan.duration(13.4, 1);
  assert.strictEqual(d.daysNeeded, 14);
  assert.strictEqual(d.recommendedDays, 14);
  d = plan.duration(15, 1);
  assert.strictEqual(d.daysNeeded, 15);
  assert.strictEqual(d.recommendedDays, 21);
  assert.strictEqual(d.weeks, 3);
  for (const t of [0.5, 1, 3, 6, 6.9]) {
    assert.strictEqual(plan.duration(t, 1).recommendedDays, 7);
  }
  d = plan.duration(7, 1);
  assert.strictEqual(d.recommendedDays, 7);
});

test('advice: rounding up, long, uneven, one-sided and small-n in order', () => {
  // daily 1400: total 29502 -> 21.07 days -> daysNeeded 22 -> 28 days.
  const r = plan.computePlan(parsed(rawP14({ daily: '1400' })));
  assert.strictEqual(r.daysNeeded, 22);
  assert.strictEqual(r.recommendedDays, 28);
  assert.strictEqual(r.advice[1], '22 days of traffic rounds up to 28 days (4 full weeks).');
  const long = plan.computePlan(parsed(rawP14({ daily: '100', share: '25', sides: 'one' })));
  assert.ok(long.recommendedDays > 56);
  let last = 0;
  for (const s of [
    'This is a long test (over 8 weeks). Consider a larger MDE, more traffic or a more sensitive metric; long tests suffer from cookie churn and seasonality.',
    'An uneven split needs more users in total than 50/50 for the same power.',
    "A one-sided test can only show an improvement. A harmful effect will read as 'not significant', so watch the guardrails."
  ]) {
    const i = long.advice.indexOf(s);
    assert.ok(i > last, s);
    last = i;
  }
  const decade = plan.computePlan(parsed(rawP14({ daily: '1' })));
  assert.ok(decade.rawDays > 3650);
  assert.ok(decade.advice.includes('That is more than 10 years of traffic. Increase the MDE or the traffic.'));
  const small = plan.computePlan(cont(1, 1, { power: 0.9 }));
  assert.ok(small.advice.includes('Small sample: the normal approximation behind this plan is optimistic below about 30 users per arm.'));
});

test('plannedEnd across a month end and a leap day', () => {
  assert.strictEqual(plan.computePlan(parsed(rawP14({ start: '2028-02-20' }))).plannedEnd, '2028-03-04');
  assert.strictEqual(plan.computePlan(parsed(rawP14({ start: '2025-01-25' }))).plannedEnd, '2025-02-07');
  assert.strictEqual(plan.computePlan(parsed(rawP14({ start: '2025-12-25' }))).plannedEnd, '2026-01-07');
  assert.strictEqual(plan.computePlan(parsed(rawP14({ start: '' }))).plannedEnd, null);
  assert.strictEqual(plan.addDays('2027-02-28', 1), '2027-03-01');
});

test('sensitivity: extra plan row inserted in order', () => {
  // daily 1000: total 29502 -> 30 days -> recommended 35, not a standard duration.
  const r = plan.computePlan(parsed(rawP14({ daily: '1000' })));
  assert.strictEqual(r.recommendedDays, 35);
  assert.strictEqual(r.sensitivity.length, 8);
  assert.deepStrictEqual(r.sensitivity.map((x) => x.days), [7, 14, 21, 28, 35, 42, 56, 84]);
  assert.deepStrictEqual(r.sensitivity.filter((x) => x.isPlan).map((x) => x.days), [35]);
});

test('sensitivity: not detectable (NaN) with daily 1', () => {
  const r = plan.computePlan(parsed(rawP14({ daily: '1' })));
  assert.strictEqual(r.sensitivity[0].nC, 3);
  assert.ok(Number.isNaN(r.sensitivity[0].mdeAbs));
  assert.ok(Number.isNaN(r.sensitivity[0].mdeRel));
  assert.ok(Number.isNaN(plan.mdeForSample(parsed(rawP14()), 0)));
});

test('infeasible flag', () => {
  const r = plan.computePlan(bin(0.1, 0.1 + 1e-7));
  assert.deepStrictEqual(r, { ok: false, reason: 'infeasible' });
  const zero = plan.computePlan(mk({ mde: 0 }));
  assert.deepStrictEqual(zero, { ok: false, reason: 'infeasible' });
  assert.strictEqual(plan.INFEASIBLE_MESSAGE, 'This MDE is too small to detect with any realistic sample. Increase the MDE.');
  assert.doesNotThrow(() => plan.computePlan(null));
  assert.strictEqual(plan.computePlan(null).ok, false);
});

for (const mean of [-5, 0]) {
  test('non-positive continuous baseline: mean ' + mean + ', sd 2, absolute MDE 1', () => {
    const r = plan.computePlan(cont(2, 1, { mean: mean }));
    assert.strictEqual(r.ok, true);
    close(r.n1Raw, 62.791, 0.01);
    assert.strictEqual(r.nControl, 63);
    assert.strictEqual(r.baselinePositive, false);
    assert.ok(Number.isNaN(r.mdeRel));
    close(r.mdeAbs, 1, 0);
    close(r.target, mean + 1, 1e-12);
    for (const row of r.sensitivity) {
      assert.ok(Number.isFinite(row.mdeAbs));
      assert.ok(Number.isNaN(row.mdeRel));
    }
  });
}
