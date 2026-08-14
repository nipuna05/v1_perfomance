import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('https://q-assessments-hrmforce-it.h2software.nl/Login.aspx', { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill('perftest.director.20260813');
  await page.locator('#Login1_Password').fill('PerfTest@2026');
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
  await page.goto('https://q-assessments-hrmforce-it.h2software.nl/MgScan.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const hasNineGrid = await page.locator('#tabMgScanNineGrid').count();
  const hasStartAssessment = await page.locator('a[data-bind*="onStartAssessment"], button', { hasText: /start assessment/i }).count();
  console.log('Has Nine-Grid tabs:', hasNineGrid, '| Has Start Assessment button:', hasStartAssessment);
  const shotPath = 'C:/Users/NIPUNA~1/AppData/Local/Temp/claude/d--QAssessment-HRMForce-GIT/4c919854-b671-4446-ad27-3862e560be10/scratchpad/pdf-check-shots/director-0813-today.png';
  await page.screenshot({ path: shotPath, fullPage: true });
  await browser.close();
})();
