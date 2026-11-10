'use strict';
// report.md for a walk: what ran, what the user answered, how long it took, what changed since the previous walk, and a
// block ready to paste into a work item. It is built from walk.json and events.jsonl only.

const { texts } = require('./i18n');
const errors = require('./errors');
const network = require('./network');
const probing = require('./probe');

const LABELS = {
  en: {
    title: 'Smoke report', plan: 'Plan', workItem: 'Work item', date: 'Date', measured: 'Measured walk time',
    measuredNote: 'sign-in wait excluded; your own extra checking is not included', browser: 'Browser', base: 'Address',
    result: 'Result', filter: 'Filter', summary: 'Summary', steps: 'Steps', step: 'Step', outcome: 'Result', auto: 'Automatic check',
    note: 'Note', shot: 'Screenshot', compare: 'Compared with', noChange: 'No change in results.', newStep: 'new step', wasStep: 'was step {n}', removedStep: 'no longer in the plan (was step {n})', paste: 'To paste into the work item',
    pasteTitle: 'Smoke ({date}, {pass}/{run}; guided-smoke {walk})', notRun: 'not run', results: { completed: 'completed', stopped: 'stopped by the user', error: 'ended with an error', running: 'still running or interrupted' },
    against: '✔ given although the automatic check failed', againstSummary: '⚠ {count} passed although the automatic check failed: {steps}.',
    againstShort: 'automatic check failed',
    byAuto: 'by itself', autoSummary: '{count} of the passed steps went on by themselves (--auto).',
    recordings: 'Recordings', recordingsNote: 'they hold what the screen showed, cookies and page data: keep them on this machine and do not attach them to the work item',
    pass: 'passed', diff: 'different', skip: 'skipped', none: 'not run', reasons: { filter: 'filter', 'follows-skip': 'follows a skipped step', declined: 'not allowed', 'skip-writes': '--skip-writes', remote: 'remote address', probe: 'runs with --probe' },
    errorsSummary: '⚠ Steps where the browser reported errors: {steps}. They are not on the screen; see "Browser errors".',
    errors: 'Browser errors', errorsNote: 'Counted from the browser: script errors, console errors, failed requests and HTTP errors (4xx/5xx). Only the kind, method, path (no query, id-like parts as •••), status and the script\'s place are kept; the messages were shown in the panel only. "•••" alone: the value box was open.',
    errorsIgnored: '{count} more matched the plan\'s ignoreErrors and are not counted.', errorsMore: '+{count} more',
    pasteErrors: ['{n} browser error', '{n} browser errors'],
    network: 'Network', networkNote: 'Counted with --network over each step, from the previous answer to the step\'s answer: requests, bytes on the wire, the slowest call and findings. Kept are the method, path (no query, id-like parts as •••), status, time, size and the names of fields, parameters, headers and cookies; never a value or a body. "•••" alone: the value box was open, and that request was not looked into.',
    networkSummary: '🌐 Network findings in steps: {steps}. See "Network".', networkCritical: '⛔ Critical network findings in steps: {steps}.',
    networkNone: '🌐 Network: no findings.',
    networkFindings: ['{n} network finding', '{n} network findings'],
    requests: 'Requests', size: 'Size', slowest: 'Slowest', findings: 'Findings',
    networkIgnored: '{count} requests matched the plan\'s network.ignore and are not counted.',
    networkUnread: '{count} response bodies could not be read (the page had moved on, or time ran out) and were not looked into.', networkMore: '+{count} more',
    expectedHere: 'expected in this environment',
    kinds: { 'secret-field': 'secret field', 'personal-field': 'personal data field', 'secret-param': 'secret in the address', 'conn-string': 'connection string', 'error-detail': 'error details', slow: 'slow', repeated: 'repeated', large: 'large' },
    site: 'Site', siteLocal: 'expected on this machine; check on the test or production server',
    siteMissing: 'Missing security headers: {list}', sitePages: '{count}/{pages} pages', siteFrame: 'X-Frame-Options (or CSP frame-ancestors)',
    siteRevealing: 'Headers that name the server or its version: {list}', siteNoHttpOnly: 'Session cookies without HttpOnly: {list}',
    siteNoSecure: 'Session cookies without Secure: {list}', siteUncompressed: 'Text responses sent uncompressed: {count} (largest {call}, {size})',
    siteNone: 'No findings.',
    probe: 'Probing', probeNote: "With --probe each probe step sent its form once per value of the plan. Expected comes from the plan: 🔧 the code, 📘 the catalog, ❓ an assumption. The application's message is kept, cut to 120 characters: it answers the plan's own test value. A long value is shown short (\"x×92\", its length in brackets).",
    probeSummary: ['🧪 Probing: {tries} tries in step {steps}; {different}.', '🧪 Probing: {tries} tries in steps {steps}; {different}.'], probeDifferent: ['{n} row different', '{n} rows different'], probeNoneDifferent: 'all as expected',
    probeStep: '{tries} tries, {different} different', probeShort: '🧪 {ok}/{tries} as expected', pasteProbe: '🧪 {ok}/{tries}',
    pasteRow: '{value}: expected {expect}, got {got}',
  },
  tr: {
    title: 'Smoke raporu', plan: 'Plan', workItem: 'İş', date: 'Tarih', measured: 'Ölçülen koşu süresi',
    measuredNote: 'giriş beklemesi hariç; senin ek incelemen dahil değil', browser: 'Tarayıcı', base: 'Adres',
    result: 'Sonuç', filter: 'Filtre', summary: 'Özet', steps: 'Adımlar', step: 'Adım', outcome: 'Sonuç', auto: 'Otomatik kontrol',
    note: 'Not', shot: 'Görüntü', compare: 'Önceki koşuyla fark', noChange: 'Sonuçlarda değişiklik yok.', newStep: 'yeni adım', wasStep: '{n}. adımdı', removedStep: 'artık planda yok ({n}. adımdı)', paste: 'İş kaydına yapıştırmak için',
    pasteTitle: 'Smoke ({date}, {pass}/{run}; guided-smoke {walk})', notRun: 'koşulmadı', results: { completed: 'tamamlandı', stopped: 'kullanıcı durdurdu', error: 'hatayla bitti', running: 'sürüyor ya da yarıda kesildi' },
    against: 'otomatik kontrol ✖ iken ✔ verildi', againstSummary: '⚠ {count} adım otomatik kontrol ✖ iken ✔ aldı: {steps}.',
    againstShort: 'otomatik kontrol ✖',
    byAuto: 'kendiliğinden', autoSummary: 'Geçen adımların {count} tanesi kendiliğinden geçti (--auto).',
    recordings: 'Kayıtlar', recordingsNote: 'ekranda görüneni, çerezleri ve sayfa verisini içerir: bu makinede tut, iş kaydına ekleme',
    pass: 'geçti', diff: 'farklı', skip: 'atlandı', none: 'koşulmadı', reasons: { filter: 'filtre', 'follows-skip': 'atlanan adımı izliyor', declined: 'izin verilmedi', 'skip-writes': '--skip-writes', remote: 'uzak adres', probe: '--probe ile koşar' },
    errorsSummary: '⚠ Tarayıcının hata bildirdiği adımlar: {steps}. Bunlar ekranda görünmez; bkz. "Tarayıcı hataları".',
    errors: 'Tarayıcı hataları', errorsNote: 'Tarayıcıdan sayıldı: JS hataları, konsol hataları, düşen istekler ve HTTP hataları (4xx/5xx). Yalnız tür, yöntem, yol (sorgusuz, kimlik benzeri parçalar •••), durum kodu ve betiğin yeri tutulur; mesajlar yalnız panelde gösterildi. Tek başına "•••": değer kutusu açıktı.',
    errorsIgnored: '{count} tanesi daha planın ignoreErrors listesine uydu, sayılmadı.', errorsMore: '+{count} tane daha',
    pasteErrors: ['{n} tarayıcı hatası', '{n} tarayıcı hatası'],
    network: 'Ağ', networkNote: '--network ile her adımda, önceki cevaptan adımın cevabına kadar sayıldı: istekler, ağdan geçen bayt, en yavaş çağrı ve bulgular. Yalnız yöntem, yol (sorgusuz, kimlik benzeri parçalar •••), durum kodu, süre, boyut ve alan, parametre, başlık ve çerez adları tutulur; hiçbir değer ya da gövde tutulmaz. Tek başına "•••": değer kutusu açıktı, o isteğin içine bakılmadı.',
    networkSummary: '🌐 Ağ bulgusu olan adımlar: {steps}. Bkz. "Ağ".', networkCritical: '⛔ Kritik ağ bulgusu olan adımlar: {steps}.',
    networkNone: '🌐 Ağ: bulgu yok.',
    networkFindings: ['{n} ağ bulgusu', '{n} ağ bulgusu'],
    requests: 'İstek', size: 'Boyut', slowest: 'En yavaş', findings: 'Bulgular',
    networkIgnored: '{count} istek planın network.ignore listesine uydu, sayılmadı.',
    networkUnread: '{count} yanıt gövdesi okunamadı (sayfa başka adrese geçmişti ya da süre doldu), içine bakılmadı.', networkMore: '+{count} tane daha',
    expectedHere: 'bu ortamda beklenir',
    kinds: { 'secret-field': 'hassas alan', 'personal-field': 'kişisel veri alanı', 'secret-param': 'adreste gizli değer', 'conn-string': 'bağlantı dizesi', 'error-detail': 'hata ayrıntısı', slow: 'yavaş', repeated: 'tekrar', large: 'büyük' },
    site: 'Site', siteLocal: 'bu makinede beklenir; test ya da canlı sunucuda kontrol et',
    siteMissing: 'Eksik güvenlik başlıkları: {list}', sitePages: '{count}/{pages} sayfa', siteFrame: 'X-Frame-Options (ya da CSP frame-ancestors)',
    siteRevealing: 'Sunucuyu ya da sürümünü söyleyen başlıklar: {list}', siteNoHttpOnly: 'HttpOnly olmayan oturum çerezleri: {list}',
    siteNoSecure: 'Secure olmayan oturum çerezleri: {list}', siteUncompressed: 'Sıkıştırılmadan gönderilen metin yanıtları: {count} (en büyüğü {call}, {size})',
    siteNone: 'Bulgu yok.',
    probe: 'Patlatma', probeNote: '--probe ile her patlatma adımı formunu plandaki her değerle birer kez gönderdi. Beklenen plandan gelir: 🔧 kod, 📘 katalog, ❓ varsayım. Uygulamanın mesajı 120 karaktere kesilerek tutulur: planın kendi test değerine verilen cevaptır. Uzun değer kısaltılmış gösterilir ("x×92", uzunluğu parantezde).',
    probeSummary: ['🧪 Patlatma: {steps}. adımda {tries} deneme; {different}.', '🧪 Patlatma: {steps}. adımlarda {tries} deneme; {different}.'], probeDifferent: ['{n} satır farklı', '{n} satır farklı'], probeNoneDifferent: 'hepsi beklendiği gibi',
    probeStep: '{tries} deneme, {different} farklı', probeShort: '🧪 {ok}/{tries} beklendiği gibi', pasteProbe: '🧪 {ok}/{tries}',
    pasteRow: '{value}: beklenen {expect}, olan {got}',
  },
};

