'use strict';
// SPEC 6.8 verdict, reasons and the 8.4 scenarios (10.1 verdict.test.cjs row).
const test = require('node:test');
const assert = require('node:assert');
const ro = require('../js/readout.js');
const plan = require('../js/plan.js');
const validate = require('../js/validate.js');
const scenarios = require('../js/scenarios.js');

function auditState(state) {
  const pp = validate.parsePlan(state.plan);
  assert.ok(pp.ok, JSON.stringify(pp.errors));
  const pr = plan.computePlan(pp.value);
  assert.ok(pr.ok);
  const r = validate.parseReadout(state.readout, pp.value);
  return ro.audit(pp, pr, r);
}
function byId(id) { return scenarios.list.find(s => s.id === id); }
function statuses(a) { const o = {}; a.checks.forEach(c => { o[c.id] = c.status; }); return o; }
function reasonIds(a) { return a.reasons.map(r => r.id); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

const FIXED = {
  'clean-win': ['ship-meaningful'],
  flat: ['underpowered'],
  trivial: ['trivial'],
  srm: ['srm', 'primary-only'],
  peeking: ['early', 'short-duration', 'sample-shortfall', 'primary-only', 'obf'],
  'guardrail-breach': ['guardrail-breach', 'primary-only']
};

test('six scenarios, each with its expected verdict, decisive id and fixed reasons', () => {
  assert.strictEqual(scenarios.list.length, 6);
  for (const s of scenarios.list) {
    const a = auditState(s.state);
    assert.strictEqual(a.verdict, s.expected.verdict, s.id);
    assert.strictEqual(a.decisive, s.expected.decisive, s.id);
    assert.strictEqual(a.label, ro.LABELS[s.expected.verdict], s.id);
    assert.deepStrictEqual(reasonIds(a), FIXED[s.id], s.id);
    assert.strictEqual(a.reasons[0].status, 'decisive');
  }
});

test('clean-win: all PASS except the INFO rows', () => {
  assert.deepStrictEqual(statuses(auditState(byId('clean-win').state)), {
    srm: 'PASS', timing: 'PASS', duration: 'PASS', sample: 'PASS', assumptions: 'PASS',
    significance: 'INFO', practical: 'PASS', 'guardrail:g1': 'PASS'
  });
});

test('flat, trivial and srm check statuses', () => {
  assert.deepStrictEqual(statuses(auditState(byId('flat').state)), {
    srm: 'PASS', timing: 'PASS', duration: 'PASS', sample: 'PASS', assumptions: 'PASS',
    significance: 'INFO', practical: 'INFO', 'guardrail:g1': 'PASS'
  });
  assert.deepStrictEqual(statuses(auditState(byId('trivial').state)), {
    srm: 'PASS', timing: 'PASS', duration: 'PASS', sample: 'PASS', assumptions: 'PASS',
    significance: 'INFO', practical: 'WARN', 'guardrail:g1': 'PASS'
  });
  const srm = auditState(byId('srm').state);
  assert.deepStrictEqual(statuses(srm), {
    srm: 'FAIL', timing: 'PASS', duration: 'PASS', sample: 'PASS', assumptions: 'PASS',
    significance: 'INFO', practical: 'PASS', 'guardrail:g1': 'PASS'
  });
  const po = srm.reasons.find(r => r.id === 'primary-only');
  assert.ok(po.text.startsWith('Primary metric on its own: Ship. '), po.text);
  assert.strictEqual(srm.reasons[0].text, 'Sample ratio mismatch: p < 0.0001 is below the 0.001 alert threshold (expected 15,350/15,350, observed 15,800/14,900).');
  assert.strictEqual(srm.summary, "The traffic split does not match the plan, so the results can't be trusted yet.");
});

test('peeking: timing FAIL, duration WARN, sample WARN, obf reason', () => {
  const a = auditState(byId('peeking').state);
  assert.deepStrictEqual(statuses(a), {
    srm: 'PASS', timing: 'FAIL', duration: 'WARN', sample: 'WARN', assumptions: 'PASS',
    significance: 'INFO', practical: 'PASS', 'guardrail:g1': 'PASS'
  });
  assert.ok(a.reasons.some(r => r.id === 'obf' && r.status === 'info'));
  assert.strictEqual(a.reasons[0].text, 'Analysed early: data through 2025-03-07, planned end 2025-03-16 (day 5 of 14).');
  const timing = a.checks.find(c => c.id === 'timing');
  assert.strictEqual(timing.detail, 'Analysed on day 5 of 14 (data through 2025-03-07; planned end 2025-03-16). 3 looks so far; the false-positive rate is about 0.107 instead of 0.05 if any look could have stopped the test.');
  assert.strictEqual(a.checks.find(c => c.id === 'sample').detail.slice(0, 41), '11,010 of 29,502 planned users (37%). At ');
  assert.ok(Math.abs(a.tInfo - 0.3732) < 1e-4);
});

test('guardrail-breach: g1 FAIL, g2 PASS, primary-only Ship, sample PASS (104%)', () => {
  const a = auditState(byId('guardrail-breach').state);
  const st = statuses(a);
  assert.strictEqual(st['guardrail:g1'], 'FAIL');
  assert.strictEqual(st['guardrail:g2'], 'PASS');
  assert.ok(a.reasons[1].text.startsWith('Primary metric on its own: Ship. '));
  const sample = a.checks.find(c => c.id === 'sample');
  assert.strictEqual(sample.status, 'PASS');
  assert.ok(sample.detail.includes('(104%)'), sample.detail);
});

test('synthetic SRM plus early', () => {
  const st = clone(byId('clean-win').state);
  st.plan.guardrails = [];
  st.readout.guardrails = {};
  Object.assign(st.readout, {
    control: { n: '5800', x: '580', mean: '', sd: '' }, treatment: { n: '5210', x: '600', mean: '', sd: '' },
    through: '2025-03-07', looks: '1'
  });
  const a = auditState(st);
  assert.strictEqual(a.verdict, 'investigate');
  assert.deepStrictEqual(reasonIds(a), ['srm', 'early', 'short-duration', 'sample-shortfall', 'primary-only', 'obf']);
  const early = a.reasons[1];
  assert.strictEqual(early.status, 'fail');
  assert.ok(early.text.startsWith('Timing / peeking: Analysed on day 5 of 14'), early.text);
});

test('precedence: SRM beats a guardrail breach; a breach beats early', () => {
  const st = clone(byId('guardrail-breach').state);
  st.readout.control.n = '15800'; st.readout.treatment.n = '14900';
  const a = auditState(st);
  assert.strictEqual(a.verdict, 'investigate');
  assert.strictEqual(a.decisive, 'srm');
  assert.ok(reasonIds(a).includes('guardrail-breach'));
  const st2 = clone(byId('guardrail-breach').state);
  st2.readout.through = '2025-03-10';
  const b = auditState(st2);
  assert.strictEqual(b.verdict, 'dont-ship');
  assert.strictEqual(b.decisive, 'guardrail-breach');
  assert.deepStrictEqual(reasonIds(b), ['guardrail-breach', 'early', 'partial-week', 'primary-only', 'obf']);
});

test('additional breached guardrails use the breach reason text', () => {
  const st = clone(byId('guardrail-breach').state);
  st.plan.guardrails[1].margin = '0.1';
  const a = auditState(st);
  assert.deepStrictEqual(reasonIds(a), ['guardrail-breach', 'guardrail-breach', 'primary-only']);
  assert.ok(a.reasons[1].text.startsWith('Guardrail breached: Page load time (ms) got 0.42% worse (limit 0.10%).'), a.reasons[1].text);
});

test('primaryCall branches', () => {
  const pc = (p, e, lo, hi, m) => ro.primaryCall({ computable: true, p: p, e: e, lo: lo, hi: hi }, m === undefined ? 0.01 : m, 0.05, 2);
  assert.deepStrictEqual(pc(0.001, -0.02, -0.03, -0.01), { verdict: 'dont-ship', reason: 'harm' });
  assert.deepStrictEqual(pc(0.04, 0.008, -0.0001, 0.016), { verdict: 'inconclusive', reason: 'borderline' });
  assert.deepStrictEqual(pc(0.001, 0.02, 0.01, 0.03), { verdict: 'ship', reason: 'ship-meaningful' });
  assert.deepStrictEqual(pc(0.001, 0.004, 0.002, 0.006), { verdict: 'dont-ship', reason: 'trivial' });
  assert.deepStrictEqual(pc(0.001, 0.008, 0.004, 0.012), { verdict: 'inconclusive', reason: 'below-mde' });
  assert.deepStrictEqual(pc(0.4, 0.001, -0.004, 0.006), { verdict: 'dont-ship', reason: 'flat' });
  assert.deepStrictEqual(pc(0.2, 0.004, -0.002, 0.011), { verdict: 'inconclusive', reason: 'underpowered' });
  assert.deepStrictEqual(ro.primaryCall({ computable: false }, 0.01, 0.05, 2), { verdict: 'inconclusive', reason: 'no-variance' });
});

test('verdict none for an empty readout or an invalid plan', () => {
  const st = clone(byId('clean-win').state);
  const pp = validate.parsePlan(st.plan);
  const pr = plan.computePlan(pp.value);
  const empty = validate.parseReadout({ control: {}, treatment: {}, through: '', looks: '1', srmThreshold: '0.001' }, pp.value);
  assert.strictEqual(empty.empty, true);
  const a = ro.audit(pp, pr, empty);
  assert.strictEqual(a.verdict, 'none');
  assert.strictEqual(a.label, 'No verdict yet');
  assert.deepStrictEqual(a.reasons, []);
  const ok = validate.parseReadout(st.readout, pp.value);
  assert.strictEqual(ro.audit(pp, { ok: false, reason: 'infeasible' }, ok).verdict, 'none');
  assert.strictEqual(ro.audit({ ok: false, value: null, errors: { x: 'y' } }, pr, ok).verdict, 'none');
});

test('meetsMde tolerance', () => {
  assert.strictEqual(ro.meetsMde(0.01, 0.01), true);
  assert.strictEqual(ro.meetsMde(0.01 - 1e-13, 0.01), true);
  assert.strictEqual(ro.meetsMde(0.01 - 1e-9, 0.01), false);
});

test('OBF suffix only when looks > 1', () => {
  const SUFFIX = '(exact at a first interim look; at later looks the true boundary is stricter)';
  assert.ok(ro.obfText(0.0013, 0.05, 0.37, 0.013, 3).includes(SUFFIX));
  assert.ok(!ro.obfText(0.0013, 0.05, 0.37, 0.013, 1).includes(SUFFIX));
  const st = clone(byId('peeking').state);
  st.readout.looks = '1';
  const a = auditState(st);
  const obf = a.reasons.find(r => r.id === 'obf');
  assert.ok(obf && !obf.text.includes(SUFFIX));
  assert.ok(obf.text.includes('would allow about 0.0013 of the 0.05 at this point (information fraction 0.37). The observed p = 0.013 would not cross it.'), obf.text);
  assert.ok(auditState(byId('peeking').state).reasons.find(r => r.id === 'obf').text.includes(SUFFIX));
  // Looks > 1 after the planned end: a looks WARN and an obf reason, no suffix-free text.
  const late = clone(byId('clean-win').state);
  late.readout.looks = '4';
  const b = auditState(late);
  assert.deepStrictEqual(reasonIds(b), ['ship-meaningful', 'looks', 'obf']);
});
