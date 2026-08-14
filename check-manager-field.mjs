import { chromium } from 'playwright';
import fs from 'fs';
const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill(admin.username);
  await page.locator('#Login1_Password').fill(admin.password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });

  await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
  const emailBox = page.locator('input[placeholder="Email address"]');
  await emailBox.waitFor({ state: 'visible', timeout: 20000 });
  await emailBox.fill('perftest.manager.20260814@example.invalid');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const row = page.locator('tr', { hasText: 'perftest.manager.20260814@example.invalid' }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.waitForTimeout(1000);
  const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
  await editBtn.click();
  await page.waitForFunction(() => document.querySelector('#pwdInput') !== null, { timeout: 15000 });
  await page.waitForTimeout(500);
  // Read whatever field shows the currently-selected manager
  const bodyText = await page.locator('button[data-bind*="onManagerPopupShowClick"]').locator('..').textContent().catch(() => 'N/A');
  console.log('Manager field area text:', bodyText?.trim());
  await page.screenshot({ path: 'C:/Users/NIPUNA~1/AppData/Local/Temp/claude/d--QAssessment-HRMForce-GIT/4c919854-b671-4446-ad27-3862e560be10/scratchpad/pdf-check-shots/manager-edit-field.png', fullPage: true });
  await browser.close();
})();
