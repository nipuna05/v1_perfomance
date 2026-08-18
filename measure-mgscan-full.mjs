import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Comprehensive, role-aware Management Scan timing + functional-check pass, run once per role
// so Manager and Director results stay in separate {role, flow, notes} entries per the user's
// "Manager and director related separated performance need" (2026-08-10). Employee only ever
// sees its own Personal Dashboard (no Nine-Grid/Kalibirity access at all — that's the permission
// boundary this script itself respects by not even attempting those tabs for that role, rather
// than hitting an authorization error and calling it a "finding"). Manager/Director share the
// same Nine-Grid+Kalibirity UI shape but differ in what they're authorized to do to a given
// candidate's cycle (see the SetManagementScanPublishState ADR-001 finding from
// director-publish.mjs — Director is NOT this candidate's computed MyManager, so publish/
// calibrate actions on THIS specific employee are expected to be unauthorized for Director,
// which this script records as data, not as a script failure).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));

const runStamp = process.argv[2];
const role = process.argv[3]; // 'employee' | 'manager' | 'director'
const RUN_LABEL = process.argv[4] || 'mgscan-full';
const RUN_TS = process.argv[5] || String(Date.now());
if (!runStamp || !role) {
  console.error('Usage: node measure-mgscan-full.mjs <runStamp> <employee|manager|director> [runLabel] [runTs]');
  process.exit(1);
}
const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `account-setup-${runStamp}.json`), 'utf-8'));
const account = accounts.find(a => a.role === role);

const resultsDir = path.join(__dirname, 'results');
fs.mkdirSync(resultsDir, { recursive: true });
const shotsDir = path.join(__dirname, 'shots', `full-${role}`);
fs.mkdirSync(shotsDir, { recursive: true });
let shotSeq = 0;
async function shot(page, label) {
  shotSeq++;
  await page.screenshot({ path: path.join(shotsDir, `${String(shotSeq).padStart(2, '0')}-${label}.png`) }).catch(() => {});
}

function now() { return process.hrtime.bigint(); }
function msSince(start) { return Number(now() - start) / 1e6; }

// Department/Function/Supervisor are jQuery "Chosen" multi-selects (ko.bindingHandlers.chosen,
// mgScan.js - `$(element).chosen()` with no options object, so the library's default markup/ID
// conventions apply unmodified: clicking `#<selectId>_chosen` opens the dropdown, results render
// as `.chosen-results li.active-result`. Server-side PrependAllOption always inserts a real,
// selectable "All ..." item first (ID -111) - skip it (nth(1)) to pick a genuine value, since
// picking "All ..." while nothing else is selected is a no-op per commonFilter.js's mutual-
// exclusivity rule (a real item always wins over "All ..."). Confirmed against source
// (commonFilter.html/js) 2026-08-13, not guessed.
//
// `scope` must be `nineGridTab` (or `#tabMgScanKalibirity`), NOT the bare `page` - commonFilter
// is mounted twice (once per tab, both kept alive via `visible` not `if`), so an unscoped
// `#<id>_chosen` lookup resolves to 2 elements and strict-mode-fails (confirmed live 2026-08-13 -
// exactly the duplicated-commonFilter gotcha this runbook already documented for the search box
// and Generate button, just not yet applied to the newer Chosen filters when they were added).
async function chosenSelectRealOption(scope, page, selectId) {
  const chosenBox = scope.locator(`#${selectId}_chosen`);
  await chosenBox.click();
  const results = chosenBox.locator('.chosen-results li.active-result');
  await results.first().waitFor({ state: 'visible', timeout: 5000 });
  const count = await results.count();
  const target = count > 1 ? results.nth(1) : results.first();
  const label = (await target.textContent())?.trim();
  await target.click();
  await page.waitForTimeout(200); // let Chosen re-render the chip/close the dropdown
  return label;
}
// Removes every staged chip on a Chosen multi-select, which per commonFilter.js's mutual-
// exclusivity rule snaps the widget back to "All ..." once the last real item is deselected -
// same UI outcome as a fresh page load, without reloading the page.
//
// Hard-capped and no-progress-guarded (confirmed live 2026-08-13: an earlier, uncapped version
// of this loop hung indefinitely - the manager sweep never got past this step, with zero output
// for 10+ minutes, screenshots showing it stalled right after "Generate (with filters applied)").
// Whatever the exact root cause (selector mismatch for this build's Chosen markup, a click not
// registering as a real user event, or something else), an unbounded while-loop on a live page
// interaction must never be able to hang a script - cap it and report what happened either way.
async function chosenClearAll(scope, page, selectId, notes) {
  const chosenBox = scope.locator(`#${selectId}_chosen`);
  const closers = chosenBox.locator('.search-choice-close');
  let n = await closers.count();
  const startCount = n;
  let iterations = 0;
  // This test only ever stages ONE chip per filter (chosenSelectRealOption picks a single
  // option), so 5 is already generous headroom - kept well short of the old unbounded loop's
  // multi-minute hang, worst case here is ~5 x (2s click timeout + 150ms) = ~11s, not infinite.
  const MAX_ITERATIONS = 5;
  while (n > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const before = n;
    await closers.first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(150);
    n = await closers.count();
    if (n >= before) {
      // No progress this iteration - clicking isn't removing chips. Stop immediately rather
      // than burn the remaining iteration budget on something that clearly isn't working.
      notes?.push(`chosenClearAll(${selectId}): click on .search-choice-close did not reduce the chip count (stuck at ${n}) - stopped after ${iterations} attempt(s) instead of hanging.`);
      return { cleared: false, remaining: n, iterations };
    }
  }
  if (n > 0) notes?.push(`chosenClearAll(${selectId}): gave up after ${MAX_ITERATIONS} iterations with ${n} chip(s) still remaining (started with ${startCount}).`);
  return { cleared: n === 0, remaining: n, iterations };
}