const ICON = { pass: '✔', diff: '✖', skip: '⏭', stop: '■', none: '○' };

/** The final state of each step: the last pass/diff/skip/stop event for its number. */
function finalStates(events) {
  const states = new Map();
  for (const e of events) {
    if (['pass', 'diff', 'skip', 'stop'].includes(e.answer)) states.set(e.n, e);
  }
  return states;
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function duration(seconds, lang) {
  if (seconds == null) return '—';
  if (seconds < 60) return lang === 'tr' ? `${seconds} sn` : `${seconds} s`;
  const m = Math.round(seconds / 60);
  return lang === 'tr' ? `${m} dk` : `${m} min`;
}

function localTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = x => String(x).padStart(2, '0');
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function counts(meta, states) {
  const c = { pass: 0, diff: 0, skip: 0, none: 0 };
  for (let n = 1; n <= meta.totalSteps; n++) {
    const e = states.get(n);
    if (!e || e.answer === 'stop') c.none++;
    else c[e.answer]++;
  }
  return c;
}

/**
 * @param {object} meta        walk.json
 * @param {object[]} events    events.jsonl
 * @param {object[]|object|null} prev  earlier walks of the same plan, newest first, as { meta, events } (one alone is
 *                                       taken as a list of one)
 * @returns {{ markdown: string, counts: object }}
 */
function build(meta, events, prev) {
  const lang = LABELS[meta.lang] ? meta.lang : 'en';
  const L = LABELS[lang];
  const states = finalStates(events);
  const c = counts(meta, states);
  // Steps the user passed over a failed automatic check: allowed (the user has the last word), but never hidden.
  const against = [...states.values()].filter(e => e.answer === 'pass' && e.againstCheck).map(e => e.n).sort((a, b) => a - b);
  // What the browser reported that the screen did not show; a step keeps them whatever the user answered.
  const t = texts(lang);
  const errorSteps = [...states.values()].filter(e => errors.total(e.browserErrors)).map(e => e.n).sort((a, b) => a - b);
  const ignored = [...states.values()].reduce((sum, e) => sum + ((e.browserErrors && e.browserErrors.ignored) || 0), 0);
  // What the network did (--network): counted findings per step; the ones a local walk expects are listed, not counted.
  const networkSteps = [...states.values()].filter(e => network.findingTotal(e.network)).map(e => e.n).sort((a, b) => a - b);
  const criticalSteps = [...states.values()].filter(e => e.network && e.network.critical).map(e => e.n).sort((a, b) => a - b);
  // Probing (--probe): the tries of each probe step and the rows that differ from the plan's expectation.
  const probed = [...states.values()].filter(e => e.probe && e.probe.tries).sort((a, b) => a.n - b.n);
  const probeSteps = probed.filter(e => e.probe.different).map(e => e.n);
  const probeNote = e => (e.probe && e.probe.tries ? L.probeShort.replace('{ok}', e.probe.tries - e.probe.different).replace('{tries}', e.probe.tries) : null);
  const networkNote = e => {
    const n = network.findingTotal(e.network);
    return n ? `🌐 ${e.network.critical ? '⛔ ' : ''}${plural(n, L.networkFindings)}` : null;
  };
  const plural = (n, [one, many]) => (n === 1 ? one : many).replace('{n}', n);
  const start = localTime(meta.readyAt || meta.startedAt);
  const end = localTime(meta.endedAt);
  const lines = [];

  lines.push(`# ${L.title} — ${meta.walkId}`, '');
  lines.push(`- **${L.plan}:** ${meta.planId}${meta.title && meta.title !== meta.planId ? ` — ${meta.title}` : ''}`);
  // "#6655" for a number (Azure DevOps, GitHub); a key such as PROJ-123 (Jira, Linear) as it is.
  if (meta.workItem) lines.push(`- **${L.workItem}:** ${/^\d+$/.test(String(meta.workItem)) ? '#' : ''}${meta.workItem}`);
  lines.push(`- **${L.date}:** ${start.day} ${start.time}${end ? '–' + end.time : ''}`);
  lines.push(`- **${L.measured}:** ${duration(meta.measuredSeconds, lang)} (${L.measuredNote})`);
  lines.push(`- **${L.browser}:** ${meta.browser} (${meta.browserSource})${meta.locale ? ` · ${meta.locale}` : ''}`);
  lines.push(`- **${L.base}:** ${meta.base}`);
  lines.push(`- **${L.result}:** ${L.results[meta.result] || meta.result}${meta.error ? ` — ${meta.error}` : ''}`);
  if (meta.filter) lines.push(`- **${L.filter}:** ${meta.filter}`);
  const recordings = [...(meta.traces || []), ...(meta.videos || [])];
  if (recordings.length) lines.push(`- **${L.recordings}:** ${recordings.map(r => `[${r}](${r})`).join(' · ')} (${L.recordingsNote})`);
  lines.push('', `## ${L.summary}`, '');
  lines.push(`${ICON.pass} ${c.pass} ${L.pass} · ${ICON.diff} ${c.diff} ${L.diff} · ${ICON.skip} ${c.skip} ${L.skip} · ${ICON.none} ${c.none} ${L.none}`);
  const byAuto = [...states.values()].filter(e => e.answer === 'pass' && e.answeredBy === 'auto').length;
  if (byAuto) lines.push('', L.autoSummary.replace('{count}', byAuto));
  if (against.length) lines.push('', L.againstSummary.replace('{count}', against.length).replace('{steps}', against.join(', ')));
  if (errorSteps.length) lines.push('', L.errorsSummary.replace('{steps}', errorSteps.join(', ')));
  if (meta.network) {
    if (criticalSteps.length) lines.push('', L.networkCritical.replace('{steps}', criticalSteps.join(', ')));
    lines.push('', networkSteps.length ? L.networkSummary.replace('{steps}', networkSteps.join(', ')) : L.networkNone);
  }
  if (probed.length) {
    const tries = probed.reduce((sum, e) => sum + e.probe.tries, 0);
    const different = probed.reduce((sum, e) => sum + e.probe.different, 0);
    const what = different ? `${plural(different, L.probeDifferent)} (${probeSteps.join(', ')})` : L.probeNoneDifferent;
    lines.push('', (probed.length === 1 ? L.probeSummary[0] : L.probeSummary[1]).replace('{tries}', tries).replace('{steps}', probed.map(e => e.n).join(', ')).replace('{different}', what));
  }

  lines.push('', `## ${L.steps}`, '');
  lines.push(`| # | ${L.step} | ${L.outcome} | ${L.auto} | ${L.note} | ${L.shot} |`);
  lines.push('|---|---|---|---|---|---|');
  for (let n = 1; n <= meta.totalSteps; n++) {
    const e = states.get(n);
    const title = (e && e.title) || (meta.titles && meta.titles[n - 1]) || '';
    let outcome = `${ICON.none} ${L.notRun}`;
    if (e && e.answer !== 'stop') {
      outcome = `${ICON[e.answer]} ${L[e.answer]}${e.reason ? ` (${L.reasons[e.reason] || e.reason})` : ''}${e.answeredBy === 'auto' ? ` (${L.byAuto})` : ''}`;
    } else if (e && e.answer === 'stop') {
      outcome = `${ICON.stop} ${L.notRun}`;
    }
    const auto = e && e.auto ? `${e.auto.ok ? '✔' : '✖'} ${e.auto.text}` : '';
    const browser = e && errors.total(e.browserErrors) ? `⚠ ${t.errIn}${errors.countsText(e.browserErrors, t)}` : null;
    const note = e ? [e.answer === 'pass' && e.againstCheck ? `⚠ ${L.against}` : null, e.note, e.error, ...(e.warnings || []), browser, networkNote(e), probeNote(e)].filter(Boolean).join(' · ') : '';
    const shot = e && e.screenshot ? `[${e.screenshot}](${e.screenshot})` : '';
    lines.push(`| ${n} | ${cell(title)} | ${cell(outcome)} | ${cell(auto)} | ${cell(note)} | ${shot} |`);
  }

  if (errorSteps.length || ignored) {
    lines.push('', `## ${L.errors}`, '', L.errorsNote, '');
    for (const n of errorSteps) {
      const e = states.get(n);
      const first = e.browserErrors.first || [];
      const rest = errors.total(e.browserErrors) - first.reduce((sum, r) => sum + (r.times || 1), 0);
      const parts = [...first.map(errors.recordLine), ...(rest > 0 ? [L.errorsMore.replace('{count}', rest)] : [])];
      lines.push(`- ${n}. ${cell(e.title)}: ${parts.map(p => `\`${p.replace(/`/g, "'")}\``).join(' · ')}`);
    }
    if (ignored) lines.push(...(errorSteps.length ? [''] : []), L.errorsIgnored.replace('{count}', ignored));
  }

  if (meta.network) lines.push(...networkSection(meta, states, L, t));
  if (probed.length) lines.push(...probeSection(probed, L, t));

  const earlier = !prev ? [] : Array.isArray(prev) ? prev : [prev];
  if (earlier.length) {
    const { changes, against: base } = compare(meta, states, earlier, L);
    lines.push('', `## ${L.compare} (${base.join(', ')})`, '');
    lines.push(...(changes.length ? changes : [L.noChange]));
  }

  const ran = c.pass + c.diff;
  lines.push('', `## ${L.paste}`, '', '```text');
  lines.push(L.pasteTitle.replace('{date}', start.day).replace('{pass}', c.pass).replace('{run}', ran).replace('{walk}', meta.walkId));
  for (let n = 1; n <= meta.totalSteps; n++) {
    const e = states.get(n);
    if (!e || e.answer === 'stop') continue;
    if (e.answer === 'skip' && (e.reason === 'filter' || e.reason === 'probe')) continue;
    const browser = errors.total(e.browserErrors);
    const net = networkNote(e);
    const tried = e.probe && e.probe.tries ? L.pasteProbe.replace('{ok}', e.probe.tries - e.probe.different).replace('{tries}', e.probe.tries) : null;
    lines.push(`${ICON[e.answer]} ${e.title}${e.answeredBy === 'auto' ? ` (${L.byAuto})` : ''}${e.answer === 'pass' && e.againstCheck ? ` (⚠ ${L.againstShort})` : ''}${browser ? ` (⚠ ${plural(browser, L.pasteErrors)})` : ''}${net ? ` (${net})` : ''}${tried ? ` (${tried})` : ''}${e.note ? ` — ${e.note}` : ''}`);
    // Of a probe only the rows that differ go to the work item, each with what the application said.
    for (const r of tried ? e.probe.rows.filter(x => !x.ok) : []) {
      const row = L.pasteRow.replace('{value}', r.value).replace('{expect}', probing.expectText(r, t)).replace('{got}', probing.gotText(r, t));
      lines.push(`   ✖ ${row}${r.message ? ` — "${r.message}"` : ''}`);
    }
  }
  lines.push(`${L.measured}: ${duration(meta.measuredSeconds, lang)}`);
  lines.push('```', '');

  return { markdown: lines.join('\n'), counts: c, against, errorSteps, networkSteps, probeSteps };
}

