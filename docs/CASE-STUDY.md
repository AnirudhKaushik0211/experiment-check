# Case study: ExperimentCheck

> Template. Every value in `[[double brackets]]` is a placeholder. Fill it in only with real, checked numbers from the sources named next to it, and delete any line you can't back up. Never estimate or round up. Leave a placeholder visible rather than guessing. Describe sources exactly as in SPEC section 9's Source column.

## One-line summary

A free, browser-only tool that plans A/B tests (sample size, duration, guardrails, pre-registration) and audits their results (SRM, peeking, practical significance, guardrail breaches), ending in a plain-English ship / don't ship memo.

- Live demo: [[GitHub Pages address]]
- Code: [[repository address]]
- Released: [[release date of v1.0.0]]

## The problem

A/B tests often fail quietly. Some are too small to detect the effect that matters. Some have no written decision rule, so the goalposts move after the fact. Some are stopped the first day the dashboard turns green. Some are shipped on a lift that is statistically real but too small to matter, while a guardrail metric gets worse off-screen. The people who make the call (PMs, growth marketers, junior analysts) usually have calculators for single steps, not one flow from plan to decision.

## What I built

- **Plan mode:** sample size and duration for conversion and mean metrics, whole-week rounding, a sensitivity table and chart (what the test can detect in 1 to 12 weeks), guardrails with limits, and an exportable pre-registration.
- **Readout mode:** effect, confidence intervals and p-values (two-proportion z-test, Welch's t-test), plus trust checks: sample ratio mismatch, peeking and timing, duration, sample shortfall, practical significance and guardrails.
- **Verdict and memo:** one of Ship / Don't ship / Inconclusive - extend / Investigate (SRM), with the decisive reason, the next step and a one-page Markdown or printable memo.
- **Six synthetic demo scenarios**, a Guide that opens on the first visit, a glossary, and a shareable link that keeps all state in the URL hash.

## Key decisions and trade-offs

| Decision | Alternatives considered | Why this choice | Cost of the choice |
|---|---|---|---|
| Static page, no backend, no analytics | Small backend; hosted analytics | Zero setup, works offline, nothing to secure, privacy by construction | Live-demo usage cannot be measured |
| Classic scripts instead of ES modules | ES modules; a single bundled file | Chromium-based browsers refuse module scripts when `index.html` is opened from disk; classic scripts work by double-click in Edge, Chrome and Firefox, and the same files run in Node tests | A small UMD wrapper in each file |
| An explicit verdict rule with a fixed precedence (SRM, guardrails, timing, then statistical vs practical significance) | Show the numbers and let users decide | Makes the reasoning reviewable and reproducible; teaches the order in which to distrust a result | Some users will disagree with a rule; the docs explain it and its limits |
| Guardrail breach based on the observed degradation, with an "At risk" state when the interval crosses the limit | Require a formal non-inferiority proof | Guardrails are usually underpowered; requiring proof would block almost everything | Less strict than a non-inferiority test: a guardrail whose interval reaches past the limit is only flagged At risk, not blocked |
| Warn about peeking; show the O'Brien-Fleming figure as informational only | Implement sequential testing | Valid sequential analysis must be planned in advance; a half-implemented version would give false confidence | Teams that need early stopping need another tool |
| Normal approximations, labelled, with small-sample warnings | Exact tests, bootstrap | Standard in industry tools, fast and transparent | Less accurate for very small counts (warned in the app) |
| Hand-written numerics (normal, t, chi-square) validated against reference values | A statistics library | Zero dependencies, so it works offline and from disk | Needed careful testing (below) |

## How I made sure the statistics are right

- Reference-value tests: [[K]] cases across the normal, t and chi-square distributions, sample size ([[N]] cases: one against the value printed in R's `power.prop.test` documentation, one compared with R's `power.t.test` output, the rest against the cited textbook formulas, Fleiss et al. ch. 4 and Chow et al. section 3.2, evaluated directly), z-test, Welch's t-test and SRM. Every case has a stated tolerance. Source: `npm test` output for release [[version]].
- Simulation checks: confidence-interval coverage and false-positive rates fall inside the expected bands, using seeded random data.
- Six demo scenarios with known verdicts, checked by the test suite.
- Browser smoke tests in Edge and Firefox, both from a web server and from a double-clicked file.

## What I measured after launch

Only what GitHub shows. The app has no tracking, so visits to the live demo are not measurable; I say so instead of estimating them.

| Metric | Source | Day 30 | Day 90 |
|---|---|---|---|
| Stars | Repository page | [[n]] | [[n]] |
| Forks | Repository page | [[n]] | [[n]] |
| Repository views / unique visitors (14-day window) | Insights > Traffic | [[views]] / [[uniques]] | [[views]] / [[uniques]] |
| Views per unique visitor (returning-interest proxy) | Calculated from the row above | [[ratio]] | [[ratio]] |
| Top referrers | Insights > Traffic | [[list]] | [[list]] |
| Release ZIP downloads | Release asset `download_count` from the GitHub REST API (`GET /repos/{owner}/{repo}/releases`; not shown in the web UI) | [[n]] | [[n]] |
| Issues / PRs opened by other people | Issues, Pull requests | [[n]] / [[n]] | [[n]] / [[n]] |

Interpretation: [[two or three sentences, written after the data is in; no claims beyond the table]]

## What I learned

- [[Lesson 1: for example, which part of the verdict rule needed the most explanation]]
- [[Lesson 2]]
- [[Lesson 3]]

## What I would do next

- A/B/n tests with a multiple-comparison correction.
- An exact test (Fisher's) and score intervals for small counts.
- Paste a CSV of daily counts to check SRM and trends by day.
- [[Anything that real feedback asked for, with the issue number]]

## Resume line (fill only with real numbers)

"Built and launched ExperimentCheck, an open-source, browser-only A/B test planner and auditor (power, SRM, peeking, guardrails, decision memos); validated against [[K]] reference statistics (standard reference values, closed forms and textbook formulas); [[S]] GitHub stars and [[D]] release downloads in [[W]] weeks."

Remove any clause you can't support with the table above.
