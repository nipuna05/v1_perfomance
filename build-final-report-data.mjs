import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Merges the per-role Management Scan runs plus the Assessment-page validation checklist and
// known-issue findings into one combined dataset for generate-excel-perf.mjs.
//
// Reported roles are the feature's own two-role model ONLY (2026-08-12 change, per explicit
// user instruction: "we only checking with manager and director only") - NOT the org-hierarchy
// test-account names used to script this (see docs/management-scan-testing-runbook.md section 0
// for the full mapping). The account named "employee" plays the assessment and is relabeled here
// to "Manager" (the feature's term for the assessed person); the account named "manager" is the
// evaluator and is relabeled to "Director". The third org-hierarchy account ("director", one
// level above the evaluator) is intentionally NOT included in the reported results - it's a
// different authorization class used only to demonstrate the Publish/Unpublish 500 bug, which
// stays documented in knownIssues rather than as a timed "role" section. Manager and Director
// stay as distinct `results[]` entries (never merged into one row) per the user's earlier
// "Manager and director related separated performance need".

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(__dirname, 'results');

const [, , employeeFile, managerFile, validationFile, outFile, assessmentPlayFile] = process.argv;
if (!employeeFile || !managerFile || !validationFile || !outFile) {
  console.error('Usage: node build-final-report-data.mjs <employeeAccountResultFile> <managerAccountResultFile> <validationResultFile> <combinedOutputFile> [assessmentPlayTimingFile]');
  console.error('(the org-rollup "director" account result file is deliberately not accepted here - see comments in this file)');
  console.error('assessmentPlayTimingFile is optional - the output of complete-mgscan-assessments.mjs, only available for a freshly-created dataset (an assessment can only be played once per 3-month cycle, so this data cannot be regenerated on demand the way Nine-Grid/Kalibirity data can).');
  process.exit(1);
}

