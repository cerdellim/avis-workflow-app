import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'frase-di-prova-lunga';
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;
const PAGES = [
  ['/', 'Ciao, Ada Admin'],
  ['/attivita', 'Attività'],
  ['/calendario', 'Calendario'],
  ['/checklist', 'Checklist'],
  ['/profilo', 'Profilo'],
  ['/notifiche', 'Notifiche'],
  ['/amministrazione/utenti', 'Utenti'],
  ['/amministrazione/gruppi', 'Gruppi'],
  ['/amministrazione/registro', 'Registro'],
  ['/amministrazione/impostazioni', 'Impostazioni'],
] as const;

test('le pagine principali restano usabili e nominate', async ({ page }) => {
  await page.goto('/accedi');
  await page.getByRole('button', { name: 'Entra' }).click();
  const email = page.getByLabel('Email');
  const describedBy = await email.getAttribute('aria-describedby');
  expect(describedBy).toContain('login-email-error');
  await expect(page.locator('#login-email-error')).not.toBeEmpty();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).not.toBe('none');

  await page.getByLabel('Email').fill('ada@example.org');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page.getByRole('heading', { name: 'Ciao, Ada Admin' })).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [path, heading] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      const names = await page
        .getByRole('button')
        .evaluateAll((elements) =>
          elements.map(
            (element) => element.getAttribute('aria-label') || element.textContent?.trim() || '',
          ),
        );
      expect(names.every((name) => name.length > 0)).toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow).toBe(false);
    }
  }
});

test('il focus resta visibile dopo il tab', async ({ page }) => {
  await openLogin(page);
  await page.keyboard.press('Tab');
  const width = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineWidth,
  );
  expect(width === '0px' || width === '0').toBe(false);
});

async function openLogin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/accedi');
}
