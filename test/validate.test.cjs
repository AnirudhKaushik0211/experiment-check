'use strict';
// SPEC 8.1 / 8.2 plan validation cases from the 10.1 validate.test.cjs row.
// Readout cases (parseReadout) are at the end of the file.
const test = require('node:test');
const assert = require('node:assert');
const v = require('../js/validate.js');

function rawPlan(over) {
  return Object.assign({
    name: 'Test', metricName: 'Conversion', type: 'binary', direction: 'increase',
    baselineRate: '10', baselineMean: '', baselineSd: '', mdeType: 'relative', mde: '10',
    alpha: '5', power: '80', sides: 'two', share: '50', daily: '2200', start: '2025-03-03',
    hypothesis: '', notes: '', guardrails: []
  }, over);
}
function errorsOf(over) { return v.parsePlan(rawPlan(over)).errors; }
function onlyError(over, id, msg) {
  const r = v.parsePlan(rawPlan(over));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.value, null);
  assert.deepStrictEqual(r.errors, { [id]: msg });
}

const RATE = 'ec-plan-baseline-rate';
const RATE_RANGE = 'The baseline rate must be above 0% and below 100%.';
const FORMAT = 'Enter a number, like 12.5.';
const INTEGER = 'Enter a whole number, like 1200.';

test('parseNumber (8.1)', () => {
  assert.deepStrictEqual(v.parseNumber('  '), { empty: true });
  assert.deepStrictEqual(v.parseNumber('12.5'), { ok: true, value: 12.5 });
  assert.deepStrictEqual(v.parseNumber('1,000'), { ok: true, value: 1000 });
  assert.deepStrictEqual(v.parseNumber('1,234,567.5'), { ok: true, value: 1234567.5 });
  assert.deepStrictEqual(v.parseNumber('.5'), { ok: true, value: 0.5 });
  assert.deepStrictEqual(v.parseNumber('-5'), { ok: true, value: -5 });
  assert.deepStrictEqual(v.parseNumber('10%', { percent: true }), { ok: true, value: 10 });
  assert.deepStrictEqual(v.parseNumber('10 %', { percent: true }), { ok: true, value: 10 });
  assert.deepStrictEqual(v.parseNumber('10%'), { ok: false, error: 'format' });
  assert.deepStrictEqual(v.parseNumber('1,00'), { ok: false, error: 'format' });
  assert.deepStrictEqual(v.parseNumber('abc'), { ok: false, error: 'format' });
  assert.deepStrictEqual(v.parseNumber('1e10'), { ok: false, error: 'format' });
  assert.deepStrictEqual(v.parseNumber('2.5', { integer: true }), { ok: false, error: 'integer' });
  assert.deepStrictEqual(v.parseNumber('1,200', { integer: true }), { ok: true, value: 1200 });
  assert.deepStrictEqual(v.parseNumber(undefined), { empty: true });
});

test('dates (8.1)', () => {
  assert.strictEqual(v.isValidDate('2025-03-03'), true);
  assert.strictEqual(v.isValidDate('2028-02-29'), true);
  assert.strictEqual(v.isValidDate('2025-02-30'), false);
  assert.strictEqual(v.isValidDate('2025-02-29'), false);
  assert.strictEqual(v.isValidDate('2025-13-01'), false);
  assert.strictEqual(v.isValidDate('1999-12-31'), false);
  assert.strictEqual(v.isValidDate('2101-01-01'), false);
  assert.strictEqual(v.isValidDate('2025-3-3'), false);
});

test('valid default plan has the 5.1 shape', () => {
  const r = v.parsePlan(rawPlan());
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, {});
  assert.deepStrictEqual(r.value, {
    name: 'Test', metricName: 'Conversion', type: 'binary', dir: 1, p1: 0.1, mean: null, sd: null,
    mdeType: 'relative', mde: 0.1, alpha: 0.05, power: 0.8, sides: 2, share: 0.5, daily: 2200,
    start: '2025-03-03', hypothesis: '', notes: '', guardrails: []
  });
});

