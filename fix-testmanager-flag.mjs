import { chromium } from 'playwright';
import fs from 'fs';
const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');
const email = 'perftest.director.20260814@example.invalid';

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
  await emailBox.fill(email);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const row = page.locator('tr', { hasText: email }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.waitForTimeout(1000);
  const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
  await editBtn.click();
  await page.waitForFunction(() => document.querySelector('#pwdInput') !== null, { timeout: 15000 });
  await page.waitForTimeout(500);

  // Find and check the "Is Test Manager" checkbox
  const checked = await page.evaluate(() => {
    const boxes = document.querySelectorAll('input[type="checkbox"]');
    for (const b of boxes) {
      const label = b.closest('label') || b.parentElement;
      if (label && label.textContent.includes('Is Test Manager')) {
        if (!b.checked) b.click();
        return b.checked;
      }
    }
    return null;
  });
  console.log('Is Test Manager now checked:', checked);
  await page.screenshot({ path: 'C:/Users/NIPUNA~1/AppData/Local/Temp/claude/d--QAssessment-HRMForce-GIT/4c919854-b671-4446-ad27-3862e560be10/scratchpad/pdf-check-shots/before-save-testmanager.png', fullPage: true });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(2000);
  const errors = (await page.locator('.nd-error-msg').allTextContents()).map(t => t.trim()).filter(Boolean);
  console.log('Validation errors after save:', errors);

  await browser.close();
})();
