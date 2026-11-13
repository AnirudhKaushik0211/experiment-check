/* ExperimentCheck stats: normal, Student t, chi-square, gamma/beta functions and a seeded PRNG.
 * Pure functions: numbers in, numbers out, NaN for invalid arguments, never throw (SPEC section 4). */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.stats = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  function isNum(x) { return typeof x === 'number' && !isNaN(x); }

  // ---- 4.1 Standard normal ----------------------------------------------------------------

  // P(Z > a) for a >= 0. Hart (1968) algorithm 5666 as published by West (2005).
  function normUpperAbs(a) {
    if (!isNum(a) || a < 0) return NaN;
    if (a > 37) return 0;
    var e = Math.exp(-a * a / 2);
    var n, d, b;
    if (a < 7.07106781186547) {
      n = 3.52624965998911e-2 * a + 0.700383064443688;
      n = n * a + 6.37396220353165; n = n * a + 33.912866078383; n = n * a + 112.079291497871;
      n = n * a + 221.213596169931; n = n * a + 220.206867912376;
      d = 8.83883476483184e-2 * a + 1.75566716318264;
      d = d * a + 16.064177579207; d = d * a + 86.7807322029461; d = d * a + 296.564248779674;
      d = d * a + 637.333633378831; d = d * a + 793.826512519948; d = d * a + 440.413735824752;
      return e * n / d;
    }
    b = a + 0.65; b = a + 4 / b; b = a + 3 / b; b = a + 2 / b; b = a + 1 / b;
    return e / b / 2.506628274631;
  }

  function normCdf(x) {
    if (!isNum(x)) return NaN;
    return x >= 0 ? 1 - normUpperAbs(x) : normUpperAbs(-x);
  }

  // Upper tail P(Z > x).
  function normSf(x) {
    if (!isNum(x)) return NaN;
    return x >= 0 ? normUpperAbs(x) : 1 - normUpperAbs(-x);
  }

  var NA = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  var NB = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  var NC = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  var ND = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

  // Inverse standard normal CDF: Acklam (2003) rational approximation plus one Halley step.
  function normInv(p) {
    if (!(isNum(p) && p > 0 && p < 1)) return NaN;
    var pl = 0.02425, q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((NC[0] * q + NC[1]) * q + NC[2]) * q + NC[3]) * q + NC[4]) * q + NC[5]) /
          ((((ND[0] * q + ND[1]) * q + ND[2]) * q + ND[3]) * q + 1);
    } else if (p <= 1 - pl) {
      q = p - 0.5; r = q * q;
      x = (((((NA[0] * r + NA[1]) * r + NA[2]) * r + NA[3]) * r + NA[4]) * r + NA[5]) * q /
          (((((NB[0] * r + NB[1]) * r + NB[2]) * r + NB[3]) * r + NB[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((NC[0] * q + NC[1]) * q + NC[2]) * q + NC[3]) * q + NC[4]) * q + NC[5]) /
           ((((ND[0] * q + ND[1]) * q + ND[2]) * q + ND[3]) * q + 1);
    }
    // Halley refinement, using the tail that keeps precision.
    var err = p < 0.5 ? normCdf(x) - p : (1 - p) - normSf(x);
    var u = err * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    x = x - u / (1 + x * u / 2);
    return x;
  }

  // ---- 4.2 Log-gamma, incomplete beta and incomplete gamma ----------------------------------

  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

  // ln Gamma(z), z > 0. Lanczos (g = 7, 9 coefficients); reflection for z < 0.5.
  function lnGamma(z) {
    if (!(isNum(z) && z > 0) || z === Infinity) return NaN;
    if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lnGamma(1 - z);
    z = z - 1;
    var s = LANCZOS[0];
    for (var i = 1; i <= 8; i++) s += LANCZOS[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
  }

  var BETA_EPS = 1e-15, FPMIN = 1e-300, BETA_MAXIT = 300;

  // Continued fraction for the incomplete beta (Numerical Recipes betacf, modified Lentz).
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= BETA_MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < BETA_EPS) break;
    }
    return h;
  }

  // Regularised incomplete beta I_x(a, b).
  function betaInc(a, b, x) {
    if (!(isNum(a) && isNum(b) && isNum(x) && a > 0 && b > 0)) return NaN;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  var GAMMA_EPS = 1e-16, GAMMA_MAXIT = 1000;

  // Regularised upper incomplete gamma Q(a, x) (Numerical Recipes gser / gcf).
  function gammaQ(a, x) {
    if (!(isNum(a) && isNum(x) && a > 0)) return NaN;
    if (x <= 0) return 1;
    if (x === Infinity) return 0;
    var gln = lnGamma(a);
    var i;
    if (x < a + 1) {
      // Series for P(a, x).
      var ap = a, sum = 1 / a, del = sum;
      for (i = 1; i <= GAMMA_MAXIT; i++) {
        ap += 1;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * GAMMA_EPS) break;
      }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    // Continued fraction for Q(a, x), modified Lentz.
    var b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (i = 1; i <= GAMMA_MAXIT; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var dl = d * c;
      h *= dl;
      if (Math.abs(dl - 1) < GAMMA_EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  // ---- 4.3 Student t ------------------------------------------------------------------------

  // P(T > t), df > 0 (non-integer df supported).
  function tSf(t, df) {
    if (!(isNum(t) && isNum(df) && df > 0)) return NaN;
    if (df > 1e7) return normSf(t);
    var x = df / (df + t * t);
    var tail = 0.5 * betaInc(df / 2, 0.5, x);
    return t >= 0 ? tail : 1 - tail;
  }

  function tCdf(t, df) { return 1 - tSf(t, df); }

  // Quantile of Student t by bisection on tSf.
  function tInv(p, df) {
    if (!(isNum(p) && isNum(df) && p > 0 && p < 1 && df > 0)) return NaN;
    if (df > 1e7) return normInv(p);
    if (p === 0.5) return 0;
    if (p < 0.5) return -tInv(1 - p, df);
    var target = 1 - p, lo = 0, hi = 1, i;
    for (i = 0; tSf(hi, df) > target; i++) {
      if (i >= 60) return NaN;
      hi = hi * 2;
    }
    for (i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (tSf(mid, df) > target) lo = mid; else hi = mid;
      if (hi - lo < 1e-13 * Math.max(1, hi)) break;
    }
    return (lo + hi) / 2;
  }

  // ---- 4.4 Chi-square -----------------------------------------------------------------------

  function chiSquareSf(x, df) {
    if (!(isNum(x) && isNum(df) && x >= 0 && df > 0)) return NaN;
    return gammaQ(df / 2, x / 2);
  }

  // ---- 4.5 Seeded PRNG ----------------------------------------------------------------------

  function mulberry32(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    normUpperAbs: normUpperAbs,
    normCdf: normCdf,
    normSf: normSf,
    normInv: normInv,
    lnGamma: lnGamma,
    betaInc: betaInc,
    gammaQ: gammaQ,
    tSf: tSf,
    tCdf: tCdf,
    tInv: tInv,
    chiSquareSf: chiSquareSf,
    mulberry32: mulberry32
  };
});
