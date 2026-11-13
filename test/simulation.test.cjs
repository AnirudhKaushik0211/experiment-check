'use strict';
// Seeded Monte Carlo checks of coverage, false-positive rate and power (10.1 simulation.test.cjs row).
// Every case uses its own mulberry32(20250303) stream, so results do not depend on test order.
const test = require('node:test');
const assert = require('node:assert');
const stats = require('../js/stats.js');
const ro = require('../js/readout.js');

const SEED = 20250303;
const OPTS = { alpha: 0.05, sides: 2, dir: 1 };

function binomial(rng, n, p) { let x = 0; for (let i = 0; i < n; i++) if (rng() < p) x++; return x; }
// Box-Muller normal sample summarised as {n, mean, sd} (sample SD, n - 1).
function normalSample(rng, n, mu, sigma) {
  let sum = 0, sq = 0;
  const xs = new Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = 1 - rng(), u2 = rng();
    xs[i] = mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    sum += xs[i];
  }
  const mean = sum / n;
  for (let i = 0; i < n; i++) sq += (xs[i] - mean) * (xs[i] - mean);
  return { n: n, mean: mean, sd: Math.sqrt(sq / (n - 1)) };
}
function inRange(x, lo, hi, label) { assert.ok(x >= lo && x <= hi, `${label}: ${x} not in [${lo}, ${hi}]`); }

test('(a) Wald CI and (b) Katz relative CI coverage, p 0.10 vs 0.12, n 2000', () => {
  const rngA = stats.mulberry32(SEED);
  let wald = 0;
  for (let r = 0; r < 2000; r++) {
    const res = ro.twoProportion({ n: 2000, x: binomial(rngA, 2000, 0.10) }, { n: 2000, x: binomial(rngA, 2000, 0.12) }, OPTS);
    if (res.ci[0] <= 0.02 && 0.02 <= res.ci[1]) wald++;
  }
  inRange(wald / 2000, 0.93, 0.97, 'Wald coverage');
  const rngB = stats.mulberry32(SEED);
  let katz = 0;
  for (let r = 0; r < 2000; r++) {
    const res = ro.twoProportion({ n: 2000, x: binomial(rngB, 2000, 0.10) }, { n: 2000, x: binomial(rngB, 2000, 0.12) }, OPTS);
    if (res.relCi[0] <= 0.2 && 0.2 <= res.relCi[1]) katz++;
  }
  inRange(katz / 2000, 0.93, 0.97, 'Katz coverage');
});

test('(c) z-test false-positive rate, p 0.10 vs 0.10, n 2000', () => {
  const rng = stats.mulberry32(SEED);
  let fp = 0;
  for (let r = 0; r < 4000; r++) {
    const res = ro.twoProportion({ n: 2000, x: binomial(rng, 2000, 0.10) }, { n: 2000, x: binomial(rng, 2000, 0.10) }, OPTS);
    if (res.p < 0.05) fp++;
  }
  inRange(fp / 4000, 0.035, 0.065, 'z FPR');
});

test('(d) Welch CI coverage and (e) Welch false-positive rate', () => {
  const rngD = stats.mulberry32(SEED);
  let cover = 0;
  for (let r = 0; r < 2000; r++) {
    const res = ro.welch(normalSample(rngD, 30, 0, 1), normalSample(rngD, 20, 0.3, 3), OPTS);
    if (res.ci[0] <= 0.3 && 0.3 <= res.ci[1]) cover++;
  }
  inRange(cover / 2000, 0.93, 0.97, 'Welch coverage');
  const rngE = stats.mulberry32(SEED);
  let fp = 0;
  for (let r = 0; r < 4000; r++) {
    const res = ro.welch(normalSample(rngE, 30, 0, 1), normalSample(rngE, 20, 0, 3), OPTS);
    if (res.p < 0.05) fp++;
  }
  inRange(fp / 4000, 0.035, 0.065, 'Welch FPR');
});

test('(f) SRM false-positive rate at p < 0.05, N 10000 at 50%', () => {
  const rng = stats.mulberry32(SEED);
  let fp = 0;
  for (let r = 0; r < 4000; r++) {
    const nt = binomial(rng, 10000, 0.5);
    if (ro.srmTest(10000 - nt, nt, 0.5).p < 0.05) fp++;
  }
  inRange(fp / 4000, 0.035, 0.065, 'SRM FPR');
});

test('(g) power of plan S3: p2 0.11, n 14751 per arm', () => {
  const rng = stats.mulberry32(SEED);
  let sig = 0;
  for (let r = 0; r < 1000; r++) {
    const res = ro.twoProportion({ n: 14751, x: binomial(rng, 14751, 0.10) }, { n: 14751, x: binomial(rng, 14751, 0.11) }, OPTS);
    if (res.p < 0.05) sig++;
  }
  inRange(sig / 1000, 0.76, 0.84, 'power');
});
