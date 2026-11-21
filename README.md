# 🐶 Daily Chinese with Doggy · AI Chinese Content Manager

> © 2026 Narzullaev Umidjon. **Barcha huquqlar himoyalangan** — kod, matnlar, kartalar va "Doggy" personaji ruxsatsiz nusxalanmasin. Batafsil: [LICENSE](LICENSE).
>
> 📘 Kundalik foydalanish bo'yicha qo'llanma: **[QOLLANMA.md](QOLLANMA.md)** · Kanal: https://t.me/+WryvE8qgdH5kMTYy

Telegram kanal uchun xitoy tili kontentini tayyorlash, rejalashtirish va **avtomatik nashr qilish** tizimi.
Hammasi bepul: **GitHub Pages** (dashboard) + **GitHub Actions** (avtomatik yuborish) + **Telegram Bot API**.

- Dashboard: `https://<username>.github.io/<repo>/`
- Postlar har kuni **09:00, 11:00, 13:00, 15:00, 17:00, 19:00** (Asia/Tashkent) da kanalga chiqadi — kuniga 6 ta.
- Kontent Claude chatida tayyorlanadi va JSON qilib import qilinadi — pullik AI API kerak emas.

---

## Qanday ishlaydi

```
Claude chat ──JSON──▶ Dashboard (brauzer) ──posts.json eksport──▶ GitHub repo
                                                                     │
                                         GitHub Actions (har 2 soatda)│
                                                                     ▼
                                                        Telegram kanal ✅
                                     published.json + status.json ◀──┘ (commit)
```

| Fayl | Vazifasi |
|---|---|
| `data/posts.json` | Barcha postlar va ularning statusi |
| `data/published.json` | Yuborilgan postlar ro'yxati — **qayta yuborishdan himoya** shu fayl orqali |
| `data/status.json` | Oxirgi ishga tushish holati (dashboarddagi "Telegram holati") |
| `scripts/publish.py` | Telegram'ga yuboruvchi skript (faqat Python standart kutubxonasi) |
| `.github/workflows/publish.yml` | Jadval bo'yicha publish.py ni ishga tushiradi |
| `.github/workflows/deploy.yml` | Saytni GitHub Pages'ga joylaydi |
| `prompts/content_prompt.md` | Claude'dan kontent so'rash uchun shablon |

Statuslar: **Draft** (qoralama) → **Approved** (tasdiqlangan) → **Scheduled** (rejalashtirilgan) → **Published** / **Failed**.
Faqat *Approved* yoki *Scheduled* va vaqti kelgan postlar yuboriladi.

---

## O'rnatish

### 1. Repository yaratish
GitHub → **New repository** → nom (masalan `chinese-content-manager`) → **Public** → Create.
> Bepul GitHub Pages faqat public repo bilan ishlaydi. Shuning uchun `posts.json` dagi kelgusi postlar ham ochiq ko'rinadi.