test('baseline rate cases', () => {
  onlyError({ baselineRate: '0' }, RATE, RATE_RANGE);
  onlyError({ baselineRate: '100' }, RATE, RATE_RANGE);
  onlyError({ baselineRate: '-5' }, RATE, RATE_RANGE);
  onlyError({ baselineRate: '1,000' }, RATE, RATE_RANGE);
  onlyError({ baselineRate: 'abc' }, RATE, FORMAT);
  onlyError({ baselineRate: '1,00' }, RATE, FORMAT);
  onlyError({ baselineRate: '' }, RATE, 'Enter the baseline conversion rate, for example 10 for 10%.');
  assert.strictEqual(v.parsePlan(rawPlan({ baselineRate: '10%' })).value.p1, 0.1);
  assert.strictEqual(v.parsePlan(rawPlan({ baselineRate: '.5' })).value.p1, 0.005);
});

test('MDE cases', () => {
  onlyError({ mde: '0' }, 'ec-plan-mde', 'The MDE must be greater than 0.');
  onlyError({ mde: '-2' }, 'ec-plan-mde', 'The MDE must be greater than 0.');
  onlyError({ mde: '1001' }, 'ec-plan-mde', 'A relative MDE above 1000% is not supported.');
  onlyError({ baselineRate: '50', mde: '100' }, 'ec-plan-mde',
    'With this MDE the target rate would be 100%, outside 0-100%. Use a smaller MDE.');
  onlyError({ baselineRate: '60', mde: '80' }, 'ec-plan-mde',
    'With this MDE the target rate would be 108%, outside 0-100%. Use a smaller MDE.');
  onlyError({ baselineRate: '10', direction: 'decrease', mdeType: 'absolute', mde: '10' }, 'ec-plan-mde',
    'With this MDE the target rate would be 0%, outside 0-100%. Use a smaller MDE.');
  // Absolute MDE in percentage points.
  const abs = v.parsePlan(rawPlan({ mdeType: 'absolute', mde: '2' }));
  assert.strictEqual(abs.ok, true);
  assert.strictEqual(abs.value.mdeType, 'absolute');
  assert.strictEqual(abs.value.mde, 0.02);
});

test('alpha, power, share and daily ranges', () => {
  onlyError({ alpha: '0' }, 'ec-plan-alpha', 'Alpha must be between 0.1% and 20%.');
  onlyError({ alpha: '25' }, 'ec-plan-alpha', 'Alpha must be between 0.1% and 20%.');
  onlyError({ power: '40' }, 'ec-plan-power', 'Power must be between 50% and 99.9%.');
  onlyError({ power: '99.95' }, 'ec-plan-power', 'Power must be between 50% and 99.9%.');
  onlyError({ share: '0' }, 'ec-plan-share', 'The treatment share must be between 1% and 99%.');
  onlyError({ share: '100' }, 'ec-plan-share', 'The treatment share must be between 1% and 99%.');
  const DAILY = 'Enter a whole number of users per day, at least 1.';
  onlyError({ daily: '0' }, 'ec-plan-daily', DAILY);
  onlyError({ daily: '2.5' }, 'ec-plan-daily', INTEGER);
  onlyError({ daily: '10000000000' }, 'ec-plan-daily', DAILY);
  onlyError({ daily: '1e10' }, 'ec-plan-daily', FORMAT);
  assert.strictEqual(v.parsePlan(rawPlan({ daily: '1000000000' })).ok, true);
});

