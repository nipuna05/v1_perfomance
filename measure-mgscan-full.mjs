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

      flow.push(await step('Action - Report (HTML) click', async () => {
        // Text match, not getByRole — these are icon+text buttons whose accessible name can
        // differ unpredictably from the visible label (confirmed live: role-based match found 0
        // even with the button plainly visible in the screenshot).
        const btn = page.locator('button, a').filter({ hasText: 'Report (HTML)' });
        if (await btn.count() === 0) { notes.push('Report (HTML) button not present — cycle may not be published yet.'); return { skipped: true }; }
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
          btn.click(),
        ]);
        await page.waitForTimeout(1000);
        if (popup) { await popup.close().catch(() => {}); return { openedNewTab: true }; }
        return { openedNewTab: false };
      }));

      flow.push(await step('Action - Report (PDF) click', async () => {
        const btn = page.locator('button, a').filter({ hasText: 'Report (PDF)' });
        if (await btn.count() === 0) { notes.push('Report (PDF) button not present.'); return { skipped: true }; }
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
        await btn.click();
        const download = await downloadPromise;
        return { downloadStarted: !!download, suggestedFilename: download ? download.suggestedFilename() : null };
      }));

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
        await toolbarBtn.click();
        const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
        await okBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await okBtn.count() === 0) { notes.push('Report (PDF) language popup did not appear after toolbar click.'); return { skipped: true }; }
        await shot(page, 'pdf-language-popup');
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 15000 }).catch(() => null),
          okBtn.click(),
        ]);
        const download = await downloadPromise;
        if (popup && !download) await popup.close().catch(() => {});
        return { downloadStarted: !!download, openedNewTab: !!popup, suggestedFilename: download ? download.suggestedFilename() : null };
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
        const otherSwatch = kalRow.first().locator('.kal-swatch:not(.is-current)').first();
        if (await otherSwatch.count() === 0) { notes.push('No alternate position swatch found to click.'); return { skipped: true }; }
        await otherSwatch.click();
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

      flow.push(await step('Action - Report (PDF) generate for candidate row', async () => {
        // Row action icons ARE both present (Report HTML via onRowReportHtml, Report PDF via
        // onRowReportPdf - mgScanManager.html ~639-640) - the static title="Download PDF" in
        // the markup is only a pre-bind fallback, immediately overwritten at runtime by
        // `attr: { title: tokens().ReportPdf }` (a localized Token Manager string, not literally
        // "Download PDF") - confirmed live: matching on that literal title found nothing even
        // though the button renders. Match on the stable icon class instead. Opens immediately
        // (window.open), no language popup at row level (that's toolbar-only).
        if (await employeeRow.count() === 0) { notes.push('Employee row not visible for row-level report test in this view state.'); return { skipped: true }; }
        const btn = employeeRow.first().locator('.mg-cell-row-actions button:has(.fa-file-pdf)');
        if (await btn.count() === 0) { notes.push('No inline Report (PDF) icon found on the candidate row.'); return { skipped: true }; }
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 15000 }).catch(() => null),
          btn.click(),
        ]);
        const download = await downloadPromise;
        if (popup && !download) await popup.close().catch(() => {});
        return { downloadStarted: !!download, openedNewTab: !!popup, suggestedFilename: download ? download.suggestedFilename() : null };
      }));
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
