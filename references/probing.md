# Probing

`--probe` walks the plan's probe steps: an experienced tester's boundary and wrong values, sent through one form field
per step. The engine sends the form once per value, sorts what happened, and the panel shows a table of every try
that the user reads once. Without `--probe` those steps are skipped ("runs with --probe"), so a plan can keep them.

## When

- The user asks to probe a form ("patlat", "probe this form", `guided-smoke plan --probe`), or the change adds or
  changes a field with rules (a length, a range, a format, required).
- Not for screens that only show data, and only on records the user chose for testing.

## Expectations first, from the rules

For each field, find its rules before choosing values:

- the form: `required`, `maxlength`, `min`/`max`, `pattern`, `type` (`email`, `number`, `date`);
- the server: validation attributes (`[Required]`, `[MaxLength]`, `[StringLength]`, `[Range]`), validator classes
  (`RuleFor(x => x.Note).MaximumLength(100)`), schema validators (zod, Joi, class-validator), the database column
  (`nvarchar(100)`, `NOT NULL`);
- the client framework's validators (Angular `Validators.maxLength`, form libraries).

Pick values from the catalog below and give each one an expectation and where it comes from (`from`): `code` 🔧 (a
rule you read), `catalog` 📘 (the catalog's default; no rule found), `assumed` ❓ (neither). Expectations taken from
the code alone confirm what the code does; the user's approval is what makes them a test.

In the chat, before writing the plan, show a table per field (value → expected → origin), say how many expectations
come from the code ("14 of 20 from the code"), and ask at most three questions, only where the answer changes the plan
(does the field trim? may an emoji be saved? which record may the probe use?). The plan holds exactly the approved
values: no catalog is expanded at run time.

## The catalog

| Kind | Values | Default expectation |
|---|---|---|
| Text | empty · only spaces · spaces around · exactly the maximum · maximum + 1 · 10,000 characters | empty and spaces refused when required; the maximum saved; maximum + 1 refused (or `trimmed` under a `maxlength`); 10,000 refused |
| Text, characters | `' " < > &` · `<script>alert(1)</script>` · `' OR 1=1 --` · an emoji · `İıĞğŞşÇçÖöÜü` | saved, and shown as typed |
| Number | 0 · negative · decimal with `,` and with `.` · very large (`99999999999999999999`) · not a number | by the rule; text in a number field: not sent |
| Date | today · yesterday · the earliest allowed day − 1 · `9999-12-31` · `2027-02-29` (no such day) | by the rule; a day that does not exist: not sent |
| E-mail | no `@` · two `@` · ending in a dot · a space inside · very long | refused |
| Phone | too short · too long · with a country code (`+90…`) · letters | by the rule |

**Flow probes** are ordinary steps marked `probe: true` that count the records they may add: a double click on the
submit button · submit, back, submit again · reload after a submit (the form sent again). Expect one record, or the
application's own "already sent" answer.

## Writing a probe step

```js
{
  title: 'Note field probed',
  probe: true,                                   // walked only with --probe; always asks first
  approve: { what: 'Send the Notes form of order 1001 with 4 values; accepted ones are added as notes starting with SMOKE-P, and the last step deletes them.' },
  did: 'I sent the "Notes" form of order 1001 with 4 values, one at a time.',
  expect: ['A table of 4 tries, all as expected: …'],
  run: async ({ page, goto, mark, probe, state }) => {
    await goto('/orders/1001');                  // a clean page: nothing on it reads as "saved" yet
    state.notes = await probe({
      field: page.locator('#note'),              // the one input to fill
      submit: page.locator('#add-note'),         // the one button that sends the form
      saved: page.locator('.alert-success', { hasText: 'Note added.' }),   // shown only after a save (or ctx => true)
      message: page.locator('#note-error'),      // where the application says why it refused
      values: [
        { value: '', expect: 'blocked', from: 'code' },                              // required
        { value: 'SMOKE-P1 ' + 'x'.repeat(91), expect: 'saved', from: 'code' },      // [MaxLength(100)]
        { value: 'SMOKE-P2 ' + 'x'.repeat(92), expect: 'rejected', from: 'code' },
        { value: 'SMOKE-P3 😀', expect: 'saved', from: 'catalog' },
      ],
    });
    await mark(page.locator('#notes'));
  },
}
```

- `expect`: `saved` (saved as typed) · `trimmed` (saved shortened, by a `maxlength`) · `rejected` (refused by the
  application, or not sent) · `blocked` (not sent: the browser or a disabled button kept it back).
- Before every value but the first the form is brought back: the address the probe started on is opened again, or the
  plan's `reset: async ctx => {}` runs instead (an edit form: put the old value back; a form in a dialog: open it
  again). Start the probe on a page where nothing reads as saved yet.
- `timeout` (ms, default 5000): how long one try waits for something to happen. An optional `label` shows a value
  differently in the table; by default a long value reads short (`x×92`, its length in brackets).
- One `probe()` per step, at most 50 values, with the value box closed. It returns `{ tries, different, rows, saved }`;
  `saved` lists the values the application saved, as sent.
- `did` and `expect` describe the table the user will read: how many tries, which rows should stand out, and why.
- **Test records.** A value that may be saved starts with a prefix the clean-up can find (`SMOKE-P1 …`, filled up to
  the length the value is about). A value meant to be refused needs none.
- **Clean-up.** End with a permitted step marked `probe: true` that deletes what the probe saved, by the prefix, and
  checks the count against `saved.length`. An edit form's probe leaves the record's last saved value: put the original
  back there too. See [patterns](patterns.md#reading-and-writing-the-database).

## What a try leads to

| Got | When |
|---|---|
| 💥 crashed | a 5xx answer, a script error or a failed request of the application during the try |
| 🛑 not sent | the browser refused the field (its own check and message), the field does not take the value (a date that is no day, text in a number field), or the submit button is disabled |
| ⛔ refused | the application's message appeared, or it answered with an error status (4xx) and showed nothing |
| ✔ saved | `saved` showed; ✂ when the browser kept only part of what was typed |
| ❔ unclear | nothing within the timeout, "saved" showing before the form was sent (the page was not reset), another field of the form blocking it, or an error of the step |

A row that differs from its expectation is red and fails the step's automatic check; ✔ then takes a second click. A
probe step never goes on by itself under `--auto`. Where a row expected from an assumption (❓) differs, doubt the
expectation first.

A refused value's 4xx answer belongs to its try and is not a browser error of the step; a 5xx or a script error is
both. Each try counts "the same call" (`--network`) on its own, so a call made once per try is not a repeated call.

## Limits

- 🛑 rows did not test the server: the value never left the browser. Checking the server with such a value (lifting the
  form's checks, or sending its request directly) is not part of `--probe` yet.
- A client framework that reports its errors only to the console (Angular's error handler) shows a crash as ❔
  unclear, not 💥; the console error is under the step.
- The application's message is recorded, cut to 120 characters: it answers the plan's own test value. A uniqueness
  message may name another record; the report stays on this machine and the paste block carries only the rows that
  differ.
