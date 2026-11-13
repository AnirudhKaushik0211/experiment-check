'use strict';
// SPEC 9.1-9.3 reference values and NaN / no-throw behaviour of js/stats.js.
const test = require('node:test');
const assert = require('node:assert');
const s = require('../js/stats.js');

function close(actual, expected, tol, rel) {
  const diff = Math.abs(actual - expected);
  const limit = rel ? tol * Math.abs(expected) : tol;
  assert.ok(diff <= limit, `got ${actual}, expected ${expected} (diff ${diff}, tolerance ${limit})`);
}

test('9.1 normal: reference values', () => {
  close(s.normCdf(-1), 0.158655253931457, 1e-12);
  close(s.normCdf(0.5), 0.691462461274013, 1e-12);
  close(s.normCdf(1.959963984540054), 0.975, 1e-12);
  close(s.normCdf(0), 0.5, 1e-15);
  close(s.normSf(3), 0.00134989803163009, 1e-13);
  close(s.normSf(5), 2.86651571879194e-7, 1e-8, true);
  close(s.normSf(8), 6.22096057427178e-16, 1e-7, true);
  close(s.normSf(-2) + s.normCdf(2), 2 * s.normCdf(2), 1e-15);
  close(s.normInv(0.975), 1.959963984540054, 1e-9);
  close(s.normInv(0.95), 1.644853626951473, 1e-9);
  close(s.normInv(0.9), 1.281551565544601, 1e-9);
  close(s.normInv(0.8), 0.841621233572914, 1e-9);
  close(s.normInv(0.995), 2.575829303548901, 1e-9);
  close(s.normInv(0.999), 3.090232306167813, 1e-9);
  close(s.normInv(0.025), -1.959963984540054, 1e-9);
  close(s.normInv(1e-10), -6.361340902404056, 1e-8);
});

test('9.1 normal: normInv outside (0, 1) is NaN', () => {
  assert.ok(Number.isNaN(s.normInv(0)));
  assert.ok(Number.isNaN(s.normInv(1)));
  assert.ok(Number.isNaN(s.normInv(NaN)));
  assert.ok(Number.isNaN(s.normInv(-0.1)));
  assert.ok(Number.isNaN(s.normInv(1.5)));
});

test('9.1 normal: normCdf(normInv(p)) round trip for p = i/1000', () => {
  for (let i = 1; i <= 999; i++) {
    const p = i / 1000;
    close(s.normCdf(s.normInv(p)), p, 1e-12);
  }
});

test('9.2 Student t: reference values', () => {
  close(2 * s.tSf(2, 10), 0.0733880347707, 1e-9);
  close(s.tSf(3, 100), 0.00170395767166, 1e-10);
  close(s.tSf(4, 2), 0.0285954792090, 1e-10);
  close(s.tSf(4, 2), 0.5 - 4 / (2 * Math.sqrt(16 + 2)), 1e-10);
  close(s.tSf(1, 1), 0.25, 1e-12);
  close(s.tSf(1.5, 3.7), 0.106799084601, 1e-8);
  close(s.tSf(0.7, 25.3), 0.245157249710, 1e-8);
  close(s.tSf(2.5, 1000), 0.00628928390055, 1e-9);
  close(s.tInv(0.975, 1), 12.7062047361747, 1e-7);
  close(s.tInv(0.975, 5), 2.57058183563631, 1e-9);
  close(s.tInv(0.975, 10), 2.22813885198627, 1e-9);
  close(s.tInv(0.975, 30), 2.04227245630124, 1e-9);
  close(s.tInv(0.975, 1000), 1.96233908082641, 1e-9);
  close(s.tInv(0.95, 20), 1.72471824292079, 1e-9);
});

test('9.2 Student t: tSf(tInv(p, df), df) round trip', () => {
  for (const p of [0.6, 0.9, 0.975, 0.999]) {
    for (const df of [1, 2.5, 7.6, 30, 725.3]) {
      close(s.tSf(s.tInv(p, df), df), 1 - p, 1e-10);
    }
  }
});