function load(f) { return JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8')); }

const ROLE_DISPLAY_NAME = { employee: 'Manager', manager: 'Director' };
function relabel(resultsArr) {
  return resultsArr.map(r => ({ ...r, scriptAccountRole: r.role, role: ROLE_DISPLAY_NAME[r.role] || r.role }));
}

// Merges entries sharing the same (relabeled) role into one {role, username, flow, notes} object
// per role, flow arrays concatenated in the order given - needed because assessment-play timing
// and the Nine-Grid/Kalibirity sweep are two separate scripts/runs that both produce a 'Manager'
// and a 'Director' entry; generate-excel-perf.mjs's per-role lookup uses .find(), which would
// silently keep only the first match and drop the other script's data if these weren't merged
// here first.
function mergeByRole(...resultArrays) {
  const byRole = new Map();
  for (const arr of resultArrays) {
    for (const r of arr) {
      if (!byRole.has(r.role)) byRole.set(r.role, { role: r.role, username: r.username, flow: [], notes: [] });
      const target = byRole.get(r.role);
      target.flow.push(...(r.flow || []));
      target.notes.push(...(r.notes || []));
    }
  }
  return [...byRole.values()];
}

const employee = load(employeeFile);
const manager = load(managerFile);
const validationChecks = load(validationFile);
const assessmentPlay = assessmentPlayFile ? load(assessmentPlayFile) : null;

const combined = {
  runLabel: 'management-scan-full-report',
  runTimestamp: manager.runTimestamp,
  baseUrl: manager.baseUrl,
  results: assessmentPlay
    ? mergeByRole(relabel(assessmentPlay.results), relabel(employee.results), relabel(manager.results))
    : mergeByRole(relabel(employee.results), relabel(manager.results)),
  functionalChecks: {
    title: 'Assessment Page — Validation & Button Behavior (PerfTest ValidationCheck account)',
    checks: validationChecks,
  },
  knownIssues: [
    {
      severity: 'Bug',
      area: 'Publish/Unpublish (Nine-Grid Completed list)',
      summary: 'Clicking Publish/Unpublish as a caller who is NOT the cycle\'s direct MyManager (e.g. Director, two levels up) throws an unhandled server exception (HTTP 500 from Service/MgScanService.asmx/SetManagementScanPublishState) instead of a graceful authorization error.',
      reproduction: 'Log in as an org-level Director (manager\'s manager, not the direct MyManager of the candidate), open Nine-Grid, Generate, select the candidate\'s cell, click Publish/Unpublish on their row.',
      evidence: 'Response body: {"Message":"There was an error processing the request.","StackTrace":"","ExceptionType":""} — reproduced independently on two separate test runs.',
      suggestedFix: 'MgScanService.asmx.cs SetManagementScanPublishState already has an UnAuthorized-result check (`if (!result.Success && result.Errors.Contains("UnAuthorized"))`) — the underlying ManagementScanPlayBO.SetPublishState call for a non-authorized caller appears to throw before reaching that check rather than returning a normal ManagementScanSaveResult with Errors=["UnAuthorized"].',
    },
    {
      severity: 'Good (by design)',
      area: 'Kalibirity manual override (position swatches)',
      summary: 'Unlike Publish, the Kalibirity position-override swatches correctly appear non-actionable for a Director who is not the candidate\'s direct MyManager (click never completes/times out) — no data mutation is possible, consistent with ADR-001 authorization intent.',
      reproduction: 'Log in as Director, open Kalibirity tab, Generate, attempt to click an alternate position swatch on the candidate row.',
    },
    {
      severity: 'Info / flaky-but-recoverable',
      area: 'CandidateNew.aspx — "+New" button',
      summary: 'Clicking "Add New" on the candidate listing intermittently lands on an unrelated "My Account" tab (test-assignment grid) instead of opening the new-candidate form, consistent with the click landing before Knockout\'s data-bind is fully wired up. Recovered reliably with a retry (re-navigate + re-click).',
      reproduction: 'Occurred on 2 of roughly 6 "Add New" attempts across this test session; not deterministic.',
    },
    {
      severity: 'Info',
      area: 'Kalibirity tab — "Loading..." after Generate',
      summary: 'On one occasion, the Kalibirity tab\'s "Loading..." modal did not clear within 15 seconds after clicking Generate. Not reproducible on retry — logged as a one-off, not a confirmed bug, but worth keeping an eye on under real usage.',
    },
    {
      severity: 'Info',
      area: 'Report (PDF) generation time',
      summary: 'The Employee Personal Dashboard\'s "Report (PDF)" button took ~12.8s to produce a download, vs. ~3s for the HTML equivalent. Not a failure, but the largest single interaction time measured in this pass — worth a dedicated threshold/monitoring if PDF report usage is frequent.',
    },
    {
      severity: 'Info',
      area: 'Full page-load sweep — 2 failing modules',
      summary: 'Dashboard.aspx (Analytics Dashboard) and AdminTools.aspx?t=0 (Recalculate an Assessment) both failed to load within 30s, twice each (failed the automatic retry too), during the full ~93-module sweep. Unrelated to Management Scan but flagged since they were the only 2 non-Management-Scan failures out of 93 pages.',
    },
  ],
  terminologyNote: 'The Nine-Grid\'s own "Manager"/"Director" progress bars refer to the two sides of a Management Scan cycle (the assessment SUBJECT is labeled "Manager"; their evaluator/boss is labeled "Director") — NOT the org-hierarchy test account names used in this report\'s Role column. In this test hierarchy: PerfTest Employee is the assessment subject (feature\'s "Manager"), PerfTest Manager is the evaluator (feature\'s "Director"), and PerfTest Director is one level further up, used only for the Nine-Grid roll-up/subtree view.',
};

fs.writeFileSync(path.join(resultsDir, outFile), JSON.stringify(combined, null, 2));
console.log(`Saved combined report data to results/${outFile}`);
console.log(`Roles included: ${combined.results.map(r => r.role).join(', ')}`);
