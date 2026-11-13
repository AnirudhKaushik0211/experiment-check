/* ExperimentCheck readout: primary-metric tests, SRM, timing, guardrails, checks and verdict (SPEC 6).
 * Binary: two-proportion z-test with pooled SE, Wald CI, Katz et al. (1978) log relative CI.
 * Continuous: Welch (1947) t-test with Welch-Satterthwaite df, delta-method relative CI (approximate).
 * SRM: chi-square goodness-of-fit, 1 df. OBF text: Lan and DeMets (1983) spending, informational only.
 * Repeated looks: Armitage, McPherson and Rowe (1969), as tabulated in Jennison and Turnbull (2000) table 1.1.
 * Pure: assumes validated input but never throws; returns NaN or a 'none' verdict instead. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { stats: require('./stats.js'), plan: require('./plan.js') } : { stats: root.ExperimentCheck.stats, plan: root.ExperimentCheck.plan };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.readout = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var stats = deps.stats;
  var planLib = deps.plan;

  // ---- Private 6.11 formatters --------------------------------------------------------------
  // The 2.2 dependency table does not list format for readout, so check and reason texts use
  // these private copies of the format.js rules (same output, kept in sync by the memo golden test).
  var NA = 'n/a';
  function finite(x) { return typeof x === 'number' && isFinite(x); }
  function group(s) {
    var sign = '';
    if (s.charAt(0) === '-' || s.charAt(0) === '+') { sign = s.charAt(0); s = s.slice(1); }
    var dot = s.indexOf('.');
    var ip = dot < 0 ? s : s.slice(0, dot);
    var fp = dot < 0 ? '' : s.slice(dot);
    return sign + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
  }
  function isZeroStr(s) { return !/[1-9]/.test(s); }
  function fixed(x, d) {
    var s = x.toFixed(d);
    if (isZeroStr(s)) s = s.replace(/^-/, '');
    return group(s);
  }
  function signedFixed(x, d) {
    var s = x.toFixed(d);
    if (isZeroStr(s)) return '+' + group(s.replace(/^-/, ''));
    return s.charAt(0) === '-' ? group(s) : '+' + group(s);
  }
  function int(n) { return finite(n) ? fixed(Math.round(n), 0) : NA; }
  function pct(f, d) { if (d === undefined) d = 2; return finite(f) ? fixed(100 * f, d) + '%' : NA; }
  function spct(f, d) { if (d === undefined) d = 2; return finite(f) ? signedFixed(100 * f, d) + '%' : NA; }
  function pp(f) { return finite(f) ? signedFixed(100 * f, 2) + ' pp' : NA; }
  function ppAbs(f) { return finite(f) ? fixed(100 * Math.abs(f), 2) + ' pp' : NA; }
  function plain(s) {
    var m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    if (!m) return s;
    var sign = m[1], digits = m[2] + (m[3] || ''), exp = parseInt(m[4], 10);
    if (exp < 0) return sign + '0.' + new Array(-exp).join('0') + digits;
    if (digits.length <= exp + 1) return sign + digits + new Array(exp + 2 - digits.length).join('0');
    return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  }
  function num(x) {
    if (!finite(x)) return NA;
    if (Math.abs(x) >= 1e5) return fixed(Math.round(x), 0);
    var s = plain(x.toPrecision(6));
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (isZeroStr(s)) s = '0';
    return group(s);
  }
  function snum(x) { var s = num(x); return s === NA || s.charAt(0) === '-' ? s : '+' + s; }
  function pValue(p) {
    if (!finite(p)) return NA;
    if (p < 0.0001) return '< 0.0001';
    return p < 0.01 ? fixed(p, 4) : fixed(p, 3);
  }
  function pText(p) { return finite(p) ? (p < 0.0001 ? 'p < 0.0001' : 'p = ' + pValue(p)) : NA; }
  function stat(x) { return finite(x) ? fixed(x, 2) : NA; }

  // ---- Labels and verdict texts (6.8) -------------------------------------------------------

  var LABELS = {
    ship: 'Ship',
    'dont-ship': "Don't ship",
    inconclusive: 'Inconclusive - extend',
    investigate: 'Investigate (SRM)',
    none: 'No verdict yet'
  };
  var SUMMARY = {
    srm: "The traffic split does not match the plan, so the results can't be trusted yet.",
    'guardrail-breach': 'A guardrail got worse by more than its pre-registered limit.',
    early: "The test was analysed before its planned end, so the result isn't final.",
    'ship-meaningful': 'The primary metric improved by at least the MDE, and the result is statistically significant.',
    trivial: 'The improvement is real but smaller than the MDE.',
    'below-mde': 'The improvement is significant, but it may be smaller than the MDE.',
    borderline: 'The result sits right at the edge of significance.',
    harm: 'The primary metric got significantly worse.',
    flat: 'No meaningful effect: the data rule out an improvement as large as the MDE.',
    underpowered: "The test can't tell yet whether there is a meaningful effect.",
    'no-variance': 'The data show no variation.'
  };
  var NEXT = {
    srm: 'Find the cause before reading any metric: check assignment, redirects, bot filtering, logging and eligibility rules. Re-run after fixing it.',
    'guardrail-breach': 'Do not roll out as is. Fix the guardrail regression, then re-test.',
    early: 'Keep the test running until the planned end date, then analyse once.',
    'ship-meaningful': 'Roll out, and keep watching the guardrails after launch.',
    trivial: 'Ship only if the change costs nothing to keep; otherwise drop it and test a bolder idea.',
    'below-mde': 'Extend the test or re-run it with more users to pin down the size of the effect.',
    borderline: 'Extend the test to get a clearer answer.',
    harm: 'Do not roll out. Learn from the result and iterate.',
    flat: 'Stop here. Do not roll out; test a different idea.',
    underpowered: 'Extend the test, or re-plan with the observed numbers, a larger MDE or more traffic.',
    'no-variance': 'Check that the numbers were entered correctly.'
  };

  // ---- 6.2-6.5 Primary metric ---------------------------------------------------------------

  // 6.5: the one MDE comparison, shared by the practical check and primaryCall.
  function meetsMde(e, m) { return e >= m - 1e-12; }

  function normSides(s) { return s === 1 ? 1 : 2; }
  function normDir(d) { return d < 0 ? -1 : 1; }

  // 6.2: primary interval quantile (two-sided 1-alpha, or 1-2alpha for a one-sided test).
  function confidenceZ(alpha, sides) { return stats.normInv(normSides(sides) === 1 ? 1 - alpha : 1 - alpha / 2); }
  function levelText(alpha, sides) { return num(100 * (1 - (normSides(sides) === 1 ? 2 : 1) * alpha)) + '%'; }

  // Katz log relative change for two proportions; NaN when an arm has zero events.
  function katzRelative(c, t, z) {
    if (!(c.x > 0 && t.x > 0)) return { rel: NaN, relCi: [NaN, NaN] };
    var p1 = c.x / c.n, p2 = t.x / t.n, lr = Math.log(p2 / p1);
    var lse = Math.sqrt((1 - p1) / c.x + (1 - p2) / t.x);
    return { rel: p2 / p1 - 1, relCi: [Math.exp(lr - z * lse) - 1, Math.exp(lr + z * lse) - 1] };
  }

  // Delta-method relative change for two means; NaN unless the control mean is positive.
  function deltaRelative(c, t, z) {
    if (!(c.mean > 0)) return { rel: NaN, relCi: [NaN, NaN] };
    var rel = t.mean / c.mean - 1;
    var mc2 = c.mean * c.mean;
    var rse = Math.sqrt(t.sd * t.sd / (t.n * mc2) + t.mean * t.mean * c.sd * c.sd / (c.n * mc2 * mc2));
    return { rel: rel, relCi: [rel - z * rse, rel + z * rse] };
  }

  // 6.3: two-proportion z-test. c, t = {n, x}; opts = {alpha, sides, dir}.
  function twoProportion(c, t, opts) {
    opts = opts || {};
    var sides = normSides(opts.sides), dir = normDir(opts.dir);
    var zc = confidenceZ(opts.alpha, sides);
    var p1 = c.x / c.n, p2 = t.x / t.n, diff = p2 - p1;
    var pool = (c.x + t.x) / (c.n + t.n);
    var se0 = Math.sqrt(pool * (1 - pool) * (1 / c.n + 1 / t.n));
    var computable = se0 > 0 && isFinite(se0);
    var z = computable ? diff / se0 : NaN;
    var p = computable ? (sides === 2 ? 2 * stats.normSf(Math.abs(z)) : stats.normSf(dir * z)) : NaN;
    var se = Math.sqrt(p1 * (1 - p1) / c.n + p2 * (1 - p2) / t.n);
    var r = katzRelative(c, t, zc);
    return {
      type: 'binary', computable: computable, reason: computable ? null : 'no-variance',
      rate1: p1, rate2: p2, diff: diff, se0: se0, z: z, p: p, se: se,
      ci: [diff - zc * se, diff + zc * se], rel: r.rel, relCi: r.relCi,
      relNa: isNaN(r.rel) ? 'needs at least one conversion in each arm' : null, zc: zc, sides: sides
    };
  }

  // 6.4: Welch's t-test. c, t = {n, mean, sd}; opts = {alpha, sides, dir}.
  function welch(c, t, opts) {
    opts = opts || {};
    var sides = normSides(opts.sides), dir = normDir(opts.dir);
    var zc = confidenceZ(opts.alpha, sides);
    var vc = c.sd * c.sd / c.n, vt = t.sd * t.sd / t.n;
    var se = Math.sqrt(vc + vt), diff = t.mean - c.mean;
    var computable = se > 0 && isFinite(se);
    var tt = computable ? diff / se : NaN;
    var df = computable ? (vc + vt) * (vc + vt) / (vc * vc / (c.n - 1) + vt * vt / (t.n - 1)) : NaN;
    var p = computable ? (sides === 2 ? 2 * stats.tSf(Math.abs(tt), df) : stats.tSf(dir * tt, df)) : NaN;
    var tc = stats.tInv(sides === 2 ? 1 - opts.alpha / 2 : 1 - opts.alpha, df);
    var r = deltaRelative(c, t, zc);
    return {
      type: 'continuous', computable: computable, reason: computable ? null : 'no-variance',
      diff: diff, se: se, t: tt, df: df, p: p, tc: tc,
      ci: [diff - tc * se, diff + tc * se], rel: r.rel, relCi: r.relCi,
      relNa: isNaN(r.rel) ? 'needs a positive control mean' : null, zc: zc, sides: sides
    };
  }

  // 6.5: direction-adjusted effect and bounds (positive is good).
  function adjust(primary, dir) {
    dir = normDir(dir);
    primary.e = dir * primary.diff;
    primary.lo = dir > 0 ? primary.ci[0] : -primary.ci[1];
    primary.hi = dir > 0 ? primary.ci[1] : -primary.ci[0];
    return primary;
  }

  // ---- 6.6 SRM ------------------------------------------------------------------------------

  function srmTest(nc, nt, share) {
    var N = nc + nt, ec = N * (1 - share), et = N * share;
    var chi2 = (nc - ec) * (nc - ec) / ec + (nt - et) * (nt - et) / et;
    return { ec: ec, et: et, chi2: chi2, p: stats.chiSquareSf(chi2, 1) };
  }

  // ---- 6.7 Timing and peeking ---------------------------------------------------------------

  var LOOKS = [1, 2, 3, 4, 5, 10, 20, 50, 100];
  var LOOKS_FPR = ['0.05', '0.083', '0.107', '0.126', '0.142', '0.193', '0.248', '0.320', '0.374'];

  // Overall false-positive rate after `looks` looks (text), only tabulated for alpha 0.05 two-sided.
  function looksFpr(looks, alpha, sides) {
    if (!(Math.abs(alpha - 0.05) < 1e-12 && normSides(sides) === 2)) return 'higher than alpha';
    if (!(looks > 1)) return LOOKS_FPR[0];
    for (var i = 1; i < LOOKS.length; i++) {
      if (looks === LOOKS[i]) return LOOKS_FPR[i];
      if (looks < LOOKS[i]) return 'between ' + LOOKS_FPR[i - 1] + ' and ' + LOOKS_FPR[i];
    }
    return 'above 0.374';
  }

  // O'Brien-Fleming-type spending (Lan-DeMets): 2 - 2 normCdf(z_{1-alpha/2} / sqrt(t)).
  function alphaSpent(tInfo, alpha) {
    if (!(tInfo > 0 && tInfo <= 1)) return NaN;
    return 2 * stats.normSf(stats.normInv(1 - alpha / 2) / Math.sqrt(tInfo));
  }

  function obfText(spent, alpha, tInfo, p, looks) {
    var suffix = looks > 1 ? ' (exact at a first interim look; at later looks the true boundary is stricter)' : '';
    var cross = p < spent ? 'would' : 'would not';
    return "Informational, approximate: an O'Brien-Fleming-type plan (Lan-DeMets spending) would allow about " +
      (finite(spent) ? spent.toFixed(4) : NA) + ' of the ' + num(alpha) + ' at this point (information fraction ' +
      (finite(tInfo) ? tInfo.toFixed(2) : NA) + '). The observed ' + pText(p) + ' ' + cross + ' cross it' + suffix +
      '. This only applies if such a plan was set before the test.';
  }

  function dayNumber(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
  }

  // ---- 6.9 Guardrails -----------------------------------------------------------------------

  // g = plan guardrail {id, name, type, dir, margin}; data = readout guardrail; alpha = plan alpha.
  function guardrailCheck(g, data, alpha) {
    var out = { id: 'guardrail:' + g.id, gid: g.id, name: g.name, label: 'Guardrail: ' + g.name, margin: g.margin };
    function warn(reasonId, detail) { out.status = 'WARN'; out.reasonId = reasonId; out.detail = detail; return out; }
    if (!data || data.state !== 'ok') return warn('guardrail-missing', 'No data entered.');
    var c = data.control, t = data.treatment;
    var z = stats.normInv(1 - alpha / 2);
    var r;
    if (g.type === 'continuous') {
      if (!(c.mean > 0)) return warn('guardrail-na', 'Relative change needs a positive control mean.');
      r = deltaRelative(c, t, z);
    } else {
      if (!(c.x > 0 && t.x > 0)) return warn('guardrail-na', "Relative change can't be computed with zero events in an arm.");
      r = katzRelative(c, t, z);
    }
    var dir = normDir(g.dir);
    var deg = -dir * r.rel;
    var worst = dir > 0 ? -r.relCi[0] : r.relCi[1];
    out.rel = r.rel; out.relCi = r.relCi; out.deg = deg; out.worst = worst;
    var tail;
    if (deg > g.margin) { out.status = 'FAIL'; out.reasonId = 'guardrail-breach'; tail = 'Breached.'; }
    else if (g.margin < worst) { out.status = 'WARN'; out.reasonId = 'guardrail-at-risk'; tail = 'At risk: the CI reaches ' + pct(worst) + ' worse.'; }
    else { out.status = 'PASS'; out.reasonId = null; tail = 'Within the limit.'; }
    out.detail = 'Change ' + spct(r.rel) + ' (' + num(100 * (1 - alpha)) + '% CI ' + spct(r.relCi[0]) + ' to ' + spct(r.relCi[1]) +
      '); ' + (dir > 0 ? 'higher' : 'lower') + ' is better; limit ' + pct(g.margin) + ' worse. ' + tail;
    return out;
  }

  function breachText(check) {
    return 'Guardrail breached: ' + check.name + ' got ' + pct(check.deg) + ' worse (limit ' + pct(check.margin) + ').';
  }

  // ---- 6.8 Verdict --------------------------------------------------------------------------

  // primary = {computable, p, e, lo, hi}; returns {verdict, reason}.
  function primaryCall(primary, m, alpha, sides) {
    if (!primary || !primary.computable) return { verdict: 'inconclusive', reason: 'no-variance' };
    var sig = primary.p < alpha;
    var e = primary.e, lo = primary.lo, hi = primary.hi;
    if (sig && e < 0) return { verdict: 'dont-ship', reason: 'harm' };
    if (sig && e > 0) {
      if (lo <= 0) return { verdict: 'inconclusive', reason: 'borderline' };
      if (meetsMde(e, m)) return { verdict: 'ship', reason: 'ship-meaningful' };
      if (hi < m) return { verdict: 'dont-ship', reason: 'trivial' };
      return { verdict: 'inconclusive', reason: 'below-mde' };
    }
    if (hi < m) return { verdict: 'dont-ship', reason: 'flat' };
    return { verdict: 'inconclusive', reason: 'underpowered' };
  }

  // Reason text for a primaryCall outcome; u = signed unit formatter, ua = absolute unit formatter.
  function primaryText(reason, pr, m, u, ua) {
    var E = u(pr.e), LO = u(pr.lo), HI = u(pr.hi), M = u(m), P = pText(pr.p), L = pr.level;
    switch (reason) {
      case 'ship-meaningful': return 'Primary metric improved by ' + E + ' (' + P + '), at least the MDE of ' + M + '.';
      case 'trivial': return 'Primary metric improved by ' + E + ' (' + P + '), but the whole ' + L + ' CI (' + LO + ' to ' + HI + ') is below the MDE of ' + M + '.';
      case 'below-mde': return 'Primary metric improved by ' + E + ' (' + P + '); the point estimate is below the MDE of ' + M + ', but the CI reaches ' + HI + '.';
      case 'borderline': return 'The p-value (' + P + ') and the ' + L + ' CI (' + LO + ' to ' + HI + ') disagree at the edge of significance.';
      case 'harm': return 'Primary metric got worse by ' + ua(pr.e) + ' (' + P + ').';
      case 'flat': return 'No significant effect (' + P + '); the ' + L + ' CI (' + LO + ' to ' + HI + ') rules out an improvement as large as the MDE of ' + M + '.';
      case 'underpowered': return 'No significant effect (' + P + '), and the ' + L + ' CI (' + LO + ' to ' + HI + ') still includes the MDE of ' + M + '.';
      default: return 'The primary metric has no variation in either arm, so no test can be computed.';
    }
  }

  function none() {
    return {
      verdict: 'none', label: LABELS.none, decisive: null, summary: '', next: '',
      reasons: [], checks: [], primary: null
    };
  }

  // Accepts a parse result ({ok, value}) or a plain value.
  function unwrap(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.ok === 'boolean' && 'errors' in x) return x.ok && !x.empty ? x.value : null;
    return x;
  }

  // Full audit: checks in 6.7 order, verdict, reasons and texts (6.7-6.9).
  function audit(parsedPlan, planResult, parsedReadout) {
    var plan = unwrap(parsedPlan), ro = unwrap(parsedReadout);
    if (!plan || !ro || !planResult || planResult.ok !== true) return none();
    var alpha = plan.alpha, sides = normSides(plan.sides), dir = normDir(plan.dir);
    var binary = plan.type !== 'continuous';
    var u = binary ? pp : snum;
    var ua = binary ? ppAbs : function (x) { return num(Math.abs(x)); };
    var c = ro.control, t = ro.treatment;
    var m = planResult.mdeAbs;

    var primary = binary ? twoProportion(c, t, { alpha: alpha, sides: sides, dir: dir }) : welch(c, t, { alpha: alpha, sides: sides, dir: dir });
    adjust(primary, dir);
    primary.level = levelText(alpha, sides);
    var checks = [];

    // srm
    var s = srmTest(c.n, t.n, plan.share);
    var thr = ro.srmThreshold;
    var srmCheck = {
      id: 'srm', label: 'Sample ratio (SRM)', status: s.p < thr ? 'FAIL' : 'PASS', reasonId: s.p < thr ? 'srm' : null,
      detail: 'Expected ' + num(s.ec) + '/' + num(s.et) + ' at ' + num(100 * (1 - plan.share)) + '/' + num(100 * plan.share) +
        '; observed ' + int(c.n) + '/' + int(t.n) + '; chi-square = ' + stat(s.chi2) + ', ' + pText(s.p) + ' (alert below ' + num(thr) + ').'
    };
    checks.push(srmCheck);

    // timing
    var through = ro.through || null, plannedEnd = planResult.plannedEnd || null;
    var datesKnown = !!(through && plannedEnd);
    var observedDays = through && plan.start ? dayNumber(through) - dayNumber(plan.start) + 1 : NaN;
    var early = datesKnown && through < plannedEnd;
    var looks = ro.looks;
    var fpr = looksFpr(looks, alpha, sides);
    var R = planResult.recommendedDays;
    var timing = { id: 'timing', label: 'Timing / peeking' };
    if (early) {
      timing.status = 'FAIL'; timing.reasonId = 'early';
      timing.detail = 'Analysed on day ' + observedDays + ' of ' + R + ' (data through ' + through + '; planned end ' + plannedEnd + ').' +
        (looks > 1 ? ' ' + looks + ' looks so far; the false-positive rate is about ' + fpr + ' instead of ' + num(alpha) + ' if any look could have stopped the test.' : '');
    } else if (looks > 1) {
      timing.status = 'WARN'; timing.reasonId = 'looks';
      timing.detail = looks + ' looks; the false-positive rate is about ' + fpr + ' instead of ' + num(alpha) + ' if any earlier look could have stopped the test.';
    } else if (datesKnown) {
      timing.status = 'PASS'; timing.reasonId = null;
      timing.detail = 'Data through ' + through + ', on or after the planned end; 1 look.';
    } else {
      timing.status = 'WARN'; timing.reasonId = 'dates-missing';
      timing.detail = "Dates missing: set a start date in Plan and 'data through' here to check for early stopping.";
    }
    checks.push(timing);

    // duration
    var D = observedDays;
    var duration = { id: 'duration', label: 'Duration' };
    if (!finite(D)) { duration.status = 'INFO'; duration.reasonId = null; duration.detail = 'Not checked (dates missing).'; }
    else if (D < 7) { duration.status = 'WARN'; duration.reasonId = 'short-duration'; duration.detail = 'Only ' + D + ' days: less than one full week, so weekday and novelty effects may be unbalanced.'; }
    else if (D % 7 !== 0) { duration.status = 'WARN'; duration.reasonId = 'partial-week'; duration.detail = D + ' days is not a whole number of weeks; weekdays are unevenly represented.'; }
    else { duration.status = 'PASS'; duration.reasonId = null; duration.detail = D + ' days (' + (D / 7) + ' full weeks).'; }
    checks.push(duration);

    // sample
    var N = c.n + t.n;
    var ratio = N / planResult.total;
    var baseline = binary ? plan.p1 : plan.mean;
    var mdeText = function (x) {
      if (!finite(x)) return 'no effect of any size';
      return planResult.baselinePositive ? pct(x / baseline) + ' relative' : num(x) + ' units';
    };
    var sample = { id: 'sample', label: 'Sample size' };
    var head = int(N) + ' of ' + int(planResult.total) + ' planned users (' + pct(ratio, 0) + ').';
    if (ratio < 0.9) {
      sample.status = 'WARN'; sample.reasonId = 'sample-shortfall';
      sample.detail = head + ' At this sample the test can detect about ' + mdeText(planLib.mdeForSample(plan, c.n)) + ' (planned ' + mdeText(m) + ').';
    } else { sample.status = 'PASS'; sample.reasonId = null; sample.detail = head; }
    checks.push(sample);

    // assumptions
    var assumptions = { id: 'assumptions', label: 'Approximation' };
    if (binary) {
      if (Math.min(c.x, c.n - c.x, t.x, t.n - t.x) < 10) {
        assumptions.status = 'WARN'; assumptions.reasonId = 'small-counts';
        assumptions.detail = "Fewer than 10 events or non-events in an arm: the normal approximation is unreliable. An exact test (for example Fisher's) would be better; it is not included.";
      } else {
        assumptions.status = 'PASS'; assumptions.reasonId = null;
        assumptions.detail = 'Normal approximation reasonable (at least 10 events and non-events per arm).';
      }
    } else if (Math.min(c.n, t.n) < 30) {
      assumptions.status = 'WARN'; assumptions.reasonId = 'small-n';
      assumptions.detail = 'Fewer than 30 users in an arm: the t-test is sensitive to skewed data at this size.';
    } else {
      assumptions.status = 'PASS'; assumptions.reasonId = null;
      assumptions.detail = 'Normal approximation reasonable (at least 30 users per arm).';
    }
    checks.push(assumptions);

    // significance and practical (never produce reasons)
    var sig = primary.computable && primary.p < alpha;
    checks.push({
      id: 'significance', label: 'Statistical significance', status: 'INFO', reasonId: null,
      detail: primary.computable
        ? pText(primary.p) + ' vs alpha ' + num(alpha) + ' (' + (sides === 2 ? 'two-sided' : 'one-sided') + '): ' + (sig ? 'significant' : 'not significant') + '.'
        : 'Not computable: no variation in the data.'
    });
    var practical = { id: 'practical', label: 'Practical significance', reasonId: null };
    if (!primary.computable) { practical.status = 'INFO'; practical.detail = 'Not computable.'; }
    else if (meetsMde(primary.e, m)) { practical.status = 'PASS'; practical.detail = 'Observed effect ' + u(primary.e) + ' is at least the MDE ' + u(m) + '.'; }
    else if (sig && primary.hi < m) { practical.status = 'WARN'; practical.detail = 'Whole CI is below the MDE ' + u(m) + '.'; }
    else if (sig) { practical.status = 'WARN'; practical.detail = 'Point estimate ' + u(primary.e) + ' is below the MDE ' + u(m) + '.'; }
    else if (primary.hi < m) { practical.status = 'INFO'; practical.detail = 'CI upper bound ' + u(primary.hi) + ' is below the MDE ' + u(m) + ': a meaningful improvement is ruled out.'; }
    else { practical.status = 'INFO'; practical.detail = 'CI still includes the MDE ' + u(m) + '.'; }
    checks.push(practical);

    // guardrails
    var roGr = ro.guardrails && typeof ro.guardrails === 'object' ? ro.guardrails : {};
    var grChecks = (plan.guardrails || []).map(function (g) {
      var data = Object.prototype.hasOwnProperty.call(roGr, g.id) ? roGr[g.id] : null;
      return guardrailCheck(g, data, alpha);
    });
    grChecks.forEach(function (gc) { checks.push(gc); });

    // verdict
    var pc = primaryCall(primary, m, alpha, sides);
    var firstBreach = null;
    for (var i = 0; i < grChecks.length; i++) if (grChecks[i].status === 'FAIL') { firstBreach = grChecks[i]; break; }
    var verdict, decisive, decisiveText, skip;
    if (srmCheck.status === 'FAIL') {
      verdict = 'investigate'; decisive = 'srm'; skip = srmCheck;
      decisiveText = 'Sample ratio mismatch: ' + pText(s.p) + ' is below the ' + num(thr) + ' alert threshold (expected ' +
        num(s.ec) + '/' + num(s.et) + ', observed ' + int(c.n) + '/' + int(t.n) + ').';
    } else if (firstBreach) {
      verdict = 'dont-ship'; decisive = 'guardrail-breach'; skip = firstBreach;
      decisiveText = breachText(firstBreach);
    } else if (early) {
      verdict = 'inconclusive'; decisive = 'early'; skip = timing;
      decisiveText = 'Analysed early: data through ' + through + ', planned end ' + plannedEnd + ' (day ' + observedDays + ' of ' + R + ').';
    } else {
      verdict = pc.verdict; decisive = pc.reason; skip = null;
      decisiveText = primaryText(pc.reason, primary, m, u, ua);
    }

    var reasons = [{ id: decisive, status: 'decisive', text: decisiveText }];
    ['FAIL', 'WARN'].forEach(function (status) {
      checks.forEach(function (ch) {
        if (ch === skip || ch.status !== status || !ch.reasonId) return;
        reasons.push({
          id: ch.reasonId, status: status.toLowerCase(),
          text: ch.reasonId === 'guardrail-breach' ? breachText(ch) : ch.label + ': ' + ch.detail
        });
      });
    });
    if (skip && primary.computable) {
      reasons.push({ id: 'primary-only', status: 'info', text: 'Primary metric on its own: ' + LABELS[pc.verdict] + '. ' + primaryText(pc.reason, primary, m, u, ua) });
    }
    var tInfo = Math.min(1, N / planResult.total);
    var spent = alphaSpent(tInfo, alpha);
    var obf = early || looks > 1 ? obfText(spent, alpha, tInfo, primary.p, looks) : null;
    if (obf) reasons.push({ id: 'obf', status: 'info', text: obf });

    return {
      verdict: verdict, label: LABELS[verdict], decisive: decisive, summary: SUMMARY[decisive], next: NEXT[decisive],
      reasons: reasons, checks: checks, primary: primary, primaryCall: pc, srm: s, guardrails: grChecks,
      early: early, observedDays: observedDays, tInfo: tInfo, alphaSpent: spent, obf: obf, fpr: fpr
    };
  }

  return {
    LABELS: LABELS,
    meetsMde: meetsMde,
    confidenceZ: confidenceZ,
    levelText: levelText,
    katzRelative: katzRelative,
    deltaRelative: deltaRelative,
    twoProportion: twoProportion,
    welch: welch,
    adjust: adjust,
    srmTest: srmTest,
    looksFpr: looksFpr,
    alphaSpent: alphaSpent,
    obfText: obfText,
    guardrailCheck: guardrailCheck,
    primaryCall: primaryCall,
    audit: audit
  };
});
