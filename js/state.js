/* ExperimentCheck state: raw state defaults, sanitising and the shareable URL hash (SPEC 7).
 * Hash format: #s=<base64url(UTF-8 JSON)>, no padding. decode never throws. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.state = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var VERSION = '1.0.0';
  var CSP_META = true;
  var MAX_HASH = 64000;
  var MAX_GUARDRAILS = 10;
  var RE_GID = /^g[1-9][0-9]{0,3}$/;

  var LEN = { name: 80, multi: 600, guardrailName: 60, numeric: 32, date: 10 };
  var ENUMS = {
    tab: ['guide', 'plan', 'readout'],
    type: ['binary', 'continuous'],
    direction: ['increase', 'decrease'],
    mdeType: ['relative', 'absolute'],
    sides: ['two', 'one']
  };
  var NUMERIC_PLAN = ['baselineRate', 'baselineMean', 'baselineSd', 'mde', 'alpha', 'power', 'share', 'daily'];
  var ARM_KEYS = ['n', 'x', 'mean', 'sd'];

  function emptyArm() { return { n: '', x: '', mean: '', sd: '' }; }

  function defaults() {
    return {
      v: 1,
      tab: 'plan',
      plan: {
        name: '', metricName: '', type: 'binary', direction: 'increase',
        baselineRate: '10', baselineMean: '', baselineSd: '',
        mdeType: 'relative', mde: '10', alpha: '5', power: '80', sides: 'two',
        share: '50', daily: '1000', start: '', hypothesis: '', notes: '',
        guardrails: []
      },
      readout: {
        control: emptyArm(),
        treatment: emptyArm(),
        through: '', looks: '1', srmThreshold: '0.001',
        guardrails: {}
      }
    };
  }

  // ---- sanitize -----------------------------------------------------------------------------

  var RE_CTRL_ALL = /[\u0000-\u001F\u007F]/g;
  var RE_CTRL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function own(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }

  // String field: wrong type keeps the default; control characters stripped, then truncated.
  function text(value, def, max, multi) {
    if (typeof value !== 'string') return def;
    return value.replace(multi ? RE_CTRL_MULTI : RE_CTRL_ALL, '').slice(0, max);
  }
  function oneOf(value, def, allowed) { return typeof value === 'string' && allowed.indexOf(value) >= 0 ? value : def; }

  function arm(src) {
    var out = emptyArm();
    ARM_KEYS.forEach(function (k) { out[k] = text(own(src, k), '', LEN.numeric, false); });
    return out;
  }

  function planGuardrails(src) {
    if (!Array.isArray(src)) return [];
    var rows = [];
    for (var i = 0; i < src.length && rows.length < MAX_GUARDRAILS; i++) {
      if (isObj(src[i])) rows.push(src[i]);
    }
    // Keep valid, unique ids; the rest get fresh ids after every kept id is known.
    var used = Object.create(null);
    var ids = rows.map(function (g) {
      var id = own(g, 'id');
      if (typeof id === 'string' && RE_GID.test(id) && !used[id]) { used[id] = true; return id; }
      return null;
    });
    var maxN = 0;
    Object.keys(used).forEach(function (id) { maxN = Math.max(maxN, parseInt(id.slice(1), 10)); });
    function fresh() {
      var n = maxN + 1;
      if (n > 9999) { n = 1; while (used['g' + n]) n++; }
      maxN = Math.max(maxN, n);
      used['g' + n] = true;
      return 'g' + n;
    }
    return rows.map(function (g, i) {
      return {
        id: ids[i] || fresh(),
        name: text(own(g, 'name'), '', LEN.guardrailName, false),
        type: oneOf(own(g, 'type'), 'binary', ENUMS.type),
        direction: oneOf(own(g, 'direction'), 'decrease', ENUMS.direction),
        margin: text(own(g, 'margin'), '5', LEN.numeric, false)
      };
    });
  }

  // Builds a fresh default state and copies over only known keys with the right types.
  function sanitize(obj) {
    var out = defaults();
    if (!isObj(obj)) return out;
    out.tab = oneOf(own(obj, 'tab'), out.tab, ENUMS.tab);

    var p = own(obj, 'plan');
    var plan = out.plan;
    if (isObj(p)) {
      plan.name = text(own(p, 'name'), plan.name, LEN.name, false);
      plan.metricName = text(own(p, 'metricName'), plan.metricName, LEN.name, false);
      plan.type = oneOf(own(p, 'type'), plan.type, ENUMS.type);
      plan.direction = oneOf(own(p, 'direction'), plan.direction, ENUMS.direction);
      plan.mdeType = oneOf(own(p, 'mdeType'), plan.mdeType, ENUMS.mdeType);
      plan.sides = oneOf(own(p, 'sides'), plan.sides, ENUMS.sides);
      NUMERIC_PLAN.forEach(function (k) { plan[k] = text(own(p, k), plan[k], LEN.numeric, false); });
      plan.start = text(own(p, 'start'), plan.start, LEN.date, false);
      plan.hypothesis = text(own(p, 'hypothesis'), plan.hypothesis, LEN.multi, true);
      plan.notes = text(own(p, 'notes'), plan.notes, LEN.multi, true);
      plan.guardrails = planGuardrails(own(p, 'guardrails'));
    }

    var r = own(obj, 'readout');
    var ro = out.readout;
    if (isObj(r)) {
      ro.control = arm(own(r, 'control'));
      ro.treatment = arm(own(r, 'treatment'));
      ro.through = text(own(r, 'through'), ro.through, LEN.date, false);
      ro.looks = text(own(r, 'looks'), ro.looks, LEN.numeric, false);
      ro.srmThreshold = text(own(r, 'srmThreshold'), ro.srmThreshold, LEN.numeric, false);
      var src = own(r, 'guardrails');
      var gids = Object.create(null);
      plan.guardrails.forEach(function (g) { gids[g.id] = true; });
      var tmp = Object.create(null);
      if (isObj(src)) {
        Object.keys(src).forEach(function (k) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype' || !gids[k]) return;
          var g = src[k];
          tmp[k] = { control: arm(own(g, 'control')), treatment: arm(own(g, 'treatment')) };
        });
      }
      var plainGr = {};
      Object.keys(tmp).forEach(function (k) { plainGr[k] = tmp[k]; });
      ro.guardrails = plainGr;
    }
    return out;
  }

  // ---- encode / decode ----------------------------------------------------------------------

  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encode(raw) { return '#s=' + toBase64Url(JSON.stringify(raw)); }

  function fail(error) { return { ok: false, error: error }; }

  function decode(hash) {
    if (typeof hash !== 'string' || hash === '' || hash === '#') return fail('empty');
    if (hash.slice(0, 3) !== '#s=') return fail('format');
    if (hash.length > MAX_HASH) return fail('too-long');
    var payload = hash.slice(3);
    if (!/^[A-Za-z0-9_-]*$/.test(payload) || payload.length % 4 === 1) return fail('base64');
    var bin;
    try {
      var b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      bin = atob(b64);
    } catch (e) { return fail('base64'); }
    var json;
    try {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e2) { return fail('utf8'); }
    var obj;
    try { obj = JSON.parse(json); } catch (e3) { return fail('json'); }
    if (!isObj(obj)) return fail('json');
    if (own(obj, 'v') !== 1) return fail('version');
    return { ok: true, state: sanitize(obj) };
  }

  return {
    VERSION: VERSION,
    CSP_META: CSP_META,
    MAX_HASH: MAX_HASH,
    defaults: defaults,
    sanitize: sanitize,
    encode: encode,
    decode: decode
  };
});
