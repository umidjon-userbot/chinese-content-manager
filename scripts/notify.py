"""Muammo bo'lsa adminga (kanal egasiga) shaxsiy Telegram xabar yuboradi.

Admin ID'lari data/config.json dagi "admin_chat_ids" ro'yxatidan olinadi.
Bot faqat /start bosgan foydalanuvchiga yoza oladi.
Xabar yuborilmasa ham asosiy ish to'xtamaydi.
"""
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def admin_ids():
    try:
        with open(os.path.join(ROOT, "data", "config.json"), encoding="utf-8") as f:
            ids = json.load(f).get("admin_chat_ids") or []
    except Exception:  # noqa
        ids = []
    return [str(i).strip() for i in ids if str(i).strip()]


def notify(text, token=None):
    token = (token or os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
    if not token:
        print("::warning::notify: TELEGRAM_BOT_TOKEN yo'q, admin xabari yuborilmadi")
        return False
    run_url = ""
    if os.environ.get("GITHUB_RUN_ID") and os.environ.get("GITHUB_REPOSITORY"):
        run_url = f"\n\n🔗 {os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    body = ("⚠️ Daily Chinese with Doggy\n\n" + text)[:3800] + run_url
    ok = False
    for chat in admin_ids():
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=json.dumps({"chat_id": chat, "text": body, "disable_web_page_preview": True}).encode(),
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=20).read()
            ok = True
        except Exception as e:  # noqa
            print(f"::warning::notify {chat}: {str(e).replace(token, '***')}")
    return ok
