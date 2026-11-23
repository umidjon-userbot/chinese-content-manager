#!/usr/bin/env python3
"""Rejalashtirilgan postlarni Telegram kanalga yuboradi (GitHub Actions uchun).

Foydalanish:
  python3 scripts/publish.py --result-out /tmp/result.json      # oddiy ishga tushirish
  python3 scripts/publish.py --dry-run --result-out /tmp/r.json # sinov: hech narsa yuborilmaydi
  python3 scripts/publish.py --apply-result /tmp/result.json    # natijani yangi checkout'ga qayta yozish

Muhit o'zgaruvchilari (GitHub Secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
Faqat Python standart kutubxonasi ishlatiladi.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=5))  # Asia/Tashkent (yozgi vaqt yo'q)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
POSTS_F = os.path.join(DATA, "posts.json")
PUB_F = os.path.join(DATA, "published.json")
STATUS_F = os.path.join(DATA, "status.json")
CONFIG_F = os.path.join(DATA, "config.json")

WINDOW = timedelta(hours=12)   # shu muddatdan eski postlar avtomatik yuborilmaydi
MAX_PER_RUN = 2
SENDABLE = {"Approved", "Scheduled"}
TG_LIMIT = 4096
CAPTION_LIMIT = 1024

# js/formatter.js dagi TYPES bilan bir xil bo'lishi shart
TYPES = {
    "vocabulary":   {"emoji": "📚", "zh": "今日词汇", "uz": "Kun so'zi"},
    "grammar":      {"emoji": "📐", "zh": "语法",     "uz": "Grammatika"},
    "chengyu":      {"emoji": "🐉", "zh": "成语故事", "uz": "Chengyu hikoyasi"},
    "culture":      {"emoji": "🏮", "zh": "中国文化", "uz": "Xitoy madaniyati"},
    "characters":   {"emoji": "✍️", "zh": "汉字",     "uz": "Ieroglif sirlari"},
    "conversation": {"emoji": "💬", "zh": "日常对话", "uz": "Kundalik suhbat"},
    "slang":        {"emoji": "😎", "zh": "流行语",   "uz": "Xitoycha slang"},
    "facts":        {"emoji": "💡", "zh": "趣味知识", "uz": "Qiziqarli faktlar"},
    "hsk":          {"emoji": "🎯", "zh": "HSK词汇",  "uz": "HSK so'zlari"},
    "internet":     {"emoji": "🌐", "zh": "网络用语", "uz": "Internet tili"},
}

_TOKEN = ""


def log(msg):
    print(redact(str(msg)), flush=True)


def redact(text):
    text = str(text)
    if _TOKEN:
        text = text.replace(_TOKEN, "***")
    return re.sub(r"bot\d+:[A-Za-z0-9_-]+", "bot***", text)


def now():
    return datetime.now(TZ).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(TZ).isoformat()


def parse_dt(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        log(f"::error::{os.path.basename(path)} JSON xato: {e}")
        raise


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# ---------- Formatlash (js/formatter.js formatPost bilan bir xil) ----------

def esc(s):
    return html.escape("" if s is None else str(s), quote=False)


def hashtag(s):
    return re.sub(r"[^\w]", "", "" if s is None else str(s))


_CONFIG = None


def config():
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = load_json(CONFIG_F, {}) or {}
    return _CONFIG


def footer_line():
    url = str(config().get("channel_link") or "").strip()
    if not url:
        return ""
    text = str(config().get("footer_text") or "").strip() or url
    href = url.replace("&", "&amp;").replace('"', "&quot;")
    return f'👉 <a href="{href}">{esc(text)}</a>'


def format_post(p):
    body = format_body(p)
    foot = footer_line()
    return f"{body}\n\n{foot}" if foot else body


def format_body(p):
    override = p.get("text_override")
    if override and str(override).strip():
        return str(override).strip()
    t = TYPES.get(p.get("type")) or TYPES["vocabulary"]
    emoji = str(p.get("emoji") or "").strip() or t["emoji"]
    title = str(p.get("title_zh") or "").strip() or t["zh"]
    lines = [f"{emoji} <b>{esc(title)} | {esc(t['uz'])}</b>", ""]
    head = f"<b>{esc(p.get('hanzi') or '')}</b>"
    if p.get("pinyin"):
        head += f" — <i>{esc(p['pinyin'])}</i>"
    lines.append(head)
    if p.get("translation_uz"):
        lines.append(f"🇺🇿 {esc(p['translation_uz'])}")
    if p.get("explanation_uz"):
        lines.append("")
        lines.append(f"📖 {esc(p['explanation_uz'])}")
    examples = [x for x in (p.get("examples") or []) if x and (x.get("zh") or x.get("uz"))]
    if examples:
        lines.append("")
        lines.append("✏️ <b>Misollar:</b>")
        for i, x in enumerate(examples, 1):
            lines.append(f"{i}. {esc(x.get('zh') or '')}")
            if x.get("pinyin"):
                lines.append(f"   <i>{esc(x['pinyin'])}</i>")
            if x.get("uz"):
                lines.append(f"   {esc(x['uz'])}")
    tags = []
    for raw in list(p.get("tags") or []) + [p.get("type")]:
        h = hashtag(raw)
        if h and h not in tags:
            tags.append(h)
    if tags:
        lines.append("")
        lines.append(" ".join("#" + x for x in tags))
    return "\n".join(lines)


def tg_length(text):
    visible = html.unescape(re.sub(r"<[^>]*>", "", text))
    return len(visible.encode("utf-16-le")) // 2


# ---------- Telegram ----------

class TgError(Exception):
    def __init__(self, message, code=None, retry_after=None):
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after


def tg_call(token, method, payload):
    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            raise TgError(f"HTTP {e.code}", code=e.code) from None
    except urllib.error.URLError as e:
        raise TgError(f"Tarmoq xatosi: {redact(e.reason)}") from None
    except TimeoutError:
        raise TgError("Telegram javob bermadi (timeout)") from None
    if not body.get("ok"):
        params = body.get("parameters") or {}
        raise TgError(
            redact(body.get("description") or "Noma'lum xato"),
            code=body.get("error_code"),
            retry_after=params.get("retry_after"),
        )
    return body.get("result")


def image_url(image):
    s = str(image or "").strip()
    if not s:
        return ""
    if re.match(r"^https?://", s, re.I):
        return s
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    branch = os.environ.get("GITHUB_REF_NAME", "main")
    if not repo:
        raise TgError("Rasm yo'li uchun GITHUB_REPOSITORY topilmadi")
    path = "/".join(urllib.parse.quote(part) for part in s.lstrip("/").split("/"))
    return f"https://raw.githubusercontent.com/{repo}/{branch}/{path}"


def send_post(token, chat_id, text, image=None):
    """Rasm bo'lsa sendPhoto (matn sig'sa caption sifatida), aks holda sendMessage. Oxirgi xabarni qaytaradi."""
    if image:
        url = image_url(image)
        if tg_length(text) <= CAPTION_LIMIT:
            return send_with_retry(token, "sendPhoto", {
                "chat_id": chat_id, "photo": url, "caption": text, "parse_mode": "HTML",
            })
        send_with_retry(token, "sendPhoto", {"chat_id": chat_id, "photo": url})
    return send_with_retry(token, "sendMessage", {
        "chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True,
    })


def send_with_retry(token, method, payload, attempts=3):
    for i in range(attempts):
        try:
            return tg_call(token, method, payload)
        except TgError as e:
            permanent = e.code in (400, 401, 403, 404)
            if permanent or i == attempts - 1:
                raise
            wait = (e.retry_after + 1) if e.retry_after else 5
            log(f"Qayta urinish {i + 2}/{attempts} ({wait}s): {e}")
            time.sleep(min(wait, 60))


# ---------- Asosiy mantiq ----------

def run(dry_run, post_id=None):
    global _TOKEN
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
    _TOKEN = token

    posts = load_json(POSTS_F, {"posts": []}).get("posts", [])
    pub_ids = {i.get("id") for i in load_json(PUB_F, {"items": []}).get("items", [])}
    t = now()

    result = {
        "run_at": iso(t), "dry_run": dry_run, "sent": [], "failed": [], "expired": [],
        "secrets_ok": bool(token and chat_id), "bot_ok": None, "bot_username": None,
        "channel_ok": None, "channel_title": None, "message": "",
    }

    due = []
    if post_id:
        # Qo'lda "hozir yuborish": vaqt va statusdan qat'i nazar (faqat hali yuborilmagan bo'lsa)
        match = [p for p in posts if p.get("id") == post_id]
        if not match:
            result["message"] = f"Post topilmadi: {post_id} — avval posts.json ni repo'ga yuklang"
            log(f"::error::{result['message']}")
            return result
        if post_id in pub_ids:
            result["message"] = f"{post_id} allaqachon yuborilgan"
            log(f"::warning::{result['message']}")
            return result
        due.append((t, match[0]))
    for p in ([] if post_id else posts):
        if p.get("status") not in SENDABLE or p.get("id") in pub_ids:
            continue
        dt = parse_dt(p.get("scheduled_at"))
        if not dt or dt > t:
            continue
        if t - dt > WINDOW:
            result["expired"].append(p.get("id"))
            continue
        due.append((dt, p))
    due.sort(key=lambda x: x[0])
    batch = due[:MAX_PER_RUN]
    log(f"Vaqt: {iso(t)} | navbatda: {len(due)} | bu safar: {len(batch)} | muddati o'tgan: {len(result['expired'])}")

    if not result["secrets_ok"]:
        result["message"] = "Secrets sozlanmagan: TELEGRAM_BOT_TOKEN va TELEGRAM_CHANNEL_ID qo'shing"
        log(f"::warning::{result['message']}")
        return result

    try:
        me = tg_call(token, "getMe", {})
        result["bot_ok"] = True
        result["bot_username"] = me.get("username")
    except TgError as e:
        result["bot_ok"] = False
        result["message"] = f"Bot tekshiruvi muvaffaqiyatsiz: {e}"
        log(f"::error::{result['message']}")
        return result

    try:
        chat = tg_call(token, "getChat", {"chat_id": chat_id})
        result["channel_ok"] = True
        result["channel_title"] = chat.get("title") or chat.get("username")
    except TgError as e:
        result["channel_ok"] = False
        result["message"] = f"Kanal topilmadi yoki bot kanalga qo'shilmagan: {e}"
        log(f"::error::{result['message']}")
        return result

    for _, p in batch:
        pid = p.get("id")
        text = format_post(p)
        length = tg_length(text)
        if length > TG_LIMIT:
            result["failed"].append({"id": pid, "error": f"Matn juda uzun: {length}/{TG_LIMIT}"})
            continue
        if dry_run:
            log(f"[dry-run] {pid} yuborilardi ({length} belgi):\n{text}\n")
            continue
        try:
            msg = send_post(token, chat_id, text, p.get("image"))
            result["sent"].append({
                "id": pid, "hanzi": p.get("hanzi", ""), "type": p.get("type"),
                "sent_at": iso(now()), "message_id": (msg or {}).get("message_id"),
            })
            log(f"✅ Yuborildi: {pid}")
        except TgError as e:
            result["failed"].append({"id": pid, "error": redact(str(e))})
            log(f"::error::❌ {pid}: {e}")
    if result["failed"]:
        result["message"] = f"{len(result['failed'])} ta post yuborilmadi"
    return result


def apply_result(result):
    """Natijani diskdagi (eng so'nggi) JSON fayllarga yozadi. Qayta ishlatilsa ham xavfsiz."""
    posts_doc = load_json(POSTS_F, {"version": 1, "posts": []})
    pub = load_json(PUB_F, {"items": []})
    prev_status = load_json(STATUS_F, {}) or {}
    items = pub.setdefault("items", [])
    ids = {i.get("id") for i in items}
    ts = result["run_at"]
    by_id = {p.get("id"): p for p in posts_doc.get("posts", [])}

    changed = False
    if not result.get("dry_run"):
        for s in result["sent"]:
            if s["id"] not in ids:
                items.append(s)
                ids.add(s["id"])
                changed = True
            p = by_id.get(s["id"])
            if p and p.get("status") != "Published":
                p["status"] = "Published"
                p["published_at"] = s["sent_at"]
                p["message_id"] = s.get("message_id")
                p["status_updated_at"] = ts
                p.pop("last_error", None)
                changed = True
        for f in result["failed"]:
            p = by_id.get(f["id"])
            if p and f["id"] not in ids and p.get("status") in SENDABLE:
                p["status"] = "Failed"
                p["last_error"] = f["error"]
                p["status_updated_at"] = ts
                changed = True
        if changed:
            save_json(PUB_F, pub)
            save_json(POSTS_F, posts_doc)

    sent_at = [s["sent_at"] for s in result["sent"]] if not result.get("dry_run") else []
    status = {
        "last_run": ts,
        "ok": bool(result["secrets_ok"] and result["bot_ok"] and result["channel_ok"] and not result["failed"]),
        "dry_run": bool(result.get("dry_run")),
        "secrets_ok": result["secrets_ok"],
        "bot_ok": result["bot_ok"],
        "bot_username": result["bot_username"],
        "channel_ok": result["channel_ok"],
        "channel_title": result["channel_title"],
        "sent": [s["id"] for s in result["sent"]] if not result.get("dry_run") else [],
        "failed": result["failed"],
        "expired": result["expired"],
        "message": result["message"],
        "last_sent_at": max(sent_at) if sent_at else prev_status.get("last_sent_at"),
    }
    save_json(STATUS_F, status)
    return changed


def alert_admin(result, prev_expired):
    """Muammo bo'lsa kanal egasiga shaxsiy xabar (notify.py)."""
    lines = []
    if not result["secrets_ok"] or result["bot_ok"] is False or result["channel_ok"] is False:
        lines.append("❌ " + (result.get("message") or "Bot/kanal tekshiruvi o'tmadi"))
    for f in result["failed"]:
        lines.append(f"❌ {f['id']} yuborilmadi: {f['error'][:200]}")
    new_exp = [e for e in result["expired"] if e not in prev_expired]
    if new_exp:
        lines.append(f"⏰ Vaqti o'tib ketgan (12 soatdan ko'p), yuborilmagan: {', '.join(new_exp[:15])}"
                     + (f" va yana {len(new_exp) - 15} ta" if len(new_exp) > 15 else ""))
    if not lines:
        return
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from notify import notify
        notify("Post yuborishda muammo:\n" + "\n".join(lines), _TOKEN or None)
    except Exception as e:  # noqa
        log(f"::warning::admin xabari: {redact(str(e))}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="hech narsa yubormaydi")
    ap.add_argument("--result-out", help="natijani shu faylga yozadi")
    ap.add_argument("--apply-result", help="avvalgi natijani qayta qo'llaydi (yuborishsiz)")
    ap.add_argument("--post-id", help="shu postni vaqtidan qat'i nazar hozir yuboradi")
    args = ap.parse_args()

    if args.apply_result:
        with open(args.apply_result, encoding="utf-8") as f:
            result = json.load(f)
        apply_result(result)
        log("Natija qayta qo'llandi")
        return 0

    pid = (args.post_id or '').strip() or None
    if pid and not re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", pid):
        log('::error::Post ID noto\'g\'ri formatda')
        return 1
    result = run(args.dry_run, pid)
    prev_expired = set((load_json(STATUS_F, {}) or {}).get("expired") or [])
    if not args.dry_run:
        alert_admin(result, prev_expired)
    if args.result_out:
        with open(args.result_out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
    apply_result(result)
    log(f"Tugadi: yuborildi {len(result['sent'])}, xato {len(result['failed'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
