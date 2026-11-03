# guided-smoke

**Takip edebileceğin bir smoke testi.** Bir değişikliği gerçek bir tarayıcıda sana adım adım gösteren Claude Code
skill'i: Playwright her adımı kendisi yapar, sayfadaki panel **ne yapıldığını** ve **ne görmen gerektiğini** yazar
(ilgili yer turuncu çerçeveyle işaretlenir); sen **✔ Doğru, devam** demeden sonraki adıma geçilmez.

[English](README.md)

Tarayıcı testi yapan skill'lerin çoğu testleri kendisi koşar ve sana sonuç verir. `guided-smoke` ise bir değişiklik
incelemeye gitmeden önceki ana göre: birinin ekrana bakıp "evet, doğru" demesi gerektiği an. Bunun için kontrol
listesini okuman, tek başına tıklaman ya da hızla akıp giden bir betiği izlemen gerekmez.

## Ne yapar

- Claude az önce yaptığın değişiklik için bir **plan** yazar (konuşmadan, dalın farkından, kabul kriterlerinden) ve
  sana numaralı liste olarak gösterir.
- Onayından sonra tarayıcı açılır. Her adımda betik işi yapar, yeri işaretler, otomatik kontrolü koşar ve bekler:
  - **✔ Doğru, devam** · **✖ Farklı** (kısa bir not yaz) · **■ Durdur** · **📷 Ekran görüntüsü kaydet** · **Küçült**
- **Sayfanın dışında** bir şeyi değiştiren adımlar (veritabanı satırı, dosya, e-posta) önce sorar: **Evet, yap / Atla /
  Durdur**. Yerel olmayan bir adreste sen izin vermedikçe kapalıdır.
- Her cevap anında kaydedilir. **Rapor** geçeni ve farklı olanı, ölçülen koşu süresini, önceki koşudan bu yana neyin
  değiştiğini ve iş kaydına yapıştırılacak bir bloğu verir.
- Düzeltmeden sonra `run 6655 --retry-failed` yalnız ✖ işaretli adımları koşar.

## Gereksinimler

- Windows, macOS ya da Linux'ta Claude Code (ya da kabuk erişimi olan başka bir ajan)
- Node.js 18 ya da üstü
- Google Chrome ya da Microsoft Edge (tarayıcı indirilmez; kurulu olan sürülür)

## Kurulum

```bash
git clone https://github.com/omrsyr/guided-smoke ~/.claude/skills/guided-smoke
```

Windows (PowerShell): `git clone https://github.com/omrsyr/guided-smoke "$env:USERPROFILE\.claude\skills\guided-smoke"`

Yeni bir Claude Code session'ı aç. İlk koşu `playwright-core`'u (birkaç MB, npm'den) veri klasörüne kurmak için izin
ister; skill klasörüne değil. İstersen kendin de kurabilirsin: `node ~/.claude/skills/guided-smoke/engine/run.js setup`.

## Kullanım

"Bunun smoke'unu koşalım" de ya da yaz:

```text
/guided-smoke                     bu işin smoke planını hazırla, göster, onayınla koş
/guided-smoke plan 6655           yalnız plan (tarayıcı açılmaz)
/guided-smoke run 6655            koş (yeni koşu: 6655-machine-expiry-1, -2, …)
/guided-smoke run 6655 --retry-failed
/guided-smoke report 6655         son koşunun raporu (2. koşu için 6655-2)
/guided-smoke list
```

İşe yarayan bayraklar: `--browser chrome|edge`, `--base https://localhost:5001`, `--pace slow|normal|fast`, `--from 5`,
`--only 3,7-9`, `--screens diff|all`, `--locale tr-TR`, `--skip-writes`, `--fresh`. Ayrıntı: [SKILL.md](SKILL.md).

## Giriş ve veriler

- **Girişi sen yaparsın.** Betik parolayı hiç görmez; smoke profilinde tarayıcının parola kaydı kapalıdır.
- Smoke proje ve tarayıcı başına **kendi tarayıcı profilini** kullanır: günlük tarayıcın etkilenmez, girişi bir kez
  yaparsın. `--fresh` geçici profil kullanır; son ekrandaki "Çıkış yap ve profili temizle" profili siler.
- Planlar, koşular, raporlar ve profiller reponun dışında durur:
  `%LOCALAPPDATA%\guided-smoke` (Windows), `~/Library/Application Support/guided-smoke` (macOS),
  `~/.local/share/guided-smoke` (Linux) ya da `GUIDED_SMOKE_HOME`.
- Kayda giren: adım başlıkları, cevapların ve notların, otomatik kontrol metinleri, süreler. Girmeyen: sayfanın HTML'i,
  çerezler, form değerleri, kimlik bilgileri. Ekran görüntüsü yalnız sen istersen.

## Plan yazmak

Plan küçük bir JavaScript modülü; Claude yazar, sen düzenleyebilirsin. Bkz.
[references/writing-steps.md](references/writing-steps.md) ve [examples/example.steps.js](examples/example.steps.js).

## Geliştirme

```bash
node --test engine/test/engine.test.js     # tarayıcı gerekmez
node engine/run.js doctor
```

## Lisans

[MIT](LICENSE) © 2026 Ömer Soyer