test('start date', () => {
  onlyError({ start: '2025-02-30' }, 'ec-plan-start', 'Enter a valid date (YYYY-MM-DD).');
  const r = v.parsePlan(rawPlan({ start: '' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.start, null);
});

test('continuous baseline: relative MDE needs a positive mean', () => {
  const base = { type: 'continuous', baselineRate: '', baselineMean: '0', baselineSd: '2', mdeType: 'relative', mde: '10' };
  const REL = 'A relative MDE needs a positive baseline mean. Use an absolute MDE instead.';
  onlyError(base, 'ec-plan-baseline-mean', REL);
  onlyError(Object.assign({}, base, { baselineMean: '-5' }), 'ec-plan-baseline-mean', REL);
  for (const mean of ['0', '-5']) {
    const r = v.parsePlan(rawPlan(Object.assign({}, base, { baselineMean: mean, mdeType: 'absolute', mde: '1' })));
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.value.mean, Number(mean));
    assert.strictEqual(r.value.sd, 2);
    assert.strictEqual(r.value.mde, 1);
    assert.strictEqual(r.value.p1, null);
  }
  onlyError(Object.assign({}, base, { baselineMean: '' }), 'ec-plan-baseline-mean', 'Enter the baseline mean.');
  onlyError(Object.assign({}, base, { baselineMean: '2000000000000' }), 'ec-plan-baseline-mean', 'Use a value between -1e12 and 1e12.');
  onlyError(Object.assign({}, base, { baselineMean: '50', baselineSd: '0' }), 'ec-plan-baseline-sd', 'The standard deviation must be greater than 0.');
  const rel = v.parsePlan(rawPlan(Object.assign({}, base, { baselineMean: '50' })));
  assert.strictEqual(rel.ok, true);
  assert.strictEqual(rel.value.mde, 0.1);
});

test('guardrails: names, duplicates, margins and keys', () => {
  const g = (id, name, margin, extra) => Object.assign({ id: id, name: name, type: 'binary', direction: 'decrease', margin: margin }, extra);
  const ok = v.parsePlan(rawPlan({ guardrails: [g('g1', ' Refund rate ', '10'), g('g3', 'Page load', '5', { type: 'continuous', direction: 'increase' })] }));
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.value.guardrails, [
    { id: 'g1', name: 'Refund rate', type: 'binary', dir: -1, margin: 0.1 },
    { id: 'g3', name: 'Page load', type: 'continuous', dir: 1, margin: 0.05 }
  ]);
  const dup = v.parsePlan(rawPlan({ guardrails: [g('g1', 'Refund rate', '10'), g('g2', 'REFUND RATE', '5')] }));
  assert.deepStrictEqual(dup.errors, { 'ec-gr-g2-name': 'Two guardrails have the same name.' });
  const empty = v.parsePlan(rawPlan({ guardrails: [g('g4', '   ', '5')] }));
  assert.deepStrictEqual(empty.errors, { 'ec-gr-g4-name': 'Name this guardrail.' });
  const MARGIN = 'Enter the maximum acceptable degradation, for example 5 for 5%.';
  for (const m of ['0', '101', '', '-1']) {
    const r = v.parsePlan(rawPlan({ guardrails: [g('g1', 'A', m)] }));
    assert.deepStrictEqual(r.errors, { 'ec-gr-g1-margin': MARGIN }, 'margin ' + m);
  }
  assert.strictEqual(v.parsePlan(rawPlan({ guardrails: [g('g1', 'A', '100')] })).ok, true);
});

test('text fields are truncated, never fail', () => {
  const r = v.parsePlan(rawPlan({ name: 'x'.repeat(100), hypothesis: 'y'.repeat(700) }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.name.length, 80);
  assert.strictEqual(r.value.hypothesis.length, 600);
});

test('never throws on junk input', () => {
  assert.doesNotThrow(() => v.parsePlan(null));
  assert.doesNotThrow(() => v.parsePlan({ guardrails: [null, 5, 'x'] }));
  assert.strictEqual(v.parsePlan(undefined).ok, false);
});

// ---- parseReadout (8.2 readout table, 6.1 shape) ----------------------------------------------

function planValue(over) { return v.parsePlan(rawPlan(over)).value; }
const CONT = { type: 'continuous', baselineRate: '', baselineMean: '50', baselineSd: '10', mdeType: 'absolute', mde: '2' };
function arm(n, x, mean, sd) { return { n: n, x: x || '', mean: mean || '', sd: sd || '' }; }
function rawRo(over) {
  return Object.assign({
    control: arm('15400', '1540'), treatment: arm('15380', '1754'),
    through: '2025-03-16', looks: '1', srmThreshold: '0.001', guardrails: {}
  }, over);
}
function roErrors(over, planOver) { return v.parseReadout(rawRo(over), planValue(planOver)).errors; }

test('readout: valid binary readout has the 6.1 shape', () => {
  const r = v.parseReadout(rawRo(), planValue());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.empty, false);
  assert.deepStrictEqual(r.value, {
    control: { n: 15400, x: 1540 }, treatment: { n: 15380, x: 1754 },
    through: '2025-03-16', looks: 1, srmThreshold: 0.001, guardrails: {}
  });
  // A parsePlan result is accepted as well as its value.
  assert.strictEqual(v.parseReadout(rawRo(), v.parsePlan(rawPlan())).ok, true);
});

