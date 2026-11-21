#!/usr/bin/env python3
"""Kunlik Telegram quiz: o'sha kuni kanalga chiqqan HSK so'zlaridan 3 ta savol.

python3 scripts/quiz.py [--dry-run] [--count 3] [--force]
Savol turlari: 汉字→tarjima, tarjima→汉字, 汉字→pinyin, gapdagi bo'sh joy.
Bir kunda ikki marta yuborilmaydi (data/quiz_log.json). Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID.
"""
import argparse, json, os, random, re, sys, time, unicodedata, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TZ = timezone(timedelta(hours=5))  # Asia/Tashkent
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHAT = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
TYPES = ["hanzi2uz", "uz2hanzi", "hanzi2py", "blank"]


def load(name, default):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def log(msg):
    print(str(msg).replace(TOKEN, "***") if TOKEN else msg, flush=True)


def tg(method, payload):
    req = urllib.request.Request(f"https://api.telegram.org/bot{TOKEN}/{method}",
                                 data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r)
        except urllib.error.HTTPError as e:
            res = json.load(e)
        if res.get("ok"):
            return res["result"]
        ra = (res.get("parameters") or {}).get("retry_after")
        if ra and attempt < 2:
            time.sleep(ra + 1); continue
        raise RuntimeError(f"{method}: {res.get('description')}")


# ---------- pinyin ohang variantlari ----------
TONES = {"a": "āáǎà", "o": "ōóǒò", "e": "ēéěè", "i": "īíǐì", "u": "ūúǔù", "ü": "ǖǘǚǜ"}
MARK = {m: (b, i + 1) for b, ms in TONES.items() for i, m in enumerate(ms)}


def retone(py, rng):
    """Bir yoki ikki bo'g'inning ohangini o'zgartirib, noto'g'ri variant yasaydi."""
    chars = list(unicodedata.normalize("NFC", py))
    idx = [i for i, c in enumerate(chars) if c.lower() in MARK]
    if not idx:  # neutral ohang (ba, ma, ne...) — asosiy unliga ohang qo'yamiz
        low = "".join(chars).lower()
        pos = next((low.find(v) for v in "aoe" if v in low), -1)
        if pos < 0:
            vs = [i for i, c in enumerate(low) if c in "iuü"]
            pos = vs[-1] if vs else -1
        if pos < 0:
            return None
        chars[pos] = TONES[low[pos]][rng.randrange(4)]
        return "".join(chars)
    for i in rng.sample(idx, k=min(len(idx), rng.choice([1, 1, 2]))):
        base, t = MARK[chars[i].lower()]
        nt = rng.choice([x for x in (1, 2, 3, 4) if x != t])
        new = TONES[base][nt - 1]
        chars[i] = new.upper() if chars[i].isupper() else new
    return "".join(chars)


def short_uz(s):
    s = re.sub(r"\s*\(.*?\)", "", s or "").split(";")[0].strip(" .")
    return s[:95]


# ---------- savollar ----------
def make_question(word, pool, qtype, rng):
    others = [w for w in pool if w["hanzi"] != word["hanzi"]]
    rng.shuffle(others)
    uz = short_uz(word.get("translation_uz"))
    if qtype == "blank":
        ex = [e for e in word.get("examples") or [] if word["hanzi"] in (e.get("zh") or "")]
        if not ex:
            qtype = "hanzi2uz"
        else:
            e = rng.choice(ex)
            gap = e["zh"].replace(word["hanzi"], "＿＿", 1)
            q = f"Bo'sh joyga qaysi so'z mos keladi?\n\n{gap}\n({e.get('uz', '').strip()})"
            same_len = [w["hanzi"] for w in others if len(w["hanzi"]) == len(word["hanzi"])]
            wrong = (same_len + [w["hanzi"] for w in others])
            opts = [word["hanzi"]] + [h for h in dict.fromkeys(wrong) if h not in e["zh"]][:3]
            expl = f"{word['hanzi']} ({word['pinyin']}) — {uz}"
            return q, opts, expl
    if qtype == "hanzi2uz":
        q = f"«{word['hanzi']}» ({word['pinyin']}) so'zining ma'nosi qaysi?"
        opts = [uz] + [o for o in dict.fromkeys(short_uz(w.get("translation_uz")) for w in others) if o and o != uz][:3]
    elif qtype == "uz2hanzi":
        q = f"«{uz}» xitoychada qanday yoziladi?"
        opts = [word["hanzi"]] + [h for h in dict.fromkeys(w["hanzi"] for w in others)][:3]
    else:  # hanzi2py
        q = f"«{word['hanzi']}» qanday o'qiladi? (ohangiga e'tibor bering)"
        wrong = []
        for _ in range(30):
            v = retone(word["pinyin"], rng)
            if v and v != word["pinyin"] and v not in wrong:
                wrong.append(v)
            if len(wrong) == 3:
                break
        wrong += [w["pinyin"] for w in others if w["pinyin"] not in wrong][: 3 - len(wrong)]
        opts = [word["pinyin"]] + wrong[:3]
    expl = f"{word['hanzi']} ({word['pinyin']}) — {uz}"
    return q, opts, expl


