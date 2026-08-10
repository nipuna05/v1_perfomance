---
name: mgscan-perf-test
description: >-
  Run (or re-run) the Management Scan performance + functional test pass in this repo:
  create the fresh Employee/Manager/Director test hierarchy, complete a real assessment
  cycle, publish it, time every role's Nine-Grid/Kalibirity/Personal-Dashboard interactions
  respecting real permissions, check Assessment-page validation/button behavior, and build
  the consolidated Excel report. Use this whenever the user asks to test/re-test Management
  Scan performance, compare it against the 2026-08-10 baseline, or wants a fresh
  ManagementScan_FULL_Report. Trigger even without the word "skill" — e.g. "run the
  management scan perf test again", "compare management scan performance to last time".
---

# Management Scan Performance & Functional Test

Full methodology lives in `docs/management-scan-testing-runbook.md` — **read it before running
anything**, it documents every selector gotcha discovered building this (Knockout `visible` vs
`if` hiding stale buttons, the duplicated `commonFilter` mount under both tabs, the
`onSave`/`onSavePassword` substring collision, etc.). This file is the short trigger + sequencing
reference; the runbook is the source of truth for *why* each step is shaped the way it is.

Baseline numbers from the first full pass: `docs/management-scan-baseline-2026-08-10.md`.

## When invoked

1. **Confirm scope with the user first** if it's not already clear from their request:
   - Fresh full run (new hierarchy + new assessment cycle), or reuse an existing `runStamp`'s
     accounts/results from a prior run (check `results/account-setup-*.json` for what exists)?
   - Compare against the 2026-08-10 baseline, or just produce a standalone report?
2. Do **not** create new test accounts/data without the user's go-ahead first — this repo's
   working convention (see `docs/management-scan-account-setup-plan.md`) is plan-before-create
   for anything that touches the shared IT environment, even though it's fresh/throwaway data.
3. Run the runbook's steps **in order** (§2 → §7) — each depends on the previous step's output
   file (`results/account-setup-<runStamp>.json` feeds every later script).

## Quick command sequence (see runbook for full detail/gotchas on each)

```bash
CREDS_FILE=.credentials.local.json node create-mgscan-test-accounts.mjs <runStamp>
node complete-mgscan-assessments.mjs <runStamp>
node director-publish.mjs <runStamp> manager      # NOT director — see runbook §4, real bug if you use director
node measure-mgscan-full.mjs <runStamp> employee mgscan-full <runTs>
node measure-mgscan-full.mjs <runStamp> manager  mgscan-full <runTs>
node measure-mgscan-full.mjs <runStamp> director mgscan-full <runTs>
node create-mgscan-test-accounts.mjs <runStamp2> validation-only
node assign-manager.mjs "ValidationCheck" "Director"
node test-assessment-validation.mjs <runStamp2>
node build-final-report-data.mjs <employeeFile> <managerFile> <directorFile> <validationFile> <combinedFile>
node generate-excel-perf.mjs "results/<combinedFile>" "reports/ManagementScan_FULL_Report.xlsx"
```

## After running

1. Open the generated report's **Known Issues** sheet and diff it against
   `docs/management-scan-baseline-2026-08-10.md`'s findings — call out explicitly which issues
   are still present, which are fixed, and any genuinely new ones. Don't silently re-report a
   known issue as if it were new.
2. For timing, compare each step label against the baseline doc using the same Good/Acceptable/
   Slow thresholds `generate-excel-perf.mjs` already applies — flag regressions, don't just dump
   numbers.
3. Report results with Manager and Director kept in **separate** sections/rows, never merged —
   this was an explicit requirement the first time and should stay the default going forward.
4. **Git:** this repo's `main` is shared — do this work on a personal branch (e.g.
   `<name>/mgscan-perf-testing`) and do not push to `main` or any other branch without the user
   explicitly asking. Confirm before pushing anywhere.
