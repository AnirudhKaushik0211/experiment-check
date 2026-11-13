/* ExperimentCheck format: locale-independent number, percent and p-value formatting (SPEC 6.11).
 * en-US grouping, ASCII '-', -0 printed as 0, NaN and non-finite values print as 'n/a'. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.format = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var NA = 'n/a';

  function finite(x) { return typeof x === 'number' && isFinite(x); }

  // Adds en-US thousands separators to a plain decimal string such as "-12345.67".
  function group(s) {
    var sign = '';
    if (s.charAt(0) === '-' || s.charAt(0) === '+') { sign = s.charAt(0); s = s.slice(1); }
    var dot = s.indexOf('.');
    var ip = dot < 0 ? s : s.slice(0, dot);
    var fp = dot < 0 ? '' : s.slice(dot);
    ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + ip + fp;
  }

  // True when a plain decimal string has only zero digits ("-0.00", "0").
  function isZeroStr(s) { return !/[1-9]/.test(s); }

  // toFixed with -0 (and values that round to zero) printed unsigned, then grouped.
  function fixed(x, d) {
    var s = x.toFixed(d);
    if (isZeroStr(s)) s = s.replace(/^-/, '');
    return group(s);
  }

  // Signed fixed: round first, then take the sign from the rounded value ('+' for 0).
  function signedFixed(x, d) {
    var s = x.toFixed(d);
    if (isZeroStr(s)) return '+' + group(s.replace(/^-/, ''));
    return s.charAt(0) === '-' ? group(s) : '+' + group(s);
  }

  function int(n) {
    if (!finite(n)) return NA;
    return fixed(Math.round(n), 0);
  }

  function pct(f, d) {
    if (d === undefined) d = 2;
    if (!finite(f)) return NA;
    return fixed(100 * f, d) + '%';
  }

  function spct(f, d) {
    if (d === undefined) d = 2;
    if (!finite(f)) return NA;
    return signedFixed(100 * f, d) + '%';
  }

  function pp(f, d) {
    if (d === undefined) d = 2;
    if (!finite(f)) return NA;
    return signedFixed(100 * f, d) + ' pp';
  }

  function ppAbs(f, d) {
    if (d === undefined) d = 2;
    if (!finite(f)) return NA;
    return fixed(100 * Math.abs(f), d) + ' pp';
  }

  // Converts toPrecision output (possibly in exponent notation) to plain decimal notation.
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

  function snum(x) {
    var s = num(x);
    if (s === NA) return NA;
    return s.charAt(0) === '-' ? s : '+' + s;
  }

  function pValue(p) {
    if (!finite(p)) return NA;
    if (p < 0.0001) return '< 0.0001';
    if (p < 0.01) return fixed(p, 4);
    return fixed(p, 3);
  }

  function pText(p) {
    if (!finite(p)) return NA;
    return p < 0.0001 ? 'p < 0.0001' : 'p = ' + pValue(p);
  }

  function stat(x) {
    if (!finite(x)) return NA;
    return fixed(x, 2);
  }

  function df(x) {
    if (!finite(x)) return NA;
    return fixed(x, 1);
  }

  return {
    int: int,
    pct: pct,
    spct: spct,
    pp: pp,
    ppAbs: ppAbs,
    num: num,
    snum: snum,
    pValue: pValue,
    pText: pText,
    stat: stat,
    df: df
  };
});