// Shared by every Report(HTML)/(PDF) trigger (toolbar, row-level, Personal Dashboard) - all of
// them end in the same window.open("Report.aspx?...", "_blank") call, just reached via a
// different button/popup path. HTML reports only ever open a new tab (no file download); PDF
// reports both open a tab AND trigger a download almost immediately after. Waiting the full
// download timeout unconditionally (the first version of this helper's logic) inflated every
// HTML step's reported time by however long that timeout was, since the download event was
// never coming - confirmed live 2026-08-13 (row-level HTML measured 15s for what should be a
// ~1-2s open). Wait for the popup first (the one signal both report types always produce), then
// give a short, bounded grace period for an accompanying download rather than the full timeout.
async function clickAndAwaitReport(page, clickFn) {
  // Both listeners registered BEFORE the click (required - Playwright only catches events that
  // fire after waitForEvent is armed), then awaited together so the total wait is bounded by
  // whichever timeout is longer, not both added sequentially. downloadTimeout is short: PDFs
  // trigger it within ~1-2s of the popup opening, and HTML reports never trigger one at all, so
  // there's nothing to gain from a long wait there (a naive sequential 15s wait AFTER the popup
  // already resolved was exactly what inflated HTML row-report timing to 15s - confirmed live
  // 2026-08-13, should be ~1-2s).
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
  const downloadPromise = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await clickFn();
  const [popup, download] = await Promise.all([popupPromise, downloadPromise]);
  if (popup && !download) await popup.close().catch(() => {});
  return { downloadStarted: !!download, openedNewTab: !!popup, suggestedFilename: download ? download.suggestedFilename() : null };
}

async function step(label, fn) {
  const start = now();
  let ok = true, error = null, extra = null;
  try { extra = await fn(); } catch (e) { ok = false; error = e.message?.slice(0, 400) || String(e); }
  const ms = msSince(start);
  console.log(`  ${label} -> ${Math.round(ms)}ms ok=${ok}${error ? ' — ' + error.split('\n')[0] : ''}`);
  return { label, ms: Math.round(ms), ok, error, extra };
}