test('readout: the empty readout gives empty: true with no errors', () => {
  const r = v.parseReadout({ control: arm(''), treatment: arm(''), through: '', looks: '1', srmThreshold: '0.001' }, planValue());
  assert.deepStrictEqual(r, { ok: false, empty: true, value: null, errors: {} });
  // looks and srmThreshold do not count, even when invalid.
  const r2 = v.parseReadout({ control: arm(''), treatment: arm(''), through: '', looks: 'x', srmThreshold: '' }, planValue());
  assert.strictEqual(r2.empty, true);
  assert.deepStrictEqual(r2.errors, {});
  // Hidden fields of the other metric type do not count either.
  const r3 = v.parseReadout({ control: arm('', '', '5', '1'), treatment: arm(''), through: '' }, planValue());
  assert.strictEqual(r3.empty, true);
});

test('readout: counts negative, non-integer, x > n, n = 0', () => {
  assert.deepStrictEqual(roErrors({ control: arm('15400', '-1') }), { 'ec-ro-c-x': "Conversions can't be negative." });
  assert.deepStrictEqual(roErrors({ treatment: arm('15380', '2.5') }), { 'ec-ro-t-x': INTEGER });
  assert.deepStrictEqual(roErrors({ treatment: arm('100', '101') }), { 'ec-ro-t-x': "Conversions can't be more than users." });
  assert.deepStrictEqual(roErrors({ control: arm('0', '0') }), { 'ec-ro-c-n': 'Enter the number of users.' });
  assert.deepStrictEqual(roErrors({ control: arm('-5', '0') }), { 'ec-ro-c-n': 'Enter the number of users.' });
  assert.deepStrictEqual(roErrors({ control: arm('10.5', '1') }), { 'ec-ro-c-n': INTEGER });
  assert.deepStrictEqual(roErrors({ control: arm('', '1') }), { 'ec-ro-c-n': 'Enter the number of users.' });
  assert.deepStrictEqual(roErrors({ control: arm('abc', '1') }), { 'ec-ro-c-n': FORMAT });
  assert.strictEqual(v.parseReadout(rawRo({ control: arm('100', '0'), treatment: arm('100', '100') }), planValue()).ok, true);
});

test('readout: continuous n = 1, sd negative, mean range', () => {
  const pl = CONT;
  const base = { control: arm('400', '', '50', '12'), treatment: arm('380', '', '52', '15') };
  assert.strictEqual(v.parseReadout(rawRo(base), planValue(pl)).ok, true);
  assert.deepStrictEqual(v.parseReadout(rawRo(base), planValue(pl)).value.control, { n: 400, mean: 50, sd: 12 });
  assert.deepStrictEqual(roErrors(Object.assign({}, base, { control: arm('1', '', '50', '12') }), pl),
    { 'ec-ro-c-n': 'A mean and SD need at least 2 users per arm.' });
  assert.deepStrictEqual(roErrors(Object.assign({}, base, { treatment: arm('380', '', '52', '-1') }), pl),
    { 'ec-ro-t-sd': "The standard deviation can't be negative." });
  assert.deepStrictEqual(roErrors(Object.assign({}, base, { treatment: arm('380', '', '2000000000000', '1') }), pl),
    { 'ec-ro-t-mean': 'Enter the mean.' });
  assert.deepStrictEqual(roErrors(Object.assign({}, base, { treatment: arm('380', '', '', '1') }), pl),
    { 'ec-ro-t-mean': 'Enter the mean.' });
  assert.strictEqual(v.parseReadout(rawRo(Object.assign({}, base, { treatment: arm('380', '', '-3', '0') })), planValue(pl)).ok, true);
});

