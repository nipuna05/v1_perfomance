import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Management Scan interaction-level timing — per docs/management-scan-perf-plan.md §3 "Action"
// rows and the 2026-08-08 scope clarification in docs/management-scan-account-setup-plan.md
// §3a: times everything that happens UNDER the Management Scan page itself (Generate, search,
// filter, cell-click, Kalibirity tab + batch save) using the fresh PerfTest Manager account —
// login/account-creation are setup, not measured, and use the same {label, ms, ok, error} shape
// as measure.mjs so generate-excel-perf.mjs can render this run too.
//
// Caveat surfaced in the report itself: PerfTest Manager/Director/Employee have no seeded
// assessment data (0/0 candidates), so Generate/cell-click will run against an empty dataset —
// this measures the UI/round-trip cost of these actions, not realistic-data rendering cost.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));

const runStamp = process.argv[2];
if (!runStamp) {
  console.error('Usage: node measure-mgscan-interactions.mjs <runStamp used with create-mgscan-test-accounts.mjs>');
  process.exit(1);
}
const accountsFile = path.join(__dirname, 'results', `account-setup-${runStamp}.json`);
const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
const manager = accounts.find(a => a.role === 'manager');

const RUN_LABEL = process.argv[3] || 'mgscan-interactions';
const RUN_TS = process.argv[4] || String(Date.now());
const resultsDir = path.join(__dirname, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const shotsDir = path.join(__dirname, 'shots', 'interactions');
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
  try {
    extra = await fn();
  } catch (e) {
    ok = false;
    error = e.message?.slice(0, 300) || String(e);
  }
  const ms = msSince(start);
  console.log(`  ${label} -> ${Math.round(ms)}ms ok=${ok}${error ? ' — ' + error.split('\n')[0] : ''}`);
  return { label, ms: Math.round(ms), ok, error, extra };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const flow = [];
  const notes = ['Test data note: PerfTest Manager/Director/Employee have zero seeded assessment completions (0/0) — Generate/cell-click measurements reflect an empty dataset, not realistic data volume.'];

  try {
    flow.push(await step('Login', async () => {
      await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#Login1_UserName').fill(manager.username);
      await page.locator('#Login1_Password').fill(manager.password);
      await page.locator('#Login1_LoginButton').click();
      await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    }));

    flow.push(await step('Page Load - Management Scan (Nine-Grid, Manager)', async () => {
      await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
      await page.locator('#tabMgScanNineGrid a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 20000 });
      await shot(page, 'nine-grid-loaded');
    }));

    // Scoped to #tabMgScanNineGrid — MgScan.aspx mounts BOTH tabs' commonFilter instances
    // simultaneously (`visible`, not `if`, so Kalibirity state survives a tab switch — see the
    // comment block above the tab markup in MgScan.aspx), so an unscoped selector matches two
    // elements and strict-mode-fails (confirmed live).
    const nineGridTab = page.locator('#tabMgScanNineGrid');

    flow.push(await step('Action - Search by name', async () => {
      const search = nineGridTab.locator('input[data-bind*="filter().SearchText"]');
      await search.fill('PerfTest');
      await search.press('Enter');
      await page.waitForTimeout(500);
      await shot(page, 'after-search');
    }));

    flow.push(await step('Action - Clear search', async () => {
      const search = nineGridTab.locator('input[data-bind*="filter().SearchText"]');
      await search.fill('');
      await search.press('Enter');
      await page.waitForTimeout(300);
    }));

    flow.push(await step('Action - Department filter select', async () => {
      const deptSelect = nineGridTab.locator('select[data-bind*="filter().DepartmentID"]');
      const options = await deptSelect.locator('option').all();
      if (options.length > 1) {
        const val = await options[1].getAttribute('value');
        await deptSelect.selectOption(val);
        await page.waitForTimeout(300);
        return { selected: val };
      }
      return { selected: null, note: 'only the "All departments" option exists — nothing to filter to' };
    }));

    // Reset department filter back to "All" before Generate, so Generate reflects the full set.
    await nineGridTab.locator('select[data-bind*="filter().DepartmentID"]').selectOption({ index: 0 }).catch(() => {});

    flow.push(await step('Action - Nine-Grid Generate', async () => {
      await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
      // No fixed post-Generate DOM signal confirmed live yet — settle on networkidle best-effort,
      // same fallback pattern measure.mjs uses for classic postback pages.
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await shot(page, 'after-generate');
    }));

    flow.push(await step('Action - Grid Cell click', async () => {
      const cell = page.locator('.mg-nine-cell').first();
      await cell.waitFor({ state: 'visible', timeout: 5000 });
      await cell.click();
      await page.waitForTimeout(500);
      await shot(page, 'after-cell-click');
    }));

    flow.push(await step('Action - Kalibirity tab load (via tab click)', async () => {
      await page.locator('.mgscan-tabs').getByText('Kalibirity', { exact: true }).click();
      await page.waitForTimeout(1000);
      await shot(page, 'kalibirity-tab');
    }));

    flow.push(await step('Action - Kalibirity Generate', async () => {
      // Kalibirity tab reuses the same shared commonFilter component — its own Generate button.
      const kalGenerate = page.locator('#tabMgScanKalibirity a[data-bind*="onGenerate"]');
      if (await kalGenerate.count() === 0) {
        return { note: 'No separate Generate control found under the Kalibirity tab — may auto-load, or markup differs from expectation.' };
      }
      await kalGenerate.click();
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await shot(page, 'kalibirity-generated');
    }));

    flow.push(await step('Action - Kalibirity batch save (skipped if no editable rows)', async () => {
      const saveBtn = page.getByText('Kalibraties opgeslagen', { exact: false });
      if (await saveBtn.count() === 0) {
        return { note: 'No batch-save control found — expected with zero seeded candidates under this Manager.' };
      }
      await saveBtn.first().click();
      await page.waitForTimeout(1000);
    }));

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
    results: [{ role: 'Manager', username: manager.username, flow, notes }],
  };
  const outPath = path.join(resultsDir, `${RUN_LABEL}-${RUN_TS}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved results to ${outPath}`);
})();
