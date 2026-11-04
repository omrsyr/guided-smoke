'use strict';
// report.md for a walk: what ran, what the user answered, how long it took, what changed since the previous walk, and a
// block ready to paste into a work item. It is built from walk.json and events.jsonl only.

const LABELS = {
  en: {
    title: 'Smoke report', plan: 'Plan', workItem: 'Work item', date: 'Date', measured: 'Measured walk time',
    measuredNote: 'sign-in wait excluded; your own extra checking is not included', browser: 'Browser', base: 'Address',
    result: 'Result', filter: 'Filter', summary: 'Summary', steps: 'Steps', step: 'Step', outcome: 'Result', auto: 'Automatic check',
    note: 'Note', shot: 'Screenshot', compare: 'Compared with', noChange: 'No change in results.', paste: 'To paste into the work item',
    pasteTitle: 'Smoke ({date}, {pass}/{run}; guided-smoke {walk})', notRun: 'not run', results: { completed: 'completed', stopped: 'stopped by the user', error: 'ended with an error', running: 'still running or interrupted' },
    against: '✔ given although the automatic check failed', againstSummary: '⚠ {count} passed although the automatic check failed: {steps}.',
    againstShort: 'automatic check failed',
    pass: 'passed', diff: 'different', skip: 'skipped', none: 'not run', reasons: { filter: 'filter', 'follows-skip': 'follows a skipped step', declined: 'not allowed', 'skip-writes': '--skip-writes', remote: 'remote address' },
  },
  tr: {
    title: 'Smoke raporu', plan: 'Plan', workItem: 'İş', date: 'Tarih', measured: 'Ölçülen koşu süresi',
    measuredNote: 'giriş beklemesi hariç; senin ek incelemen dahil değil', browser: 'Tarayıcı', base: 'Adres',
    result: 'Sonuç', filter: 'Filtre', summary: 'Özet', steps: 'Adımlar', step: 'Adım', outcome: 'Sonuç', auto: 'Otomatik kontrol',
    note: 'Not', shot: 'Görüntü', compare: 'Önceki koşuyla fark', noChange: 'Sonuçlarda değişiklik yok.', paste: 'İş kaydına yapıştırmak için',
    pasteTitle: 'Smoke ({date}, {pass}/{run}; guided-smoke {walk})', notRun: 'koşulmadı', results: { completed: 'tamamlandı', stopped: 'kullanıcı durdurdu', error: 'hatayla bitti', running: 'sürüyor ya da yarıda kesildi' },
    against: 'otomatik kontrol ✖ iken ✔ verildi', againstSummary: '⚠ {count} adım otomatik kontrol ✖ iken ✔ aldı: {steps}.',
    againstShort: 'otomatik kontrol ✖',
    pass: 'geçti', diff: 'farklı', skip: 'atlandı', none: 'koşulmadı', reasons: { filter: 'filtre', 'follows-skip': 'atlanan adımı izliyor', declined: 'izin verilmedi', 'skip-writes': '--skip-writes', remote: 'uzak adres' },
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
 * @param {object|null} prev   { meta, events } of the previous walk of the same plan
 * @returns {{ markdown: string, counts: object }}
 */
function build(meta, events, prev) {
  const lang = LABELS[meta.lang] ? meta.lang : 'en';
  const L = LABELS[lang];
  const states = finalStates(events);
  const c = counts(meta, states);
  // Steps the user passed over a failed automatic check: allowed (the user has the last word), but never hidden.
  const against = [...states.values()].filter(e => e.answer === 'pass' && e.againstCheck).map(e => e.n).sort((a, b) => a - b);
  const start = localTime(meta.readyAt || meta.startedAt);
  const end = localTime(meta.endedAt);
  const lines = [];

  lines.push(`# ${L.title} — ${meta.walkId}`, '');
  lines.push(`- **${L.plan}:** ${meta.planId}${meta.title && meta.title !== meta.planId ? ` — ${meta.title}` : ''}`);
  if (meta.workItem) lines.push(`- **${L.workItem}:** #${meta.workItem}`);
  lines.push(`- **${L.date}:** ${start.day} ${start.time}${end ? '–' + end.time : ''}`);
  lines.push(`- **${L.measured}:** ${duration(meta.measuredSeconds, lang)} (${L.measuredNote})`);
  lines.push(`- **${L.browser}:** ${meta.browser} (${meta.browserSource})${meta.locale ? ` · ${meta.locale}` : ''}`);
  lines.push(`- **${L.base}:** ${meta.base}`);
  lines.push(`- **${L.result}:** ${L.results[meta.result] || meta.result}${meta.error ? ` — ${meta.error}` : ''}`);
  if (meta.filter) lines.push(`- **${L.filter}:** ${meta.filter}`);
  lines.push('', `## ${L.summary}`, '');
  lines.push(`${ICON.pass} ${c.pass} ${L.pass} · ${ICON.diff} ${c.diff} ${L.diff} · ${ICON.skip} ${c.skip} ${L.skip} · ${ICON.none} ${c.none} ${L.none}`);
  if (against.length) lines.push('', L.againstSummary.replace('{count}', against.length).replace('{steps}', against.join(', ')));

  lines.push('', `## ${L.steps}`, '');
  lines.push(`| # | ${L.step} | ${L.outcome} | ${L.auto} | ${L.note} | ${L.shot} |`);
  lines.push('|---|---|---|---|---|---|');
  for (let n = 1; n <= meta.totalSteps; n++) {
    const e = states.get(n);
    const title = (e && e.title) || (meta.titles && meta.titles[n - 1]) || '';
    let outcome = `${ICON.none} ${L.notRun}`;
    if (e && e.answer !== 'stop') {
      outcome = `${ICON[e.answer]} ${L[e.answer]}${e.reason ? ` (${L.reasons[e.reason] || e.reason})` : ''}`;
    } else if (e && e.answer === 'stop') {
      outcome = `${ICON.stop} ${L.notRun}`;
    }
    const auto = e && e.auto ? `${e.auto.ok ? '✔' : '✖'} ${e.auto.text}` : '';
    const note = e ? [e.answer === 'pass' && e.againstCheck ? `⚠ ${L.against}` : null, e.note, e.error, ...(e.warnings || [])].filter(Boolean).join(' · ') : '';
    const shot = e && e.screenshot ? `[${e.screenshot}](${e.screenshot})` : '';
    lines.push(`| ${n} | ${cell(title)} | ${cell(outcome)} | ${cell(auto)} | ${cell(note)} | ${shot} |`);
  }

  if (prev) {
    const before = finalStates(prev.events);
    const changes = [];
    for (let n = 1; n <= meta.totalSteps; n++) {
      const a = before.get(n);
      const b = states.get(n);
      const from = a ? a.answer : 'none';
      const to = b ? b.answer : 'none';
      if (from !== to && b && !(b.reason === 'filter')) changes.push(`- ${n}. ${cell(b.title)}: ${ICON[from] || ICON.none} → ${ICON[to] || ICON.none}`);
    }
    lines.push('', `## ${L.compare} (${prev.meta.walkId})`, '');
    lines.push(...(changes.length ? changes : [L.noChange]));
  }

  const ran = c.pass + c.diff;
  lines.push('', `## ${L.paste}`, '', '```text');
  lines.push(L.pasteTitle.replace('{date}', start.day).replace('{pass}', c.pass).replace('{run}', ran).replace('{walk}', meta.walkId));
  for (let n = 1; n <= meta.totalSteps; n++) {
    const e = states.get(n);
    if (!e || e.answer === 'stop') continue;
    if (e.answer === 'skip' && e.reason === 'filter') continue;
    lines.push(`${ICON[e.answer]} ${e.title}${e.answer === 'pass' && e.againstCheck ? ` (⚠ ${L.againstShort})` : ''}${e.note ? ` — ${e.note}` : ''}`);
  }
  lines.push(`${L.measured}: ${duration(meta.measuredSeconds, lang)}`);
  lines.push('```', '');

  return { markdown: lines.join('\n'), counts: c, against };
}

module.exports = { build, finalStates, counts, duration };