### 2. Fayllarni yuklash
Repo sahifasida **Add file → Upload files** → shu papkadagi barcha fayl va papkalarni tashlang → **Commit changes**.
(`.github` papkasi ham yuklanishi shart. Agar yashirin papka ko'rinmasa, terminaldan `git push` qiling.)

### 3. GitHub Pages'ni yoqish
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
So'ng **Actions → Deploy GitHub Pages → Run workflow**. 1–2 daqiqadan keyin sayt ochiladi.

### 4. Telegram bot yaratish
1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing → `/newbot`.
2. Bot nomi va username bering (oxiri `bot` bilan tugashi kerak).
3. BotFather bergan **token**ni saqlab qo'ying (masalan `123456:ABC...`). Uni hech kimga ko'rsatmang.

### 5. Botni kanalga administrator qilish
Kanal → **Administrators → Add Admin** → botingizni toping → kamida **Post Messages** huquqini bering.

### 6. Kanal ID'ni aniqlash
- Ochiq kanal bo'lsa: `@kanal_username` (masalan `@xitoy_tili_kanal`).
- Yopiq kanal bo'lsa: kanaldagi istalgan postni [@userinfobot](https://t.me/userinfobot) yoki [@getidsbot](https://t.me/getidsbot) ga forward qiling — `-100...` bilan boshlanadigan raqam chiqadi.

### 7. GitHub Secrets
**Settings → Secrets and variables → Actions → New repository secret**:

| Nomi | Qiymati |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_CHANNEL_ID` | `@kanal_username` yoki `-100...` |

Token faqat GitHub Actions ichida ishlatiladi — dashboard yoki brauzerga hech qachon chiqmaydi.

### 8. Actions ruxsatlari
**Settings → Actions → General**:
- *Actions permissions*: **Allow all actions**.
- *Workflow permissions*: **Read and write permissions** → Save.

### 9. Tekshirish
**Actions → Publish to Telegram → Run workflow → dry_run ✅** → Run.
Logda `Bot tekshiruvi` va `Kanal` xatosiz o'tsa, dashboarddagi **Telegram holati** yashil bo'ladi.
Keyin dry_run'siz ishga tushirsangiz, vaqti kelgan postlar haqiqatan yuboriladi.

---

## Kundalik ish tartibi

1. **Import / Prompt** sahifasida sana oralig'i va turlarni tanlang → **Promptni yaratish** → nusxa oling.
2. Promptni Claude chatiga yuboring. Javobdagi JSON'ni nusxalab, **JSON import** maydoniga qo'ying.
3. **Tekshirish** → xatolar, pinyin ogohlantirishlari va takrorlarni ko'ring → **Import qilish**.
4. **Postlar** yoki **Editor** da matnni o'qib chiqing, kerak bo'lsa tuzating, pinyinni tekshiring.
5. **Tasdiqlash** yoki **Rejalashtirish** bosing. **Kalendar** da postlarni sudrab boshqa kunga o'tkazish mumkin. **Avto-taqsimlash** vaqtsiz tasdiqlangan postlarni bo'sh slotlarga joylaydi.
6. **Eksport** sahifasida `posts.json` ni yuklab oling va GitHub'da `data/` papkasiga yuklang (**Add file → Upload files → Commit**).
7. Tamom — GitHub Actions postlarni o'z vaqtida kanalga yuboradi.

> Muhim: brauzerdagi o'zgarishlar repo'ga yuklanmaguncha kanalga ketmaydi. Saqlanmagan o'zgarish bo'lsa, yuqorida sariq banner chiqadi.

---

## Kanal havolasi

Har bir post oxiriga kanal havolasi avtomatik qo'shiladi. Uni `data/config.json` faylida o'zgartirasiz:

```json
{
  "channel_link": "https://t.me/+WryvE8qgdH5kMTYy",
  "footer_text": "Daily Chinese with Doggy 🐶 — obuna bo'ling"
}
```

`channel_link` bo'sh qoldirilsa, havola qo'shilmaydi.

## Rasm qo'shish

1. Rasmni GitHub'da `assets/images/` papkasiga yuklang (**Add file → Upload files**).
2. Editorda **Rasm** maydoniga yo'lini yozing: `assets/images/chunjie.jpg`. Internetdagi rasm manzilini (`https://...`) ham qo'yish mumkin.
3. Preview'da rasm ko'rinadi. Matn 1024 belgigacha bo'lsa, rasm va matn bitta xabar bo'lib ketadi; uzunroq bo'lsa, avval rasm, keyin matn alohida yuboriladi.

## Muhim eslatmalar

- **Cron kechikishi.** GitHub jadvaldagi ishlarni ba'zan 5–30 daqiqa, yuklama yuqori bo'lsa undan ko'p kechiktiradi. Har 2 soatlik ishga tushish oldingisidan qolgan postni ham yuboradi, 19:30 da esa kunlik zaxira ishga tushish bor. Vaqti kelgan post 12 soat ichida baribir yuboriladi; 12 soatdan eskirganlari avtomatik yuborilmaydi va dashboardda "muddati o'tgan" deb ko'rinadi.
- **Qayta yuborishdan himoya.** Har bir yuborilgan post ID'si `published.json` ga yoziladi. Eski `posts.json` ni qayta yuklasangiz ham, yuborilgan post ikkinchi marta ketmaydi. Workflow'da `concurrency` ham bor — ikki nusxa bir vaqtda ishlamaydi.
- **Bir ishga tushishda ko'pi bilan 2 ta post** yuboriladi (eng eskisidan boshlab).
- **Failed post.** Xato matni postda va dashboardda ko'rinadi. Matnni tuzating va qayta rejalashtiring.
- **Telegram limiti.** Bitta xabar 4096 belgidan oshmasligi kerak — editor hisoblagichi buni ko'rsatadi.
- **60 kunlik qoida.** Public repo'da 60 kun hech qanday faollik bo'lmasa, GitHub jadvalni o'chiradi. Workflow har ishga tushishda `status.json` ni commit qiladi, shuning uchun bu odatda muammo bo'lmaydi. O'chib qolsa: Actions → Publish to Telegram → **Enable workflow**.
- **Vaqtni o'zgartirish.** Vaqtlar `data/config.json` dagi `slots` ro'yxatida. O'zgartirsangiz, `.github/workflows/publish.yml` dagi `cron` qatorini ham yangilang: Toshkent vaqti − 5 soat = UTC (09:00 → 4, 11:00 → 6 ...).
- **Hozir yuborish.** Postlar ro'yxatida yoki editorda ⚡ tugmasi → GitHub'da Publish to Telegram → Run workflow → post ID → Run.

## Muammolar va yechimlar

| Belgi | Sabab va yechim |
|---|---|
| "Secrets sozlanmagan" | 7-qadamni bajaring, nomlar aynan `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` bo'lsin |
| "Bot tekshiruvi muvaffaqiyatsiz: Unauthorized" | Token noto'g'ri — BotFather'dan `/token` bilan qayta oling |
| "Kanal topilmadi" / "chat not found" | Bot kanalga admin qilinmagan yoki kanal ID noto'g'ri |
| "Forbidden: bot is not a member" | Botni kanalga administrator qiling (5-qadam) |
| "can't parse entities" | Qo'lda yozilgan matnda yopilmagan teg bor yoki `<` belgisi ochiq qolgan |
| Push xatosi (403) | 8-qadam: Workflow permissions → Read and write |
| Sayt eski ma'lumotni ko'rsatyapti | Sahifadagi ↻ tugmasi yoki Eksport → "Serverdan yangilash" |

## Kanal sozlamalari

Kanal nomi, tavsifi, rasmi va pin qilingan salomlashish posti `data/channel.json` da saqlanadi va
**Actions → Kanal sozlamalari → Run workflow** orqali bot yordamida o'rnatiladi (`scripts/channel_setup.py`).
Bot kanalda "Change channel info" va "Pin messages" huquqlariga ega bo'lishi kerak. Batafsil — [QOLLANMA.md](QOLLANMA.md#7-kanal-sozlamalari-nom-tavsif-rasm-salomlashish-posti).

## Mualliflik huquqi

Repo faqat GitHub Pages va Telegram bot ishlashi uchun ochiq. Bu foydalanishga ruxsat emas:
barcha materiallar muallifning yozma ruxsatisiz nusxalanishi, tarqatilishi yoki tijoratda ishlatilishi mumkin emas.
To'liq shartlar — [LICENSE](LICENSE). Bog'lanish: narzullayevumidjon976@gmail.com

## Mahalliy sinov

```bash
python3 -m http.server 8000         # http://localhost:8000
python3 scripts/publish.py --dry-run --result-out /tmp/r.json
```

---

© 2026 Narzullaev Umidjon (吴敏俊). Barcha huquqlar himoyalangan.
