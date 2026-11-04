// The demo plan: `node engine/run.js demo` starts the demo application (server.js) and walks this plan against it.
// It shows every kind of step: a plain one, a form submit, a validation the browser blocks, a download, the
// application's own dialog, permitted steps that change data outside the page, a background job waited for with
// poll(), and API calls with an account the user types into the value box. Copy the shapes; the selectors are the demo's.
const { pickLanguage } = require('../../engine/i18n');
const demo = require('./server');

const lang = pickLanguage();
const A = require('./texts')[lang];          // what the screen shows
const future = demo.isoDay(30);

const P = {
  en: {
    title: 'Demo: order due date, reminder job and client API',
    s1: ['Order page opened', 'I opened order 1001.', [`The card "${A.order}" is shown.`, `"${A.dueDate}" reads "—" and "${A.status}" reads "${A.open}".`]],
    s2: ['Due date saved', `I typed ${future} into "${A.dueDate}" and clicked "${A.save}".`, [`A green "${A.saved}" message at the top.`, `"${A.dueDate}" reads ${future}.`]],
    s3: ['A past date is refused by the browser', `I typed 2000-01-01 into "${A.dueDate}" and clicked "${A.save}".`, ['The browser shows a small balloon under the field and does not send the form.']],
    s4: ['Invoice downloaded', `I clicked "${A.download}"; the file was checked and deleted (its content was not read).`, ['The page does not change; the automatic check shows the file name and size.']],
    s5: ['Cancel asks in the application\'s dialog', `I clicked "${A.cancel}". Next I click "${A.no}": nothing is cancelled.`, ['The application\'s own dialog opens (not the browser\'s grey box).', `Text: "${A.confirm}"`]],
    s6: ['"No" closes the dialog', `I clicked "${A.no}".`, ['The dialog is closed.', `"${A.status}" still reads "${A.open}".`]],
    s7: ['Overdue order (due date moved into the past)', 'I moved the due date of order 1001 to yesterday and reloaded the page.', [`A yellow "${A.overdue}" badge next to the status.`]],
    s7what: 'In the demo\'s data, set the due date of order 1001 to yesterday: one change limited to that order; the number of changed rows is shown.',
    s7yes: '✔ Yes, move the date',
    s8: ['Reminder job triggered', `I opened "${A.jobs}", ticked "${demo.JOB}" and clicked "${A.trigger}".`, [`In the job's row "${A.lastRun}" reads "${A.running}" (the job takes a few seconds).`]],
    s8what: `Run the "${demo.JOB}" job now: it writes a reminder for every overdue order in the demo's data.`,
    s8yes: '✔ Yes, run the job',
    s9: ['Reminder written (waited for the job)', 'I counted the reminders in the demo\'s data, waiting up to 15 seconds for the job, then opened order 1001.', [`"✉ ${A.reminder}" under the order details.`]],
    s10: ['Value box ready', 'I added a box at the bottom left of the page for the demo API account.', [`Type the account shown in the "${A.apiAccount}" card into the box (e-mail and password), then click "Correct, continue".`, 'The script does not read the box; the values stay in the page.']],
    s11: ['API check answers "Valid"', 'With the box\'s account I signed in to the demo API and called POST /api/check for machine SMOKE-A.', ['The box shows http 200 and status "Valid".', 'The e-mail and the password appear nowhere in the result.']],
    s12: ['A wrong password is refused', 'I called the API sign-in again with the box\'s password plus one character.', ['The box shows http 401 and the message "Invalid e-mail or password."']],
    s13: ['The calls are listed on the order page', `I reloaded order 1001 (the page load cleared the box), removed the box and outlined "${A.calls}".`, ['Newest first: login · Refused, check · SMOKE-A · Valid, login · SignedIn.']],
    s14: ['Help page', `I opened "${A.help}" ▸ "${A.helpTitle}".`, [`The paragraph begins "${A.helpDue.split('. ')[0]}."`]],
    boxTitle: 'Demo API account', email: 'E-mail', password: 'Password',
  },
  tr: {
    title: 'Demo: sipariş son tarihi, hatırlatma işi ve istemci API\'si',
    s1: ['Sipariş sayfası açıldı', '1001 numaralı siparişi açtım.', [`"${A.order}" kartı görünüyor.`, `"${A.dueDate}" "—", "${A.status}" "${A.open}" yazıyor.`]],
    s2: ['Son tarih kaydedildi', `"${A.dueDate}" alanına ${future} yazdım ve "${A.save}" düğmesine bastım.`, [`Üstte yeşil "${A.saved}" mesajı.`, `"${A.dueDate}" ${future} yazıyor.`]],
    s3: ['Geçmiş tarihi tarayıcı reddediyor', `"${A.dueDate}" alanına 2000-01-01 yazdım ve "${A.save}" düğmesine bastım.`, ['Tarayıcı alanın altında küçük bir baloncuk gösteriyor ve formu göndermiyor.']],
    s4: ['Fatura indirildi', `"${A.download}" bağlantısına tıkladım; dosya denetlendi ve silindi (içeriği okunmadı).`, ['Sayfa değişmiyor; otomatik kontrol dosyanın adını ve boyutunu gösteriyor.']],
    s5: ['İptal, uygulamanın kendi penceresinde soruluyor', `"${A.cancel}" düğmesine bastım. Sonra "${A.no}" diyeceğim: hiçbir şey iptal edilmez.`, ['Uygulamanın kendi penceresi açılıyor (tarayıcının gri kutusu değil).', `Metin: "${A.confirm}"`]],
    s6: ['"Hayır" pencereyi kapatıyor', `"${A.no}" düğmesine bastım.`, ['Pencere kapandı.', `"${A.status}" hâlâ "${A.open}" yazıyor.`]],
    s7: ['Gecikmiş sipariş (son tarih geçmişe çekildi)', '1001 numaralı siparişin son tarihini düne çektim ve sayfayı yeniledim.', [`Durumun yanında sarı "${A.overdue}" rozeti.`]],
    s7what: 'Demonun verisinde 1001 numaralı siparişin son tarihini düne çek: yalnız o siparişle sınırlı tek değişiklik; değişen satır sayısı gösterilir.',
    s7yes: '✔ Evet, tarihi çek',
    s8: ['Hatırlatma işi tetiklendi', `"${A.jobs}" sayfasını açtım, "${demo.JOB}" satırını işaretledim ve "${A.trigger}" düğmesine bastım.`, [`İşin satırında "${A.lastRun}" "${A.running}" yazıyor (iş birkaç saniye sürer).`]],
    s8what: `"${demo.JOB}" işini şimdi çalıştır: demonun verisinde gecikmiş her sipariş için hatırlatma yazar.`,
    s8yes: '✔ Evet, işi çalıştır',
    s9: ['Hatırlatma yazıldı (iş beklendi)', 'Demonun verisinde hatırlatmaları saydım, iş için 15 saniyeye kadar bekledim, sonra 1001 numaralı siparişi açtım.', [`Sipariş bilgilerinin altında "✉ ${A.reminder}"`]],
    s10: ['Değer kutusu hazır', 'Sayfanın sol altına demo API hesabı için bir kutu ekledim.', [`"${A.apiAccount}" kartındaki hesabı (e-posta ve parola) kutuya yaz, sonra "Doğru, devam" de.`, 'Betik kutuyu okumaz; değerler sayfada kalır.']],
    s11: ['API kontrolü "Valid" diyor', 'Kutudaki hesapla demo API\'sine giriş yaptım ve SMOKE-A makinesi için POST /api/check çağırdım.', ['Kutuda http 200 ve status "Valid" görünüyor.', 'Sonuçta e-posta da parola da hiçbir yerde geçmiyor.']],
    s12: ['Yanlış parola reddediliyor', 'API girişini kutudaki parolanın sonuna bir harf ekleyerek yeniden çağırdım.', ['Kutuda http 401 ve "Invalid e-mail or password." mesajı görünüyor.']],
    s13: ['Çağrılar sipariş sayfasında listeleniyor', `1001 numaralı siparişi yeniledim (sayfa yüklenince kutu boşaldı), kutuyu kaldırdım ve "${A.calls}" kartını işaretledim.`, ['En yeni üstte: login · Refused, check · SMOKE-A · Valid, login · SignedIn.']],
    s14: ['Yardım sayfası', `"${A.help}" ▸ "${A.helpTitle}" sayfasını açtım.`, [`Paragraf "${A.helpDue.split('. ')[0]}." diye başlıyor.`]],
    boxTitle: 'Demo API hesabı', email: 'E-posta', password: 'Parola',
  },
}[lang];

