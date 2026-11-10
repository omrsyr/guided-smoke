// The demo plan: `node engine/run.js demo` starts the demo application (server.js) and walks this plan against it.
// It shows every kind of step: a plain one, a form submit, a validation the browser blocks, a download, the
// application's own dialog, permitted steps that change data outside the page, a background job waited for with
// poll(), API calls with an account the user types into the value box, and a page whose background call fails (the
// panel shows it; with --network also what its other background calls send and cost). The last four are probe steps,
// walked only with --probe: two fields sent with boundary and wrong values, a double click, and the clean-up of what the
// probe saved. Copy the shapes; the selectors are the demo's.
const { pickLanguage, texts } = require('../../engine/i18n');
const { countsText } = require('../../engine/errors');
const { findingLine } = require('../../engine/network');
const demo = require('./server');

const lang = pickLanguage();
const A = require('./texts')[lang];          // what the screen shows
// What the panel shows under a step when the browser reported errors.
const browser = counts => `⚠ ${texts(lang).errIn}${countsText(counts, texts(lang))}`;
const future = demo.isoDay(30);
// run.js demo --network sets this: step 14 then says what the network shows there, in the panel's own words.
const network = process.env.GUIDED_SMOKE_DEMO_NETWORK === '1';
const netLine = f => findingLine(f, texts(lang));
const profileLeak = netLine({ kind: 'secret-field', level: 'critical', method: 'GET', url: '/api/profile', keys: ['$.passwordHash'] });
const settingsTwice = netLine({ kind: 'repeated', level: 'warn', method: 'GET', url: '/api/settings', times: 3 });
// A probe value the demo may save starts with "SMOKE-P", so the clean-up finds it; `at(prefix, n)` fills it to n characters.
const PREFIX = 'SMOKE-P';
const at = (prefix, n) => prefix + 'x'.repeat(n - prefix.length);
const farDay = '9999-12-31';
const noDay = '2027-02-29';

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
    s12: ['A wrong password is refused', 'I called the API sign-in again with the box\'s password plus one character.', ['The box shows http 401 and the message "Invalid e-mail or password."', `Under the step the panel shows "${browser({ http: 1 })}" and "POST ••• → 401": the refused sign-in, its address masked because the value box is open.`]],
    s13: ['The calls are listed on the order page', `I reloaded order 1001 (the page load cleared the box), removed the box and outlined "${A.calls}".`, ['Newest first: login · Refused, check · SMOKE-A · Valid, login · SignedIn.']],
    s14: ['Help page', `I opened "${A.help}" ▸ "${A.helpTitle}".`, [`The paragraph begins "${A.helpDue.split('. ')[0]}."`, `Under the step the panel shows "${browser({ js: 1, http: 1 })}": the page loads its tips with GET /api/tips, which the demo fails on purpose. Nothing on the screen shows it.`]],
    s14network: `With --network the panel also shows "${profileLeak}" (the profile call sends a password hash) and "${settingsTwice}"; once GET /api/help/stats has finished (about 1.5 s), the 🌐 line names it the slowest call.`,
    s15: ['Note field probed', `I sent the "${A.notes}" form of order 1001 with 11 values, one at a time, opening the order again before each.`, [
      'A table of 11 tries. Not sent: empty (the browser). Refused: only spaces, 101 and 10,000 characters. Saved: 100 characters, quotes and brackets, a script tag, a piece of SQL, Turkish letters, and spaces around a note.',
      'Only row 10, an emoji, is red: "💥 crashed". The demo fails that value on purpose, as a database column that cannot store emoji would; that is what probing is for. The automatic check reads ✖, so "✔ Correct, continue" takes a second click.',
      `Under the step the panel shows "${browser({ http: 1 })}": that crash. The refused values (HTTP 422) are in the table, not there.`,
    ]],
    s15what: `Send the "${A.notes}" form of order 1001 with 11 values. Values the demo accepts are added as notes starting with "${PREFIX}"; the last step deletes them.`,
    s15yes: '✔ Yes, probe the field',
    s16: ['Due date field probed', `I sent the "${A.dueDate}" form with 6 values, one at a time.`, [
      `A table of 6 tries, all as expected. Saved: tomorrow and today. Not sent (the browser): yesterday, empty, and ${noDay}, which is no day. Refused by the demo: ${farDay}, "${A.farDate}"`,
      'Under the table a note says that the values not sent did not reach the demo\'s own check.',
    ]],
    s16what: `Send the "${A.dueDate}" form of order 1001 with 6 values; each value the demo accepts becomes the order's due date.`,
    s17: [`A double click on "${A.addNote}" adds one note`, `I typed ${PREFIX}9 into "${A.note}" and double-clicked "${A.addNote}".`, [`A green "${A.noteAdded}" message at the top.`, `One new note "${PREFIX}9" in "${A.notes}", not two.`]],
    s17what: `Double-click "${A.addNote}" with the note ${PREFIX}9. A page that does not guard against it adds two notes.`,
    s18: ['Probe notes deleted', `I deleted the notes starting with "${PREFIX}" in the demo's data and opened order 1001 again.`, [`"${A.notes}" reads "${A.noNotes}"`, 'The automatic check compares the number deleted with what the probe and the double click saved.']],
    s18what: `In the demo's data, delete the notes that start with "${PREFIX}": the ones the probe and the double click added. The number deleted is shown.`,
    s18yes: '✔ Yes, delete them',
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
    s12: ['Yanlış parola reddediliyor', 'API girişini kutudaki parolanın sonuna bir harf ekleyerek yeniden çağırdım.', ['Kutuda http 401 ve "Invalid e-mail or password." mesajı görünüyor.', `Panelde adımın altında "${browser({ http: 1 })}" ve "POST ••• → 401" görünüyor: reddedilen giriş; değer kutusu açık olduğu için adresi maskeli.`]],
    s13: ['Çağrılar sipariş sayfasında listeleniyor', `1001 numaralı siparişi yeniledim (sayfa yüklenince kutu boşaldı), kutuyu kaldırdım ve "${A.calls}" kartını işaretledim.`, ['En yeni üstte: login · Refused, check · SMOKE-A · Valid, login · SignedIn.']],
    s14: ['Yardım sayfası', `"${A.help}" ▸ "${A.helpTitle}" sayfasını açtım.`, [`Paragraf "${A.helpDue.split('. ')[0]}." diye başlıyor.`, `Panelde adımın altında "${browser({ js: 1, http: 1 })}" görünüyor: sayfa ipuçlarını GET /api/tips ile yüklüyor, demo bu çağrıyı bilerek düşürüyor. Ekranda hiçbir iz yok.`]],
    s14network: `--network ile panel ayrıca "${profileLeak}" (profil çağrısı bir parola özeti gönderiyor) ve "${settingsTwice}" satırlarını gösteriyor; GET /api/help/stats bitince (yaklaşık 1,5 sn) 🌐 satırı onu en yavaş çağrı olarak gösteriyor.`,
    s15: ['Not alanı patlatıldı', `1001 numaralı siparişin "${A.notes}" formunu 11 değerle tek tek gönderdim; her değerden önce siparişi yeniden açtım.`, [
      '11 denemelik bir tablo. Gönderilmedi: boş (tarayıcı). Reddedildi: yalnız boşluk, 101 ve 10.000 karakter. Kaydedildi: 100 karakter, tırnak ve köşeli ayraçlar, script etiketi, bir SQL parçası, Türkçe harfler ve başında sonunda boşluk olan not.',
      'Yalnız 10. satır, emoji, kırmızı: "💥 çöktü". Demo bu değeri bilerek düşürüyor, emoji saklayamayan bir veritabanı sütunu gibi; patlatma tam bunun için. Otomatik kontrol ✖ diyor, bu yüzden "✔ Doğru, devam" iki tık ister.',
      `Panelde adımın altında "${browser({ http: 1 })}" görünüyor: o çöküş. Reddedilen değerler (HTTP 422) orada değil, tabloda.`,
    ]],
    s15what: `1001 numaralı siparişin "${A.notes}" formunu 11 değerle gönder. Demonun kabul ettiği değerler "${PREFIX}" ile başlayan not olarak eklenir; son adım onları siler.`,
    s15yes: '✔ Evet, alanı patlat',
    s16: ['Son tarih alanı patlatıldı', `"${A.dueDate}" formunu 6 değerle tek tek gönderdim.`, [
      `6 denemelik bir tablo, hepsi beklendiği gibi. Kaydedildi: yarın ve bugün. Gönderilmedi (tarayıcı): dün, boş ve var olmayan bir gün olan ${noDay}. Demo reddetti: ${farDay}, "${A.farDate}"`,
      'Tablonun altındaki not, gönderilmeyen değerlerin demonun kendi denetimine ulaşmadığını söylüyor.',
    ]],
    s16what: `1001 numaralı siparişin "${A.dueDate}" formunu 6 değerle gönder; demonun kabul ettiği her değer siparişin son tarihi olur.`,
    s17: [`"${A.addNote}" düğmesine çift tıklama tek not ekliyor`, `"${A.note}" alanına ${PREFIX}9 yazdım ve "${A.addNote}" düğmesine çift tıkladım.`, [`Üstte yeşil "${A.noteAdded}" mesajı.`, `"${A.notes}" kartında tek yeni not "${PREFIX}9", iki değil.`]],
    s17what: `"${A.addNote}" düğmesine ${PREFIX}9 notuyla çift tıkla. Buna karşı korunmayan bir sayfa iki not ekler.`,
    s18: ['Patlatma notları silindi', `Demonun verisinde "${PREFIX}" ile başlayan notları sildim ve 1001 numaralı siparişi yeniden açtım.`, [`"${A.notes}" kartında "${A.noNotes}" yazıyor.`, 'Otomatik kontrol silinen sayıyı patlatmanın ve çift tıklamanın kaydettikleriyle karşılaştırıyor.']],
    s18what: `Demonun verisinde "${PREFIX}" ile başlayan notları sil: patlatmanın ve çift tıklamanın ekledikleri. Silinen sayı gösterilir.`,
    s18yes: '✔ Evet, sil',
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
      ...(network ? { expect: [...P.s14[2], P.s14network] } : {}),
      run: async ({ page, goto, mark }) => {
        await goto('/help/orders');
        await mark(page.locator('#help-due'));
      },
      check: async ({ page, text }) => [(await text(page.locator('#help-due'))) === A.helpDue, tx('Paragraph found.', 'Paragraf bulundu.'), tx('Paragraph text differs.', 'Paragraf metni farklı.')],
    },
    {
      // Probe steps (--probe): each value with what it expects and where that comes from — the code (the server
      // allows 100 characters and trims; the field is required), the catalog of references/probing.md, or an
      // assumption the user agreed to. The demo's own check of the emoji is the bug on purpose.
      ...step(P.s15),
      probe: true,
      approve: { what: P.s15what, yes: P.s15yes },
      run: async ({ page, goto, mark, probe, state }) => {
        await goto(`/orders/${demo.ORDER}`);
        state.notes = await probe({
          field: page.locator('#note'),
          submit: page.locator('#add-note'),
          saved: page.locator('.alert-success', { hasText: A.noteAdded }),
          message: page.locator('#note-error'),
          values: [
            { value: '', expect: 'blocked', from: 'code' },
            { value: '   ', expect: 'rejected', from: 'code' },
            { value: at(`${PREFIX}1 `, demo.NOTE_MAX), expect: 'saved', from: 'code' },
            { value: at(`${PREFIX}2 `, demo.NOTE_MAX + 1), expect: 'rejected', from: 'code' },
            { value: 'x'.repeat(10000), expect: 'rejected', from: 'catalog' },
            { value: `${PREFIX}3 ' " < > &`, expect: 'saved', from: 'catalog' },
            { value: `${PREFIX}4 <script>alert(1)</script>`, expect: 'saved', from: 'catalog' },
            { value: `${PREFIX}5 ' OR 1=1 --`, expect: 'saved', from: 'catalog' },
            { value: `${PREFIX}6 İıĞğŞşÇçÖöÜü`, expect: 'saved', from: 'catalog' },
            { value: `${PREFIX}7 😀`, expect: 'saved', from: 'catalog' },
            { value: `  ${PREFIX}8  `, expect: 'saved', from: 'assumed' },
          ],
        });
        await mark(page.locator('#notes'));
      },
    },
    {
      ...step(P.s16),
      probe: true,
      approve: { what: P.s16what },
      run: async ({ page, goto, mark, probe }) => {
        await goto(`/orders/${demo.ORDER}`);
        await probe({
          field: page.locator('#dueDate'),
          submit: page.locator('#due-form button[type=submit]'),
          saved: page.locator('.alert-success', { hasText: A.saved }),
          message: page.locator('.alert-error'),
          values: [
            { value: demo.isoDay(1), expect: 'saved', from: 'code' },
            { value: demo.isoDay(0), expect: 'saved', from: 'code' },
            { value: demo.isoDay(-1), expect: 'blocked', from: 'code' },
            { value: '', expect: 'blocked', from: 'code' },
            { value: noDay, expect: 'blocked', from: 'catalog' },
            { value: farDay, expect: 'rejected', from: 'code' },
          ],
        });
        await mark(page.locator('#due-form'));
      },
    },
    {
      // A flow probe: an ordinary step, walked only with --probe, that counts the records it may have added.
      ...step(P.s17),
      probe: true,
      approve: { what: P.s17what },
      run: async ({ page, goto, mark, state }) => {
        await goto(`/orders/${demo.ORDER}`);
        state.notesBefore = demo.db.notes();
        await page.locator('#note').fill(`${PREFIX}9`);
        await Promise.all([page.waitForEvent('load'), page.locator('#add-note').dblclick()]);
        state.double = demo.db.notes() - state.notesBefore;
        await mark(page.locator('#notes'));
      },
      check: async ({ state }) => [state.double === 1, tx('1 note added.', '1 not eklendi.'), tx(`${state.double} notes added (expected 1).`, `${state.double} not eklendi (1 bekleniyordu).`)],
    },
    {
      // The clean-up of the probe: what it saved, by the prefix, checked against the probe's own list.
      ...step(P.s18),
      probe: true,
      approve: { what: P.s18what, yes: P.s18yes },
      run: async ({ page, goto, mark, state }) => {
        // Stands in for the project's database tool: a delete limited to the test records, count kept.
        state.deleted = demo.db.deleteNotes(PREFIX);
        state.expectedDeleted = ((state.notes && state.notes.saved.length) || 0) + (state.double || 0);
        await goto(`/orders/${demo.ORDER}`);
        await mark(page.locator('#notes'));
      },
      check: async ({ state }) => [state.deleted === state.expectedDeleted, tx(`${state.deleted} notes deleted.`, `${state.deleted} not silindi.`),
        tx(`${state.deleted} notes deleted (expected ${state.expectedDeleted}).`, `${state.deleted} not silindi (${state.expectedDeleted} bekleniyordu).`)],
    },
  ],
};
