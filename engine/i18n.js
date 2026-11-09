'use strict';
// Panel texts. The panel speaks the user's language; step texts come from the plan as written.

const TEXTS = {
  en: {
    step: 'Smoke {n} / {total}',
    minimize: 'Minimize',
    open: 'Open',
    did: 'What I did',
    expect: 'What you should see (outlined in orange)',
    expectPlain: 'What to expect',
    autoOk: '✔ Automatic check: ',
    autoFail: '✖ Automatic check: ',
    pass: '✔ Correct, continue',
    passConfirm: '✔ The check failed. Correct anyway? Click again',
    diff: '✖ Different',
    stop: '■ Stop',
    send: 'Send',
    notePlaceholder: 'What was different? Keep it short, then Send.',
    shot: '📷 Save screenshot',
    shotSaved: '📷 Saved',
    approveTitle: 'Permission needed',
    approveIntro: 'This step changes something outside the page. Nothing happens until you allow it.',
    approveYes: '✔ Yes, do it',
    approveSkip: 'Skip',
    todo: 'What you need to do',
    change: 'What will change',
    outcome: 'Result',
    loginTitle: 'Sign in first',
    loginDid: 'I opened the start page; the application asked for a sign-in.',
    loginExpect: [
      'Type your user name and password yourself (and a verification code if asked).',
      'After you sign in I open the start page again and continue here.',
    ],
    doneTitle: 'Smoke finished — thank you',
    doneDid: 'Results are saved. You can close the browser.',
    doneSummary: '{pass} passed · {diff} different · {skip} skipped',
    doneAgainst: '⚠ {against} passed although the automatic check failed.',
    doneAuto: '{auto} of them went on by themselves (--auto).',
    autoIn: 'The automatic check passed: going on by itself in {s} s.',
    autoHold: '⏸ Wait',
    close: 'Close',
    signOut: 'Sign out and clear the profile',
    filtered: 'Only the selected steps run; earlier steps must already be in place.',
    markMissing: '⚠ The place to look at was not found on the page, so nothing is outlined.',
    manyMark: '⚠ {count} places on the page match; only the first is outlined. (A narrower locator in the plan removes the doubt.)',
    manyText: '⚠ {count} places on the page match with different texts; the automatic check read the first. (A narrower locator in the plan removes the doubt.)',
    boxTitle: 'Values for this smoke',
    boxNote: 'You type these. The script does not read or record them; they are cleared when the page reloads.',
    boxIdle: 'Nothing sent yet.',
    boxEmpty: 'Fill in the box first: ',
    boxGone: 'The value box is no longer on the page.',
    boxUse: '✔ Use these values',
    boxWaitDid: 'This step uses the values in the box at the bottom left, and the box is not filled in yet.',
    boxWaitTodo: 'Fill in {fields} in the box, then press "{use}" there. The step goes on by itself.',
    errIn: 'In the browser: ',
    errJs: ['{n} script error', '{n} script errors'],
    errConsole: ['{n} console error', '{n} console errors'],
    errRequests: ['{n} failed request', '{n} failed requests'],
    errMore: '… and {n} more',
    errIgnored: '{n} left out by the plan (ignoreErrors)',
    doneErrors: '⚠ The browser reported errors in {errorSteps} of the steps (see the report).',
    netIn: '🌐 Network: ',
    netRequests: ['{n} request', '{n} requests'],
    netSlowest: 'slowest {call} {time}',
    netMore: '… and {n} more',
    netSecretField: '{call}: secret field in the response: {names}',
    netPersonalField: '{call}: personal data field in the response: {names} (does this screen need it?)',
    netSecretParam: '{call}: secret in the address: {names}',
    netConnString: '{call} → {status}: part of a connection string in the error response',
    netErrorDetail: '{call} → {status}: {what} in the error response',
    netStack: 'stack trace',
    netSql: 'database error',
    netSlow: '{call} took {time}',
    netRepeated: '{call} {times} times in this step',
    netLarge: '{call}: {size} response',
    decimal: '.',
    seconds: 's',
    doneNetwork: '⚠ Network findings in {networkSteps} of the steps (see the report).',
    doneNetworkCritical: '⛔ Critical network findings in {networkCritical} of the steps (see the report).',
  },
  tr: {
    step: 'Smoke {n} / {total}',
    minimize: 'Küçült',
    open: 'Aç',
    did: 'Ne yaptım',
    expect: 'Ekranda görmen gereken (turuncu çerçeveli yer)',
    expectPlain: 'Beklenen sonuç',
    autoOk: '✔ Otomatik kontrol: ',
    autoFail: '✖ Otomatik kontrol: ',
    pass: '✔ Doğru, devam',
    passConfirm: '✔ Kontrol ✖ verdi. Yine de doğru mu? Tekrar bas',
    diff: '✖ Farklı',
    stop: '■ Durdur',
    send: 'Gönder',
    notePlaceholder: 'Ne farklıydı? Kısaca yaz, sonra Gönder.',
    shot: '📷 Ekran görüntüsü kaydet',
    shotSaved: '📷 Kaydedildi',
    approveTitle: 'İzin gerekiyor',
    approveIntro: 'Bu adım sayfanın dışında bir şeyi değiştirir. Sen izin vermeden hiçbir şey yapılmaz.',
    approveYes: '✔ Evet, yap',
    approveSkip: 'Atla',
    todo: 'Senden beklenen',
    change: 'Yapılacak değişiklik',
    outcome: 'Sonuç',
    loginTitle: 'Önce giriş yap',
    loginDid: 'Başlangıç sayfasını açtım; uygulama giriş istedi.',
    loginExpect: [
      'Kullanıcı adını ve parolanı sen yaz, giriş yap (istenirse doğrulama kodunu da).',
      'Girişten sonra başlangıç sayfasını yeniden açacağım; panel orada devam eder.',
    ],
    doneTitle: 'Smoke bitti — teşekkürler',
    doneDid: 'Sonuçlar kaydedildi. Tarayıcıyı kapatabilirsin.',
    doneSummary: '{pass} geçti · {diff} farklı · {skip} atlandı',
    doneAgainst: '⚠ {against} adım otomatik kontrol ✖ iken ✔ aldı.',
    doneAuto: 'Bunların {auto} tanesi kendiliğinden geçti (--auto).',
    autoIn: 'Otomatik kontrol geçti: {s} sn sonra kendiliğinden devam ediyor.',
    autoHold: '⏸ Bekle',
    close: 'Kapat',
    signOut: 'Çıkış yap ve profili temizle',
    filtered: 'Yalnız seçilen adımlar koşuyor; önceki adımların yaptıkları zaten yerinde olmalı.',
    markMissing: '⚠ Bakılacak yer sayfada bulunamadı, bu yüzden çerçeve çizilmedi.',
    manyMark: '⚠ Sayfada {count} yer eşleşti; yalnız ilki çerçevelendi. (Plandaki seçiciyi daraltmak belirsizliği giderir.)',
    manyText: '⚠ Sayfada farklı metinli {count} yer eşleşti; otomatik kontrol ilkini okudu. (Plandaki seçiciyi daraltmak belirsizliği giderir.)',
    boxTitle: 'Bu smoke için değerler',
    boxNote: 'Bunları sen yazarsın. Betik okumaz, kayda yazmaz; sayfa yenilenince silinir.',
    boxIdle: 'Henüz bir şey gönderilmedi.',
    boxEmpty: 'Önce kutuyu doldur: ',
    boxGone: 'Değer kutusu artık sayfada yok.',
    boxUse: '✔ Bu değerleri kullan',
    boxWaitDid: 'Bu adım sol alttaki kutudaki değerleri kullanıyor; kutu henüz dolu değil.',
    boxWaitTodo: 'Kutuda şunları doldur: {fields}. Sonra kutudaki "{use}" düğmesine bas; adım kendiliğinden sürer.',
    errIn: 'Tarayıcıda: ',
    errJs: ['{n} JS hatası', '{n} JS hatası'],
    errConsole: ['{n} konsol hatası', '{n} konsol hatası'],
    errRequests: ['{n} başarısız istek', '{n} başarısız istek'],
    errMore: '… ve {n} tane daha',
    errIgnored: '{n} tanesi planda yok sayıldı (ignoreErrors)',
    doneErrors: '⚠ {errorSteps} adımda tarayıcı hata bildirdi (rapora bak).',
    netIn: '🌐 Ağ: ',
    netRequests: ['{n} istek', '{n} istek'],
    netSlowest: 'en yavaş {call} {time}',
    netMore: '… ve {n} tane daha',
    netSecretField: '{call} yanıtında hassas alan: {names}',
    netPersonalField: '{call} yanıtında kişisel veri alanı: {names} (bu ekranda gerekli mi?)',
    netSecretParam: '{call} adresinde gizli değer: {names}',
    netConnString: '{call} → {status} hata yanıtında bağlantı dizesi parçası',
    netErrorDetail: '{call} → {status} hata yanıtında {what}',
    netStack: 'stack trace',
    netSql: 'veritabanı hatası',
    netSlow: '{call} {time} sürdü',
    netRepeated: '{call} bu adımda {times} kez',
    netLarge: '{call} yanıtı {size}',
    decimal: ',',
    seconds: 'sn',
    doneNetwork: '⚠ {networkSteps} adımda ağ bulgusu var (rapora bak).',
    doneNetworkCritical: '⛔ {networkCritical} adımda kritik ağ bulgusu var (rapora bak).',
  },
};

function pickLanguage(requested) {
  const candidates = [requested, process.env.GUIDED_SMOKE_LANG, process.env.LANG, Intl.DateTimeFormat().resolvedOptions().locale];
  for (const c of candidates) {
    if (!c) continue;
    const code = String(c).toLowerCase().slice(0, 2);
    if (TEXTS[code]) return code;
  }
  return 'en';
}

/**
 * The browser locale when none is given: the system's (tr-TR here), so date inputs and the browser's own validation
 * messages read as the user reads them. GUIDED_SMOKE_LOCALE overrides; null when nothing usable is found.
 */
function systemLocale(raw = process.env.GUIDED_SMOKE_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale) {
  const m = /^([a-zA-Z]{2})(?:[-_]([a-zA-Z]{2}))?(?:\b|$)/.exec(String(raw || ''));
  if (!m) return null;
  return m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase();
}

function texts(lang) {
  return TEXTS[lang] || TEXTS.en;
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (values[k] === undefined ? '' : String(values[k])));
}

module.exports = { pickLanguage, systemLocale, texts, format, LANGUAGES: Object.keys(TEXTS) };