const flow = [];
const notes = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (msg) => { if (msg.type() === 'error') notes.push(`Browser console error: ${msg.text().slice(0, 200)}`); });
  page.on('pageerror', (err) => { notes.push(`Uncaught JS exception: ${err.message.slice(0, 300)}`); });
  // A native browser dialog (confirm/alert/prompt) blocks all page interaction until dismissed -
  // Playwright auto-dismisses these by default only for `beforeunload`; anything else just sits
  // there, and every subsequent locator action hangs until its own timeout with no indication why.
  // Confirmed live 2026-08-14: a native dialog titled "HrmForce" showing "Loading..." appeared
  // during Kalibirity Generate and silently ate 30s on the next click - no console error/pageerror
  // preceded it, so this is either an intentional (if unusual for an SPA) native dialog, or a
  // fallback triggered by something not visible via those two events. Log + auto-dismiss so the
  // rest of the flow can proceed and this shows up as data instead of an opaque timeout.
  page.on('dialog', async (dialog) => {
    notes.push(`Native browser dialog appeared: type=${dialog.type()}, message="${dialog.message().slice(0, 200)}" - auto-dismissed.`);
    await dialog.dismiss().catch(() => {});
  });
  page.on('requestfinished', async (req) => {
    if (req.url().includes('.asmx/')) {
      const res = await req.response();
      if (res && res.status() >= 400) {
        const body = await res.text().catch(() => '');
        notes.push(`HTTP ${res.status()} on ${req.url().split('/Service/')[1]?.split('?')[0]}: ${body.slice(0, 200)}`);
      }
    }
  });

  try {
    flow.push(await step('Login', async () => {
      await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#Login1_UserName').fill(account.username);
      await page.locator('#Login1_Password').fill(account.password);
      await page.locator('#Login1_LoginButton').click();
      await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    }));

    if (role === 'employee') {
      // ── Employee: Personal Dashboard only. No Nine-Grid/Kalibirity — confirming that absence
      // IS the expected permission boundary, not attempting to force access to it. ──────────
      flow.push(await step('Page Load - Personal Dashboard', async () => {
        await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
        await page.locator('h1', { hasText: account.fullName }).waitFor({ state: 'visible', timeout: 20000 });
        await shot(page, 'dashboard');
      }));

      flow.push(await step('Permission check - Nine-Grid/Kalibirity tabs absent for Employee', async () => {
        const tabs = await page.locator('.mgscan-tabs').count();
        if (tabs > 0) throw new Error('Employee unexpectedly sees Manager/Kalibirity tab navigation — permission boundary may have regressed.');
        return { confirmedAbsent: true };
      }));

      // A "Loading..." modal briefly covers the dashboard right after navigation (same pattern
      // seen on the Kalibirity tab) — wait for it to clear before checking for report buttons,
      // otherwise a same-tick check can find 0 even though they render moments later.
      await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
      await shot(page, 'before-report-buttons-check');

      // As of the "Unify Manager and Employee report generation" release (2026-08-13), the
      // Personal Dashboard's Report(HTML)/(PDF) buttons now go through the SAME language-popup
      // flow already handled for Manager's toolbar/row-level reports (onReportHtml/onReportPdf
      // just set *PopupVisibility(true) now; the real window.open moves to onHtmlOk/onPdfOk).
      // Confirmed via source (mgScanEmployee.js ~643-694) after this test's first run against
      // the new release hung for 30s clicking the PDF button - it was blocked by the still-open
      // HTML popup left over from the previous step, which the old immediate-download assumption
      // never detected or dismissed.
      async function personalDashboardReport(label) {
        // As of the 2026-08-14 release, these are icon-only buttons (title tooltip via a token
        // binding, no visible text) - a UI redesign, not a functional change. Text matching
        // silently found 0 buttons and made a working feature look broken. Match by icon class,
        // same convention as the row-level icons (mgScanEmployee.html: .fa-code / .fa-file-pdf).
        const iconClass = label === 'HTML' ? '.fa-code' : '.fa-file-pdf';
        const btn = page.locator(`button:has(${iconClass}), a:has(${iconClass})`);
        if (await btn.count() === 0) { notes.push(`Report (${label}) button not present — cycle may not be published yet.`); return { skipped: true }; }
        let hadLanguagePopup = false;
        // The whole click sequence (main button, then Ok if a popup shows) runs INSIDE
        // clickAndAwaitReport's clickFn, so its popup/download listeners are armed before any of
        // it happens - correct regardless of whether this build shows the popup or opens
        // immediately, with no separate/duplicated listener setup for each path.
        const result = await clickAndAwaitReport(page, async () => {
          await btn.click();
          const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
          hadLanguagePopup = await okBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
          if (hadLanguagePopup) await okBtn.click();
        });
        return { hadLanguagePopup, ...result };
      }

      flow.push(await step('Action - Report (HTML) click', () => personalDashboardReport('HTML')));
      flow.push(await step('Action - Report (PDF) click', () => personalDashboardReport('PDF')));

    } else {
      // ── Manager / Director: full Nine-Grid + Kalibirity sweep. ──────────────────────────
      const nineGridTab = page.locator('#tabMgScanNineGrid');

      flow.push(await step('Page Load - Management Scan (Nine-Grid)', async () => {
        await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
        await nineGridTab.locator('a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 20000 });
        await shot(page, 'nine-grid-loaded');
      }));

      flow.push(await step('Action - Search by name (real match)', async () => {
        const search = nineGridTab.locator('input[data-bind*="filter().SearchText"]');
        await search.fill('PerfTest Employee');
        await search.press('Enter');
        await page.waitForTimeout(600);
        await shot(page, 'search-real-match');
      }));

      flow.push(await step('Action - Clear search', async () => {
        const search = nineGridTab.locator('input[data-bind*="filter().SearchText"]');
        await search.fill('');
        await search.press('Enter');
        await page.waitForTimeout(300);
      }));

      flow.push(await step('Action - Nine-Grid Generate', async () => {
        await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await shot(page, 'after-generate');
      }));

      flow.push(await step('Action - Report (PDF) toolbar (language popup + overview report)', async () => {
        // Toolbar-level Report (PDF) is a 2-step flow: click opens a language-selection popup
        // (onReportPdf -> pdfPopupVisibility(true)), then Ok generates the filtered/overview
        // report (onPdfOk -> _openOverviewReport -> window.open). Confirmed via source
        // (mgScanManager.html/.js) rather than guessed — recently fixed per PR 5590/5581
        // (2026-08-07), which is why this step exists: the user asked to verify PDF
        // view/download is genuinely working now, not just the row-level icon.
        const toolbarBtn = nineGridTab.locator('a[data-bind*="onReportPdf"]');
        if (await toolbarBtn.count() === 0) { notes.push('Toolbar Report (PDF) button not found.'); return { skipped: true }; }
        return clickAndAwaitReport(page, async () => {
          await toolbarBtn.click();
          const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
          const popupAppeared = await okBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
          if (!popupAppeared) { notes.push('Report (PDF) language popup did not appear after toolbar click.'); return; }
          await shot(page, 'pdf-language-popup');
          await okBtn.click();
        });
      }));

      flow.push(await step('Action - Export (.xlsx download)', async () => {
        // Toolbar Export -> FileDownload.aspx?ManagementScanNineGridExport=True&...filters ->
        // NineGridController.ExportExcel - a real server-recomputed .xlsx, not a client-side
        // CSV dump. Confirmed via source 2026-08-13.
        const exportBtn = nineGridTab.locator('a[data-bind*="onExport"]');
        if (await exportBtn.count() === 0) { notes.push('Export button not found.'); return { skipped: true }; }
        const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
        await exportBtn.click();
        const download = await downloadPromise;
        return { downloadStarted: !!download, suggestedFilename: download ? download.suggestedFilename() : null };
      }));

      flow.push(await step('Action - Filter: Department (multi-select, Chosen)', async () => {
        if (await nineGridTab.locator('#mgScanDepartment_chosen').count() === 0) { notes.push('Department filter (Chosen widget) not found.'); return { skipped: true }; }
        const picked = await chosenSelectRealOption(nineGridTab, page, 'mgScanDepartment');
        await shot(page, 'filter-department-picked');
        return { picked };
      }));

      flow.push(await step('Action - Filter: Function (multi-select, Chosen)', async () => {
        if (await nineGridTab.locator('#mgScanFunction_chosen').count() === 0) { notes.push('Function filter (Chosen widget) not found.'); return { skipped: true }; }
        const picked = await chosenSelectRealOption(nineGridTab, page, 'mgScanFunction');
        return { picked };
      }));

      flow.push(await step('Action - Filter: Supervisor (multi-select, Chosen)', async () => {
        if (await nineGridTab.locator('#mgScanSupervisor_chosen').count() === 0) { notes.push('Supervisor filter (Chosen widget) not found.'); return { skipped: true }; }
        const picked = await chosenSelectRealOption(nineGridTab, page, 'mgScanSupervisor');
        return { picked };
      }));

      flow.push(await step('Action - Filter: Group (single-select, native)', async () => {
        // Group is a plain <select> (no Chosen) - options: groups, value: filter().GroupID.
        const groupSelect = nineGridTab.locator('select').filter({ has: page.locator('option') }).last();
        const options = await groupSelect.locator('option').allTextContents();
        if (options.length < 2) { notes.push('Group filter has fewer than 2 options - nothing to switch to.'); return { skipped: true }; }
        await groupSelect.selectOption({ index: 1 });
        return { picked: options[1]?.trim() };
      }));

      flow.push(await step('Action - Nine-Grid Generate (with filters applied)', async () => {
        await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await shot(page, 'after-generate-filtered');
      }));

      flow.push(await step('Action - Reset filters (Department/Function/Supervisor back to All)', async () => {
        const dept = await chosenClearAll(nineGridTab, page, 'mgScanDepartment', notes);
        const func = await chosenClearAll(nineGridTab, page, 'mgScanFunction', notes);
        const sup = await chosenClearAll(nineGridTab, page, 'mgScanSupervisor', notes);
        const groupSelect = nineGridTab.locator('select').filter({ has: page.locator('option') }).last();
        await groupSelect.selectOption({ index: 0 }).catch(() => {});
        return { dept, func, sup };
      }));

      flow.push(await step('Action - Nine-Grid Generate (filters reset)', async () => {
        await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await shot(page, 'after-generate-reset');
      }));

      flow.push(await step('Action - Grid Cell click (real data cell)', async () => {
        // Prefer a cell that actually shows a candidate avatar (real data) over an empty one.
        const cellWithAvatar = nineGridTab.locator('.mg-nine-cell', { has: page.locator('[class*="avatar"], .mgscan-avatar, [style*="border-radius"]') });
        const target = (await cellWithAvatar.count()) > 0 ? cellWithAvatar.first() : nineGridTab.locator('.mg-nine-cell').first();
        await target.click();
        await page.waitForTimeout(600);
        await shot(page, 'after-cell-click');
      }));

      flow.push(await step('Data check - Employee row visible with correct scores', async () => {
        const row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
        if (await row.count() === 0) {
          notes.push(`${role}: PerfTest Employee row not found in this cell — may need a different cell (subtree visibility) or search.`);
          return { found: false };
        }
        const rowText = await row.first().textContent();
        return { found: true, rowText: rowText?.trim().slice(0, 200) };
      }));

      flow.push(await step('Action - Row click -> open candidate Personal Dashboard', async () => {
        // Not a real page navigation - MgScanVM.openDashboard just flips currentView() to
        // 'employee' (in-page Knockout view swap, mgScan.js). Confirmed via source 2026-08-13.
        const row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
        if (await row.count() === 0) { notes.push('Employee row not visible for dashboard-navigation test.'); return { skipped: true }; }
        await row.first().click();
        const dashboard = page.locator('#tabMgScanEmployee');
        await dashboard.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        const opened = await dashboard.isVisible().catch(() => false);
        if (!opened) notes.push('Row click did not open the Personal Dashboard view (#tabMgScanEmployee never became visible).');
        await shot(page, 'candidate-dashboard-opened');
        return { opened };
      }));

      flow.push(await step('Action - Back to Nine-Grid from candidate dashboard', async () => {
        const backBtn = page.locator('#tabMgScanEmployee button[data-bind="click: onBack"]');
        if (await backBtn.count() === 0) { notes.push('Back button not found on candidate dashboard.'); return { skipped: true }; }
        await backBtn.click();
        await nineGridTab.locator('a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 10000 });
        await shot(page, 'back-on-nine-grid');
      }));

      flow.push(await step('Action - "Load All Completed" (drops cell scope, ADR-012)', async () => {
        const loadAllBtn = page.locator('a[data-bind*="onShowAllCompleted"]');
        if (await loadAllBtn.count() === 0) { notes.push('"Load All Completed" button not found - may not have shipped yet on this environment.'); return { skipped: true }; }
        await loadAllBtn.click();
        await page.waitForTimeout(300);
        await shot(page, 'load-all-completed');
      }));

      flow.push(await step('Action - Sub-tab round trip (Voltooid -> Openstaand -> Voltooid)', async () => {
        const openstaandBtn = page.locator('.mg-cell-tabs button', { hasText: /pending|openstaand/i });
        const voltooidBtn = page.locator('.mg-cell-tabs button', { hasText: /completed|voltooid/i });
        if (await openstaandBtn.count() === 0 || await voltooidBtn.count() === 0) { notes.push('Sub-tab buttons not found for round-trip test.'); return { skipped: true }; }
        await openstaandBtn.first().click();
        await page.waitForTimeout(300);
        await voltooidBtn.first().click();
        await page.waitForTimeout(300);
      }));

      flow.push(await step('Action - Pending tab click', async () => {
        const pendingTab = page.locator('button', { hasText: /pending/i });
        if (await pendingTab.count() === 0) { notes.push('No Pending sub-tab found.'); return { skipped: true }; }
        await pendingTab.first().click();
        await page.waitForTimeout(400);
        await shot(page, 'pending-tab');
      }));

      flow.push(await step('Load More - pending list (only meaningful with >10 rows)', async () => {
        const loadMore = page.locator('.kal-load-more-btn, a', { hasText: /load more/i });
        if (await loadMore.count() === 0) { notes.push('No Load More control visible — dataset (1 candidate) is below the pagination threshold, so this is untestable with current seed data.'); return { skipped: true, reason: 'below pagination threshold' }; }
        await loadMore.first().click();
        await page.waitForTimeout(600);
      }));

      flow.push(await step('Action - Kalibirity tab load', async () => {
        await page.locator('.mgscan-tabs').getByText('Kalibirity', { exact: true }).click();
        await page.waitForTimeout(1000);
        await shot(page, 'kalibirity-tab');
      }));

      flow.push(await step('Action - Kalibirity Generate', async () => {
        const kalGenerate = page.locator('#tabMgScanKalibirity a[data-bind*="onGenerate"]');
        if (await kalGenerate.count() === 0) { notes.push('No Generate control under Kalibirity tab.'); return { skipped: true }; }
        await kalGenerate.click();
        // Wait for the actual "Loading..." modal (text seen live) to disappear, not just
        // networkidle — confirmed live that networkidle can resolve while this modal is still
        // showing, understating how long the UI is actually stuck/busy.
        const loadingModal = page.getByText('Loading...', { exact: true });
        let modalStuck = false;
        try {
          await loadingModal.waitFor({ state: 'visible', timeout: 2000 });
          await loadingModal.waitFor({ state: 'hidden', timeout: 15000 });
        } catch {
          modalStuck = await loadingModal.isVisible().catch(() => false);
        }
        await shot(page, 'kalibirity-generated');
        if (modalStuck) notes.push(`${role}: Kalibirity Generate's "Loading..." modal did not clear within 15s — possible stuck-spinner bug (see console/pageerror notes for a root cause if one was captured).`);
        return { modalStuck };
      }));

      const kalRow = page.locator('#tabMgScanKalibirity .kal-row', { hasText: 'PerfTest Employee' });
      flow.push(await step('Data check - Kalibirity row for Employee visible', async () => {
        const found = await kalRow.count() > 0;
        if (!found) notes.push(`${role}: no Kalibirity row for PerfTest Employee found after Generate — may require the automatic position to be computed (both sides Done) or a different filter state.`);
        await shot(page, 'kalibirity-row-check');
        return { found };
      }));

      flow.push(await step('Action - Stage a manual override (click a non-current swatch)', async () => {
        if (await kalRow.count() === 0) { notes.push('Cannot stage an override — Employee row not found in Kalibirity list.'); return { skipped: true }; }
        // Confirmed live 2026-08-14: an in-page modal (NOT a native browser dialog - Playwright's
        // `dialog` event never fires for it, despite being styled to look like an OS dialog,
        // titled "HrmForce" with a "Loading..." spinner) can persist over the swatch, making
        // Playwright's own actionability check wait the full click timeout with no indication why.
        // This is the same class of "Loading..." stuck-spinner issue already seen on Kalibirity
        // Generate, just a different trigger/selector - wait it out first rather than let a plain
        // .click() hang for the full 30s with a message that doesn't explain what actually blocked it.
        // Confirmed FIXED 2026-08-18 (check-kalibirity-adr024.mjs): the click now completes in
        // ~33ms for the direct-manager evaluator, after Kalibirity switched to a new
        // GetFilteredScansForCalibration endpoint. Left this defensive wait in place anyway -
        // cheap insurance, not proof the underlying class of stuck-spinner bug can't recur elsewhere.
        const genericLoading = page.getByText('Loading...', { exact: true });
        const stuckBeforeSwatch = await genericLoading.isVisible().catch(() => false);
        if (stuckBeforeSwatch) {
          const cleared = await genericLoading.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false);
          if (!cleared) { notes.push('A "Loading..." modal was still covering the page before the override-swatch click could even be attempted, and did not clear within 10s - likely the same stuck-spinner class of bug already known from Kalibirity Generate, but blocking a different action this time.'); return { skipped: true, stuckModal: true }; }
        }
        const otherSwatch = kalRow.first().locator('.kal-swatch:not(.is-current)').first();
        if (await otherSwatch.count() === 0) { notes.push('No alternate position swatch found to click.'); return { skipped: true }; }
        await otherSwatch.click({ timeout: 10000 });
        await page.waitForTimeout(400);
        const commentInput = kalRow.first().locator('.kal-inline-edit-input');
        if (await commentInput.count() > 0) {
          await commentInput.fill('Performance-test override — reason for manual calibration change.');
        }
        await shot(page, 'override-staged');
      }));

      flow.push(await step('Action - Kalibirity batch save ("Save calibrations (N)")', async () => {
        const saveBtn = page.locator('#tabMgScanKalibirity a[data-bind*="click: onSave"]');
        if (await saveBtn.count() === 0) { notes.push('No batch-save control found at all.'); return { skipped: true }; }
        const label = (await saveBtn.textContent())?.trim();
        if (/Calibrations saved/i.test(label || '')) { notes.push(`Batch-save button shows "${label}" — no pending change was actually staged (override click may not have registered).`); return { skipped: true, label }; }
        await saveBtn.click();
        await page.waitForTimeout(1500);
        const labelAfter = (await saveBtn.textContent())?.trim();
        await shot(page, 'after-batch-save');
        return { labelBefore: label, labelAfter };
      }));

      // ── Publish/Unpublish round-trip, back on the Nine-Grid Completed list. Re-select a
      // cell after switching tabs — the completed-list panel's visibility depends on the
      // Nine-Grid's own selected-cell state, which does not survive a tab round-trip
      // (confirmed live: employeeRow.count() was 0 immediately after switching back without
      // re-clicking a cell). ────────────────────────────────────────────────────────────────
      await page.locator('.mgscan-tabs').getByText('Nine-Grid', { exact: true }).click();
      await page.waitForTimeout(500);
      // Simplest reliable approach: click every cell until the employee's row reappears.
      let employeeRow = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
      if (await employeeRow.count() === 0) {
        const cells = await nineGridTab.locator('.mg-nine-cell').all();
        for (const c of cells) {
          await c.click();
          await page.waitForTimeout(400);
          employeeRow = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
          if (await employeeRow.count() > 0) break;
        }
      }

      flow.push(await step('Action - Publish/Unpublish toggle', async () => {
        if (await employeeRow.count() === 0) { notes.push('Employee row not visible for publish-toggle test in this view state.'); return { skipped: true }; }
        const publishBtn = employeeRow.first().locator('button[data-bind*="onTogglePublish"]');
        // Short explicit timeouts — after toggling, the row can legitimately leave the
        // "Completed" list's current filter/cell view entirely (confirmed live: the button
        // disappears rather than just changing its title), which would otherwise make
        // Playwright's default 30s auto-wait make this step look falsely "slow".
        const before = await publishBtn.getAttribute('title', { timeout: 3000 }).catch(() => null);
        await publishBtn.click({ timeout: 3000 }).catch((e) => notes.push(`Publish toggle click issue: ${e.message.slice(0, 150)}`));
        await page.waitForTimeout(1200);
        const stillThere = await publishBtn.count() > 0;
        const after = stillThere ? await publishBtn.getAttribute('title', { timeout: 3000 }).catch(() => null) : null;
        const toggled = before !== after || !stillThere;
        if (!stillThere) notes.push(`${role}: after toggling, the row/button left the current Completed-list view (expected if toggling Unpublish removes it from that filtered list) — toggle itself likely succeeded.`);
        else if (!toggled) notes.push(`${role}: Publish/Unpublish click did not change state (before="${before}", after="${after}") — see director-publish.mjs's finding: only the cycle's actual MyManager (or a super-user) is authorized; a non-authorized caller gets an unhandled 500 rather than a graceful error.`);
        return { before, after, toggled, stillThere };
      }));

      // Best-effort: leave the cycle published (re-find the row fresh, since it may have moved
      // list/cell after the toggle above) so downstream checks (Employee's dashboard) stay valid.
      try {
        await page.locator('.mgscan-tabs').getByText('Nine-Grid', { exact: true }).click();
        await page.waitForTimeout(500);
        const cells = await nineGridTab.locator('.mg-nine-cell').all();
        for (const c of cells) {
          await c.click();
          await page.waitForTimeout(300);
          const row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
          if (await row.count() > 0) {
            const btn = row.first().locator('button[data-bind*="onTogglePublish"]');
            const t = await btn.getAttribute('title', { timeout: 2000 }).catch(() => null);
            if (t === 'Publish') await btn.click({ timeout: 2000 }).catch(() => {});
            break;
          }
        }
        await page.waitForTimeout(800);
      } catch { /* best-effort cleanup only */ }

      // Row action icons ARE both present (Report HTML via onRowReportHtml, Report PDF via
      // onRowReportPdf - mgScanManager.html ~712-714) - the static title="Download PDF"/
      // "Download HTML" in the markup is only a pre-bind fallback, immediately overwritten at
      // runtime by `attr: { title: tokens().ReportPdf/ReportHtml }` (localized Token Manager
      // strings) - matching on that literal title finds nothing even though the button renders.
      // Match on the stable icon class instead (.fa-file-pdf / .fa-code).
      //
      // As of the 2026-08-13 master sync, row-level reports gained their OWN language popups
      // (rowHtmlPopupVisibility/rowPdfPopupVisibility, mgScanManager.html ~571-581) - a behaviour
      // change from the immediate window.open this test previously assumed (fixed 2026-08-12,
      // now stale again). Same Ok-button pattern as the toolbar popups: `a[data-bind="click:
      // onOk"]:visible`.
      async function rowReport(iconClass, label) {
        if (await employeeRow.count() === 0) { notes.push(`Employee row not visible for row-level ${label} report test in this view state.`); return { skipped: true }; }
        const btn = employeeRow.first().locator(`.mg-cell-row-actions button:has(${iconClass})`);
        if (await btn.count() === 0) { notes.push(`No inline Report (${label}) icon found on the candidate row.`); return { skipped: true }; }
        let hadLanguagePopup = false;
        const result = await clickAndAwaitReport(page, async () => {
          await btn.click();
          const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
          hadLanguagePopup = await okBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
          if (hadLanguagePopup) await okBtn.click();
        });
        return { hadLanguagePopup, ...result };
      }

      flow.push(await step('Action - Report (HTML) generate for candidate row', () => rowReport('.fa-code', 'HTML')));
      flow.push(await step('Action - Report (PDF) generate for candidate row', () => rowReport('.fa-file-pdf', 'PDF')));
    }

  } catch (e) {
    notes.push(`Fatal error during measurement: ${e.message}`);
    console.log('FATAL:', e.message);
    await shot(page, 'FATAL');
  } finally {
    await browser.close();
  }

  const output = {
    runLabel: RUN_LABEL,
    runTimestamp: RUN_TS,
    baseUrl: creds.baseUrl,
    results: [{ role: account.role, username: account.username, flow, notes }],
  };
  const outPath = path.join(resultsDir, `${RUN_LABEL}-${role}-${RUN_TS}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved results to ${outPath}`);
})();
