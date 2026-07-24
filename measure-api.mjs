import { chromium, request } from 'playwright';
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
const UsernameInput = '#Login1_UserName';
const PasswordInput = '#Login1_Password';
const LoginButton = '#Login1_LoginButton';

async function waitForPageLoad(page) {
  await page.waitForLoadState('load');
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch { /* best-effort, same as BasePage.cs */ }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// IMPORTANT DISCOVERY (confirmed via live probing while building this suite, and cross-checked
// against V1_Automation's own precedent at V1.Tests/Tests/Performance/LoginApiTimingTests.cs):
//
// V1 is a classic ASP.NET Web Forms app, NOT a SPA like the FlexForce sibling this suite is
// modeled on. Clicking the real sign-in form's submit button (#Login1_LoginButton) triggers a
// normal ASP.NET Forms-Authentication POSTBACK to the page itself (observed live: POST
// "<baseUrl>/?AspxAutoDetectCookieSupport=1" -> 302 redirect to CandidateNew.aspx) — it does
// NOT call the /auth/login REST endpoint at all. Those are two separate, unrelated code paths.
//
// V1_Automation's own LoginApiTimingTests.cs confirms this same split: it times /auth/login via
// 5 *direct* RestSharp calls (no browser involved whatsoever), completely independent of the UI
// login form. So "the real POST the sign-in form triggers" (per this suite's build spec) and
// "the documented /auth/login endpoint" (per LoginApiTests.cs / the known-404 ground truth) are
// two different requests. Rather than silently picking one interpretation, this suite measures
// BOTH, clearly labeled:
//   - "Login (API response) #N"       -> the REAL browser-triggered postback (UI form submit)
//   - "API: POST /auth/login (direct) #N" -> the documented REST endpoint, called directly,
//                                             matching LoginApiTimingTests.cs's own approach
// ═══════════════════════════════════════════════════════════════════════════════════════════

async function measureUserApi(browser, user) {
  console.log(`\n########## ${user.role} (${user.username}) [API] ##########`);
  const flow = [];
  const notes = [];
  notes.push(
    'Discovery: the UI sign-in form\'s own POST goes to the page itself (ASP.NET Forms-Auth '
    + 'postback, observed live returning a 302 redirect) — NOT to /auth/login. These are separate '
    + 'code paths (confirmed against V1_Automation/V1.Tests/Tests/Performance/LoginApiTimingTests.cs, '
    + 'which also times /auth/login via direct calls, not through the UI). Both are measured below.',
  );

  try {
    // ===================== Page Load - Sign In page (once) =====================
    const pageLoadContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const pageLoadPage = await pageLoadContext.newPage();
    flow.push(await step('Page Load - Sign In page', async () => {
      await pageLoadPage.goto(creds.baseUrl, { waitUntil: 'load' });
      await pageLoadPage.locator(UsernameInput).waitFor({ state: 'visible' });
    }));
    await pageLoadContext.close().catch(() => {});

    // ===================== Login (API response) x5 =====================
    // Repeated 5 times (fresh incognito-style context + fresh navigation each time, so every
    // run is a genuine unauthenticated login, not a session-cached no-op) for a min/median/max
    // view — same reasoning as the C# suite's Login_ValidCredentials_Timing (5 samples).
    for (let i = 1; i <= 5; i++) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      try {
        await page.goto(creds.baseUrl, { waitUntil: 'load' });
        await page.locator(UsernameInput).waitFor({ state: 'visible' });

        let observed = null;
        flow.push(await step(`Login (API response) #${i}`, async () => {
          // Registered BEFORE clicking submit, per spec — matches whatever real POST the form
          // triggers (confirmed live: the page's own Forms-Auth postback, not /auth/login).
          const respPromise = page.waitForResponse(
            (r) => r.request().method() === 'POST',
            { timeout: 20000 },
          );
          await page.locator(UsernameInput).fill(user.username);
          await page.locator(PasswordInput).fill(user.password);
          await page.locator(LoginButton).click();
          const resp = await respPromise;
          observed = { method: resp.request().method(), url: resp.url(), status: resp.status() };
          return observed;
        }));
        if (observed) {
          notes.push(`Run #${i}: UI sign-in form POST observed: ${observed.method} ${observed.url} -> ${observed.status}.`);
        } else {
          notes.push(`Run #${i}: UI sign-in form POST NOT observed — waitForResponse did not resolve (see error on that step).`);
        }
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ===================== API: POST /auth/login (direct) x5 =====================
    // Calls the actual documented endpoint (V1_Automation/V1.Tests/Tests/Api/LoginApiTests.cs:
    // POST /auth/login, body { username, password }) directly via Playwright's API request
    // context — bypassing the browser entirely, matching LoginApiTimingTests.cs's own approach.
    // Known, pre-existing, already-confirmed environment issue: this endpoint currently 404s
    // against the real environment. We do NOT throw / mark ok:false because of that — the status
    // is recorded as real timing data, same treatment as the FlexForce BE sibling's own
    // known-404 lic-type endpoint.
    const apiCtx = await request.newContext({ baseURL: creds.apiBaseUrl });
    try {
      for (let i = 1; i <= 5; i++) {
        let observedStatus = null;
        flow.push(await step(`API: POST /auth/login (direct) #${i}`, async () => {
          const res = await apiCtx.post('/auth/login', {
            data: { username: user.username, password: user.password },
          });
          const status = res.status();
          observedStatus = status;
          let body = null;
          try { body = await res.text(); } catch { /* ignore */ }
          return {
            status,
            url: res.url(),
            body: body?.slice(0, 300) || null,
            note: status === 404 ? 'Known live issue: /auth/login 404s against the real environment (see LoginApiTests.cs).' : undefined,
          };
        }));
        if (observedStatus === 404) {
          notes.push(`Run #${i}: /auth/login (direct) -> 404 — matches the known, pre-existing environment issue documented in LoginApiTests.cs. Not treated as a script failure.`);
        } else if (observedStatus != null) {
          notes.push(`Run #${i}: /auth/login (direct) -> ${observedStatus}${observedStatus === 200 ? ' — endpoint now responding successfully; the known-404 issue appears to be resolved as of this run.' : ' (differs from the previously-known 404 — worth a closer look).'}`);
        }
      }
    } finally {
      await apiCtx.dispose().catch(() => {});
    }

  } catch (e) {
    notes.push(`Fatal error during measurement: ${e.message}`);
    console.log('FATAL for', user.role, e.message);
  }

  return { role: user.role, username: user.username, flow, notes };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const roleFilter = process.env.ROLE_FILTER ? process.env.ROLE_FILTER.split(',') : null;
  const usersToRun = roleFilter ? creds.users.filter(u => roleFilter.includes(u.role)) : creds.users;
  const results = [];
  for (const user of usersToRun) {
    const r = await measureUserApi(browser, user);
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
  // Filename gets an "api-" prefix baked in (distinct from measure.mjs's plain
  // "${RUN_LABEL}-${RUN_TS}.json") so the two suites never collide even when invoked with the
  // exact same RUN_LABEL/RUN_TS args, since both scripts share this same results/ folder.
  const outPath = path.join(resultsDir, `api-${RUN_LABEL}-${RUN_TS}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n\nSaved results to ${outPath}`);
})();
