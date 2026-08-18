# Whole-Project Performance Baseline — 2026-08-18

*First run of the existing "V1 performance-timing suite" (`measure.mjs` + `measure-api.mjs`, originally added 2026-07-24, main branch) brought under the same tracking pipeline the Management Scan deep-dive already has: Excel report, trend log, and this baseline doc. Prior whole-project sweeps (Jul 24 – Aug 10) predate that pipeline and were never tracked this way. Report files: `reports/WholeProject_Performance_Report_2026-08-18.xlsx`, `reports/WholeProject_LoginAPI_Report_2026-08-18.xlsx`. Raw data: `results/whole-project-baseline-20260818.json`, `results/api-whole-project-baseline-20260818.json`. Trend log: `results/whole-project-perf-trend.json` (new, separate from `mgscan-perf-trend.json` — use `TREND_FILE=whole-project-perf-trend.json` with `record-perf-run.mjs`/`compare-perf-runs.mjs` to keep working with this one).

**Management Scan detail was missing from the first version of this report — fixed.** `measure.mjs`'s sweep only ever produces one generic "Page Load - Management Scan" line for the whole feature, which looks like a coverage gap when Management Scan actually has the deepest coverage of anything in this suite (30+ interaction steps per role via `measure-mgscan-full.mjs`). `merge-wholeproject-with-mgscan.mjs` combines the whole-project sweep with the latest Management Scan combined results into one report — see `reports/WholeProject_Performance_Report_Full_2026-08-18.xlsx` / `results/whole-project-with-mgscan-20260818.json` for the version that includes both. The Management Scan data in that merged file is from the 2026-08-14 run (the most recent full one available), not same-day with the 08-18 sweep — re-run `measure-mgscan-full.mjs` and re-merge for a same-day pairing when that matters.

## Scope

`measure.mjs`'s module catalog (extracted from `V1_Automation/V1.Tests/Tests/UI/Navigation/ModuleCatalog.cs`, read-only reference, zero code dependency) covers **93 pages** across every major area of HRMForce: CRM, Analytics, Candidates, Recruitment, BiLa, Development/PPP, HR Data, Support, Admin, plus Management Scan. This is page-load timing only (navigate + wait for load, best-effort networkidle) — not the deep, click-by-click interaction timing the Management Scan suite does for its own feature. `measure-api.mjs` separately times the real login path (both the UI form's actual POST and the documented-but-unused `/auth/login` REST endpoint).

**Functional flows beyond page-load are also missing for every other area** — this suite can currently answer "does this page load and how fast" for 93 pages, but not "does creating a candidate work," "does BILA Plus work," "what does a Candidate's own login experience look like," or "can a Candidate actually play an assessment outside Management Scan." Adding those is tracked as in-progress work — see the "New functional flows" section below once it's filled in.

Only one role (`Admin`, `service@hrmforce.com`) is configured in `.credentials.local.json` at present — this run reflects Admin's view/permissions only. Extending role coverage would need additional non-Admin accounts added to that file (parallel to what the Management Scan suite already does with its own PerfTest accounts).

## Result: 93/93 pages loaded successfully — zero failures

Every module in the catalog returned `ok: true`, including two pages that failed twice each (even after the built-in retry) in the 2026-08-10 Management Scan baseline run: **Dashboard.aspx** (Analytics Dashboard, 5,279ms this run) and **AdminTools.aspx?t=0** (Recalculate an Assessment, 4,061ms this run). Genuinely fixed, or at least not currently reproducing — worth keeping an eye on rather than assuming permanently resolved from one clean run.

## Timing summary

- **Average**: 2,536ms per page load
- **Median**: 2,303ms
- **Fastest**: Contact Details (1,065ms)
- **Slowest**: Recruitment Dashboard (6,464ms)

### Slowest 10 (all still "Slow" bucket, >4,000ms against this suite's Page Load threshold)

| Module | ms |
|---|---:|
| Recruitment Dashboard | 6,464 |
| Support Call | 6,261 |
| Support Overview | 6,039 |
| Analytics Dashboard | 5,279 |
| Employees (Development Overview) | 5,191 |
| My Teams | 4,538 |
| BiLa Plus | 4,381 |
| Clients | 4,345 |
| Recalculate an Assessment | 4,061 |
| CRM Organization | 4,001 |

No obvious single pattern across these (different areas: Recruitment, Support, Analytics, Development, BiLa, Admin) — each would need its own investigation if this becomes a priority; this run only establishes that they're consistently on the slower end, not why.

### Fastest 5

| Module | ms |
|---|---:|
| Contact Details | 1,065 |
| PPP Overview | 1,109 |
| Year Cycle Overview | 1,132 |
| Recruitment Documents | 1,157 |
| Matching | 1,230 |

## Login timing (`measure-api.mjs`)

- **UI sign-in form POST** (real Forms-Auth postback, `?AspxAutoDetectCookieSupport=1` → 302): 5 runs, 961–1,130ms, averaging ~1,054ms.
- **`/auth/login` direct REST call**: still 404s on every one of 5 attempts — a pre-existing, already-documented environment gap (see `LoginApiTests.cs` in the V1_Automation reference project), not a new finding. First call took 1,755ms (cold-connection overhead), subsequent 4 calls 171–176ms.

## What this baseline does NOT cover (be explicit about gaps, don't imply otherwise)

- Only page **load** timing — no in-page interactions (button clicks, form submissions, filters) for any of these 93 modules, unlike the Management Scan suite's deep interaction coverage.
- Only the `Admin` role — no permission-boundary or role-specific timing/behavior differences captured.
- No functional/content verification — a page "loading successfully" here means the HTTP navigation completed and the load event fired, not that the page's content or data is correct.
- Not a load/stress test — single sequential requests only, matching this whole suite's own stated scope (see `package.json`'s description).

## Next steps

1. Re-run this same sweep on a regular cadence (daily, per the update-check workflow in `management-scan-testing-runbook.md` §13) and start diffing via `TREND_FILE=whole-project-perf-trend.json node compare-perf-runs.mjs` once a second data point exists.
2. Decide whether the 10 consistently-slow pages above are worth investigating now or just tracking for regression going forward — this baseline doesn't have enough information to say which.
3. Consider adding non-Admin roles to `.credentials.local.json` if permission-specific whole-project timing becomes a priority.
4. If deeper coverage of any specific area (not just Management Scan) is wanted later, the same pattern used for Management Scan — a dedicated interaction-timing script plus its own test accounts — could be replicated for that area.
