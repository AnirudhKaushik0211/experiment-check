/* ExperimentCheck plan: effect to detect, sample size, duration, advice and sensitivity (SPEC 5).
 * Binary: Fleiss, Levin and Paik (2003) ch. 4, normal approximation without continuity correction.
 * Continuous: Chow, Shao and Wang (2008) section 3.2, normal approximation, equal SD.
 * Pure: assumes validated input but never throws; returns NaN or {ok: false} instead. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { stats: require('./stats.js') } : { stats: root.ExperimentCheck.stats };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.plan = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var stats = deps.stats;

  var SENS_DAYS = [7, 14, 21, 28, 42, 56, 84];
  var EPS = 1e-9;

  var ADVICE = {
    always: 'Run whole weeks so every weekday is represented equally, and at least 7 days to dampen novelty effects.',
    long: 'This is a long test (over 8 weeks). Consider a larger MDE, more traffic or a more sensitive metric; long tests suffer from cookie churn and seasonality.',
    decade: 'That is more than 10 years of traffic. Increase the MDE or the traffic.',
    uneven: 'An uneven split needs more users in total than 50/50 for the same power.',
    smallN: 'Small sample: the normal approximation behind this plan is optimistic below about 30 users per arm.',
    oneSided: "A one-sided test can only show an improvement. A harmful effect will read as 'not significant', so watch the guardrails."
  };
  var INFEASIBLE_MESSAGE = 'This MDE is too small to detect with any realistic sample. Increase the MDE.';

  // ceil with a 1e-9 epsilon, so 3841.0000000001 (floating noise) stays 3841.
  function ceilEps(x) { return Math.ceil(x - EPS); }

  // za, zb and k (n_treatment = k * n_control) for a parsed plan.
  function quantiles(plan) {
    return {
      za: stats.normInv(1 - plan.alpha / plan.sides),
      zb: stats.normInv(plan.power),
      k: plan.share / (1 - plan.share)
    };
  }

  // 5.3: control-arm n for two independent proportions (pooled variance under H0, unpooled under H1).
  function sampleSizeBinary(p1, p2, k, za, zb) {
    var pbar = (p1 + k * p2) / (1 + k), qbar = 1 - pbar;
    var a = za * Math.sqrt(pbar * qbar * (1 + 1 / k)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / k);
    return a * a / ((p2 - p1) * (p2 - p1));
  }

  // 5.4: control-arm n for two means with a common SD.
  function sampleSizeContinuous(sd, delta, k, za, zb) {
    return (1 + 1 / k) * sd * sd * (za + zb) * (za + zb) / (delta * delta);
  }

  // UTC date arithmetic on 'YYYY-MM-DD' strings.
  function addDays(start, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start));
    if (!m || !isFinite(days)) return null;
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }

  // 5.5 duration rules from the total sample and daily traffic.
  function duration(total, daily) {
    var rawDays = total / daily;
    var daysNeeded = ceilEps(rawDays);
    var recommendedDays = Math.max(7, 7 * Math.ceil(daysNeeded / 7));
    return { rawDays: rawDays, daysNeeded: daysNeeded, recommendedDays: recommendedDays, weeks: recommendedDays / 7 };
  }

  function baselineOf(plan) { return plan.type === 'binary' ? plan.p1 : plan.mean; }
  function isBaselinePositive(plan) { return plan.type === 'binary' || plan.mean > 0; }

  // 5.6: detectable absolute MDE for a control-arm sample (treatment = k * nControl).
  function mdeForSample(plan, nControl) {
    if (!plan || typeof plan !== 'object' || !(nControl >= 1)) return NaN;
    var q = quantiles(plan);
    if (plan.type === 'continuous') {
      return (q.za + q.zb) * plan.sd * Math.sqrt(1 / nControl + 1 / (q.k * nControl));
    }
    var p1 = plan.p1, dir = plan.dir > 0 ? 1 : -1;
    var need = function (D) { return sampleSizeBinary(p1, p1 + dir * D, q.k, q.za, q.zb); };
    var hi = (dir > 0 ? 1 - p1 : p1) - 1e-9, lo = 0;
    if (!(need(hi) <= nControl)) return NaN;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (need(mid) > nControl) lo = mid; else hi = mid;
    }
    return hi;
  }

  function sensitivityRow(plan, days, recommendedDays, bp, baseline) {
    var users = days * plan.daily;
    var nC = Math.floor(users * (1 - plan.share));
    var nT = Math.floor(users * plan.share);
    var mdeAbs = mdeForSample(plan, nC);
    return {
      days: days, weeks: days / 7, nC: nC, nT: nT,
      mdeAbs: mdeAbs, mdeRel: bp ? mdeAbs / baseline : NaN,
      isPlan: days === recommendedDays
    };
  }

  function sensitivity(plan, recommendedDays, bp, baseline) {
    var list = SENS_DAYS.slice();
    if (list.indexOf(recommendedDays) < 0) {
      list.push(recommendedDays);
      list.sort(function (a, b) { return a - b; });
    }
    return list.map(function (d) { return sensitivityRow(plan, d, recommendedDays, bp, baseline); });
  }

  function advice(plan, d, nControl, nTreatment) {
    var out = [ADVICE.always];
    if (d.daysNeeded < 7) {
      out.push('The sample needs only ' + d.daysNeeded + ' day(s) of traffic, but run 7 days anyway so every weekday is covered.');
    }
    if (d.daysNeeded >= 7 && d.daysNeeded % 7 !== 0) {
      out.push(d.daysNeeded + ' days of traffic rounds up to ' + d.recommendedDays + ' days (' + d.weeks + ' full weeks).');
    }
    if (d.recommendedDays > 56) out.push(ADVICE.long);
    if (d.rawDays > 3650) out.push(ADVICE.decade);
    if (plan.share !== 0.5) out.push(ADVICE.uneven);
    if (plan.type === 'continuous' && Math.min(nControl, nTreatment) < 30) out.push(ADVICE.smallN);
    if (plan.sides === 1) out.push(ADVICE.oneSided);
    return out;
  }

  // 5.7: full plan result, or {ok: false, reason}.
  function computePlan(plan) {
    if (!plan || typeof plan !== 'object') return { ok: false, reason: 'invalid' };
    var baseline = baselineOf(plan);
    var mdeAbs = plan.mdeType === 'relative' ? plan.mde * baseline : plan.mde;
    var bp = isBaselinePositive(plan);
    var mdeRel = bp ? mdeAbs / baseline : NaN;
    var dir = plan.dir > 0 ? 1 : -1;
    var target = baseline + dir * mdeAbs;
    var q = quantiles(plan);

    var n1 = plan.type === 'binary'
      ? sampleSizeBinary(plan.p1, target, q.k, q.za, q.zb)
      : sampleSizeContinuous(plan.sd, mdeAbs, q.k, q.za, q.zb);
    if (!isFinite(n1)) return { ok: false, reason: 'infeasible' };
    var nControl = ceilEps(n1);
    if (nControl > 1e12) return { ok: false, reason: 'infeasible' };
    var n2 = q.k * n1;
    var nTreatment = ceilEps(n2);
    var total = nControl + nTreatment;
    if (!(plan.daily >= 1)) return { ok: false, reason: 'invalid' };
    var d = duration(total, plan.daily);

    return {
      ok: true,
      mdeAbs: mdeAbs,
      mdeRel: mdeRel,
      baselinePositive: bp,
      target: target,
      za: q.za,
      zb: q.zb,
      k: q.k,
      n1Raw: n1,
      n2Raw: n2,
      nControl: nControl,
      nTreatment: nTreatment,
      total: total,
      rawDays: d.rawDays,
      daysNeeded: d.daysNeeded,
      recommendedDays: d.recommendedDays,
      weeks: d.weeks,
      plannedEnd: plan.start ? addDays(plan.start, d.recommendedDays - 1) : null,
      advice: advice(plan, d, nControl, nTreatment),
      sensitivity: sensitivity(plan, d.recommendedDays, bp, baseline),
      test: plan.type === 'binary' ? 'z' : 'welch'
    };
  }

  return {
    SENS_DAYS: SENS_DAYS,
    INFEASIBLE_MESSAGE: INFEASIBLE_MESSAGE,
    ceilEps: ceilEps,
    sampleSizeBinary: sampleSizeBinary,
    sampleSizeContinuous: sampleSizeContinuous,
    addDays: addDays,
    duration: duration,
    mdeForSample: mdeForSample,
    computePlan: computePlan
  };
});
