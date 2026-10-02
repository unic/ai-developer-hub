# Cost figures have been restated

**Date**: 2026-09-18 · **Feature**: 045-usage-based-cost-model · **Applies to**: Claude API (Claude Console) figures only

Two numbers in the Hub changed this week, and historical months moved with them. Nothing about seat-based tools — Claude seats, GitHub Copilot, Microsoft Copilot, Cursor — has changed by a single cent. If you only look at seat costs, you can stop reading here.

## In one paragraph

The Hub used to work out what each person's Claude API usage cost by counting their tokens and multiplying by a price list it kept internally. That list went stale every time Anthropic released a model, and the fallback was to charge the highest rate the Hub had ever seen — which overstated one person's August spend by **7.6×**. The Hub now reads the amount Anthropic actually billed for each workspace instead of re-deriving it. Separately, the $125/month on a Claude Console licence was being forecast as if it were a cost; it is an **allowance** — how much that person may spend — and almost nobody spends it. Expected spend for those licences is now based on what was actually consumed.

## What changed, and why

### 1. Per-user Claude API cost is now Anthropic's billed figure

For a complete day, a person's cost is the amount Anthropic billed for their workspace — the same number the Claude Console shows — not a figure the Hub computed. Where a workspace has several owners, its billed total is split between them in proportion to their measured usage, and the split is labelled `apportioned` so nobody mistakes it for an individual bill.

Today's figure is still an estimate, because Anthropic bills only complete UTC days. It is labelled `estimate` and replaced by the billed number tomorrow.

**Why it moved:** the old figure consulted a price table; the new one does not.

### 2. Expected spend for Claude Console is based on consumption, not allowances

| | |
| --- | --- |
| Sum of Claude Console allowances (before) | **$3,650 / month** |
| Actual Claude API consumption, August 2026 | **$406.48** |

The budget's "expected" line carried the first number. It now carries measured consumption for completed periods, and a projection from the last three complete months for open ones. Where a licence has no consumption history at all, the allowance is still used — and labelled as a placeholder rather than a forecast.

### 3. The licence register no longer counts licences that were switched off

37 Claude Console assignments sat on the 12 pooled `boost-*` workspaces, which were deactivated in the Claude Console some time ago. The Hub was still carrying them as active. They are now revoked with an effective date of **2026-07-01**, matching the month org-wide API spend collapsed from $3,016.86 to $194.89.

| | Before | After |
| --- | --- | --- |
| Active Claude Console assignments | 40 | **3** |
| Monthly allowance on the register | $3,650 | **$375** |

Budget periods that ended before the revocation date are untouched — revoking does not rewrite the past.

## The numbers that moved

Per-user monthly totals, before → after. These are the people whose figures changed by more than a few cents.

### July–September: the people on their own workspaces

| Person | Month | Before | After | Change |
| --- | --- | --- | --- | --- |
| Marlon Schlosshauer | Aug 2026 | $630.85 | **$254.66** | −$376.19 |
| Marlon Schlosshauer | Sep 2026 (to the 17th) | $183.48 | **$112.55** | −$70.93 |
| Oliver Ladner | Jul 2026 | $180.56 | **$54.98** | −$125.58 |
| Oliver Ladner | Aug 2026 | $174.94 | **$23.37** | −$151.57 |
| Oliver Ladner | Sep 2026 (to the 17th) | $256.95 | **$48.61** | −$208.34 |
| Martin Kriegler | Jul 2026 | $248.80 | **$33.80** | −$215.00 |
| Svenja Haas | Sep 2026 (to the 17th) | $29.30 | **$29.31** | +$0.01 |

Svenja's figure barely moved, and that is the clearest evidence for the change: every model she used was in the Hub's price table, so the old computation was already right. The others used models the table did not know.

### Earlier months: apportionment across the shared pools

Before July, most people shared the pooled `boost-*` workspaces. Anthropic bills those per workspace, not per person, so each workspace's billed total is now split across the people in it by their measured usage. Individual figures move in **both** directions — the total per workspace is now exactly right, while each person's share is an estimate of a known total rather than an independent guess.

Examples from June 2026: Lukas Schiffmann $73.04 → $212.81, Silvia Monti $109.79 → $208.14, Fridolin Jackstadt $285.39 → $242.60, Tomasz Wołowiec $77.44 → $40.94.

Treat pre-July per-person figures as approximate. They always were; now they at least add up to what was billed.

## What this means for you

- **Your own cost looks lower.** It is not that you spent less — it is that the Hub was overstating it. The new number is what Anthropic charged.
- **Every figure now says how it was produced.** `billed` carries no label because it is the normal case. `apportioned` and `estimate` are marked wherever they appear, including in the profile API and the MCP tools.
- **If you integrate with the profile API**, no field changed name, type or meaning — the values are simply accurate now. New `attribution` fields were added alongside. See `docs/profile-api-integration-guide.md`.
- **Saved forecast scenarios** (the Budget / Cost Forecast Simulation) read the same per-user data and have moved with it. Re-run any scenario you rely on.

## What has not changed

- Seat-based tools: identical to the cent.
- Total org-level Claude API spend: it always came from Anthropic's billed figures and did not move.
- Project and client workspace spend (`AI Code Review Trial`, `Jungfraubahnen`, `Automations`, `Ensinger Plastics`) is still reported at org level and attributed to no individual. Attributing it to cost centres or clients needs a concept the Hub does not have yet and is a separate piece of work.
- The Hub still enforces nothing. Spend caps live in the Claude Console; the Hub mirrors and reports them.

## Questions worth expecting

**"Why was it wrong for so long?"** The Hub set a flag on every row it could not price, and nothing read the flag. There is now a sync warning that names any unpriced model, and a daily check that compares the Hub's arithmetic against Anthropic's bill and raises a warning past a tolerance. Running it against September's data surfaces the remaining gaps immediately.

**"Can it happen again?"** Not for a person on their own workspace with complete days — no price table is consulted there. It can still drift for the current-day estimate and for shared workspaces, which is exactly what the new warnings watch.

**"Which months were restated?"** Every month for which Anthropic's cost report still has data — back to 2026-01-30. Anything earlier keeps its original figures and is marked as estimated.
