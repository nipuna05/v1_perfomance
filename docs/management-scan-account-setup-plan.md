# Management Scan — Test Account Setup Plan

*Drafted with Claude Code, 2026-08-07. Follow-up to `management-scan-perf-plan.md` (2026-07-24), specifically its §5 blocker #1 ("A Manager-role test account and an Employee-role test account") and #2 (a seeded 3-level hierarchy). This is a planning document only — nothing described here has been created yet. No accounts, no data, no code changes beyond what's already landed in `measure.mjs` (Management Scan module entry, `CREDS_FILE`/`MODULE_FILTER`/`signInUrl` overrides) and the new `.credentials.localhost.json`.*

## 1. Why this is needed

Everything measurable today uses the single existing `Admin` account (`service@hrmforce.com`). Admin's `GetUserStatus()` bypass means it can *authorize* Manager-level actions (confirmed in `CalibrationController.IsAuthorized`), but it does not *render as* a Manager or Director in the UI — `MgScan.aspx`'s `IsCandidateUser` check and the Nine-Grid/Kalibirity views key off actual role/hierarchy data (`UserAccountsData.IsManager`, `Profile_MyManager`), not Admin's rights bypass. So Admin alone can reach `MgScan.aspx` (confirmed: 29.2s page load, once the sign-in URL fix landed), but it cannot exercise the Manager Nine-Grid/Kalibirity view or a Director's roll-up view the way a real user in those roles would.

The user asked specifically for **Manager and Director** accounts (not just Manager/Employee as the original plan listed) — Director is presumably the Manager's own Manager, i.e. the 3rd level in the plan's "Employee → Manager → that Manager's own Manager" hierarchy (§5 blocker #2), needed for the "Mijn dashboard" / multi-level visibility timing rows.

## 2. What "creating an account" should mean here — options, not yet decided

| Option | How | Risk / concern |
|---|---|---|
| **A. Through the app's own UI/BL flow** | Use whatever admin screen already creates candidates/users (Candidates / DirectCandidate / Clients area) logged in as Admin, same as a real H2Compute admin would onboard a new hire | Slowest, but goes through the real validation/BL path (`AccountBO`/`AccountController` per this repo's own conventions) — least likely to leave the DB in a state the app itself wouldn't produce |
| **B. Direct SQL insert against the shared dev DB** | Insert rows into `aspnet_Membership`/`aspnet_Users`/`User_Account` etc. directly | Fastest, but this is the **shared** dev DB (`LKH2VSDB01.H2LK.LOCAL`, `Q-assessment_HRMForce`) that IT/UT environments and other developers also use — a malformed insert (wrong FK, missing a trigger-populated field) could corrupt state for people who aren't even part of this test, and is exactly the kind of "existing data" edit the user just said not to do |
| **C. A dedicated seed script through the BL layer** (like a small console tool, similar in spirit to `HRMForce_TokenGenerator`) | Call `AccountBO`/`AccountController` methods directly from a throwaway script/test harness, bypassing the UI but not the business rules | Middle ground — still shared-DB, but goes through the same validation the app enforces, so less likely to create an inconsistent record |

**Given the "don't edit existing data" instruction, my default recommendation is Option A** — create the two accounts through the app's real UI, the same way any legitimate user would be onboarded, rather than writing directly into the shared database. This creates *new* rows (a new Manager and a new Director test account) without touching or mutating anything that already exists.

## 3. Proposed accounts (draft — not created)

| Role | Purpose | Relationship |
|---|---|---|
| Manager (test) | Renders the Manager Nine-Grid/Kalibirity view; is Employee-test's manager | Reports to Director (test) |
| Director (test) | Renders the "Mijn dashboard" / roll-up view one level up | Is Manager (test)'s manager |
| *(Employee — already exists?)* | The plan's blocker #2 also wants an Employee at the bottom of the chain | Need to confirm whether an existing candidate account (e.g. the `nipuna12` one used earlier this session) can be reused as this Employee, reporting to the new test Manager, instead of creating a 4th new account |

Open questions before I create anything:
1. **Confirm Option A (through-the-UI) is the right approach**, vs. B or C above.
2. Naming/credentials for the two new accounts — any convention to follow (e.g. matching the `nipuna12`-style plain-username pattern seen on the existing candidate account), or should I propose names?
3. Should the existing `nipuna12` candidate account be reassigned/reused as the Employee under the new test Manager, or should a fresh Employee account also be created?
4. Once created, should these accounts be documented back into `management-scan-perf-plan.md` §5 (marking that blocker as resolved), or tracked separately?

## 3a. Scope clarification (2026-08-08)

User confirmed: account creation and login are purely **setup** steps, not something to time. Once the accounts/hierarchy exist, the actual performance measurement should cover **everything that happens under the Management Scan page itself** — Generate click, cell-click → employee list, search/filter, Kalibirity tab load + batch save, etc. — not the login step or the account-creation flow. `measure.mjs`'s existing `Login` step stays only as a means to get into the app, excluded from what this task cares about reporting on.

Session paused here (VPN/DB connectivity issue, see git history) — resume with account creation once connectivity is confirmed stable again.

## 4. What happens after the accounts exist (unchanged from the original plan)

Per `management-scan-perf-plan.md` §6 sequencing: once accounts + hierarchy exist, add the plain page-load timing rows for each role's Personal Dashboard state, then the action-timing rows (Generate click, Kalibirity batch save), then PDF/report timing last — deferred anyway per this session's earlier note that the PDF report has no real content yet.

---
*Nothing in this document has been executed. Waiting for confirmation on §2 (creation approach) and §3 (open questions) before creating any account or touching the database.*