/** A walk's steps as "title#k" (the k-th step with that title), by number. */
function stepKeys(meta, states) {
  const keys = new Map();
  const seen = new Map();
  for (let n = 1; n <= meta.totalSteps; n++) {
    const title = (meta.titles && meta.titles[n - 1]) || (states.get(n) && states.get(n).title) || '';
    const k = (seen.get(title) || 0) + 1;
    seen.set(title, k);
    keys.set(n, `${title}#${k}`);
  }
  return keys;
}

/**
 * What changed, step by step, since the step was last walked. `earlier`: the plan's earlier walks, newest first. A step
 * is compared with the newest walk in which it was answered ✔ or ✖, so a walk stopped early or a --retry-failed walk
 * that ran a few steps does not make the others look new; without such a walk, with the newest one that holds it.
 * A step is the same step when its title is: a plan that gained, lost or moved steps keeps its comparison right, a new
 * step says so, a step no longer in the plan (as of the previous walk) is listed. A walk that shares no title with
 * this one but has as many steps (the plan translated or renamed throughout) is matched by number.
 * Returns the lines and the walks compared with, newest first.
 */
function compare(meta, states, earlier, L) {
  const now = stepKeys(meta, states);
  const walks = earlier.map(w => {
    const done = finalStates(w.events);
    const keys = stepKeys(w.meta, done);
    const byKey = new Map([...keys].map(([n, key]) => [key, n]));
    const byNumber = ![...now.values()].some(key => byKey.has(key)) && w.meta.totalSteps === meta.totalSteps;
    return { id: w.meta.walkId, done, keys, byKey, byNumber };
  });
  const baseline = (n, key) => {
    let held = null;
    for (const w of walks) {
      const m = w.byNumber ? n : w.byKey.get(key);
      if (m == null) continue;
      const e = w.done.get(m);
      const answer = e ? e.answer : 'none';
      if (answer === 'pass' || answer === 'diff') return { w, m, answer };
      // A walk without --probe did not walk a probe step: it holds nothing to compare with.
      if (!held && !(e && e.reason === 'probe')) held = { w, m, answer };
    }
    return held;
  };
  const icon = answer => ICON[answer] || ICON.none;
  const rows = [];
  const used = new Set();
  for (const [n, key] of now) {
    const b = states.get(n);
    // Not walked in this walk: filtered out, or a probe step without --probe.
    if (!b || b.reason === 'filter' || b.reason === 'probe') continue;
    const base = baseline(n, key);
    if (!base) {
      rows.push({ text: `- ${n}. ${cell(b.title)}: ${L.newStep} → ${icon(b.answer)}` });
      continue;
    }
    used.add(base.w.id);
    if (base.answer !== b.answer) {
      rows.push({ id: base.w.id, text: `- ${n}. ${cell(b.title)}: ${icon(base.answer)} → ${icon(b.answer)}${base.m !== n ? ` (${L.wasStep.replace('{n}', base.m)})` : ''}` });
    }
  }
  const against = walks.map(w => w.id).filter(id => used.has(id));
  if (!against.length) against.push(walks[0].id);
  // Several walks compared with: each line says which one.
  const lines = rows.map(r => (against.length > 1 && r.id ? `${r.text} · ${r.id}` : r.text));
  const last = walks[0];
  if (!last.byNumber) {
    const current = new Set(now.values());
    for (const [m, key] of last.keys) if (!current.has(key)) lines.push(`- ${cell(key.replace(/#\d+$/, ''))}: ${L.removedStep.replace('{n}', m)}`);
  }
  return { changes: lines, against };
}

