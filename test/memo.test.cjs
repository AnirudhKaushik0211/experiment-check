'use strict';
// SPEC 8.3 documents: toMarkdown, pre-registration and the golden decision memo (10.1 memo.test.cjs row).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const memo = require('../js/memo.js');
const ro = require('../js/readout.js');
const plan = require('../js/plan.js');
const validate = require('../js/validate.js');
const scenarios = require('../js/scenarios.js');

function pipeline(st) {
  const pp = validate.parsePlan(st.plan);
  const pr = plan.computePlan(pp.value);
  const r = validate.parseReadout(st.readout, pp.value);
  return { pp: pp, pr: pr, r: r, a: ro.audit(pp, pr, r) };
}
function memoFor(st) {
  const x = pipeline(st);
  return memo.toMarkdown(memo.buildMemo({ plan: x.pp.value, planResult: x.pr, readout: x.r.value, audit: x.a, version: '1.0.0', generatedOn: '2025-03-17' }));
}
function byId(id) { return scenarios.list.find(s => s.id === id); }
function trimNl(s) { return s.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, ''); }

test('toMarkdown: block rendering and escaping', () => {
  const md = memo.toMarkdown({ title: 'T', blocks: [
    { type: 'h1', text: 'Title\nwith newline' },
    { type: 'h2', text: 'Sub' },
    { type: 'strong-p', strong: 'Bold.', text: 'Rest' },
    { type: 'p', text: 'Para\u0007 one\nline two\r' },
    { type: 'ul', items: ['a', 'b\u0000'] },
    { type: 'table', header: ['Name', 'Value'], rows: [['A | B', 'x\ny'], ['C\u0001', 'z']] }
  ] });
  assert.strictEqual(md, '# Title with newline\n\n## Sub\n\n**Bold.** Rest\n\nPara one\nline two\n\n- a\n- b\n\n' +
    '| Name | Value |\n|---|---|\n| A \\| B | x y |\n| C | z |\n');
  assert.ok(md.endsWith('|\n') && !md.endsWith('\n\n'));
});

test('user text: single-line fields lose newlines, control characters removed', () => {
  const st = JSON.parse(JSON.stringify(byId('guardrail-breach').state));
  st.plan.name = 'Line\none\u0007';
  st.plan.guardrails[0].name = 'Refund | rate';
  const md = memoFor(st);
  assert.ok(md.startsWith('# Decision memo: Line one\n'), md.slice(0, 40));
  assert.ok(md.includes('| Guardrail: Refund \\| rate | FAIL |'));
  assert.ok(!/[\u0000-\u0009\u000B-\u001F]/.test(md));
});

test('buildPrereg: section order and P14 decision-rule numbers', () => {
  const x = pipeline(byId('guardrail-breach').state);
  const doc = memo.buildPrereg({ plan: x.pp.value, planResult: x.pr, srmThreshold: 0.001, version: '1.0.0', generatedOn: '2025-03-01' });
  const md = memo.toMarkdown(doc);
  const heads = doc.blocks.filter(b => b.type === 'h1' || b.type === 'h2').map(b => b.text);
  assert.deepStrictEqual(heads, ['Pre-registration: Express checkout button', 'Hypothesis', 'Primary metric', 'Sample and duration',
    'Guardrail metrics', 'Decision rule', 'Notes']);
  for (const s of [
    'Prepared 2025-03-01 with ExperimentCheck 1.0.0.',
    '- Metric: Checkout conversion (conversion rate, higher is better)',
    '- Baseline: 10.00%',
    '- Minimum detectable effect: +1.00 pp (10.00% relative), so the target is 11.00%',
    '- Test: two-proportion z-test, two-sided, alpha 5%, power 80%',
    '- Split: 50% control / 50% treatment',
    '- Required users: 14,751 control + 14,751 treatment = 29,502',
    '- Traffic: 2,200 users per day, so 13.4 days of traffic',
    '- Run for: 14 days (2 full weeks)',
    '- Start: 2025-03-03; planned end (last day of data): 2025-03-16',
    '| Guardrail | Type | Better when | Limit |',
    '| Refund rate | rate | lower | 10.00% worse |',
    '| Page load time (ms) | mean | lower | 5.00% worse |',
    '- If the sample ratio check fails (p < 0.001), investigate; do not decide.',
    '- Ship if the primary metric improves with p < 0.05 and the observed improvement is at least the MDE (+1.00 pp).',
    '## Notes\n\nNone.\n'
  ]) assert.ok(md.includes(s), 'missing: ' + s);
  // No guardrails, no start, no hypothesis.
  const bare = JSON.parse(JSON.stringify(byId('clean-win').state.plan));
  Object.assign(bare, { name: '', metricName: '', guardrails: [], start: '', hypothesis: '' });
  const pp2 = validate.parsePlan(bare);
  const md2 = memo.toMarkdown(memo.buildPrereg({ plan: pp2.value, planResult: plan.computePlan(pp2.value), srmThreshold: 0.001, version: '1.0.0', generatedOn: '2025-03-01' }));
  for (const s of ['# Pre-registration: Untitled experiment', '- Metric: Primary metric (', 'Not written yet.',
    'None. Consider adding at least one guardrail.', '- Start: not set yet']) assert.ok(md2.includes(s), 'missing: ' + s);
});

