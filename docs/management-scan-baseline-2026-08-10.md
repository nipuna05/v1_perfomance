# Management Scan Performance Baseline — 2026-08-10

*First full end-to-end pass. Use this to compare future runs against — see `management-scan-testing-runbook.md` §8 for how. Report file: `reports/ManagementScan_FULL_Report_2026-08-10_05-10-52.xlsx`.*

**Dataset**: 3 fresh accounts (PerfTest Director → Manager → Employee), exactly 1 candidate (Employee) with one completed, published assessment cycle. Not representative of a real production dataset size — see "Known limitations" below.

## Timings

### Employee (Personal Dashboard only — no Nine-Grid/Kalibirity access, confirmed)

| Step | ms | Verdict |
|---|---:|---|
| Login | 7,704 | — (excluded from scope per user request) |
| Page Load - Personal Dashboard | 2,347 | Acceptable |
| Report (HTML) click | 2,982 | Slow |
| Report (PDF) click | 12,768 | Slow |

### Manager (assessment evaluator — "Director" in the feature's own terminology)

| Step | ms | Verdict |
|---|---:|---|
| Page Load - Management Scan (Nine-Grid) | 2,856 | Acceptable |
| Search by name | 714 | Acceptable |
| Clear search | 328 | Good |
| Nine-Grid Generate | 803 | Acceptable |
| Grid Cell click | 733 | Acceptable |
| Pending tab click | 525 | Good |
| Kalibirity tab load | 1,122 | Acceptable |
| Kalibirity Generate | 220 | Good |
| Stage a manual override (swatch click) | 711 | Acceptable |
| Kalibirity batch save | 1,649 | Acceptable |
| Publish/Unpublish toggle | 1,243 | Acceptable |

### Director (org roll-up, one level above Manager — NOT the cycle's direct evaluator)

| Step | ms | Verdict |
|---|---:|---|
| Page Load - Management Scan (Nine-Grid) | 2,327 | Acceptable |
| Search by name | 712 | Acceptable |
| Nine-Grid Generate | 809 | Acceptable |
| Grid Cell click | 735 | Acceptable |
| Kalibirity tab load | 1,128 | Acceptable |
| Kalibirity Generate | 243 | Good |
| Stage a manual override (swatch click) | **30,017 (FAIL — timeout)** | Expected: UI correctly blocks this action for an unauthorized caller, not a real perf issue |
| Publish/Unpublish toggle | 1,272 | Acceptable — but see Known Issues, this same action 500s server-side for Director |

Thresholds (from `generate-excel-perf.mjs`): Page Load good ≤2,000ms/ok ≤4,000ms; Action good ≤1,000ms/ok ≤3,000ms.

## Functional checks (Assessment page) — 6/6 passed

1. Unanswered questions get `.is-unanswered` highlight after Submit — PASS (30 highlighted on a fully-blank submit)
2. Validation banner shown on submit-without-answering — PASS ("All 28 statements must be answered before the Management Scan can be completed (0 answered).")
3. Submit does not navigate away when validation fails — PASS
4. Pause & Resume button present and clickable — PASS
5. Pause returns to Personal Dashboard — PASS
6. Answers retained after Pause + Resume (3 answered before pause) — PASS (3/3 retained)

## Known issues at baseline time

1. **Bug**: `SetManagementScanPublishState` throws an unhandled HTTP 500 when called by a non-authorized caller (Director, not the cycle's direct MyManager) instead of a graceful error. Reproduced twice.
2. **Good (by design)**: Kalibirity's manual-override swatches are correctly non-interactive for that same Director — the bug is isolated to Publish, not calibration.
3. **Info**: PDF report generation (~12.8s) is the single slowest interaction measured.
4. **Info**: Two unrelated modules failed in the full 92-page sweep: `Dashboard.aspx`, `AdminTools.aspx?t=0` (both timed out twice, including the automatic retry).
5. **Info / not reproducible on retry**: "Add New" button on `CandidateNew.aspx` intermittently opened the wrong tab; a Kalibirity "Loading..." modal once didn't clear within 15s.

## Known limitations of this baseline (don't compare against these as if they were tested)

- Only 1 candidate existed under the test Manager — **Load More / pagination was never actually exercised** (control never appears below ~10 rows). A future run with a bigger seeded dataset will produce a *first*, not a *regressed*, number here.
- Only one full Kalibirity override cycle was staged+saved; no multi-row batch save was tested.
- Full page-load sweep (93 modules) was run once against localhost, not against this same IT-environment session — re-run it there for a directly comparable number if needed.
