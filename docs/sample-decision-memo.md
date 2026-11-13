# Sample decision memo (synthetic)

This is the memo ExperimentCheck produces for the built-in **Guardrail breach** example: a fictional "Express checkout button" test. All names and numbers are invented for illustration. The memo is reproduced exactly as the app generates it (with the "Prepared" date fixed at 2025-03-17). The test suite compares the text between the markers below with the generator's output, so this file always shows real output.

Why this example: the primary metric clearly wins (+1.40 pp, p < 0.0001, above the MDE), but refunds rise by more than the pre-registered 10% limit. A dashboard that shows only conversion would say "ship". The pre-registered decision rule says "don't ship".

<!-- memo:start -->
# Decision memo: Express checkout button

**Verdict: Don't ship.** A guardrail got worse by more than its pre-registered limit.

- Experiment: Express checkout button
- Primary metric: Checkout conversion (conversion rate, higher is better)
- Data: 2025-03-03 to 2025-03-16 (14 days), 30,780 users
- Prepared: 2025-03-17 with ExperimentCheck 1.0.0. All numbers were computed in the browser from the inputs below.

## Why

- Guardrail breached: Refund rate got 24.16% worse (limit 10.00%).
- Primary metric on its own: Ship. Primary metric improved by +1.40 pp (p < 0.0001), at least the MDE of +1.00 pp.

## Next step

Do not roll out as is. Fix the guardrail regression, then re-test.

## Primary metric

| Arm | Users | Conversions | Conversion rate |
|---|---|---|---|
| Control | 15,400 | 1,540 | 10.00% |
| Treatment | 15,380 | 1,754 | 11.40% |

- Absolute difference: +1.40 pp (95% CI +0.71 pp to +2.09 pp)
- Relative lift: +14.04% (95% CI +6.90% to +21.67%)
- Test: two-proportion z-test (pooled), z = 3.99, p < 0.0001, two-sided
- Pre-registered MDE: +1.00 pp (10.00% relative)

## Checks

| Check | Result | Detail |
|---|---|---|
| Sample ratio (SRM) | PASS | Expected 15,390/15,390 at 50/50; observed 15,400/15,380; chi-square = 0.01, p = 0.909 (alert below 0.001). |
| Timing / peeking | PASS | Data through 2025-03-16, on or after the planned end; 1 look. |
| Duration | PASS | 14 days (2 full weeks). |
| Sample size | PASS | 30,780 of 29,502 planned users (104%). |
| Approximation | PASS | Normal approximation reasonable (at least 10 events and non-events per arm). |
| Statistical significance | INFO | p < 0.0001 vs alpha 0.05 (two-sided): significant. |
| Practical significance | PASS | Observed effect +1.40 pp is at least the MDE +1.00 pp. |
| Guardrail: Refund rate | FAIL | Change +24.16% (95% CI +6.82% to +44.32%); lower is better; limit 10.00% worse. Breached. |
| Guardrail: Page load time (ms) | PASS | Change +0.42% (95% CI -0.33% to +1.16%); lower is better; limit 5.00% worse. Within the limit. |

## Pre-registered plan

- Hypothesis: A one-tap express checkout button raises checkout conversion by skipping the address and payment steps for returning users.
- Test: two-sided, alpha 5%, power 80%, split 50% control / 50% treatment
- Baseline 10.00%; MDE +1.00 pp (10.00% relative); target 11.00%
- Planned sample: 14,751 control + 14,751 treatment = 29,502 users
- Planned duration: 14 days from 2025-03-03 (planned end 2025-03-16)
- Guardrails: Refund rate (lower is better, limit 10.00% worse); Page load time (ms) (lower is better, limit 5.00% worse)
- Decision rule: ship only if the sample ratio check passes, no guardrail is breached, the analysis is on or after the planned end, and the primary metric improves significantly by at least the MDE.

## Assumptions and limitations

- Users are randomised independently, the analysis unit equals the randomisation unit, and each user is counted once.
- Normal approximations: z-test, Wald CI and Katz log CI (binary); delta-method relative CI (continuous); normal-approximation sample size. They are unreliable with small counts, and the tool warns.
- Welch's t-test assumes approximately normal sample means (central limit theorem). Heavily skewed metrics (revenue) may need more data or a transformation.
- One treatment vs one control. No correction for multiple metrics or multiple guardrails.
- No valid sequential testing: peeking is only warned about. The O'Brien-Fleming figure is informational.
- The verdict is a documented rule, not a substitute for judgement about costs, risks and strategy.
- Daily traffic is assumed constant. Returning users make the real duration longer.

## Method

- Two-proportion z-test with a pooled standard error; Wald interval for the difference; Katz log interval for the relative lift.
- Sample ratio check: chi-square goodness-of-fit against the planned split (1 degree of freedom).
- Guardrails: relative change with a 95% interval (Katz log interval for rates, delta method for means); breached when the observed degradation exceeds the limit.
- Sample size: normal approximation for two proportions without continuity correction (Fleiss, Levin and Paik 2003, ch. 4).
- Verdict: statistical versus practical significance (Kohavi, Tang and Xu 2020, ch. 2); sample ratio check first (Kohavi, Tang and Xu 2020, ch. 21; Fabijan et al. 2019).
<!-- memo:end -->

## How the numbers come about

- Conversion: 1,540 / 15,400 = 10.00% vs 1,754 / 15,380 = 11.40%. The difference is +1.40 pp, and the pooled z-test gives z = 3.99 (p = 0.00007). That beats the pre-registered MDE of +1.00 pp (10% of the 10% baseline).
- Refund rate: 300 / 15,400 = 1.95% vs 372 / 15,380 = 2.42%, a +24.16% relative increase. The pre-registered limit was 10% worse, so the guardrail is breached. Even the lower end of its interval (+6.82%) shows refunds rising.
- Sample ratio: 15,400 vs 15,380 against an expected 15,390 each, so chi-square = 0.013 and p = 0.909. The split is fine.
- Because the guardrail check comes before the primary metric in the decision order, the verdict is Don't ship. The memo still reports that the primary metric alone would have been a Ship, so the trade-off is visible.