const code = text =>`\`${String(text).replace(/`/g, "'")}\``;

/** The "Probing" section: per probe step its table of tries, the rows that differ marked, then the table's notes. */
function probeSection(probed, L, t) {
  const lines = ['', `## ${L.probe}`, '', L.probeNote];
  for (const e of probed) {
    const p = e.probe;
    lines.push('', `### ${e.n}. ${cell(e.title)} (${L.probeStep.replace('{tries}', p.tries).replace('{different}', p.different)})`, '');
    const tbl = probing.table(p, t);
    lines.push(`| ${tbl.head.join(' | ')} |`, `|${tbl.head.map(() => '---').join('|')}|`);
    for (const r of tbl.rows) {
      const [n, value, expect, got, message] = r.cells;
      lines.push(`| ${r.bad ? `✖ ${n}` : n} | ${cell(code(value))} | ${cell(expect)} | ${cell(r.bad ? `**${got}**` : got)} | ${cell(message)} |`);
    }
    if (tbl.notes.length) lines.push('', ...tbl.notes.map(x => `- ${x}`));
  }
  return lines;
}

/** The "Network" section: a row per step that ran with --network, its findings, then each of the application's sites. */
function networkSection(meta, states, L, t) {
  const lines = ['', `## ${L.network}`, '', L.networkNote, ''];
  const ran = [...states.values()].filter(e => e.network).sort((a, b) => a.n - b.n);
  if (ran.length) {
    lines.push(`| # | ${L.step} | ${L.requests} | ${L.size} | ${L.slowest} | ${L.findings} |`, '|---|---|---|---|---|---|');
    for (const e of ran) {
      const r = e.network;
      const slowest = r.slowest ? `${r.slowest.method} ${r.slowest.url} ${network.time(r.slowest.ms, t)}` : '';
      const found = (r.findings || []).filter(f => !f.env).map(f => `${f.level === 'critical' ? '⛔' : '⚠'} ${L.kinds[f.kind] || f.kind}${f.kind === 'repeated' ? ` ×${f.times}` : ''}`);
      lines.push(`| ${e.n} | ${cell(e.title)} | ${r.requests} | ${network.size(r.bytes, t)} | ${cell(slowest)} | ${cell(found.join(' · '))} |`);
    }
    const detailed = ran.filter(e => (e.network.findings || []).length);
    if (detailed.length) lines.push('');
    for (const e of detailed) {
      const r = e.network;
      const parts = r.findings.map(f => code(`${network.findingLine(f, t)}${f.env ? ` (${L.expectedHere})` : ''}`));
      if (r.more) parts.push(code(L.networkMore.replace('{count}', r.more)));
      lines.push(`- ${e.n}. ${cell(e.title)}: ${parts.join(' · ')}`);
    }
    const ignored = ran.reduce((sum, e) => sum + (e.network.ignored || 0), 0);
    const unread = ran.reduce((sum, e) => sum + (e.network.unread || 0), 0);
    if (ignored || unread) lines.push('');
    if (ignored) lines.push(L.networkIgnored.replace('{count}', ignored));
    if (unread) lines.push(L.networkUnread.replace('{count}', unread));
  }
  for (const [origin, s] of Object.entries(meta.network.sites || {})) {
    lines.push('', `### ${L.site} — ${origin}${meta.network.local ? ` (${L.siteLocal})` : ''}`, '');
    const items = [];
    const missing = Object.entries(s.missing || {});
    if (missing.length) {
      items.push(L.siteMissing.replace('{list}', missing.map(([name, count]) => `${name === 'X-Frame-Options' ? L.siteFrame : name} (${L.sitePages.replace('{count}', count).replace('{pages}', s.pages)})`).join(', ')));
    }
    if ((s.revealing || []).length) items.push(L.siteRevealing.replace('{list}', s.revealing.join(', ')));
    if ((s.noHttpOnly || []).length) items.push(L.siteNoHttpOnly.replace('{list}', s.noHttpOnly.join(', ')));
    if ((s.noSecure || []).length) items.push(L.siteNoSecure.replace('{list}', s.noSecure.join(', ')));
    if (s.uncompressed) {
      const big = s.uncompressed.largest;
      items.push(L.siteUncompressed.replace('{count}', s.uncompressed.count).replace('{call}', `${big.method} ${big.url}`).replace('{size}', network.size(big.bytes, t)));
    }
    lines.push(...(items.length ? items.map(i => `- ${i}`) : [L.siteNone]));
  }
  return lines;
}

module.exports = { build, finalStates, counts, duration };