const step = ([title, did, expect]) => ({ title, did, expect });
const tx = (en, tr) => (lang === 'tr' ? tr : en);

// Runs in the page (inPage): signs in with the box's account, then calls the check. Returns only what the product
// branches on: HTTP status, status and message.
const callApi = async ({ fields, arg }) => {
  const post = (url, body, token) => fetch(url, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  const password = arg.wrongPassword ? fields.password + 'x' : fields.password;
  const login = await post('/api/login', { email: fields.email, password });
  const signIn = await login.json().catch(() => ({}));
  if (!signIn.token) return { route: '/api/login', http: login.status, message: signIn.message };
  const r = await post('/api/check', { machine: arg.machine }, signIn.token);
  const j = await r.json().catch(() => ({}));
  return { route: '/api/check', http: r.status, status: j.status };
};

const callRows = page => page.locator('#calls tbody tr');

module.exports = {
  id: 'demo',
  title: P.title,
  lang,
  start: `/orders/${demo.ORDER}`,
  ready: '#order-card',
  login: '/login',

  steps: [
    {
      ...step(P.s1),
      run: async ({ page, mark }) => { await mark(page.locator('#order-card')); },
      check: async ({ page, text }) => [(await text(page.locator('#order-card h1'))) === A.order, `"${A.order}"`, tx('Card title not found.', 'Kart başlığı bulunamadı.')],
    },
    {
      ...step(P.s2),
      run: async ({ page, mark, submit }) => {
        await page.locator('#dueDate').fill(future);
        await submit(page.locator('#due-form button[type=submit]'));
        await mark(page.locator('.alert-success'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#due'))) === future, `${A.dueDate}: ${future}`, tx(`${A.dueDate} is not ${future}.`, `${A.dueDate} ${future} değil.`)],
    },
    {
      ...step(P.s3),
      run: async ({ page, mark, sleep, state }) => {
        const field = page.locator('#dueDate');
        await field.fill('2000-01-01');
        await page.locator('#due-form button[type=submit]').click();
        await sleep(600);
        state.validation = await field.evaluate(e => ({ blocked: e.validity.rangeUnderflow, message: e.validationMessage }));
        await mark(field);
      },
      check: async ({ state }) => [state.validation.blocked, `"${state.validation.message}"`, tx('The browser did not block it.', 'Tarayıcı engellemedi.')],
    },
    {
      ...step(P.s4),
      run: async ({ page, mark, download, state }) => {
        state.file = await download(page.locator('#invoice'));
        await mark(page.locator('#invoice'));
      },
      check: async ({ state }) => [state.file.name === `invoice-${demo.ORDER}.txt` && state.file.size > 0, `${state.file.name} · ${state.file.size} B`],
    },
    {
      ...step(P.s5),
      run: async ({ page, mark }) => {
        await page.locator('#cancel').click();
        await page.locator('#cancel-dialog .modal-content').waitFor({ state: 'visible' });
        await mark(page.locator('#cancel-dialog .modal-content'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#cancel-dialog p'))) === A.confirm, `"${A.confirm}"`, tx('Dialog text not found.', 'Pencere metni bulunamadı.')],
    },
    {
      ...step(P.s6),
      run: async ({ page, mark }) => {
        await page.locator('#cancel-no').click();
        await mark(page.locator('#status'));
      },
      check: async ({ page, text, visible }) => [!(await visible(page.locator('#cancel-dialog .modal-content'))) && (await text(page.locator('#status'))) === A.open,
        `"${A.open}"`, tx('The dialog is still open or the status changed.', 'Pencere hâlâ açık ya da durum değişti.')],
    },
    {
      ...step(P.s7),
      approve: { what: P.s7what, yes: P.s7yes },
      skipTo: 10,
      run: async ({ page, mark, state }) => {
        // Stands in for the project's database tool: one change limited to the test record, row count kept.
        state.rows = demo.db.setDueDays(demo.ORDER, -1);
        await page.reload();
        await mark(page.locator('.badge-overdue'));
      },
      check: async ({ state }) => [state.rows === 1, tx('1 row changed.', '1 satır değişti.'), tx(`${state.rows} rows changed (expected 1).`, `${state.rows} satır değişti (1 bekleniyordu).`)],
    },
    {
      ...step(P.s8),
      approve: { what: P.s8what, yes: P.s8yes },
      skipTo: 10,
      run: async ({ page, goto, mark, submit }) => {
        await goto('/jobs');
        await page.locator(`input[name=job][value="${demo.JOB}"]`).check();
        await submit(page.locator('#trigger'));
        await mark(page.locator(`#job-${demo.JOB}`));
      },
      check: async ({ page, text }) => {
        const last = await text(page.locator(`#job-${demo.JOB} .last-run`));
        return [last === A.running || /^\d\d:\d\d:\d\d$/.test(last), `${A.lastRun}: ${last}`];
      },
    },
    {
      ...step(P.s9),
      run: async ({ page, goto, mark, poll, state }) => {
        state.reminders = await poll(() => demo.db.reminders(), { until: n => n >= 1, timeout: 15000, interval: 1000 });
        await goto(`/orders/${demo.ORDER}`);
        await mark(page.locator('#reminder'));
      },
      check: async ({ state }) => [state.reminders === 1, tx('1 reminder.', '1 hatırlatma.'), tx(`${state.reminders} reminders after 15 s (expected 1).`, `15 sn sonra ${state.reminders} hatırlatma (1 bekleniyordu).`)],
    },
    {
      ...step(P.s10),
      run: async ({ page, mark, secretBox }) => {
        await secretBox({ title: P.boxTitle, fields: [
          { name: 'email', label: P.email, type: 'email' },
          { name: 'password', label: P.password, secret: true },
        ] });
        await mark(page.locator('#api-account'));
      },
    },
    {
      ...step(P.s11),
      run: async ({ page, inPage, mark, state }) => {
        state.r = await inPage(callApi, { machine: 'SMOKE-A' });
        await mark(page.locator('#__guided_smoke_box'));
      },
      check: async ({ state }) => [state.r.http === 200 && state.r.status === 'Valid', `http ${state.r.http} · ${state.r.status || state.r.message}`],
    },
    {
      ...step(P.s12),
      run: async ({ page, inPage, mark, state }) => {
        state.r = await inPage(callApi, { machine: 'SMOKE-A', wrongPassword: true });
        await mark(page.locator('#__guided_smoke_box'));
      },
      check: async ({ state }) => [state.r.http === 401, `http ${state.r.http} · ${state.r.message || state.r.status}`],
    },
    {
      ...step(P.s13),
      run: async ({ page, mark, secretBox }) => {
        await page.reload();
        await secretBox(null);
        await mark(page.locator('#calls'));
      },
      check: async ({ page, text }) => {
        const rows = [];
        for (let i = 0; i < Math.min(await callRows(page).count(), 3); i++) rows.push(await text(callRows(page).nth(i).locator('td').nth(3)));
        return [rows.join(',') === 'Refused,Valid,SignedIn', rows.join(' · ') || '—'];
      },
    },
    {
      ...step(P.s14),
      run: async ({ page, goto, mark }) => {
        await goto('/help/orders');
        await mark(page.locator('#help-due'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#help-due'))) === A.helpDue, tx('Paragraph found.', 'Paragraf bulundu.'), tx('Paragraph text differs.', 'Paragraf metni farklı.')],
    },
  ],
};