test('relative MDE brackets only when the baseline is positive', () => {
  const raw = Object.assign({}, byId('clean-win').state.plan, { type: 'continuous', baselineRate: '', baselineMean: '-5', baselineSd: '2', mdeType: 'absolute', mde: '1', guardrails: [] });
  const pp = validate.parsePlan(raw);
  const pr = plan.computePlan(pp.value);
  const md = memo.toMarkdown(memo.buildPrereg({ plan: pp.value, planResult: pr, srmThreshold: 0.001, version: '1.0.0', generatedOn: '2025-03-01' }));
  assert.ok(md.includes('- Minimum detectable effect: +1, so the target is -4\n'), md);
  assert.ok(!md.includes('relative)'));
  assert.ok(md.includes("- Test: Welch's t-test, two-sided"));
  assert.ok(md.includes('- Baseline: mean -5, SD 2'));
});

test('buildMemo(guardrail-breach) equals docs/sample-decision-memo.md', () => {
  const golden = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sample-decision-memo.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = golden.indexOf('<!-- memo:start -->');
  const end = golden.indexOf('<!-- memo:end -->');
  assert.ok(start >= 0 && end > start);
  const expected = trimNl(golden.slice(start + '<!-- memo:start -->'.length, end));
  assert.strictEqual(trimNl(memoFor(byId('guardrail-breach').state)), expected);
});

test('every scenario memo contains its verdict label', () => {
  for (const sc of scenarios.list) {
    const md = memoFor(sc.state);
    assert.ok(md.includes('**Verdict: ' + ro.LABELS[sc.expected.verdict] + '.**'), sc.id);
    assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
  }
});

test('continuous memo: Welch line and relative lift n/a', () => {
  const st = JSON.parse(JSON.stringify(byId('clean-win').state));
  Object.assign(st.plan, { type: 'continuous', baselineRate: '', baselineMean: '50', baselineSd: '12', mdeType: 'absolute', mde: '2', start: '', guardrails: [] });
  Object.assign(st.readout, { control: { n: '400', x: '', mean: '50', sd: '12' }, treatment: { n: '380', x: '', mean: '52', sd: '15' }, through: '', guardrails: {} });
  const md = memoFor(st);
  assert.ok(md.includes("- Test: Welch's t-test, t = 2.05, df = 725.3, p = 0.041, two-sided"), md);
  assert.ok(md.includes('- Data: Dates not given, 780 users'));
  assert.ok(md.includes('| Control | 400 | 50 | 12 |'));
  const neg = JSON.parse(JSON.stringify(st));
  neg.plan.baselineMean = '-5';
  neg.readout.control.mean = '-5';
  assert.ok(memoFor(neg).includes('- Relative lift: n/a (needs a positive control mean)'));
});
