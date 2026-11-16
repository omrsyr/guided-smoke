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
  ignoreErrors: [],            // known browser noise, e.g. 'GET /hub/negotiate → 404' (matched against the panel's line)
  network: null,               // for --network: { slowMs: 1000, origins: ['https://api.example.com'], ignore: ['/hub/'] }
  data: {},                    // test records the steps use as ctx.data, e.g. { order: 1001 }
  db: null,                    // SQL Server test database for sql(), e.g. { server: 'localhost', database: 'App', login: 'windows' }
  signIn: null,                // 'windows' for a site that signs in with the Windows account (IIS Windows authentication)
  appVersion: undefined,       // e.g. async ({ page, text }) => text(page.locator('#app-version')): read once after sign-in
  envs: null,                  // other environments for --env, e.g. { test: { base: 'https://test01/App', data: { order: 2001 } } }

  steps: [
    {
      title: 'Start page opened',
      did: 'I opened the start page.',
      expect: ['The page opens without an error.'],
      run: async ({ page, mark }) => { await mark(page.locator('h1')); },
      check: async ({ page }) => [(await page.locator('h1').count()) > 0, 'A heading is on the page.', 'No heading found.'],
    },
  ],
};