test('9.2 Student t: symmetry and tCdf', () => {
  close(s.tSf(-2, 10), 1 - s.tSf(2, 10), 1e-15);
  close(s.tCdf(2, 10), 1 - s.tSf(2, 10), 1e-15);
  assert.strictEqual(s.tInv(0.5, 7), 0);
  close(s.tInv(0.025, 10), -2.22813885198627, 1e-9);
});

test('9.3 chi-square: reference values', () => {
  close(s.chiSquareSf(3.841458820694124, 1), 0.05, 1e-12);
  close(s.chiSquareSf(4, 1), 0.0455002638963584, 1e-12);
  close(s.chiSquareSf(10.82756617, 1), 0.001, 1e-10);
  close(s.chiSquareSf(5.991464547107979, 2), 0.05, 1e-12);
  close(s.chiSquareSf(5.991464547107979, 2), Math.exp(-5.991464547107979 / 2), 1e-12);
  close(s.chiSquareSf(7.814727903251178, 3), 0.05, 1e-11);
  close(s.chiSquareSf(0.5, 4), 0.973500978839, 1e-11);
  close(s.chiSquareSf(0.5, 4), Math.exp(-0.25) * 1.25, 1e-11);
});

test('9.3 chi-square: df 1 equals 2 normSf(sqrt(x))', () => {
  for (const x of [0.01, 1, 4, 26.38]) {
    close(s.chiSquareSf(x, 1), 2 * s.normSf(Math.sqrt(x)), 1e-12);
  }
});

test('invalid inputs give NaN and never throw', () => {
  const bad = [NaN, undefined, null, 'x', {}, -1];
  assert.doesNotThrow(() => {
    for (const v of bad) {
      s.normCdf(v); s.normSf(v); s.normInv(v); s.normUpperAbs(v); s.lnGamma(v);
      s.betaInc(v, v, v); s.gammaQ(v, v); s.tSf(v, v); s.tCdf(v, v); s.tInv(v, v); s.chiSquareSf(v, v);
    }
  });
  assert.ok(Number.isNaN(s.normUpperAbs(-1)));
  assert.ok(Number.isNaN(s.normCdf(NaN)));
  assert.ok(Number.isNaN(s.normSf(NaN)));
  assert.ok(Number.isNaN(s.tSf(1, -1)));
  assert.ok(Number.isNaN(s.tSf(1, 0)));
  assert.ok(Number.isNaN(s.tSf(NaN, 5)));
  assert.ok(Number.isNaN(s.tInv(0.9, -2)));
  assert.ok(Number.isNaN(s.tInv(0, 5)));
  assert.ok(Number.isNaN(s.tInv(1, 5)));
  assert.ok(Number.isNaN(s.tInv(1.2, 5)));
  assert.ok(Number.isNaN(s.chiSquareSf(4, -1)));
  assert.ok(Number.isNaN(s.chiSquareSf(4, 0)));
  assert.ok(Number.isNaN(s.chiSquareSf(-1, 1)));
  assert.ok(Number.isNaN(s.lnGamma(0)));
  assert.ok(Number.isNaN(s.lnGamma(-2)));
  assert.ok(Number.isNaN(s.betaInc(-1, 1, 0.5)));
  assert.ok(Number.isNaN(s.gammaQ(0, 1)));
});

test('lnGamma, betaInc and gammaQ basics', () => {
  close(s.lnGamma(5), Math.log(24), 1e-12);
  close(s.lnGamma(0.5), 0.5 * Math.log(Math.PI), 1e-12);
  close(s.lnGamma(0.25), Math.log(3.625609908221908), 1e-12);
  close(s.betaInc(1, 1, 0.3), 0.3, 1e-14);
  assert.strictEqual(s.betaInc(2, 3, 0), 0);
  assert.strictEqual(s.betaInc(2, 3, 1), 1);
  close(s.gammaQ(1, 2), Math.exp(-2), 1e-14);
  assert.strictEqual(s.gammaQ(2, 0), 1);
});

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = s.mulberry32(20250303), b = s.mulberry32(20250303);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.strictEqual(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notStrictEqual(s.mulberry32(1)(), s.mulberry32(2)());
});
