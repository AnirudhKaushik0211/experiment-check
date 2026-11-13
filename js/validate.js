/* ExperimentCheck validate: parsing and validation of raw (string) inputs (SPEC 8.1, 8.2).
 * Owns every input invariant. Pure: never throws, never reads the clock. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.validate = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  // ---- 8.1 Number and date parsing ----------------------------------------------------------

  var MSG_FORMAT = 'Enter a number, like 12.5.';
  var MSG_INTEGER = 'Enter a whole number, like 1200.';
  var MSG_DATE = 'Enter a valid date (YYYY-MM-DD).';

  var RE_NUM = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
  var RE_NUM_FRAC = /^[+-]?\.\d+$/;
  var RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function str(raw) { return raw === undefined || raw === null ? '' : String(raw); }

  // Returns {ok: true, value} | {ok: false, error: 'format'|'integer'} | {empty: true}.
  function parseNumber(raw, opts) {
    opts = opts || {};
    var s = str(raw).trim();
    if (s === '') return { empty: true };
    if (opts.percent && s.charAt(s.length - 1) === '%') s = s.slice(0, -1).trim();
    if (!(RE_NUM.test(s) || RE_NUM_FRAC.test(s))) return { ok: false, error: 'format' };
    var value = Number(s.replace(/,/g, ''));
    if (!isFinite(value)) return { ok: false, error: 'format' };
    if (opts.integer && !Number.isInteger(value)) return { ok: false, error: 'integer' };
    return { ok: true, value: value };
  }

  function numberErrorMessage(error) { return error === 'integer' ? MSG_INTEGER : MSG_FORMAT; }

  // Real calendar date between 2000-01-01 and 2100-12-31, in YYYY-MM-DD form.
  function isValidDate(raw) {
    var s = str(raw);
    if (!RE_DATE.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
    return s >= '2000-01-01' && s <= '2100-12-31';
  }

  function truncate(raw, max) { return str(raw).slice(0, max); }

  // ---- 8.2 Plan validation ------------------------------------------------------------------

  // Parses one required numeric field. `check(v)` returns '' when valid or the range message.
  // `emptyMsg` is used for a blank field (defaults to the range message).
  function field(errors, id, raw, opts, emptyMsg, check) {
    var r = parseNumber(raw, opts);
    if (r.empty) { errors[id] = emptyMsg; return NaN; }
    if (!r.ok) { errors[id] = numberErrorMessage(r.error); return NaN; }
    var msg = check(r.value);
    if (msg) { errors[id] = msg; return NaN; }
    return r.value;
  }

  // Formats a target rate in percent for the MDE target message (at most 2 decimals).
  function targetText(t) { return String(Number((100 * t).toFixed(2))); }

  // parsePlan(raw) -> {ok, value, errors: {fieldId: message}}; value has the SPEC 5.1 shape.
  function parsePlan(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var errors = {};
    var type = raw.type === 'continuous' ? 'continuous' : 'binary';
    var dir = raw.direction === 'decrease' ? -1 : 1;
    var mdeType = raw.mdeType === 'absolute' ? 'absolute' : 'relative';
    var sides = raw.sides === 'one' ? 1 : 2;
    var p1 = null, mean = null, sd = null;
    var baseline = NaN;

    if (type === 'binary') {
      var rate = field(errors, 'ec-plan-baseline-rate', raw.baselineRate, { percent: true },
        'Enter the baseline conversion rate, for example 10 for 10%.',
        function (v) { return v > 0 && v < 100 ? '' : 'The baseline rate must be above 0% and below 100%.'; });
      if (!isNaN(rate)) { p1 = rate / 100; baseline = p1; }
    } else {
      var m = field(errors, 'ec-plan-baseline-mean', raw.baselineMean, {}, 'Enter the baseline mean.',
        function (v) {
          if (!(Math.abs(v) <= 1e12)) return 'Use a value between -1e12 and 1e12.';
          if (mdeType === 'relative' && !(v > 0)) return 'A relative MDE needs a positive baseline mean. Use an absolute MDE instead.';
          return '';
        });
      if (!isNaN(m)) { mean = m; baseline = m; }
      var sdMsg = 'The standard deviation must be greater than 0.';
      var s = field(errors, 'ec-plan-baseline-sd', raw.baselineSd, {}, sdMsg,
        function (v) { return v > 0 && v <= 1e12 ? '' : sdMsg; });
      if (!isNaN(s)) sd = s;
    }

    var mdeZero = 'The MDE must be greater than 0.';
    var mdeRawValue = field(errors, 'ec-plan-mde', raw.mde, { percent: mdeType === 'relative' || type === 'binary' }, mdeZero,
      function (v) {
        if (!(v > 0)) return mdeZero;
        if (mdeType === 'relative' && v > 1000) return 'A relative MDE above 1000% is not supported.';
        if (type === 'binary' && !isNaN(baseline)) {
          var abs = mdeType === 'relative' ? (v / 100) * baseline : v / 100;
          var t = baseline + dir * abs;
          if (!(t > 0 && t < 1)) return 'With this MDE the target rate would be ' + targetText(t) + '%, outside 0-100%. Use a smaller MDE.';
        }
        return '';
      });
    var mde = NaN;
    if (!isNaN(mdeRawValue)) mde = mdeType === 'relative' || type === 'binary' ? mdeRawValue / 100 : mdeRawValue;

    var alphaMsg = 'Alpha must be between 0.1% and 20%.';
    var alpha = field(errors, 'ec-plan-alpha', raw.alpha, { percent: true }, alphaMsg,
      function (v) { return v >= 0.1 && v <= 20 ? '' : alphaMsg; });
    var powerMsg = 'Power must be between 50% and 99.9%.';
    var power = field(errors, 'ec-plan-power', raw.power, { percent: true }, powerMsg,
      function (v) { return v >= 50 && v <= 99.9 ? '' : powerMsg; });
    var shareMsg = 'The treatment share must be between 1% and 99%.';
    var share = field(errors, 'ec-plan-share', raw.share, { percent: true }, shareMsg,
      function (v) { return v >= 1 && v <= 99 ? '' : shareMsg; });
    var dailyMsg = 'Enter a whole number of users per day, at least 1.';
    var daily = field(errors, 'ec-plan-daily', raw.daily, { integer: true }, dailyMsg,
      function (v) { return v >= 1 && v <= 1e9 ? '' : dailyMsg; });

    var startRaw = str(raw.start).trim();
    var start = null;
    if (startRaw !== '') {
      if (isValidDate(startRaw)) start = startRaw;
      else errors['ec-plan-start'] = MSG_DATE;
    }

    // Guardrails: name 1-60 characters after trimming, unique (case-insensitive); margin 0 < v <= 100.
    var guardrails = [];
    var seen = {};
    var list = Array.isArray(raw.guardrails) ? raw.guardrails : [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i] && typeof list[i] === 'object' ? list[i] : {};
      var gid = str(g.id);
      var nameKey = 'ec-gr-' + gid + '-name';
      var marginKey = 'ec-gr-' + gid + '-margin';
      var name = str(g.name).trim().slice(0, 60);
      if (name === '') errors[nameKey] = 'Name this guardrail.';
      else {
        var lower = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(seen, lower)) errors[nameKey] = 'Two guardrails have the same name.';
        else seen[lower] = true;
      }
      var marginMsg = 'Enter the maximum acceptable degradation, for example 5 for 5%.';
      var margin = field(errors, marginKey, g.margin, { percent: true }, marginMsg,
        function (v) { return v > 0 && v <= 100 ? '' : marginMsg; });
      guardrails.push({
        id: gid,
        name: name,
        type: g.type === 'continuous' ? 'continuous' : 'binary',
        dir: g.direction === 'increase' ? 1 : -1,
        margin: margin / 100
      });
    }

    var ok = Object.keys(errors).length === 0;
    if (!ok) return { ok: false, value: null, errors: errors };
    return {
      ok: true,
      errors: errors,
      value: {
        name: truncate(raw.name, 80),
        metricName: truncate(raw.metricName, 80),
        type: type,
        dir: dir,
        p1: p1,
        mean: mean,
        sd: sd,
        mdeType: mdeType,
        mde: mde,
        alpha: alpha / 100,
        power: power / 100,
        sides: sides,
        share: share / 100,
        daily: daily,
        start: start,
        hypothesis: truncate(raw.hypothesis, 600),
        notes: truncate(raw.notes, 600),
        guardrails: guardrails
      }
    };
  }

  // ---- 8.2 Readout validation ---------------------------------------------------------------

  var MSG_USERS = 'Enter the number of users.';
  var MSG_USERS_LOW = 'A mean and SD need at least 2 users per arm.';
  var MSG_X_NEG = "Conversions can't be negative.";
  var MSG_X_MAX = "Conversions can't be more than users.";
  var MSG_MEAN = 'Enter the mean.';
  var MSG_SD = "The standard deviation can't be negative.";
  var MSG_THROUGH = 'The data-through date is before the start date.';
  var MSG_LOOKS = 'Enter how many times results were looked at (1 or more).';
  var MSG_SRM = 'Use a threshold between 0.00001 and 0.05 (default 0.001).';
  var MSG_GR_PARTIAL = 'Fill in every field for this guardrail, or leave them all empty.';

  function obj(x) { return x && typeof x === 'object' ? x : {}; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
  function blank(raw) { return str(raw).trim() === ''; }
  function armKeys(type) { return type === 'continuous' ? ['n', 'mean', 'sd'] : ['n', 'x']; }

  // Parses one arm ({n, x} or {n, mean, sd}); error keys are `<prefix>-<field>`.
  function parseArm(errors, prefix, arm, type) {
    arm = obj(arm);
    var n = field(errors, prefix + '-n', arm.n, { integer: true }, MSG_USERS, function (v) {
      if (type === 'continuous' && v < 2) return MSG_USERS_LOW;
      return v >= 1 && v <= 1e9 ? '' : MSG_USERS;
    });
    if (type === 'continuous') {
      var mean = field(errors, prefix + '-mean', arm.mean, {}, MSG_MEAN,
        function (v) { return Math.abs(v) <= 1e12 ? '' : MSG_MEAN; });
      var sd = field(errors, prefix + '-sd', arm.sd, {}, MSG_SD,
        function (v) { return v >= 0 && v <= 1e12 ? '' : MSG_SD; });
      return { n: n, mean: mean, sd: sd };
    }
    var x = field(errors, prefix + '-x', arm.x, { integer: true }, MSG_X_NEG, function (v) {
      if (v < 0) return MSG_X_NEG;
      return !isNaN(n) && v > n ? MSG_X_MAX : '';
    });
    return { n: n, x: x };
  }

  // Accepts a parsed plan value (5.1) or a parsePlan result.
  function planValue(p) {
    if (p && typeof p === 'object' && typeof p.ok === 'boolean' && 'errors' in p) return p.value;
    return p && typeof p === 'object' ? p : null;
  }

  // parseReadout(raw, parsedPlan) -> {ok, empty, value, errors}; value has the SPEC 6.1 shape.
  // An entirely blank primary metric and `through` gives {ok: false, empty: true} with no errors.
  function parseReadout(raw, parsedPlan) {
    raw = obj(raw);
    var plan = planValue(parsedPlan) || {};
    var type = plan.type === 'continuous' ? 'continuous' : 'binary';
    var keys = armKeys(type);
    var c = obj(raw.control), t = obj(raw.treatment);
    var allBlank = blank(raw.through);
    for (var i = 0; i < keys.length; i++) {
      if (!blank(c[keys[i]]) || !blank(t[keys[i]])) allBlank = false;
    }
    if (allBlank) return { ok: false, empty: true, value: null, errors: {} };

    var errors = {};
    var control = parseArm(errors, 'ec-ro-c', c, type);
    var treatment = parseArm(errors, 'ec-ro-t', t, type);

    var throughRaw = str(raw.through).trim();
    var through = null;
    if (throughRaw !== '') {
      if (!isValidDate(throughRaw)) errors['ec-ro-through'] = MSG_DATE;
      else if (plan.start && throughRaw < plan.start) errors['ec-ro-through'] = MSG_THROUGH;
      else through = throughRaw;
    }

    var looks = field(errors, 'ec-ro-looks', raw.looks, { integer: true }, MSG_LOOKS,
      function (v) { return v >= 1 && v <= 1000 ? '' : MSG_LOOKS; });
    var srmThreshold = field(errors, 'ec-ro-srm-threshold', raw.srmThreshold, {}, MSG_SRM,
      function (v) { return v >= 0.00001 && v <= 0.05 ? '' : MSG_SRM; });

    // Guardrails: all fields or none, per plan guardrail.
    var guardrails = {};
    var rawGr = obj(raw.guardrails);
    var planGr = Array.isArray(plan.guardrails) ? plan.guardrails : [];
    for (var j = 0; j < planGr.length; j++) {
      var g = obj(planGr[j]);
      var gid = str(g.id);
      var gtype = g.type === 'continuous' ? 'continuous' : 'binary';
      var gkeys = armKeys(gtype);
      var src = obj(own(rawGr, gid));
      var arms = { c: obj(src.control), t: obj(src.treatment) };
      var blanks = [], filled = 0;
      ['c', 't'].forEach(function (a) {
        gkeys.forEach(function (k) {
          if (blank(arms[a][k])) blanks.push('ec-rg-' + gid + '-' + a + '-' + k); else filled++;
        });
      });
      if (filled === 0) { guardrails[gid] = { state: 'empty' }; continue; }
      var gErrors = {};
      var gc = parseArm(gErrors, 'ec-rg-' + gid + '-c', arms.c, gtype);
      var gt = parseArm(gErrors, 'ec-rg-' + gid + '-t', arms.t, gtype);
      blanks.forEach(function (key) { gErrors[key] = MSG_GR_PARTIAL; });
      Object.keys(gErrors).forEach(function (key) { errors[key] = gErrors[key]; });
      guardrails[gid] = { state: 'ok', control: gc, treatment: gt };
    }

    var ok = Object.keys(errors).length === 0;
    if (!ok) return { ok: false, empty: false, value: null, errors: errors };
    return {
      ok: true,
      empty: false,
      errors: errors,
      value: {
        control: control,
        treatment: treatment,
        through: through,
        looks: looks,
        srmThreshold: srmThreshold,
        guardrails: guardrails
      }
    };
  }

  return {
    parseNumber: parseNumber,
    isValidDate: isValidDate,
    parsePlan: parsePlan,
    parseReadout: parseReadout,
    MSG_FORMAT: MSG_FORMAT,
    MSG_INTEGER: MSG_INTEGER,
    MSG_DATE: MSG_DATE
  };
});
