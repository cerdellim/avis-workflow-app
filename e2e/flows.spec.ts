import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'frase-di-prova-lunga';

test('coordinatore, volontario e amministratore svolgono attività e checklist', async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const checklist = `Fase 7 checklist ${stamp}`;
  const title = `Fase 7 attività ${stamp}`;

  await login(page, 'ciro@example.org', 'Ciao, Ciro Coord');
  await page.getByRole('link', { name: 'Checklist', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova checklist' }).click();
  await page.getByLabel('Titolo').fill(checklist);
  await page.getByLabel('Voce 1').fill('Estintore');
  await page.locator('#checklist-group').selectOption({ label: 'Squadra A' });
  await page.getByRole('checkbox', { name: 'Obbligatoria' }).check();
  await page.getByRole('button', { name: 'Crea la checklist' }).click();
  await expect(page.getByRole('link', { name: checklist })).toBeVisible();

  await page.getByRole('link', { name: 'Attività', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova attività' }).click();
  const group = page.locator('#task-group');
  await expect(group.locator('option', { hasText: 'Squadra A' })).toHaveCount(1);
  await group.selectOption({ label: 'Squadra A' });
  await expect(group).toHaveValue(/.+/);
  await page.getByRole('checkbox', { name: checklist }).check();
  await page.getByRole('checkbox', { name: 'Vera Volontaria' }).check();
  await page.locator('#task-title').fill(title);
  await expect(page.locator('#task-title')).toHaveValue(title);
  await page.getByRole('button', { name: "Crea l'attività" }).click();
  await page.getByLabel('Cerca').fill(title);
  await page.getByRole('button', { name: 'Applica i filtri' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await logout(page);

  await login(page, 'vera@example.org', 'Ciao, Vera Volontaria');
  await page.getByRole('link', { name: 'Attività', exact: true }).click();
  await page.getByLabel('Cerca').fill(title);
  await page.getByRole('button', { name: 'Applica i filtri' }).click();
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Prendi in carico' }).click();
  await page.getByRole('button', { name: 'Esegui la checklist' }).click();
  await page.getByRole('radio', { name: 'Conforme', exact: true }).check();
  await page.getByRole('button', { name: 'Salva la voce' }).click();
  await page.getByRole('button', { name: 'Concludi la checklist' }).click();
  await expect(page.getByText('Completata · Conforme')).toBeVisible();
  await page.getByRole('link', { name: "Torna all'attività" }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Completa' })).toBeEnabled();
  await page.getByRole('button', { name: 'Completa' }).click();
  await expect(page.getByText('Squadra A · Completata')).toBeVisible();
  await logout(page);

  await login(page, 'ada@example.org', 'Ciao, Ada Admin');
  await page.getByRole('link', { name: 'Attività', exact: true }).click();
  await page.getByLabel('Cerca').fill(title);
  await page.getByRole('button', { name: 'Applica i filtri' }).click();
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Squadra A · Completata')).toBeVisible();
  await page.getByRole('link', { name: 'Registro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registro' })).toBeVisible();
  await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Scarica la copia JSON' })).toBeVisible();
});

async function login(page: Page, email: string, heading: string): Promise<void> {
  await page.goto('/accedi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function logout(page: Page): Promise<void> {
  await page.goto('/profilo');
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
}
