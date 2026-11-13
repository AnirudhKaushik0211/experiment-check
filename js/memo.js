/* ExperimentCheck memo: pre-registration and decision memo documents, and their Markdown (SPEC 8.3).
 * A document is {title, blocks}; the UI renders the same blocks with textContent. Pure, never throws. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { format: require('./format.js'), plan: require('./plan.js'), readout: require('./readout.js') }
    : { format: root.ExperimentCheck.format, plan: root.ExperimentCheck.plan, readout: root.ExperimentCheck.readout };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.memo = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var f = deps.format;
  var readoutLib = deps.readout;

  // 6.10, shown verbatim in every memo.
  var LIMITATIONS = [
    'Users are randomised independently, the analysis unit equals the randomisation unit, and each user is counted once.',
    'Normal approximations: z-test, Wald CI and Katz log CI (binary); delta-method relative CI (continuous); normal-approximation sample size. They are unreliable with small counts, and the tool warns.',
    "Welch's t-test assumes approximately normal sample means (central limit theorem). Heavily skewed metrics (revenue) may need more data or a transformation.",
    'One treatment vs one control. No correction for multiple metrics or multiple guardrails.',
    'No valid sequential testing: peeking is only warned about. The O\'Brien-Fleming figure is informational.',
    'The verdict is a documented rule, not a substitute for judgement about costs, risks and strategy.',
    'Daily traffic is assumed constant. Returning users make the real duration longer.'
  ];

  var DECISION_RULE = 'Decision rule: ship only if the sample ratio check passes, no guardrail is breached, the analysis is on or after the planned end, and the primary metric improves significantly by at least the MDE.';

  // ---- Text hygiene -------------------------------------------------------------------------

  var RE_CTRL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

  // Removes control characters other than \n.
  function clean(s) { return String(s === undefined || s === null ? '' : s).replace(RE_CTRL_MULTI, ''); }
  // Single-line user text: control characters removed, newlines replaced by spaces.
  function line(s) { return clean(s).replace(/\n/g, ' '); }
  function cell(s) { return line(s).replace(/\|/g, '\\|'); }

  // ---- toMarkdown ---------------------------------------------------------------------------

  function toMarkdown(doc) {
    var blocks = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
    var out = [];
    blocks.forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      switch (b.type) {
        case 'h1': out.push('# ' + line(b.text)); break;
        case 'h2': out.push('## ' + line(b.text)); break;
        case 'p': out.push(clean(b.text)); break;
        case 'strong-p': out.push('**' + line(b.strong) + '** ' + clean(b.text)); break;
        case 'ul': out.push((b.items || []).map(function (i) { return '- ' + clean(i); }).join('\n')); break;
        case 'table': {
          var header = b.header || [];
          var rows = ['| ' + header.map(cell).join(' | ') + ' |', '|' + header.map(function () { return '---|'; }).join('')];
          (b.rows || []).forEach(function (r) { rows.push('| ' + r.map(cell).join(' | ') + ' |'); });
          out.push(rows.join('\n'));
          break;
        }
        default: break;
      }
    });
    return out.join('\n\n') + '\n';
  }

  // ---- Shared pieces ------------------------------------------------------------------------

  function nameOf(plan) { var s = line(plan.name).trim(); return s === '' ? 'Untitled experiment' : s; }
  function metricOf(plan) { var s = line(plan.metricName).trim(); return s === '' ? 'Primary metric' : s; }
  function isBinary(plan) { return plan.type !== 'continuous'; }
  function better(dir) { return dir < 0 ? 'lower' : 'higher'; }
  function sidesText(plan) { return plan.sides === 1 ? 'one-sided' : 'two-sided'; }
  function unitS(plan, x) { return isBinary(plan) ? f.pp(x) : f.snum(x); }

  function metricLine(plan) {
    return metricOf(plan) + ' (' + (isBinary(plan) ? 'conversion rate' : 'mean') + ', ' + better(plan.dir) + ' is better)';
  }
  function mdeText(plan, pr) {
    return unitS(plan, pr.mdeAbs) + (pr.baselinePositive ? ' (' + f.pct(pr.mdeRel) + ' relative)' : '');
  }
  function targetText(plan, pr) { return isBinary(plan) ? f.pct(pr.target) : f.num(pr.target); }
  function splitText(plan) { return f.num(100 * (1 - plan.share)) + '% control / ' + f.num(100 * plan.share) + '% treatment'; }
  function sampleText(pr) { return f.int(pr.nControl) + ' control + ' + f.int(pr.nTreatment) + ' treatment = ' + f.int(pr.total); }

  function unwrap(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.ok === 'boolean' && 'errors' in x) return x.ok ? x.value : null;
    return x;
  }

  // ---- Pre-registration ---------------------------------------------------------------------

  function buildPrereg(o) {
    o = o || {};
    var plan = unwrap(o.plan) || {}, pr = o.planResult || {};
    var srm = typeof o.srmThreshold === 'number' && isFinite(o.srmThreshold) ? o.srmThreshold : 0.001;
    var hyp = clean(plan.hypothesis).trim(), notes = clean(plan.notes).trim();
    var title = 'Pre-registration: ' + nameOf(plan);
    var blocks = [
      { type: 'h1', text: title },
      { type: 'p', text: 'Prepared ' + o.generatedOn + ' with ExperimentCheck ' + o.version + ". Agree on this before the test starts, and don't change it afterwards." },
      { type: 'h2', text: 'Hypothesis' },
      { type: 'p', text: hyp === '' ? 'Not written yet.' : hyp },
      { type: 'h2', text: 'Primary metric' },
      { type: 'ul', items: [
        'Metric: ' + metricLine(plan),
        'Baseline: ' + (isBinary(plan) ? f.pct(plan.p1) : 'mean ' + f.num(plan.mean) + ', SD ' + f.num(plan.sd)),
        'Minimum detectable effect: ' + mdeText(plan, pr) + ', so the target is ' + targetText(plan, pr),
        'Test: ' + (isBinary(plan) ? 'two-proportion z-test' : "Welch's t-test") + ', ' + sidesText(plan) +
          ', alpha ' + f.num(100 * plan.alpha) + '%, power ' + f.num(100 * plan.power) + '%'
      ] },
      { type: 'h2', text: 'Sample and duration' },
      { type: 'ul', items: [
        'Split: ' + splitText(plan),
        'Required users: ' + sampleText(pr),
        'Traffic: ' + f.int(plan.daily) + ' users per day, so ' + (isFinite(pr.rawDays) ? pr.rawDays.toFixed(1) : 'n/a') + ' days of traffic',
        'Run for: ' + pr.recommendedDays + ' days (' + pr.weeks + ' full week' + (pr.weeks === 1 ? '' : 's') + ')',
        plan.start ? 'Start: ' + plan.start + '; planned end (last day of data): ' + pr.plannedEnd : 'Start: not set yet'
      ] },
      { type: 'h2', text: 'Guardrail metrics' }
    ];
    var gr = plan.guardrails || [];
    if (gr.length) {
      blocks.push({
        type: 'table', header: ['Guardrail', 'Type', 'Better when', 'Limit'],
        rows: gr.map(function (g) {
          return [line(g.name), g.type === 'continuous' ? 'mean' : 'rate', better(g.dir), f.pct(g.margin) + ' worse'];
        })
      });
    } else {
      blocks.push({ type: 'p', text: 'None. Consider adding at least one guardrail.' });
    }
    blocks.push(
      { type: 'h2', text: 'Decision rule' },
      { type: 'ul', items: [
        'Analyse once, on or after the planned end date. Earlier looks do not change the decision.',
        'If the sample ratio check fails (p < ' + f.num(srm) + '), investigate; do not decide.',
        'If any guardrail is worse than its limit, do not ship.',
        'Ship if the primary metric improves with p < ' + f.num(plan.alpha) + ' and the observed improvement is at least the MDE (' + unitS(plan, pr.mdeAbs) + ').',
        'Do not ship if the whole confidence interval is below the MDE, if the primary metric is significantly worse, or if the interval rules out an improvement as large as the MDE.',
        'Otherwise the result is inconclusive: extend the test or re-plan.'
      ] },
      { type: 'h2', text: 'Notes' },
      { type: 'p', text: notes === '' ? 'None.' : notes }
    );
    return { title: title, blocks: blocks };
  }

  // ---- Decision memo ------------------------------------------------------------------------

  function buildMemo(o) {
    o = o || {};
    var plan = unwrap(o.plan) || {}, pr = o.planResult || {}, ro = unwrap(o.readout) || {};
    var au = o.audit || {};
    var prim = au.primary || {};
    var c = ro.control || {}, t = ro.treatment || {};
    var binary = isBinary(plan);
    var name = nameOf(plan);
    var title = 'Decision memo: ' + name;
    var label = au.label || readoutLib.LABELS.none;
    var hyp = line(plan.hypothesis).trim();
    var dates = plan.start && ro.through
      ? plan.start + ' to ' + ro.through + ' (' + au.observedDays + ' days)'
      : 'Dates not given';

    var blocks = [
      { type: 'h1', text: title },
      { type: 'strong-p', strong: 'Verdict: ' + label + '.', text: au.summary || '' },
      { type: 'ul', items: [
        'Experiment: ' + name,
        'Primary metric: ' + metricLine(plan),
        'Data: ' + dates + ', ' + f.int(c.n + t.n) + ' users',
        'Prepared: ' + o.generatedOn + ' with ExperimentCheck ' + o.version + '. All numbers were computed in the browser from the inputs below.'
      ] },
      { type: 'h2', text: 'Why' },
      { type: 'ul', items: (au.reasons || []).map(function (r) { return r.text; }) },
      { type: 'h2', text: 'Next step' },
      { type: 'p', text: au.next || '' },
      { type: 'h2', text: 'Primary metric' }
    ];

    if (binary) {
      blocks.push({
        type: 'table', header: ['Arm', 'Users', 'Conversions', 'Conversion rate'],
        rows: [
          ['Control', f.int(c.n), f.int(c.x), f.pct(c.x / c.n)],
          ['Treatment', f.int(t.n), f.int(t.x), f.pct(t.x / t.n)]
        ]
      });
    } else {
      blocks.push({
        type: 'table', header: ['Arm', 'Users', 'Mean', 'SD'],
        rows: [
          ['Control', f.int(c.n), f.num(c.mean), f.num(c.sd)],
          ['Treatment', f.int(t.n), f.num(t.mean), f.num(t.sd)]
        ]
      });
    }
    var ci = prim.ci || [NaN, NaN], relCi = prim.relCi || [NaN, NaN];
    var level = prim.level || '';
    var u = function (x) { return unitS(plan, x); };
    blocks.push({ type: 'ul', items: [
      'Absolute difference: ' + u(prim.diff) + ' (' + level + ' CI ' + u(ci[0]) + ' to ' + u(ci[1]) + ')',
      isFinite(prim.rel)
        ? 'Relative lift: ' + f.spct(prim.rel) + ' (' + level + ' CI ' + f.spct(relCi[0]) + ' to ' + f.spct(relCi[1]) + ')'
        : 'Relative lift: n/a (' + (prim.relNa || '') + ')',
      'Test: ' + (binary
        ? 'two-proportion z-test (pooled), z = ' + f.stat(prim.z)
        : "Welch's t-test, t = " + f.stat(prim.t) + ', df = ' + f.df(prim.df)) +
        ', ' + f.pText(prim.p) + ', ' + sidesText(plan),
      'Pre-registered MDE: ' + mdeText(plan, pr)
    ] });

    blocks.push(
      { type: 'h2', text: 'Checks' },
      { type: 'table', header: ['Check', 'Result', 'Detail'],
        rows: (au.checks || []).map(function (ch) { return [ch.label, ch.status, ch.detail]; }) },
      { type: 'h2', text: 'Pre-registered plan' }
    );

    var gr = plan.guardrails || [];
    blocks.push({ type: 'ul', items: [
      'Hypothesis: ' + (hyp === '' ? 'Not written.' : hyp),
      'Test: ' + sidesText(plan) + ', alpha ' + f.num(100 * plan.alpha) + '%, power ' + f.num(100 * plan.power) + '%, split ' + splitText(plan),
      'Baseline ' + (binary ? f.pct(plan.p1) : f.num(plan.mean) + ' (SD ' + f.num(plan.sd) + ')') + '; MDE ' + mdeText(plan, pr) + '; target ' + targetText(plan, pr),
      'Planned sample: ' + sampleText(pr) + ' users',
      'Planned duration: ' + pr.recommendedDays + ' days' + (plan.start ? ' from ' + plan.start + ' (planned end ' + pr.plannedEnd + ')' : ', start not set'),
      gr.length
        ? 'Guardrails: ' + gr.map(function (g) { return line(g.name) + ' (' + better(g.dir) + ' is better, limit ' + f.pct(g.margin) + ' worse)'; }).join('; ')
        : 'Guardrails: none.',
      DECISION_RULE
    ] });

    blocks.push(
      { type: 'h2', text: 'Assumptions and limitations' },
      { type: 'ul', items: LIMITATIONS.slice() },
      { type: 'h2', text: 'Method' },
      { type: 'ul', items: [
        binary
          ? 'Two-proportion z-test with a pooled standard error; Wald interval for the difference; Katz log interval for the relative lift.'
          : "Welch's t-test with Welch-Satterthwaite degrees of freedom; t interval for the difference; delta-method interval for the relative lift (approximate).",
        'Sample ratio check: chi-square goodness-of-fit against the planned split (1 degree of freedom).',
        'Guardrails: relative change with a ' + f.num(100 * (1 - plan.alpha)) + '% interval (Katz log interval for rates, delta method for means); breached when the observed degradation exceeds the limit.',
        binary
          ? 'Sample size: normal approximation for two proportions without continuity correction (Fleiss, Levin and Paik 2003, ch. 4).'
          : 'Sample size: normal approximation for two means (Chow, Shao and Wang 2008, section 3.2).',
        'Verdict: statistical versus practical significance (Kohavi, Tang and Xu 2020, ch. 2); sample ratio check first (Kohavi, Tang and Xu 2020, ch. 21; Fabijan et al. 2019).'
      ] }
    );
    return { title: title, blocks: blocks };
  }

  return {
    LIMITATIONS: LIMITATIONS,
    toMarkdown: toMarkdown,
    buildPrereg: buildPrereg,
    buildMemo: buildMemo
  };
});
