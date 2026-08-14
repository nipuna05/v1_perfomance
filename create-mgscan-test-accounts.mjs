import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off setup script (NOT part of the measure.mjs/generate-excel-perf.mjs perf-timing suite):
// creates three brand-new accounts through CandidateNew.aspx's real "Add New" UI flow (never
// touches the DB directly), building a 3-level Employee -> Manager -> Director hierarchy needed
// for Management Scan interaction-level performance timing. Per
// docs/management-scan-account-setup-plan.md: fresh accounts only, no reuse of existing ones.
//
// Order matters: the Manager picker can only select an account that already exists, so accounts
// are created bottom-up in dependency order — Director first (no manager), then Manager
// (manager = Director), then Employee (manager = Manager).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same CREDS_FILE override as measure.mjs — defaults to the real (IT-env) credentials file.
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');

const shotsDir = path.join(__dirname, 'shots', 'account-setup');
fs.mkdirSync(shotsDir, { recursive: true });
let shotSeq = 0;
async function shot(page, label) {
  shotSeq++;
  const file = path.join(shotsDir, `${String(shotSeq).padStart(2, '0')}-${label}.png`);
  try {
    // Non-fatal: this environment intermittently hangs on subresource/font loads (confirmed
    // live — 'load'/'networkidle' waits and even screenshot's own font-wait can exceed 30s even
    // though the page is visually/functionally ready). A failed screenshot should never abort
    // account creation itself.
    await page.screenshot({ path: file, fullPage: true, timeout: 8000 });
    console.log(`  [screenshot] ${file}`);
  } catch (e) {
    console.log(`  [screenshot skipped: ${e.message?.slice(0, 100)}]`);
  }
}

const RUN_STAMP = process.argv[2] || String(Date.now());
const MODE = process.argv[3] || 'hierarchy'; // 'hierarchy' (default 3-account setup) | 'validation-only'

const ACCOUNTS = MODE === 'validation-only'
  ? [{ key: 'validationcheck', firstName: 'PerfTest', lastName: 'ValidationCheck', email: `perftest.validationcheck.${RUN_STAMP}@example.invalid`, managerOf: null }]
  : [
    { key: 'director', firstName: 'PerfTest', lastName: 'Director', email: `perftest.director.${RUN_STAMP}@example.invalid`, managerOf: null },
    { key: 'manager', firstName: 'PerfTest', lastName: 'Manager', email: `perftest.manager.${RUN_STAMP}@example.invalid`, managerOf: 'director' },
    { key: 'employee', firstName: 'PerfTest', lastName: 'Employee', email: `perftest.employee.${RUN_STAMP}@example.invalid`, managerOf: 'manager' },
  ];
const PASSWORD = 'PerfTest@2026';

async function login(page) {
  // 'domcontentloaded' rather than 'load': the login page's full load event can hang on a
  // slow/unreachable subresource (e.g. a flag icon) even though the page is visually and
  // functionally ready well before that — confirmed live: a screenshot taken right after a
  // 30s 'load' timeout showed a fully rendered, usable login form.
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#Login1_UserName').fill(admin.username);
  await page.locator('#Login1_Password').fill(admin.password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 45000 });
}

