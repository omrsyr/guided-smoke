'use strict';
// Panel texts. The panel speaks the user's language; step texts come from the plan as written.

const TEXTS = {
  en: {
    step: 'Smoke {n} / {total}',
    minimize: 'Minimize',
    open: 'Open',
    did: 'What I did',
    expect: 'What you should see (outlined in orange)',
    autoOk: '✔ Automatic check: ',
    autoFail: '✖ Automatic check: ',
    pass: '✔ Correct, continue',
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
    loginTitle: 'Sign in first',
    loginDid: 'I opened the start page; the application asked for a sign-in.',
    loginExpect: [
      'Type your user name and password yourself (and a verification code if asked).',
      'After you sign in I open the start page again and continue here.',
    ],
    doneTitle: 'Smoke finished — thank you',
    doneDid: 'Results are saved. You can close the browser.',
    doneSummary: '{pass} passed · {diff} different · {skip} skipped',
    close: 'Close',
    signOut: 'Sign out and clear the profile',
    filtered: 'Only the selected steps run; earlier steps must already be in place.',
  },
  tr: {
    step: 'Smoke {n} / {total}',
    minimize: 'Küçült',
    open: 'Aç',
    did: 'Ne yaptım',
    expect: 'Ekranda görmen gereken (turuncu çerçeveli yer)',
    autoOk: '✔ Otomatik kontrol: ',
    autoFail: '✖ Otomatik kontrol: ',
    pass: '✔ Doğru, devam',
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
    loginTitle: 'Önce giriş yap',
    loginDid: 'Başlangıç sayfasını açtım; uygulama giriş istedi.',
    loginExpect: [
      'Kullanıcı adını ve parolanı sen yaz, giriş yap (istenirse doğrulama kodunu da).',
      'Girişten sonra başlangıç sayfasını yeniden açacağım; panel orada devam eder.',
    ],
    doneTitle: 'Smoke bitti — teşekkürler',
    doneDid: 'Sonuçlar kaydedildi. Tarayıcıyı kapatabilirsin.',
    doneSummary: '{pass} geçti · {diff} farklı · {skip} atlandı',
    close: 'Kapat',
    signOut: 'Çıkış yap ve profili temizle',
    filtered: 'Yalnız seçilen adımlar koşuyor; önceki adımların yaptıkları zaten yerinde olmalı.',
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

function texts(lang) {
  return TEXTS[lang] || TEXTS.en;
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (values[k] === undefined ? '' : String(values[k])));
}

module.exports = { pickLanguage, texts, format, LANGUAGES: Object.keys(TEXTS) };
