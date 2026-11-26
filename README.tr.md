# Robot Radyo 📻🤖

**Valetudo'lu robot süpürgeler için internet radyosu. Robotun kendi hoparlöründen çalar, Valetudo sayfasının içinde yandan açılan bir panelden yönetilir.**

[English](README.md)

> ⚠️ **Resmi değildir.** Bu proje [Valetudo](https://valetudo.cloud) ile bağlantılı değildir ve onlar tarafından desteklenmez. Sorularınız için lütfen Valetudo geliştiricilerine başvurmayın. Robotun ses ayarlarını değiştirir; kullanım sorumluluğu size aittir.

## Neler yapar

- **Valetudo'nun içinde radyo paneli.** Valetudo sayfanızı `8080` portundan açın, sağ kenardaki tutamacı çekin (Samsung Edge paneli gibi). Ses açma, kısma ve sessiz düğmeleri doğrudan tutamacın üstünde.
- **Dünyanın her yerinden radyo.** İstasyonlar açık [radio-browser.info](https://www.radio-browser.info) dizininden gelir (50.000'den fazla istasyon, 220'den fazla ülke). Ülkeye, türe ya da isme göre arayın, önizleyin ve favorilerinize ekleyin. Kendi yayın adresinizi de ekleyebilirsiniz.
- **İlk açılışta hazır liste.** Ülkenizi seçtiğinizde panel, dizinde en çok dinlenen radyolardan bir başlangıç listesi hazırlar. Listede "Popüler" grubu, tür grupları (Pop, Rock, Nostalji, Slow ve Sakin, Halk ve Yerel, Caz ve Klasik, Haber ve Spor, Dini) ve tanınmış birkaç yabancı caz, klasik ve sakin müzik radyosu bulunur. Az radyosu olan ülkelerde liste, aynı dildeki radyolarla tamamlanır. Her radyo arka planda sessizce ve en düşük öncelikle denenir. Çalışmayanın yerine aynı gruptan bir başkası konur. Listeyi istediğiniz zaman değiştirebilirsiniz.
- **15 dil.** English, Türkçe, Deutsch, Français, Español, Italiano, Português, Nederlands, Polski, Русский, Українська, العربية, 中文, 日本語, 한국어. Panel tarayıcının dilini kullanır, dil panelden de değiştirilebilir. Projenin asıl dilleri Türkçe ve İngilizcedir. Diğer 13 dilin metinleri bu arayüz için özel olarak yazıldı (otomatik çeviri aracı kullanılmadı), ama henüz o dili ana dili olarak konuşan biri tarafından kontrol edilmedi. Düzeltmeler memnuniyetle karşılanır; bütün metinler `robot/web/i18n.js` dosyasında.
- **Robotun kendi sesiyle uyumlu.** Robot ve radyo ses kartını paylaşır. Robot konuşurken radyo kısılır (yaklaşık −30 dB), sonra yavaşça eski sesine döner.
- **Temizliğe göre çalışır.** İsterseniz temizlik başlayınca radyo kendiliğinden açılır. Robot istasyonuna dönünce kapanır. Robot hata verirse (ör. fırça takıldı), robot uyarısını söyledikten sonra kapanır.
- **Kendini onaran istasyon listesi.** Favoriler radio-browser'daki kalıcı kimlikleriyle tutulur. Bir radyo yayın adresini değiştirirse yenisi kendiliğinden bulunur.
- **Kurulumdan sonra bulut, telefon uygulaması ya da bilgisayar gerekmez.** Her şey robotun içinde çalışır.

## Uyumluluk

| Robot | Durum |
|---|---|
| Roborock S5 (2. nesil), Valetudo 2026.x | ✅ test edildi |
| Xiaomi Mi Robot Vacuum (1. nesil), Valetudo | 🟡 aynı altyapı, test edilmedi |
| Diğer robotlar | ❌ henüz değil; "Başka robotlara uyarlama" bölümüne bakın |

Kurulum betiği önce robotu kontrol eder, uyumsuz bir robota kurulum yapmaz. Robota root olarak SSH ile bağlanabilmeniz gerekir. Valetudo'yu kurduysanız bu erişim zaten sizde vardır.

## Kurulum

Robota SSH ile bağlanabilen bir bilgisayarda (Linux, macOS, WSL ya da Windows'ta Git Bash):

```bash
git clone https://github.com/n920aziz-coder/robot-radyo.git
cd robot-radyo
bash install.sh --dry-run -i ~/.ssh/robot_anahtariniz 192.168.1.50   # isteğe bağlı: yalnızca kontrol eder, hiçbir şeyi değiştirmez
bash install.sh --reboot  -i ~/.ssh/robot_anahtariniz 192.168.1.50
```

Ardından `http://<robot-ip>:8080` adresini açın ve **Valetudo** kullanıcı adı ve şifrenizle girin. Sağ kenardaki tutamacı çekin, ülkenizi seçip **Listemi hazırla**'ya basın.

Kurulum betiği şunları yapar:

1. [Node.js](https://github.com/yao-pkg/pkg-fetch) ve [ffmpeg](https://johnvansickle.com/ffmpeg/) için statik derlemeleri, Ubuntu 14.04 arşivinden `aplay`/`amixer` araçlarını ve [curl.se](https://curl.se/docs/caextract.html)'den güncel sertifika listesini indirir. Her indirmeyi sabit ya da yayımlanmış bir doğrulama değeriyle kontrol eder.
2. Bunları ve uygulamayı firmware güncellemelerinden etkilenmeyen `/mnt/data/robot-radyo` klasörüne kopyalar.
3. `/etc/asound.conf` (ses kartı paylaşımı) ve `/etc/init/S12robotradyo` (açılışta başlatma) dosyalarını kurar.

**Robotu bir kez yeniden başlatın** (`--reboot`). Böylece robotun kendi ses programı paylaşılan ses kartını kullanmaya başlar. Yeniden başlatana kadar radyo çalarken robotun sesi duyulmaz.

Seçenekler: `--dir`, `--port` (varsayılan 8080), `-i ANAHTAR`, `--dry-run`, `--reboot`. İndirme kaynakları ortam değişkenleriyle (`NODE_URL`, `FFMPEG_URL`, `ALSA_DEB_URL`, …) değiştirilebilir; ayrıntılar `install.sh` dosyasının başında.

Kaldırmak için: `bash uninstall.sh -i ANAHTAR <robot-ip>`

## Nasıl çalışır

```
tarayıcı ──► :8080 Robot Radyo (Node.js) ──► :80 Valetudo        (Valetudo olduğu gibi aktarılır; sayfaya panel betiği eklenir)
                 │
                 ├─ ffmpeg (yayın → PCM) ─► aplay ─► "Radyo Ses" ─► "Radyo" ─► dmix ─► hoparlör
                 │                                     ses ayarı     kısma       ▲
                 │                                                               │
                 └─ robotun ses programını izler ──────────────────── robotun sesi ┘
```

- **Ses kartı paylaşımı:** Robotun ses kütüphanesi ALSA'nın `default` cihazını açar. `/etc/asound.conf` bu cihazı bir `dmix` karıştırıcıya yönlendirir, böylece robotun sesi ve radyo aynı anda çalabilir.
- **Ses ayarı ve kısma**, karıştırıcının hemen önündeki iki `softvol` kanalıyla yapılır. Bu yüzden değişiklikler yaklaşık 0,2 saniyede duyulur. Bir softvol kanalını, onu yaratan program çalıştığı sürece başkası değiştiremez. Bu nedenle kanallar açılışta kısa bir sessiz denemeyle önceden oluşturulur.
- **Robotun konuştuğu**, robotun ses programı (`RoboController`) ses kartını açtığında anlaşılır.
- **Temizlik başladı / istasyona vardı / hata** bilgisi Valetudo'nun kendi arayüzünden okunur. Bunun için sayfayı 8080'den açan kişinin oturumu kullanılır. Oturum bilgisi yalnızca bellekte tutulur, diske yazılmaz. Robot yeniden başladıktan sonra otomatik özellikler, sayfa 8080'den bir kez açılınca devreye girer. Temizliği o sayfadan başlatmak yeterlidir.
- Valetudo'nun **"yalnızca ev ağından erişim"** kuralı 8080 portunda da uygulanır.

## Kaynak kullanımı

Roborock S5 üzerinde (4 çekirdekli ARM Cortex-A7, 512 MB RAM), robot istasyondayken ölçüldü:

| | Radyo kapalı | Radyo çalarken |
|---|---|---|
| İşlemci, tüm işlemcinin yüzdesi | yaklaşık %0,3 | yaklaşık %2,4 (tek çekirdeğin yaklaşık %10'u) |
| RAM | 26–42 MB | 7 MB daha (ffmpeg ≈ 5,5 MB, aplay ≈ 1 MB) |
| `/mnt/data` içinde yer | 84 MB (Node.js 53 MB, ffmpeg 31 MB, uygulamanın kendisi 0,2 MB'tan az) | aynı |

Robot her zaman önce gelir:

- Robotun kendi programları en yüksek öncelikle çalışır (nice −20). Radyo nice 10 ile çalışır. İşlemci yoğun olduğunda zamanın neredeyse tamamı robota gider.
- Bellek biterse çekirdek önce radyoyu kapatır (`oom_score_adj` 1000). Robotun programlarına ve Valetudo'ya dokunmaz.
- Robotun kullanılabilir belleği 40 MB'ın altına inerse radyo kendini kapatır. Sunucunun kendi belleği olağandışı büyürse (100 MB'ın üstü) sunucu kendini yeniden başlatır.
- Ses verisi ffmpeg'den aplay'e doğrudan akar, Node.js'in içinden geçmez. Arka plandaki radyo denemeleri en düşük öncelikle çalışır (nice 19).
- Kayıt dosyası bellekte (`/tmp`) tutulur ve 256 KB ile sınırlanır. Ayarlar yalnızca siz değiştirdiğinizde kalıcı belleğe yazılır.
- Sunucu kendi ölçümlerini tutar; temizlik sırasında görülen en yüksek yük de bunlara dahildir. Giriş yapmışken `http://<robot-ip>:8080/robot-radyo/api/durum` adresini açıp `kaynak` bölümüne bakın.

## Gizlilik ve hukuki konular

- Arama yapmak ve bir radyoyu başlatmak radio-browser.info'ya bağlanır. Bir radyoyu başlattığınızda, dizinin uygulamalardan istediği gibi bu bir "tıklama" olarak bildirilir. Kişisel bilgi gönderilmez. Her radyo uygulamasında olduğu gibi robotun genel IP adresi dizine ve radyo istasyonuna görünür.
- Proje yalnızca istasyonların dinlenmesi için açıkça yayımladığı yayınları çalar. Kayıt yapmaz, yeniden yayınlamaz, hiçbir korumayı aşmaz. Depoda hazır bir istasyon listesi yoktur. Hazır liste, dizindeki güncel dinlenme sayılarına göre robotun üzerinde oluşturulur; kullanıcı onu dilediği gibi değiştirebilir.
- Her istasyonun kullanım koşullarına uyun. Dükkân, kafe gibi ticari bir mekânda radyo çalmak genellikle ayrı bir lisans gerektirir (Türkiye'de MESAM/MSG gibi).

## Başka robotlara uyarlama

Robota özel kısımlar az sayıda:

- İşlemciye uygun derlemeler (`NODE_URL`, `FFMPEG_URL`, armv7 için alsa-utils)
- Açılışta başlatma yöntemi (`/etc/init/rcS` → `S12robotradyo`)
- `robot/web/server.mjs` içindeki ses kartı ve süreç adları (`/dev/snd/pcmC0D0p`, `RoboController`)

Başka modeller için katkılar (pull request) memnuniyetle karşılanır.

## Teşekkürler

[radio-browser.info](https://www.radio-browser.info) · [Valetudo](https://valetudo.cloud) · John Van Sickle'ın [ffmpeg](https://ffmpeg.org) statik derlemeleri · [yao-pkg/pkg-fetch](https://github.com/yao-pkg/pkg-fetch) statik Node.js derlemeleri · ALSA / alsa-utils

## Lisans

MIT, bkz. [LICENSE](LICENSE). İndirilen üçüncü taraf programlar kendi lisanslarına tabidir (ffmpeg ve alsa-utils: GPL; Node.js: MIT). Bu programlar özgün kaynaklarından indirilir, bu depo tarafından dağıtılmaz.
