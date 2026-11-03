// Example plan for an imaginary "orders" screen. It shows every kind of step: a plain step, a form submit, a
// validation the browser blocks, a download, the application's own confirm dialog and a permitted (approve) step.
// Copy the shapes, not the selectors.
module.exports = {
  id: 'example-orders',
  title: 'Orders: due date',
  workItem: null,
  lang: 'en',
  base: 'https://localhost:5001',
  start: '/orders/1001',
  ready: '#order-card',
  login: 'account/login',

  steps: [
    {
      title: 'Order page opened',
      did: 'I opened order 1001.',
      expect: ['The card "Order details" is shown.', 'Due date reads "—".'],
      run: async ({ page, mark }) => { await mark(page.locator('#order-card')); },
      check: async ({ page, text }) => {
        const t = await text(page.locator('#order-card'));
        return [t.includes('Order details'), 'Card found.', 'Card text not found.'];
      },
    },
    {
      title: 'Due date saved',
      did: 'I typed 2030-01-31 into "Due date" and clicked "Save".',
      expect: ['A green "Saved." message appears.', 'Due date reads 2030-01-31.'],
      run: async ({ page, mark, submit }) => {
        await page.locator('#dueDate').fill('2030-01-31');
        await submit(page.locator('form#order-form button[type=submit]'));
        await mark(page.locator('#order-card'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#order-card'))).includes('2030-01-31'), 'Date shown.', 'Date not shown.'],
    },
    {
      title: 'A past date is refused by the browser',
      did: 'I typed 2000-01-01 and clicked "Save".',
      expect: ['The browser shows a small balloon next to the field and does not submit.'],
      run: async ({ page, mark, sleep, state }) => {
        const field = page.locator('#dueDate');
        await field.fill('2000-01-01');
        await page.locator('form#order-form button[type=submit]').click();
        await sleep(600);
        state.validation = await field.evaluate(e => ({ blocked: e.validity.rangeUnderflow, message: e.validationMessage }));
        await mark(field);
      },
      check: async ({ state }) => [state.validation.blocked, `Blocked: "${state.validation.message}"`, 'The browser did not block it.'],
    },
    {
      title: 'Invoice downloaded',
      did: 'I clicked "Download invoice"; the file was checked and deleted (its content was not read).',
      expect: ['A .pdf file appears in the download bar.'],
      run: async ({ page, download, state }) => { state.file = await download(page.locator('button', { hasText: 'Download invoice' })); },
      check: async ({ state }) => [state.file.name.endsWith('.pdf') && state.file.size > 0, `${state.file.name} · ${state.file.size} bytes`],
    },
    {
      title: 'Cancel asks in the application dialog',
      did: 'I clicked "Cancel order". Next I click "No" — nothing is cancelled.',
      expect: ['The application\'s own dialog opens (not the browser\'s grey box).', 'Text: "Cancel this order?"'],
      run: async ({ page, mark }) => {
        await page.locator('button', { hasText: 'Cancel order' }).click();
        await page.locator('#app-dialog').waitFor({ state: 'visible' });
        await mark(page.locator('#app-dialog .modal-content'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#app-dialog'))).includes('Cancel this order?'), 'Dialog open.', 'Dialog text not found.'],
    },
    {
      title: 'Overdue order (test data moved into the past)',
      approve: { what: 'Set order 1001\'s due date to yesterday in the dev database: one UPDATE limited to that order; the row count is shown.', yes: 'Yes, move the date' },
      skipTo: 8,
      did: 'I moved the due date of order 1001 to yesterday and reloaded the page.',
      expect: ['A yellow "Overdue" badge is on the card.'],
      run: async ({ page, state }) => {
        // Use the project's own database tool here; never print connection strings.
        state.updated = 1;
        await page.reload();
      },
      check: async ({ state }) => [state.updated === 1, '1 row updated.', `${state.updated} rows updated (expected 1).`],
    },
    {
      title: 'Overdue badge',
      did: 'I outlined the badge.',
      expect: ['Yellow "Overdue".'],
      run: async ({ page, mark }) => { await mark(page.locator('.badge', { hasText: 'Overdue' })); },
      check: async ({ page }) => [(await page.locator('.badge', { hasText: 'Overdue' }).count()) === 1, 'Badge found.', 'Badge not found.'],
    },
    {
      title: 'Help page',
      did: 'I opened Help ▸ Orders.',
      expect: ['A paragraph explains the due date.'],
      run: async ({ page, goto, mark }) => { await goto('/help/orders'); await mark(page.locator('p', { hasText: 'due date' })); },
    },
  ],
};
