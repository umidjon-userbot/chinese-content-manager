# 🐶 Daily Chinese with Doggy — foydalanish qo'llanmasi

Bu qo'llanma kanalni yurituvchi uchun: postlar qanday tayyorlanadi, rejalashtiriladi, rasm qanday ulanadi va kanal qanday sozlanadi.
O'rnatish (bot, token, GitHub sozlamalari) bo'yicha ma'lumot — [README.md](README.md) da.

**Dashboard:** https://umidjon-userbot.github.io/chinese-content-manager/
**Kanal:** https://t.me/+WryvE8qgdH5kMTYy

---

## 1. Tizim qanday ishlaydi — 30 soniyada

1. Postlar `data/posts.json` faylida saqlanadi (hozir 300 ta HSK1 so'zi + boshqa turdagi postlar).
2. GitHub Actions har kuni **09:00, 11:00, 13:00, 15:00, 17:00, 19:00** da vaqti kelgan postni kanalga yuboradi.
3. Yuborilgan post `data/published.json` ga yoziladi — bir post **hech qachon ikki marta ketmaydi**.
4. Dashboard — postlarni ko'rish, tahrirlash va rejalashtirish uchun panel. U brauzeringizda ishlaydi; o'zgarishlar **Eksport** qilinib GitHub'ga yuklanmaguncha kanalga ta'sir qilmaydi.

---

## 2. Kundalik ish: nimani tekshirish kerak

| Qachon | Nima qilinadi |
|---|---|
| Ertalab | Dashboard → **Dashboard** sahifasida "Telegram holati" yashil ekanini ko'ring |
| Hafta boshida | **Kalendar** da kelgusi 7 kun to'liqligini tekshiring |
| Post chiqmasa | GitHub → **Actions → Publish to Telegram** → oxirgi ishga tushish logini oching |

Odatda hech narsa qilish shart emas — jadval o'zi ishlaydi.

---

## 3. Yangi post qo'shish

### A) Claude chat orqali (tavsiya etiladi)
1. Dashboard → **Import / Prompt** → sana oralig'i va post turlarini tanlang → **Promptni yaratish** → nusxa oling.
2. Promptni Claude chatiga yuboring. Javobdagi JSON'ni nusxalang.
3. **JSON import** maydoniga qo'ying → **Tekshirish** → xato va ogohlantirishlarni ko'ring → **Import qilish**.

### B) Qo'lda
Dashboard → **Postlar** → **+ Yangi post** → maydonlarni to'ldiring → **Saqlash**.

### Har doim oxirida: Eksport
1. **Eksport** → `posts.json` ni yuklab oling.
2. GitHub → `data` papkasi → **Add file → Upload files** → faylni tashlang → **Commit changes**.
3. Tepadagi sariq **"Eksport kerak"** yozuvi yo'qolsa — hammasi saqlangan.

> ⚠️ Eksport qilinmagan o'zgarish faqat sizning brauzeringizda qoladi va kanalga ketmaydi.

---

## 4. Rejalashtirish

- **Statuslar:** Qoralama → Tasdiqlangan → Rejalashtirilgan → Nashr qilingan / Xato.
- Faqat **Tasdiqlangan** yoki **Rejalashtirilgan** va vaqti kelgan postlar yuboriladi.
- **Kalendar** da postni sudrab boshqa kunga o'tkazish mumkin.
- **⚡ Avto-taqsimlash** vaqtsiz postlarni bo'sh slotlarga joylaydi (kuniga 6 ta).
- Vaqti kelgan post 12 soat ichida baribir yuboriladi; 12 soatdan eskirgani avtomatik ketmaydi.

---

## 5. Hozir yuborish (⚡)

1. Postlar ro'yxatida **⚡** tugmasini bosing — post ID nusxalanadi.
2. Ochilgan GitHub sahifasida **Run workflow** → `post_id` maydoniga ID ni qo'ying → **Run workflow**.
3. 1 daqiqada post kanalda bo'ladi.

> Allaqachon yuborilgan postni qayta yuborib bo'lmaydi (himoya). Logda "allaqachon yuborilgan" yozuvi chiqadi.

---

## 6. Rasmlar va kartalar

- 300 ta HSK1 kartasi `assets/images/hsk1-001.jpg … hsk1-300.jpg` da turibdi va postlarga ulangan.
- Boshqa postga rasm qo'shish: rasmni `assets/images/` ga yuklang → Editorda **Rasm** maydoniga `assets/images/nomi.jpg` yozing.
- Matn 1024 belgigacha bo'lsa, rasm va matn bitta xabar bo'ladi; uzunroq bo'lsa — rasm, keyin matn alohida.
- Rasm faqat GitHub'ga yuklangandan keyin kanalda ko'rinadi.

---

## 7. Kanal sozlamalari (nom, tavsif, rasm, salomlashish posti)

Hammasi `data/channel.json` faylida:

| Maydon | Nima |
|---|---|
| `title` | Kanal nomi |
| `description` | Kanal tavsifi (255 belgigacha) |
| `photo` | Kanal rasmi (`assets/channel/avatar.jpg`) |
| `welcome_text`, `welcome_image` | Yangi obunachilar uchun pin qilinadigan post |

O'zgartirish tartibi:
1. GitHub'da `data/channel.json` ni oching → ✏️ → tahrirlang → **Commit changes**.
2. **Actions → Kanal sozlamalari → Run workflow** → maydonga kerakli qismlarni yozing:
   - `title,description` — faqat nom va tavsif;
   - `photo` — faqat rasm;
   - `welcome` — yangi salomlashish postini yuborib pin qilish.
3. **Run workflow**.

> Telegram botlarga har bir yangi a'zoga alohida xabar yozishga ruxsat bermaydi, shuning uchun salomlashish pin qilingan post sifatida turadi.

Har bir post ostidagi havola matni `data/config.json` dagi `footer_text` da.

---

## 8. Muammolar

| Belgi | Yechim |
|---|---|
| Dashboard'da vaqtlar eski | Cmd+Shift+R (Windows: Ctrl+Shift+R). Bo'lmasa: **Sozlamalar → Repo'dagi versiyani qayta yuklash** |
| "Eksport kerak" ketmayapti | Eksport → `posts.json` ni `data/` ga yuklang |
| Post rasmsiz ketdi | Postda **Rasm** maydoni bo'shmi yoki rasm GitHub'ga yuklanganmi — tekshiring |
| Post o'z vaqtida chiqmadi | GitHub cron 5–30 daqiqa kechikishi mumkin — normal holat |
| Post "Xato" holatida | Xato matnini o'qing, tuzating va qayta rejalashtiring |
| Jadval umuman ishlamayapti | Actions → Publish to Telegram → **Enable workflow** |

---

## 9. Xavfsizlik va mualliflik huquqi

- Bot tokeni faqat **GitHub Secrets** da. Uni hech qachon chatga, faylga yoki dashboardga yozmang. Token oshkor bo'lsa — @BotFather → `/revoke`, keyin yangisini Secrets'ga qo'ying.
- Repo texnik sabablarga ko'ra ochiq, lekin barcha kontent himoyalangan — [LICENSE](LICENSE) ga qarang.
- Kartalarda "Daily Chinese with Doggy" mualliflik belgisi bor — uni olib tashlamang.

---

© 2026 Narzullaev Umidjon. Barcha huquqlar himoyalangan.
