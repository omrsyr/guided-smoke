// guided-smoke plan. One step = one action: run() does it, the panel shows `did` and `expect`, the user answers.
// Write `expect` with the exact texts the screen shows. See references/writing-steps.md.
module.exports = {
  title: 'TITLE',
  workItem: null,
  lang: null,                  // panel language: 'tr' | 'en' (default: the user's)
  base: null,                  // e.g. 'https://localhost:5001' — --base overrides
  start: '/',                  // page opened first (and again after sign-in)
  ready: null,                 // CSS selector that exists only once signed in and on the start page
  login: null,                 // regex source matching sign-in URLs (default: login|signin|auth|…)

  steps: [
    {
      title: 'Start page opened',
      did: 'I opened the start page.',
      expect: ['The page opens without an error.'],
      run: async ({ page, mark }) => { await mark(page.locator('h1, h2').first()); },
      check: async ({ page }) => [(await page.locator('h1, h2').count()) > 0, 'A heading is on the page.', 'No heading found.'],
    },
  ],
};
