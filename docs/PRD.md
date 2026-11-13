# ExperimentCheck: Product Requirements Document

Status: v1.0 (MVP). Owner: the repository owner. Companion documents: [SPEC.md](SPEC.md) (build spec), [sample-decision-memo.md](sample-decision-memo.md) (example output), [CASE-STUDY.md](CASE-STUDY.md) (portfolio write-up template).

## 1. Summary

ExperimentCheck is a free, open-source, browser-only tool that helps people plan an A/B test properly before launch and audit the result honestly afterwards. It has two modes:

- Plan: sample size, duration, sensitivity (what effect the test can detect in N days), guardrail metrics and a pre-registration summary that can be copied, downloaded as Markdown or shared as a link.
- Readout: effect, confidence interval and p-value, plus the checks that catch the most common readout mistakes: sample ratio mismatch (SRM), peeking, short duration, practical versus statistical significance and guardrail breaches. It ends with one verdict (Ship, Don't ship, Inconclusive - extend, Investigate (SRM)), the reasons behind it, and a one-page decision memo.

It is a single static page (HTML, CSS and plain JavaScript). There is no server, no sign-up, no build step, no runtime dependency, no network call and no analytics. It runs on GitHub Pages and also offline by double-clicking `index.html`. All demo data is synthetic.

## 2. Problem

Most experiment mistakes are cheap to prevent but expensive to discover late:

- Before launch: the test is too small to detect the effect anyone cares about, nobody wrote down a decision rule, and guardrails (what must not get worse) were never named.
- At readout: someone looks at the dashboard every day and stops when it turns green (peeking). Nobody checks whether the traffic split actually matches the plan (SRM). A statistically significant lift that is too small to matter gets shipped. A guardrail regression is missed because it was not on the main chart.

The people who make these calls (product managers, growth marketers, junior analysts) often don't have a statistician on hand. The tools they find are either single-purpose calculators (sample size only, or significance only) or developer-oriented libraries and command-line tools. None of the tools found in the research joins planning, pre-registration, the readout audit and a plain-English decision memo in one no-install page.

## 3. Target users

| Persona | Context | What they need from the tool |
|---|---|---|
| Product manager (APM to senior PM) | Owns the ship decision; reads results from an analyst or a dashboard | A clear verdict with reasons they can defend, and a memo they can paste into a doc |
| Data or product analyst (junior to mid) | Sets up tests and prepares readouts | Correct, cited formulas; a fast SRM and peeking sanity check; a reusable pre-registration template |
| Growth or performance marketer | Runs landing-page, email and checkout tests, often in third-party tools | Sample size and duration in plain language; a warning when a test is stopped too early |
| Student (MBA, analytics, case prep) | Learning experimentation | Worked examples (the six demo scenarios), a glossary and "how to read the verdict" |

Assumption: users know what an A/B test is, but not necessarily the formulas. The Guide tab covers the gap.

## 4. Jobs to be done

1. When I am about to launch a test, I want to know how many users and days I need for the effect I care about, so I don't run a test that can't answer the question.
2. When the traffic is fixed, I want to see the smallest effect I can detect for 1, 2, 3 ... weeks, so I can choose a realistic duration or rethink the idea.
3. When I start a test, I want to write the hypothesis, primary metric, guardrails and decision rule down, and share them, so the decision can't be quietly rewritten later.
4. When results come in, I want to know whether I can trust them (SRM, peeking, duration), so I don't act on a broken test.
5. When the result is significant, I want to know whether it is big enough to matter and whether anything important got worse, so I don't ship a trivial or harmful change.
6. When I need a decision, I want a one-page memo with the verdict, numbers and caveats, so stakeholders can review it quickly.

## 5. Competitors and differentiation

Competitors are taken from the market research behind this project. Descriptions are kept to what that research recorded.

| Tool | Type (as recorded) | Gap this project fills |
|---|---|---|
| [welpo/ab-test-calculator](https://github.com/welpo/ab-test-calculator) | Calculator | Calculator only: no pre-registration, readout audit or memo |
| [trialcheck](https://github.com/SidharthKriplani/trialcheck) | Readout audit, command line | Needs a developer setup; no planning |
| [ab-test-analysis-toolkit](https://github.com/ShivakrishnaMacha/ab-test-analysis-toolkit) | Analysis toolkit | Developer-oriented |
| [godaddy/sample-size](https://github.com/godaddy/sample-size) | Sample-size library | Planning only, for developers |
| [ab_testing_dashboard](https://github.com/bhargavasomya/ab_testing_dashboard) | Streamlit dashboard | Needs Python to run |
| Popular one-page online calculators | Single-purpose web calculators | Usually one calculation per page; no decision rule, guardrails or memo |

Differentiation, in order of importance:

1. One flow from plan to decision: plan, pre-register, audit, decide, memo.
2. An explicit, documented verdict rule. The tool says Ship, Don't ship, Inconclusive or Investigate, and why, in plain language.
3. Trust checks first: SRM and peeking are checked before the effect is interpreted.
4. Honest statistics: each formula is named and cited, approximations are labelled, and limitations are listed in the app and the README.
5. Zero install and privacy by construction: one static page, works offline, nothing leaves the browser.

## 6. MVP scope

### 6.1 Plan mode

- Metric type: conversion (binary) or continuous mean. Direction: higher is better or lower is better.
- Inputs: baseline rate (binary) or baseline mean and standard deviation (continuous); MDE as absolute or relative; alpha; power; one- or two-sided; traffic split (treatment share); daily users entering the experiment; optional start date.
- Outputs: users per arm and in total; raw duration in days; recommended duration rounded up to whole weeks (minimum 7 days) with an explanation; planned end date.
- Sensitivity: a table and an inline SVG curve of detectable MDE for 1, 2, 3, 4, 6, 8 and 12 weeks at the given traffic.
- Guardrails: up to 10, each with a name, type, direction and maximum acceptable degradation (relative %).
- Pre-registration summary: hypothesis, primary metric, test, sample, dates, guardrails and the decision rule. Copy to clipboard and download as Markdown.
- Shareable link: the whole state (plan and readout) is encoded in the URL hash. No server is involved.

### 6.2 Readout mode

- Inputs: users and conversions per arm (binary), or n, mean and SD per arm (continuous); "data through" date; number of looks so far; results for each pre-registered guardrail; SRM threshold (default 0.001).
- Statistics: absolute and relative effect with confidence intervals; p-value from a two-proportion z-test (binary) or Welch's t-test (continuous).
- Checks:
  - SRM chi-square goodness-of-fit
  - peeking/timing (analysed before the planned end, or more than one look), with an informational O'Brien-Fleming-type note and the false-positive inflation for repeated looks
  - duration (under 7 days, or not whole weeks)
  - sample shortfall
  - practical significance against the pre-registered MDE
  - guardrails (OK, At risk, Breached)
  - small-sample warnings
- Verdict: Ship / Don't ship / Inconclusive - extend / Investigate (SRM), with ordered plain-language reasons and a next step.
- Decision memo: Markdown (copy and download) and a printable view.

### 6.3 Demo scenarios (synthetic)

Six built-in examples, each loading a full plan and readout: a clean win, a flat or inconclusive test, an SRM case, a peeking-too-early case, a significant-but-trivial lift, and a guardrail breach. Each scenario produces a known verdict, and the tests check it.

### 6.4 Guide

- A Guide tab that opens first for first-time visitors (remembered in localStorage, with safe fallback when storage is blocked).
- Quick start, glossary, how to read the verdict, assumptions and limitations, and references.

### 6.5 Quality bar

- Accessible: keyboard navigation (including the tabs), visible focus, labelled fields, errors announced and linked to fields, colour never the only signal, and a table alternative for the chart. The concrete rules (focus style, palette, target sizes, zoom, manual checks) are in SPEC section 3.11.
- Responsive down to 320 px wide (WCAG 1.4.10 reflow). No external fonts or CDNs.
- Statistics validated against reference values (table in SPEC section 9), with stated tolerances.

## 7. Non-goals (v1)

- A/B/n tests with more than one treatment, and multiple-comparison corrections (planned for later).
- Sequential designs that let you stop early with valid inference (group-sequential boundaries, always-valid p-values, Bayesian methods). v1 only warns, and shows an informational O'Brien-Fleming-type figure.
- Ratio metrics with a different analysis unit (for example revenue per session when users are randomised), the delta method for ratio metrics, CUPED or variance reduction.
- Exact tests (Fisher's exact test), bootstrap and non-parametric tests. v1 warns when the normal approximation is shaky.
- Uploading raw event data or CSV files, connecting to analytics tools, generating SQL.
- Accounts, a backend, saving to the cloud, collaboration.
- Any in-app analytics, telemetry or tracking.
- Translations and dark mode.

## 8. User flows

### Flow A: first visit

1. Open the page. The Guide tab is shown first.
2. Read the quick start, or pick an example from "Load example" (for example "Guardrail breach").
3. The Readout tab opens with the verdict card, checks and memo. Each reason links back to the glossary term.
4. "Start planning" moves to Plan. Later visits open on Plan (or on the tab in the link).

### Flow B: plan a new test

1. Plan tab: choose the metric type and direction, enter the baseline, MDE, alpha, power, sides, split and daily traffic.
2. Read the required users, the duration and the recommended whole-week duration. Check the sensitivity table to see the trade-off.
3. Add guardrails with their maximum acceptable degradation. Write the hypothesis and set the start date.
4. Copy or download the pre-registration, and copy the share link into the team's doc or ticket.

### Flow C: audit a finished test

1. Open the shared link (the plan is restored) or re-enter the plan.
2. Readout tab: enter the counts (or means/SDs), the "data through" date, the number of looks and the guardrail results.
3. Read the verdict and its reasons. Fix any input errors shown next to the fields.
4. Copy, download or print the decision memo.

### Flow D: learn

1. Load each of the six examples in turn and compare their verdicts.
2. Use the glossary for terms (SRM, MDE, power, peeking, guardrail, practical significance).

## 9. Success metrics (honestly measurable)

The app has no analytics by design, so success is measured only with what GitHub already shows the repository owner. No usage figures appear in the README or the app.

| Metric | Source | How to record | Notes |
|---|---|---|---|
| Stars and forks | Repository page | Weekly snapshot in a private sheet | Public numbers |
| Repository views and unique visitors | Repository Insights > Traffic | Weekly snapshot (GitHub keeps only 14 days) | Counts repository page views, not GitHub Pages visits |
| Returning-interest proxy | Insights > Traffic | Views divided by unique visitors, per 14-day window | A proxy only. Real returning users of the live demo can't be measured without analytics |
| Referring sites | Insights > Traffic | Weekly snapshot | Shows which launch channel worked |
| Clones | Insights > Traffic | Weekly snapshot | Developer interest |
| Release ZIP downloads | Release asset `download_count` from the GitHub REST API (`GET /repos/{owner}/{repo}/releases`); the web UI does not show it | At 7, 30 and 90 days | Offline users |
| Issues and pull requests from other people | Issues and Pull requests tabs | Count at 30 and 90 days | Quality signal |
| Statistical accuracy | `npm test` reference table | Every release | 100% of reference cases within tolerance is a release gate |

Explicitly not measurable: visits to the GitHub Pages site, time in the app, memos generated. The case study must say so instead of estimating them.

Targets are deliberately not set before launch. The owner records a baseline at 30 days and sets targets for the 90-day review.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A statistical error in a public tool | Credibility loss; wrong decisions by users | Formulas cited; at least 6 sample-size and 30+ total reference cases with tolerances; simulation checks of CI coverage and false-positive rate; limitations shown in the app; MIT licence "as is" |
| Users treat the verdict as authoritative | Bad ship decisions | The verdict text always states its rule; assumptions and limitations are in the Guide and the memo; the memo says it supports, not replaces, judgement |
| Approximations misused (tiny samples, rates near 0 or 100%) | Misleading p-values or CIs | Validation rejects impossible inputs; warnings for small counts (fewer than 10 events or non-events per arm) and small n (under 30 per arm) |
| Peeking warnings misunderstood as valid sequential testing | False confidence | The O'Brien-Fleming figure is labelled "informational, approximate; valid only if pre-planned" and never changes the verdict |
| ES modules blocked on file:// | Offline double-click fails | Classic scripts only (decision in SPEC section 2.2), verified by a browser smoke test in file:// mode |
| Private or personal data leaking into the public repo | Policy breach | Synthetic demo data only; allow-list packaging; deny-list scan (must be 0 hits) on files, file names and zip entries; visible-text scan before saving screenshots; manual look at every screenshot |
| Shared links expose test data | Privacy | The Guide and README say that the URL hash holds the inputs, and the owner decides where to share it. The hash is never sent to the server by browsers |
| Low adoption | Weak portfolio signal | Launch plan below; case study written with real numbers only |

## 11. Launch plan

Approval first: nothing is published until the owner has open-source approval.

1. Pre-launch (week 0)
   - All tests and browser smoke tests pass, the package scan shows 0 deny-list hits, and every screenshot has been checked by eye.
   - README complete: live-demo placeholder, offline use, deploy-your-own steps, statistics and references, limitations, privacy.
2. Publish (day 1)
   - Create the public repository and upload the package contents in batches of 100 files or fewer.
   - Enable GitHub Pages from `main` / root, then replace the README live-demo placeholder with the Pages URL.
   - Set the About text and topics (`ab-testing`, `experimentation`, `statistics`, `product-management`, `sample-size`, `github-pages`).
   - Create release v1.0.0 with the ZIP attached.
3. Share (week 1)
   - A short post with one screenshot and the "plan, audit, decide" story in product and analytics communities (for example r/ProductManagement, r/analytics, product community Slack/Discord groups), on LinkedIn and optionally as a Show HN.
   - Ask for feedback through GitHub Issues only.
4. Review (day 30 and day 90)
   - Record the metrics in section 9 and fill in CASE-STUDY.md with real numbers.
   - Triage issues and plan v1.1 (candidates: A/B/n with a correction, Fisher's exact test for small counts, a CSV paste for readouts).

## 12. Assumptions

- Randomisation is at the user level and the analysis unit is the user. Each user is counted once.
- One primary metric and one treatment arm in v1.
- "Daily traffic" means users entering the experiment per day, across both arms. Repeat visitors are not new users. The Guide says that duration is optimistic if many users return.
- Dates are calendar dates without time zones. "Data through" is the last full day included in the readout.