test('readout: through date, looks and SRM threshold', () => {
  assert.deepStrictEqual(roErrors({ through: '2025-03-01' }), { 'ec-ro-through': 'The data-through date is before the start date.' });
  assert.deepStrictEqual(roErrors({ through: '2025-02-30' }), { 'ec-ro-through': 'Enter a valid date (YYYY-MM-DD).' });
  assert.strictEqual(v.parseReadout(rawRo({ through: '2025-03-03' }), planValue()).ok, true);
  assert.strictEqual(v.parseReadout(rawRo({ through: '' }), planValue()).value.through, null);
  assert.strictEqual(v.parseReadout(rawRo({ through: '2025-01-01' }), planValue({ start: '' })).ok, true);
  const LOOKS = 'Enter how many times results were looked at (1 or more).';
  assert.deepStrictEqual(roErrors({ looks: '0' }), { 'ec-ro-looks': LOOKS });
  assert.deepStrictEqual(roErrors({ looks: '1001' }), { 'ec-ro-looks': LOOKS });
  assert.deepStrictEqual(roErrors({ looks: '' }), { 'ec-ro-looks': LOOKS });
  assert.deepStrictEqual(roErrors({ looks: '2.5' }), { 'ec-ro-looks': INTEGER });
  const SRM = 'Use a threshold between 0.00001 and 0.05 (default 0.001).';
  assert.deepStrictEqual(roErrors({ srmThreshold: '0.1' }), { 'ec-ro-srm-threshold': SRM });
  assert.deepStrictEqual(roErrors({ srmThreshold: '0.000001' }), { 'ec-ro-srm-threshold': SRM });
  assert.strictEqual(v.parseReadout(rawRo({ srmThreshold: '0.00001' }), planValue()).value.srmThreshold, 0.00001);
});

test('readout: guardrails all or none', () => {
  const grPlan = { guardrails: [
    { id: 'g1', name: 'Refund rate', type: 'binary', direction: 'decrease', margin: '10' },
    { id: 'g2', name: 'Page load', type: 'continuous', direction: 'decrease', margin: '5' }
  ] };
  const PARTIAL = 'Fill in every field for this guardrail, or leave them all empty.';
  const empty = v.parseReadout(rawRo(), planValue(grPlan));
  assert.strictEqual(empty.ok, true);
  assert.deepStrictEqual(empty.value.guardrails, { g1: { state: 'empty' }, g2: { state: 'empty' } });
  const partial = roErrors({ guardrails: { g1: { control: arm('15400', '300'), treatment: arm('15380', '') } } }, grPlan);
  assert.deepStrictEqual(partial, { 'ec-rg-g1-t-x': PARTIAL });
  const partial2 = roErrors({ guardrails: { g2: { control: arm('100', '', '1200', ''), treatment: arm('', '', '', '') } } }, grPlan);
  assert.deepStrictEqual(partial2, {
    'ec-rg-g2-c-sd': PARTIAL, 'ec-rg-g2-t-n': PARTIAL, 'ec-rg-g2-t-mean': PARTIAL, 'ec-rg-g2-t-sd': PARTIAL
  });
  const bad = roErrors({ guardrails: { g1: { control: arm('100', '200'), treatment: arm('100', '5') } } }, grPlan);
  assert.deepStrictEqual(bad, { 'ec-rg-g1-c-x': "Conversions can't be more than users." });
  const full = v.parseReadout(rawRo({ guardrails: {
    g1: { control: arm('15400', '300'), treatment: arm('15380', '372') },
    g2: { control: arm('15400', '', '1200', '400'), treatment: arm('15380', '', '1205', '400') }
  } }), planValue(grPlan));
  assert.strictEqual(full.ok, true);
  assert.deepStrictEqual(full.value.guardrails, {
    g1: { state: 'ok', control: { n: 15400, x: 300 }, treatment: { n: 15380, x: 372 } },
    g2: { state: 'ok', control: { n: 15400, mean: 1200, sd: 400 }, treatment: { n: 15380, mean: 1205, sd: 400 } }
  });
});

test('readout: never throws on junk input', () => {
  assert.doesNotThrow(() => v.parseReadout(null, null));
  assert.doesNotThrow(() => v.parseReadout({ control: 5, guardrails: 'x' }, { guardrails: [null] }));
  assert.strictEqual(v.parseReadout(undefined, undefined).empty, true);
});
