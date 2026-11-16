# Testçi kılavuzu

[English](testers.md)

Bir değişikliği ortak test sunucusunda test ediyorsun. Geliştirici o değişiklik için bir **plan** yazdı ve repoda,
kodun yanında tutuyor. Sen o planı koşarsın: tarayıcı her adımı yapar, bir panel ne yapıldığını ve ne görmen
gerektiğini söyler, sen cevap verirsin. Bu kılavuz bunun için gerekenleri anlatır; Claude'lu ya da Claude'suz.

## Gerekenler

- Node.js 20 ya da daha yenisi, ve Google Chrome ya da Microsoft Edge.
- Planların durduğu repo (çoğunlukla bir `smoke` klasörü) ve makinenden test sunucusuna erişim.
- Test veritabanını okuyan ya da değiştiren planlar için: `sqlcmd` ve o veritabanı için bir hesap (okuyabilen,
  yalnız planların yazdığı yere yazabilen bir hesap iste).
- guided-smoke'un kendisi, bir kez:

```bash
git clone https://github.com/omrsyr/guided-smoke ~/guided-smoke
node ~/guided-smoke/engine/run.js setup        # playwright-core veri klasörüne (tarayıcı indirilmez)
```

Açık npm kayıt defterine erişim yoksa [README](../README.tr.md#kurulum)'deki ilgili paragrafa bak.

Aşağıdaki komutlar uzun. Terminal başına bir kez kısa bir ad ver:

```bash
gsmoke() { node ~/guided-smoke/engine/run.js "$@"; }                                # bash, zsh
function gsmoke { node "$env:USERPROFILE\guided-smoke\engine\run.js" @args }        # PowerShell
```

Komutları reponun içinden çalıştır: klasörünün adı, koşularının tutulduğu projedir.

## Bir sunucudaki ilk koşudan önce

```bash
gsmoke doctor --base https://test01.corp.example/Orders
```

Adresi görünmeyen bir tarayıcıda bir kez açar ve şunları söyler: cevap veriyor mu, ne kadar sürdü, sertifikasına
güveniliyor mu, Windows girişi istiyor mu, giriş sayfasına mı götürüyor, hangi sunucu. Burada cevap vermiyorsa koşuda
da vermez.

## Tek bir planı koş

```bash
gsmoke run smoke/6655-machine-expiry.steps.js --env test
```

`--env test` planın test sunucusu ayarlarını seçer: adresi, test kayıtları, veritabanı. Sonra olanlar:

1. **Test veritabanı** (plan kullanıyorsa): önce ayrı bir sekme açılır ve hesabı sorar (plan sana bıraktıysa sunucuyu
   ve veritabanını da). Motor hesabı hemen dener, reddedilirse nedenini yazar. Hesap koşu bitene kadar bellekte
   kalır, hiçbir yere yazılmaz. **Veritabanı olmadan devam et**, ona ihtiyaç duyan adımları atlar.
2. **Giriş:** her zamanki gibi girişi sen yaparsın. Betik yalnız bekler. Smoke'un kendi tarayıcı profili vardır;
   sonraki koşuda girişin durur.
3. **Her adım:** betik işi yapar ve yeri turuncu çerçeveler; panel **ne yaptım** ve **ekranda görmen gereken**i
   yazar, bir otomatik kontrol gösterir. Sen cevap verirsin:
   - Ekran anlatıldığı gibiyse **✔ Doğru, devam**.
   - Değilse **✖ Farklı**: yerine ne gördüğünü kısaca yaz. Geliştiricinin okuduğu şey bu nottur; yalnız yanlış
     olduğunu değil, ekranda ne olduğunu söyle.
   - **■ Durdur** koşuyu bitirir. **📷** ekran görüntüsü kaydeder. **Küçült** paneli yoldan çeker.
   - Otomatik kontrol ✖ verdiyse ✔ ikinci bir tıklama ister. Yalnız ekran gerçekten doğruysa kullan; rapor böyle
     adımları işaretler ve büyük olasılıkla planın düzeltilmesi gerekir.
   - Panel adımın altında ekranda görünmeyeni de gösterir: JS hataları, konsol hataları, başarısız istekler. Böyle
     bir satırı olan ✔ adımını da geliştiriciye söylemeye değer.
4. **Sayfanın dışında bir şeyi değiştiren adımlar** (bir veritabanı satırı, bir iş) önce sorar: **Evet / Atla /
   Durdur**. Kendi makinen olmayan bir sunucuda, koşuyu `--allow-remote-writes` ile başlatmadıysan atlanırlar. Bunu
   test sunucusunda, planın yazarı adımların orada güvenli olduğunu söylediyse kullan; canlıda asla. Geri alması olan
   adım değişikliğini koşu bitince, ■ Durdur'dan sonra da geri alır.
5. **Kapanış ekranı** geçenleri ve farklı olanları sayar. **Kapat** girişini sonraki koşu için tutar; **Çıkış yap ve
   profili temizle** siler.

Terminal sonra raporun yerini yazar.

## Bütün klasörü koş (suite)

```bash
gsmoke run smoke/ --env test
```

Klasördeki her plan, adlarının sırasıyla (`01-…`, `02-…`) art arda koşulur.

- Bütün planlar tarayıcı açılmadan denetlenir. Biri koşulamıyorsa hiçbir şey başlamaz ve her sorun adıyla yazılır:
  düzeltmek planın yazarının işidir.
- Her plan kendi tarayıcı penceresini açar; panelin başlığı nerede olduğunu söyler: "Plan 2/5 · Smoke 3 / 9".
  Pencereler smoke profilini paylaşır: girişi ilk plan için yaparsın, sonraki planlar seni girişli bulur (girişi yalnız
  pencere açıkken süren bir uygulama yeniden sorar).
- İki plan arasında bir ekran sıradakinin adını verir: **▶ Sonraki plan** devam eder, **■ Suite'i durdur** orada
  bitirir.
- Bir adımdaki **■ Durdur** ya da pencereyi kapatmak bütün suite'i bitirir; ulaşılmayan planlar raporda "koşulmadı"
  görünür. Bozulan plan (sayfası cevap vermiyor) yalnız kendisi biter, sıradaki plan koşulur.
- Veritabanı hesabı bir kez sorulur. Aynı veritabanını kullanan sonraki planlar onu kullanır; suite bitince unutulur.
- Sonunda terminal `suite report:` ile raporun yolunu yazar.

## Raporu oku

Her koşu bir `report.md` yazar: sonuç, adım başına cevabın ve notun, tarayıcının hata bildirdiği adımlar, neyin geri
alındığı ve neyin alınmadığı, adım bu sunucuda son koşulduğundan beri ne değişti, ve **iş kaydına yapıştırmak için**
bir blok. O bloğu iş kaydına sen kopyalarsın.

Suite, planlarının hepsi için bir rapor daha ekler: plan başına bir satır, nerede durdurulduğu, koşulmayan ve bozulan
planlar, her ✖ notuyla, ve test döngüsünün kaydına yapıştırılacak bir blok.

Önce üç şeye bak: ✖ adımlar; "geri alınmadı" yazan satırlar (test verisinde bir değişiklik duruyor: satırda yazanı
elle yap ya da planın yazarına söyle); hatayla biten planlar.

Raporlar, ekran görüntüleri ve kayıtlar makinende kalır. Bir kayıt (`--video`, `--trace`) ekranda görüneni gösterir
ve oturumu taşır: iş kaydına ekleme.

## Düzeltmeden sonra

```bash
gsmoke run 6655 --env test --retry-failed      # yalnız bu sunucuda son kez ✖ verdiğin adımlar
gsmoke report 6655                              # son raporu yeniden
gsmoke list                                     # planlar ve koşular
```

`6655` iş kaydıdır: o işin tek planını bulur. Hiçbir koşunun üzerine yazılmaz; yeni rapor neyin değiştiğini söyler
(`✖ → ✔`).

## İstersen daha fazlası

- `--network`: her adımın altında ağın yaptıkları da (yavaş ya da tekrarlanan çağrı, bir yanıtta gizli ya da kişisel
  veri); rapora sunucunun güvenlik başlıkları ve çerezleri için bir bölüm eklenir. Test sunucusunda işe yarar.
- `--probe`: planın patlatma adımlarını koşar; bunlar bir form alanına deneyimli bir testçinin deneyeceği sınır ve
  yanlış değerleri gönderir, her birinin neye yol açtığını tek tabloda gösterir.
- `--pace normal|fast`, `--screens diff` (her ✖ için ekran görüntüsü), `--auto` (kontrolü geçen adım kendiliğinden
  geçer; daha önce elle koştuğun bir şeyin ikinci koşusu için).

## Claude Code ile

Yukarıdakilerin hepsi sorarak da olur: "smoke klasörünü test sunucusunda koş" ya da
`/guided-smoke run smoke/ --env test`. Claude koşuyu başlatır, bekler, raporu okur ve ne anlama geldiğini söyler.

Geliştirici plan bırakmadıysa Claude iş kaydından plan da yazar (`/guided-smoke plan 6655`). İş kaydını, ona bağlı
commit'leri ve repoyu okur; hiçbir şey koşmadan önce planı sana gösterir. Orada iki şeye bak:

- Her beklentinin nereden geldiği işaretlidir: 📋 iş kaydı, 🔧 kod, 👤 sen, ❓ varsayım. Çoğu 🔧 olan bir plan, kodun
  kodun dediğini yaptığını denetler. ❓ olanları oku ve düzelt: ne istendiğini sen bilirsin.
- Kapsama tablosu her kabul kriterini, onu kapsayan adımlarla ya da smoke'un onu neden dışarıda bıraktığıyla listeler.

## Smoke'a hazır iş kaydı

Bir plan kabul kriterlerinden fazlasına ihtiyaç duyar. İş kaydına yazılan beş kısa satır bir tur soruyu kurtarır:

- **Nerede:** değişikliğin göründüğü menü yolu ya da ekran.
- **Kim:** onu gören roller ve her biri için test hesabı var mı.
- **Test verisi:** kullanılacak kayıtlar, ya da smoke kendi kaydını mı oluşturacak, ve nasıl tanınacakları.
- **Sayfanın dışı:** değişikliğin başka yere yazdıkları (bir tablo, bir e-posta, bir iş) ve testin onu nasıl geri
  alacağı.
- **Smoke dışı:** hiçbir ekranın göstermediği kriterler.

## Ortak sunucuda

- Yalnız planın test kayıtlarını kullan. Plan, yazarının seçtiği kayıtlarda çalışır; onu gerçek veriye yöneltme.
- Her şeyi bulduğun gibi bırak. Adımların geri alması bunun içindir; raporun "Geri alma" bölümüne bak.
- Veritabanı hesabını yalnız motorun kendi sekmesine, giriş bilgini yalnız uygulamanın kendi sayfasına yaz. İkisini
  de bir plana, bir komuta ya da sohbete asla yazma.
- Plan, makinende senin yetkilerinle çalışan koddur. Ekibinin reposunda duran, orada incelenmiş planları koş.

## Bir şey ters giderse

| Gördüğün | Yap |
|---|---|
| `The plan has no environment "test"` | Plan o sunucu için hazırlanmamış: mesaj sahip olduğu ortamları sayar. Yazarından eklemesini iste. |
| `No address: pass --base …` | `--env test` ekle; ortamı olmayan plan için `--base https://…`. |
| `The suite was not started: …` | Her satır bir planı ve sorununu söyler. Hiçbir şey koşmadı. |
| `The smoke profile is already open in another browser window` | Önceki koşunun penceresini kapat, yeniden koş. |
| Giriş yaptıktan sonra panel hâlâ "Önce giriş yap" diyor | Plan bu sunucunun giriş sayfalarını tanımıyor: yazarına söyle (ortamdaki `login`). |
| Windows girişli sunucuda sayfa hemen düşüyor | Ortama `signIn: 'windows'` gerekir; `doctor --base` bunu söyler. |
| Veritabanı sekmesi hesabı reddediyor | Nedenini yazar: kullanıcı adı ya da parola, veritabanı, ağ, ya da `sqlcmd` yok. |
| Adımlar "uzak adres" diye atlanıyor | Veri değiştiriyorlar ve sunucu senin makinen değil: amaç buysa `--allow-remote-writes`. |
| Otomatik kontrol ✖ ama ekran doğru | İki kez ✔, ve planın yazarına söyle: yanlış olan plan, uygulama değil. |
| Pencereyi yanlışlıkla kapattın | Yeniden koş: yeni bir koşudur. Önceki adımların değişiklikleri yerindeyse `--from 7` 7. adımdan başlar. |
