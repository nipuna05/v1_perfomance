# Management Scan — Performance Test Coverage Plan

*Drafted with Claude Code, 2026-07-24. Based on the "Custom 9-Box Requirement Document V4" (23 July 2026) and the `v1_perfomance` suite as it exists today. This is a planning document, not an implementation — nothing described here has been built yet.*

## 1. Purpose

The V1 app is getting a new feature, **Management Scan** (Nine-Grid + Kalibirity tabs under Dashboard). This document plans what performance-timing coverage should be added to the `v1_perfomance` suite once the feature ships, so timing coverage grows alongside the app instead of trailing behind it. It does **not** re-litigate the feature's functional requirements — see the source requirement doc for those; this only asks "what should we time, and how."

## 2. What `v1_perfomance` already covers today

Repo: `github.com/nipuna05/v1_perfomance`. Two Node/Playwright scripts, standalone — no dependency on the `V1_Automation` C# project:

- **`measure.mjs`** — logs in once (Admin), then times page-load for all 92 existing app modules (pulled from a catalog mirroring the app's real navigation menu). Each step is `{ label, ms, ok, error }`; full sweep currently completes 92/92 with zero failures, ~1.1s–6.6s per page (avg ~2.5s).
- **`measure-api.mjs`** — times the sign-in flow itself: page-load of the sign-in screen, and the actual login action. V1 is classic ASP.NET Web Forms, so "login" is a page postback (~1s), not a REST call — `/auth/login` is a separate endpoint that currently 404s directly (pre-existing, unrelated to this suite).
- **`generate-excel-perf.mjs`** — renders either script's JSON output into a color-coded Excel report (Summary + Details sheets), thresholds bucketed by label substring (`Login`, `Page Load`, `API: *`).
- Everything shares one JSON schema: `{ runLabel, runTimestamp, baseUrl, results: [{ role, username, flow: [{label, ms, ok, error}], notes }] }`.

**Known gap, relevant to this new feature:** the suite currently only has one test identity (`Admin`, single role). Management Scan has meaningfully different views per role (Employee vs Manager), so this gap needs closing before Management Scan coverage can be built — see §5.

## 3. New surfaces Management Scan introduces, mapped to proposed timing steps

| Feature area (from requirement doc) | Proposed timed step(s) | Notes / blockers |
|---|---|---|
| Management Scan menu item load (Dashboard → Management Scan, default Nine-Grid tab) | `Page Load - Management Scan (Nine-Grid)` — add as a new entry in the module catalog, same as any other of the 92 existing modules | Straightforward once the menu item exists; no blocker |
| Nine-Grid: Search + 4 filters + **Generate** click | `Action - Nine-Grid Generate` (time from click to grid+progress-bars rendered) | Mirrors the existing "Filter"/"Sort" action-timing pattern already used for other grids in this suite's sibling (FlexForce) |
| Nine-Grid: click a grid cell → employee list renders (Voltooid/Openstaand) | `Action - Grid Cell -> Employee List` | Partial-page interaction, not a full navigation — time via a response/DOM-wait, not `waitForLoadState` |
| Employee list: "load next 10" (infinite scroll) | `Action - Employee List Load More` | Only meaningful once there are >10 records in a test dataset — needs seeded data (§5) |
| Kalibirity tab load (direct tab click, Generate required) | `Page Load - Management Scan (Kalibirity)` | Manager-only — needs a Manager-role test account (§5) |
| Kalibirity tab load via "Kalibirity →" shortcut (auto-loads, no Generate) | `Action - Kalibirity via Shortcut` | Worth timing separately from the plain tab load since it skips the Generate click |
| Kalibirity: change a position + **"Kalibraties opgeslagen"** batch save | `Action - Kalibirity Batch Save` | Time the save call itself (likely the closest analogue to FlexForce-BE's Add/Update/Delete API timing — check whether this is a real API call or a full postback once built) |
| Kalibirity: expand a row's history log | `Action - Kalibirity History Expand` | Low priority — cheap UI expand, unlikely to be a real perf concern, include only if trivial to add |
| Personal Dashboard — Employee, not yet completed (shows "Start Assessment") | `Page Load - Personal Dashboard (not started)` | Needs a seeded Employee account with zero assessment data |
| Personal Dashboard — Employee completed, Manager hasn't (shows "Waiting", disabled) | `Page Load - Personal Dashboard (awaiting manager)` | Needs a seeded Employee-completed / Manager-pending state |
| Personal Dashboard — both completed (full report + PDF button) | `Page Load - Personal Dashboard (complete)` | Needs a fully-seeded pair; this is also the state the PDF-generation timing (below) depends on |
| Personal Dashboard — "Mijn dashboard" (Manager viewing their own record) | `Action - Mijn Dashboard Open` + `Action - Terug naar Nine-Grid` | Only reachable for a Manager who is *also* someone else's Employee — needs a 3-level test hierarchy (matches the requirement doc's own A→B→C→D example) |
| Start Assessment — 28-question flow, initial load | `Page Load - Assessment (Start)` | Question wording is still an open item in the requirement doc (§8 there) — timing the *page*, not content, so this isn't blocked by that, but confirm the page is stable before adding |
| Start Assessment — submit/save | `Action - Assessment Submit` | Time submit-to-redirect, per the doc's stated redirect behavior (Manager → Nine-Grid, Employee → own dashboard) |
| Personal Dashboard — PDF download | `Action - PDF Report Generate` | Report generation is a common slow-path in these apps generally — worth a dedicated, generous threshold bucket in `generate-excel-perf.mjs` rather than lumping it with page loads |
| Employee list — per-row quick HTML/PDF icon | `Action - Employee List Quick Report` | Same generation concern as above, at smaller scale |
| To-Do page (existing module, new row type for Management Scan) | No new step — reuse the existing To-Do page-load timing already in the catalog | Behavior changes (which assessments show) don't change what's being timed |

## 4. What this plan deliberately does NOT cover

- Functional correctness of any of the above (permission boundaries, GDPR export, audit log accuracy, replay-wipes-Kalibirity-history behavior) — that's QA/functional test scope, not this performance suite.
- Load/concurrency testing (many simultaneous users) — this suite has always been single-user timing by design, consistent with the rest of `v1_perfomance` and its FlexForce siblings.
- The 28 real assessment questions' content/wording — still an open item in the source requirement doc; irrelevant to timing the page itself.
- HR Admin / Admin role screens for this feature — the requirement doc itself says these aren't detailed yet ("screen work so far covers Employee/Manager only").

## 5. What needs to exist before this can actually be built (blockers, not yet in place)

1. **A Manager-role test account and an Employee-role test account**, distinct from today's single Admin account — the suite's `.credentials.local.json` shape supports multiple `users[]` entries already (unused so far, only `Admin` populated), so this is additive, not a redesign.
2. **A seeded 3-level hierarchy** (Employee → Manager → that Manager's own Manager) to exercise "Mijn dashboard" and the multi-level visibility rule (A→B→C→D from the requirement doc).
3. **Seeded assessment data at each completion state** (not started / employee-only / both-complete) for at least one Employee each, so Personal Dashboard timing isn't measuring three different accidental states by luck.
4. **>10 employees under one Manager** to exercise the "load next 10" pagination action meaningfully.
5. Confirmation the feature is actually deployed to the environment this suite targets (`https://q-assessments-hrmforce-it.h2software.nl`) before any of this is runnable.

## 6. Suggested sequencing

Land in roughly this order, since each step unblocks the next: (1) add the multi-role credentials + seed data described in §5, (2) add the plain page-load steps (menu item, both tabs, three Personal Dashboard states) — these only need `measure.mjs`-style navigation timing, (3) add the action-timing steps (Generate, cell-click, batch save, assessment submit) once the plain page loads are confirmed working, (4) add PDF/report-generation timing last, since it's the most likely to need its own threshold tuning in `generate-excel-perf.mjs`.

---
*Scope summary for anyone picking this up: this document plans **performance-timing** coverage only, for the `v1_perfomance` suite, for the Management Scan feature described in the V4 requirement doc. It lists proposed timed steps, explicit non-goals, and concrete blockers — it is not a functional test plan and not an implementation.*