def pick_words(posts, published, today, count):
    by_id = {p["id"]: p for p in posts}
    items = [i for i in published if i.get("id") in by_id and by_id[i["id"]].get("type") == "hsk"]
    items.sort(key=lambda i: i.get("sent_at") or "")
    todays = [by_id[i["id"]] for i in items if (i.get("sent_at") or "")[:10] == today and i["id"] in by_id]
    if len(todays) < count:  # yetmasa — oxirgi chiqqanlardan to'ldiramiz
        recent = [by_id[i["id"]] for i in reversed(items) if by_id[i["id"]] not in todays]
        todays += recent[: count - len(todays)]
    return todays


def main():
    global TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--force", action="store_true", help="bugun yuborilgan bo'lsa ham qayta yuborish")
    ap.add_argument("--date", default=os.environ.get("QUIZ_DATE", "").strip(), help="YYYY-MM-DD — boshqa kun so'zlaridan quiz")
    a = ap.parse_args()

    now = datetime.now(TZ)
    today = a.date or now.strftime("%Y-%m-%d")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", today):
        log(f"::error::Sana noto'g'ri: {today}"); sys.exit(1)
    qlog = load("quiz_log.json", {"days": {}})
    if today in qlog["days"] and not a.force and not a.dry_run:
        log(f"Bugungi quiz allaqachon yuborilgan ({today})"); return

    posts = load("posts.json", {"posts": []})["posts"]
    published = load("published.json", {"items": []})["items"]
    pool = [p for p in posts if p.get("type") == "hsk" and p.get("hanzi") and p.get("pinyin")]
    words = pick_words(posts, published, today, a.count)
    if not words:
        log("Hali HSK so'zlari chiqmagan — quiz yo'q"); return

    rng = random.Random(today)
    rng.shuffle(words)
    words = words[: a.count]
    start = rng.randrange(len(TYPES))
    questions = []
    for n, w in enumerate(words):
        q, opts, expl = make_question(w, pool, TYPES[(start + n) % len(TYPES)], rng)
        correct = opts[0]
        opts = [o[:100] for o in opts]
        rng.shuffle(opts)
        questions.append({"id": w["id"], "question": f"🧠 {n + 1}/{len(words)} · {q}"[:300],
                          "options": opts, "correct": opts.index(correct[:100]), "explanation": expl[:200]})

    for qq in questions:
        log(f"\n{qq['question']}\n  " + "\n  ".join(("✅ " if i == qq["correct"] else "   ") + o for i, o in enumerate(qq["options"])))
    if a.dry_run:
        log("\n(dry-run — hech narsa yuborilmadi)"); return
    if not TOKEN or not CHAT:
        log("::error::TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHANNEL_ID yo'q"); sys.exit(1)

    tg("sendMessage", {"chat_id": CHAT, "parse_mode": "HTML",
                       "text": "🐶 <b>Kunlik test!</b> 每日小测验\nBugungi so'zlarni qanchalik eslab qoldingiz? 👇"})
    sent = []
    for qq in questions:
        msg = tg("sendPoll", {"chat_id": CHAT, "question": qq["question"],
                              "options": [{"text": o} for o in qq["options"]],
                              "type": "quiz", "correct_option_id": qq["correct"],
                              "explanation": qq["explanation"], "is_anonymous": True})
        sent.append({"id": qq["id"], "message_id": msg["message_id"]})
        time.sleep(1.5)
    qlog["days"][today] = {"sent_at": now.isoformat(timespec="seconds"), "questions": sent}
    with open(os.path.join(DATA, "quiz_log.json"), "w", encoding="utf-8") as f:
        json.dump(qlog, f, ensure_ascii=False, indent=2)
    log(f"✅ {len(sent)} ta savol yuborildi")


if __name__ == "__main__":
    main()