async function createAccount(page, account, createdUsernames) {
  console.log(`\n=== Creating ${account.key}: ${account.firstName} ${account.lastName} ===`);

  await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
  const addNewBtn = page.locator('a.new-design-add-new-btn');
  await addNewBtn.waitFor({ state: 'visible', timeout: 30000 });
  // Was 500ms. The "lands on My Account instead of the new-candidate form" flake, historically
  // ~1-in-6, hit 5-in-5 in a row on 2026-08-14 (same release that also redesigned the Personal
  // Dashboard's report buttons and touched Starter.aspx.cs/session handling) - consistent with
  // Knockout's binding attachment now taking measurably longer after whatever changed, not pure
  // chance. Widening the settle wait rather than just keep retrying.
  await page.waitForTimeout(1500);
  await shot(page, `${account.key}-01-listing`);

  // Retry loop: this click is intermittently flaky even with the settle wait above — confirmed
  // live on a separate run, it can land on an unrelated "My Account" test-grid tab instead of
  // the new-candidate form (consistent with clicking before Knockout's binding is wired up).
  // Re-navigating to the listing and retrying recovers cleanly when this happens.
  let formOpened = false;
  for (let attempt = 1; attempt <= 3 && !formOpened; attempt++) {
    await addNewBtn.click();
    try {
      await page.locator('input[data-bind*="user().FirstName"]').waitFor({ state: 'visible', timeout: 8000 });
      formOpened = true;
    } catch {
      console.log(`  Add New click attempt ${attempt} did not open the form — retrying.`);
      await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
      await addNewBtn.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(500);
    }
  }
  if (!formOpened) throw new Error('Add New click failed to open the candidate form after 3 attempts.');
  // "Add New" also triggers an async GetCandidateAccountDetails call that populates the
  // Language list and only then flips pwdInputEnabled(true) (Account.js ~line 146) — wait for
  // that real signal instead of a flat timeout, since its latency varies a lot with server
  // distance (confirmed live: 1s was enough locally but not enough against the real IT env).
  await page.waitForFunction(() => {
    const pwd = document.querySelector('#pwdInput');
    return pwd && !pwd.disabled;
  }, { timeout: 20000 });
  await shot(page, `${account.key}-02-form-open`);

  await page.locator('input[data-bind*="user().FirstName"]').fill(account.firstName);
  await page.locator('input[data-bind*="user().LastName"]').fill(account.lastName);
  await page.locator('input[data-bind*="user().Email"]').fill(account.email);

  // Language is mandatory. The IT environment pre-fills this (e.g. "English - United Kingdom")
  // before any of our own field edits — confirmed live: blindly picking "the first option with
  // a non-empty value" actually SELECTED THE PLACEHOLDER ITSELF ("-- Select Language --", whose
  // <option> apparently carries a non-empty sentinel value) and silently overwrote a perfectly
  // good pre-filled selection. Only touch it if it's genuinely unset.
  const langSelect = page.locator('select[data-bind*="user().LanguageID"]');
  const currentLangValue = await langSelect.inputValue();
  const currentLangText = await langSelect.locator('option:checked').textContent();
  if (currentLangValue && currentLangValue !== '0' && !/select/i.test(currentLangText || '')) {
    console.log(`  Language already pre-filled: "${currentLangText?.trim()}" — leaving as-is.`);
  } else {
    const langOptions = await langSelect.locator('option').all();
    let langValueSet = false;
    for (const opt of langOptions) {
      const val = await opt.getAttribute('value');
      const text = (await opt.textContent()) || '';
      if (val && val !== '0' && !/select/i.test(text)) {
        await langSelect.selectOption(val);
        langValueSet = true;
        break;
      }
    }
    if (!langValueSet) console.log('  WARNING: could not find a non-empty Language option to select.');
  }

  // Username: click the generate button, then verify/adjust for unique readability.
  const username = `perftest.${account.key}.${RUN_STAMP}`;
  await page.locator('input[data-bind*="user().UserName"]').fill(username);

  await page.locator('#pwdInput').fill(PASSWORD);

  if (account.managerOf) {
    const managerFullName = createdUsernames[account.managerOf].fullName;
    await page.locator('button[data-bind*="onManagerPopupShowClick"]').click();
    await page.waitForTimeout(800);
    await shot(page, `${account.key}-03-manager-popup`);

    await page.locator('input[data-bind*="filters().LastName"]').fill(createdUsernames[account.managerOf].lastName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await shot(page, `${account.key}-04-manager-search-results`);

    const row = page.locator('#hgvManagerPickerGrid tbody tr').filter({ hasText: createdUsernames[account.managerOf].lastName }).first();
    await row.click();
    await page.waitForTimeout(300);
    await shot(page, `${account.key}-05-manager-row-selected`);

    await page.locator('a[data-bind*="click: onSelect"]').click();
    await page.waitForTimeout(800);
    await shot(page, `${account.key}-06-manager-selected`);
  }

  await shot(page, `${account.key}-07-before-save`);
  // NOT '[data-bind*="click: onSave"]' (matches the separate onSavePassword button too, since
  // "onSave" is a substring of it) and NOT '.new-tb-edit-state-btn' (shared with the sibling
  // Edit button, present-but-hidden in the DOM via KO's `visible` binding rather than removed) —
  // both confirmed live as strict-mode violations. Match by accessible name instead.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(2000);
  await shot(page, `${account.key}-08-after-save`);

  // Look for validation error text anywhere on the page.
  const errorTexts = await page.locator('.nd-error-msg').allTextContents();
  const nonEmptyErrors = errorTexts.map(t => t.trim()).filter(Boolean);
  if (nonEmptyErrors.length) {
    console.log(`  VALIDATION ERRORS for ${account.key}:`, nonEmptyErrors);
  } else {
    console.log(`  No validation errors visible for ${account.key}.`);
  }

  return { username, fullName: `${account.firstName} ${account.lastName}`, lastName: account.lastName, email: account.email, errors: nonEmptyErrors };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);
  const createdUsernames = {};
  const summary = [];

  try {
    await login(page);
    console.log('Logged in as Admin.');

    for (const account of ACCOUNTS) {
      const result = await createAccount(page, account, createdUsernames);
      createdUsernames[account.key] = result;
      summary.push({ role: account.key, ...result, password: PASSWORD });
    }
  } catch (e) {
    console.log('FATAL:', e.message);
    await shot(page, 'FATAL-error-state');
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }

  const outPath = path.join(__dirname, 'results', `account-setup-${RUN_STAMP}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Merge with whatever's already recorded for this runStamp instead of overwriting - a second
  // call for the same runStamp (e.g. the "validation-only" extra account) used to wipe out
  // accounts an earlier call for the SAME runStamp had already created, since this used to be a
  // plain overwrite. Confirmed live 2026-08-12: creating a validation-only account after the
  // director/manager/employee hierarchy silently destroyed that hierarchy's saved credentials.
  let existing = [];
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')); } catch { existing = []; }
  }
  const newRoles = new Set(summary.map(a => a.role));
  const merged = [...existing.filter(a => !newRoles.has(a.role)), ...summary];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n\nSaved account summary to ${outPath} (${merged.length} account(s) total for this runStamp)`);
  console.log(JSON.stringify(summary, null, 2));
})();
