import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '.credentials.local.json'), 'utf-8'));
const RUN_LABEL = process.argv[2] || 'before-release';
const RUN_TS = process.argv[3] || String(new Date('2026-07-14T00:00:00Z').getTime());

const resultsDir = path.join(__dirname, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

function now() {
  return process.hrtime.bigint();
}
function msSince(start) {
  return Number(now() - start) / 1e6;
}

async function step(label, fn) {
  const start = now();
  let ok = true, error = null, extra = null;
  try {
    extra = await fn();
  } catch (e) {
    ok = false;
    error = e.message?.slice(0, 300) || String(e);
  }
  const ms = msSince(start);
  return { label, ms: Math.round(ms), ok, error, extra };
}

// ── V1 login selectors — extracted verbatim from V1_Automation/V1.Tests/Pages/Login/LoginPage.cs
// (read-only reference; this suite has zero code/runtime dependency on that C# project). ────────
const UsernameInput = '#Login1_UserName';
const PasswordInput = '#Login1_Password';
const LoginButton = '#Login1_LoginButton';
// Success indicator: V1_Automation/V1.Tests/Pages/Login/LoginPage.cs's LogoutAsync() comment
// documents a real DOM trap confirmed live while building this suite: there are TWO logout
// LinkButtons — #lbLogout1 (top-bar profile dropdown, style="display: none" until that dropdown
// is opened) and #MenuLogout (always-visible sidebar link). #lbLogout1 appears FIRST in DOM
// order, so waiting on ".first()" of a combined "#MenuLogout, #lbLogout1" selector picks the
// permanently-hidden one and hangs for the full timeout (confirmed live during this suite's
// first verification run: a 27.5s "Login" step that was really a 20s timeout waiting on a
// hidden element). Scoping to #MenuLogout alone — exactly what LogoutAsync() does — fixes it.
const AppShellIndicator = '#MenuLogout';

// V1 is a classic ASP.NET Web Forms app (.aspx pages, server postbacks) — NOT a SPA. Mirrors
// V1_Automation/V1.Tests/Pages/BasePage.cs's WaitForPageLoad(): wait for the 'load' event, then
// best-effort wait for 'networkidle' (some pages keep a live connection open — chat widgets,
// polling — and never truly go idle, so this is not a hard requirement).
async function waitForPageLoad(page) {
  await page.waitForLoadState('load');
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch { /* best-effort, same as BasePage.cs */ }
}

// ── Module catalog — extracted verbatim (name + relative URL) from
// V1_Automation/V1.Tests/Tests/UI/Navigation/ModuleCatalog.cs (92 tuples). Read-only reference;
// copied here as plain data, no code dependency on that project. ────────────────────────────────
const MODULES = [
  // CRM
  ['CRM Dashboard', 'CRMDashboard.aspx'],
  ['CRM Organization', 'CRM.aspx'],
  ['CRM Contacts', 'CRMContacts.aspx'],
  ['CRM Tasks', 'CRMTasks.aspx'],
  ['CRM Opportunity', 'CRMOpportunity.aspx'],
  ['CRM Tree View', 'CRMTreeView.aspx'],
  ['CRM Email', 'CRMEmail.aspx'],
  ['CRM Not In Contacts', 'CRMNotInContacts.aspx'],

  // Analytics
  ['Analytics Dashboard', 'Dashboard.aspx'],
  ['Satisfaction', 'Analytics.aspx?t=0'],
  ['Group Overview', 'Analytics.aspx?t=1'],
  ['Factor Overview', 'Analytics.aspx?t=2'],
  ['Performance', 'Analytics.aspx?t=3'],
  ['Exit Assessment', 'Analytics.aspx?t=4'],
  ['Pulse Survey', 'Analytics.aspx?t=5'],
  ['Energy Assessment', 'Analytics.aspx?t=7'],
  ['Team Assessment', 'TeamAssessment.aspx'],
  ['Develop Matrix', 'DevelopMatrix.aspx'],
  ['9 Box Performance Grid', 'NineBoxPerformanceGrid.aspx'],
  ['Culture Assessment', 'CultureAnalytics.aspx'],

  // Candidates
  ['Candidates', 'CandidateNew.aspx'],
  ['Groups', 'Groups.aspx?Tab=2'],
  ['Direct Candidates', 'DirectCandidate.aspx?Tab=3'],
  ['Test Managers', 'TestManagers.aspx'],
  ['Clients', 'Clients.aspx'],
  ['Partner', 'Partners.aspx'],

  // Recruitment
  ['Recruitment Dashboard', 'RecruitmentDashboard.aspx'],
  ['Match Profile', 'MatchProfiles.aspx'],
  ['Matching', 'Recruitment.aspx'],
  ['Recruitment Portal Dashboard', 'RecruitmentPortalDashboard.aspx'],
  ['Vacancy', 'RecruitmentVacancy.aspx'],
  ['Recruitment Documents', 'RecruitmentDocument.aspx'],
  ['Global Process', 'GlobleProcess.aspx'],
  ['Global Process Email Template', 'GlobleProcessEmailTemplate.aspx'],
  ['Global Procedure', 'RecruitmentGlobalProcedure.aspx'],
  ['Process', 'RecruitmentProcess.aspx'],
  ['Recruitment Email Template', 'RecruitmentEmailTemplate.aspx'],
  ['Procedure', 'RecruitmentProcedure.aspx'],
  ['Stakeholders', 'RecruitmentStakeholders.aspx'],
  ['Applicant', 'RecruitmentApplicants.aspx'],
  ['Recruitment Client', 'RecruitmentClients.aspx'],

  // BiLa
  ['BiLa', 'BILA.aspx'],
  ['BiLa Overview', 'BilaOverview.aspx'],
  ['Ziezo', 'BilaBasic.aspx'],
  ['BiLa Basic Overview', 'BilaBasicOverview.aspx'],
  ['BiLa Plus', 'BILAPlus.aspx'],
  ['BiLa Plus Overview', 'BilaPlusOverview.aspx'],

  // Development / PPP
  ['Employees', 'DevelopmentOverviewNew.aspx'],
  ['PPP Overview', 'PPPOverview.aspx'],
  ['Year Cycle Overview', 'YearCycleOverview.aspx'],
  ['My Teams', 'MyTeam.aspx'],
  ['Planning Overview', 'PlanningOverview.aspx'],
  ['Requests Overview', 'RequestsOverview.aspx'],
  ['Holiday Overview', 'HolidayOverview.aspx'],

  // HR Data
  ['Competency Profiles', 'CompetencyProfiles.aspx'],
  ['Function', 'Function.aspx'],
  ['Department', 'Organization.aspx'],
  ['Organisation Diagram', 'OrganizationDiagram.aspx'],
  ['Task Overview', 'TaskProfile.aspx'],
  ['Customised Competencies', 'CustomizedCompetencies.aspx'],
  ['Materials', 'HRDataMaterials.aspx'],
  ['Pulse Survey Questions', 'PulseSurveyQuestion.aspx'],
  ['Pulse Survey Questionnaire', 'PulseSurveyQuestionare.aspx'],
  ['Study', 'Study.aspx'],
  ['Custom Assessment', 'CustomAssessment.aspx'],

  // Support
  ['Support Overview', 'SupportOverview.aspx?t=10'],
  ['Support Documents', 'Support.aspx?t=0'],
  ['Training Document', 'Support.aspx?t=9'],
  ['Sample Reports', 'Support.aspx?t=1'],
  ['Competency Overview', 'Support.aspx?t=2'],
  ['Support', 'Support.aspx?t=3'],
  ['Service Desk', 'Support.aspx?t=4'],
  ['Support Call', 'Support.aspx?t=5'],
  ['FAQ', 'Support.aspx?t=6'],
  ['Security', 'Support.aspx?t=7'],
  // "My Documents" (MyDocument.aspx) excluded, same as ModuleCatalog.cs: reproducible server
  // Runtime Error on the Q environment, tracked separately in V1_Automation, not this suite's
  // concern to fix.
  ['Video', 'Support.aspx?t=8'],
  ['Signals', 'Support.aspx?t=11'],

  // Admin
  ['Contact Details', 'ContactDetails.aspx'],
  ['Language Manager', 'LanguageManager.aspx'],
  ['Default Prices', 'DefaultPrices.aspx'],
  ['Currency', 'Currency.aspx'],
  ['Invoices', 'Invoice.aspx'],
  ['Distributor', 'Distributers.aspx'],
  ['Certification Training', 'CertificationTraining.aspx'],
  ['API Manual Sync', 'ApiManualSync.aspx'],
  ['Recalculate an Assessment', 'AdminTools.aspx?t=0'],
  ['Recalculate all assessments', 'AdminTools.aspx?t=1'],
  ['Recalculate All Assessments Client Wise', 'AdminTools.aspx?t=2'],
  ['Archive Candidates', 'AdminTools.aspx?t=3'],
  ['Resend Invoice', 'AdminTools.aspx?t=4'],

  // Other
  ['ToDo', 'ToDoList.aspx'],
  ['User Log', 'LoggingUserDetail.aspx'],
];

async function measureUser(browser, user) {
  console.log(`\n########## ${user.role} (${user.username}) ##########`);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const flow = [];
  const notes = [];

  try {
    // ===================== Page Load - Sign In page =====================
    // V1 is a classic ASP.NET Web Forms app: the sign-in form IS the base URL itself
    // (LoginPage.GoToAsync() -> Page.GotoAsync(TestConfig.BaseUrl)) — there is no separate
    // /sign-in route like the FlexForce SPA siblings this suite is modeled on.
    flow.push(await step('Page Load - Sign In page', async () => {
      await page.goto(creds.baseUrl, { waitUntil: 'load' });
      await page.locator(UsernameInput).waitFor({ state: 'visible' });
    }));

    // ===================== Login =====================
    flow.push(await step('Login', async () => {
      await page.locator(UsernameInput).fill(user.username);
      await page.locator(PasswordInput).fill(user.password);
      await page.locator(LoginButton).click();
      await waitForPageLoad(page);
      await page.locator(AppShellIndicator).waitFor({ state: 'visible', timeout: 20000 });
    }));

    // ===================== Page Load - each of the ~92 modules =====================
    for (const [name, relativeUrl] of MODULES) {
      const targetUrl = `${creds.baseUrl}/${relativeUrl}`;
      let result = await step(`Page Load - ${name}`, async () => {
        await page.goto(targetUrl, { waitUntil: 'load' });
        await waitForPageLoad(page);
      });

      let retried = false;
      if (!result.ok) {
        // Simple retry-once-on-failure (first-version scope per task spec) — NOT the full
        // SessionGuard re-login/app-shell-recovery machinery NavigationComponent.cs uses.
        retried = true;
        result = await step(`Page Load - ${name}`, async () => {
          await page.goto(targetUrl, { waitUntil: 'load' });
          await waitForPageLoad(page);
        });
      }
      if (retried) {
        notes.push(`"${name}" (${relativeUrl}): first attempt failed, retried once — ${result.ok ? 'succeeded on retry' : 'still failed after retry'}.`);
      }
      flow.push(result);
      // Lightweight progress line (console only — does not affect the output JSON schema) so a
      // ~92-module sweep can be observed/verified incrementally rather than as one long silence.
      console.log(`  [${flow.length - 2}/${MODULES.length}] ${name} -> ${result.ms}ms ok=${result.ok}${retried ? ' (retried)' : ''}`);
    }

  } catch (e) {
    notes.push(`Fatal error during measurement: ${e.message}`);
    console.log('FATAL for', user.role, e.message);
  } finally {
    await context.close().catch(() => {});
  }

  return { role: user.role, username: user.username, flow, notes };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const roleFilter = process.env.ROLE_FILTER ? process.env.ROLE_FILTER.split(',') : null;
  const usersToRun = roleFilter ? creds.users.filter(u => roleFilter.includes(u.role)) : creds.users;
  const results = [];
  for (const user of usersToRun) {
    const r = await measureUser(browser, user);
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
  await browser.close();

  const output = {
    runLabel: RUN_LABEL,
    runTimestamp: RUN_TS,
    baseUrl: creds.baseUrl,
    results,
  };
  const outPath = path.join(resultsDir, `${RUN_LABEL}-${RUN_TS}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n\nSaved results to ${outPath}`);
})();
