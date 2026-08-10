import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off: assign an existing account as another account's Manager via CandidateNew.aspx's real
// Edit flow (not the create flow) — needed because Management Scan refuses to assign a cycle to
// a candidate with no manager linked (confirmed live).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');

const targetLastName = process.argv[2]; // e.g. "ValidationCheck"
const managerLastName = process.argv[3]; // e.g. "Director"

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#Login1_UserName').fill(admin.username);
  await page.locator('#Login1_Password').fill(admin.password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
  console.log('Logged in as Admin.');

  await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
  const searchBox = page.locator('input[placeholder="Full Name"]');
  await searchBox.waitFor({ state: 'visible', timeout: 20000 });
  await searchBox.fill(targetLastName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const targetRow = page.locator('tr', { hasText: targetLastName }).first();
  await targetRow.waitFor({ state: 'visible', timeout: 10000 });
  await targetRow.click();
  await page.waitForTimeout(1000);

  // Now in view mode — click Edit.
  const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
  await editBtn.waitFor({ state: 'visible', timeout: 10000 });
  await editBtn.click();
  await page.waitForFunction(() => { const p = document.querySelector('#pwdInput'); return p !== null; }, { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.locator('button[data-bind*="onManagerPopupShowClick"]').click();
  await page.waitForTimeout(800);
  await page.locator('input[data-bind*="filters().LastName"]').fill(managerLastName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const row = page.locator('#hgvManagerPickerGrid tbody tr').filter({ hasText: managerLastName }).first();
  await row.click();
  await page.waitForTimeout(300);
  await page.locator('a[data-bind*="click: onSelect"]').click();
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(2000);

  const errors = (await page.locator('.nd-error-msg').allTextContents()).map(t => t.trim()).filter(Boolean);
  console.log('Validation errors after save:', errors);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'assign-manager-result.png'), fullPage: true });

  await browser.close();
})();
