#!/usr/bin/env python3
"""Kanal ko'rinishini bot orqali sozlaydi: nom, tavsif, rasm, salomlashish posti (+pin).

Foydalanish: python3 scripts/channel_setup.py --actions title,description,photo,welcome
Matnlar data/channel.json da. Token: TELEGRAM_BOT_TOKEN, kanal: TELEGRAM_CHANNEL_ID (GitHub Secrets).
"""
import argparse, json, os, sys, uuid, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHAT = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()


def log(m):
    print(str(m).replace(TOKEN, "***") if TOKEN else m, flush=True)


def call(method, fields=None, files=None):
    url = f"https://api.telegram.org/bot{TOKEN}/{method}"
    fields = {k: (json.dumps(v) if isinstance(v, (dict, list, bool)) else str(v)) for k, v in (fields or {}).items()}
    if files:
        b = uuid.uuid4().hex
        body = b""
        for k, v in fields.items():
            body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, path in files.items():
            with open(path, "rb") as f:
                data = f.read()
            body += (f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{os.path.basename(path)}"\r\n'
                     f'Content-Type: image/jpeg\r\n\r\n').encode() + data + b"\r\n"
        body += f"--{b}--\r\n".encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    else:
        req = urllib.request.Request(url, data=json.dumps(fields).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        res = json.load(e)
    if not res.get("ok"):
        raise RuntimeError(f"{method}: {res.get('description')}")
    return res.get("result")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--actions", default="title,description,photo,welcome")
    acts = {a.strip() for a in ap.parse_args().actions.split(",") if a.strip()}
    if not TOKEN or not CHAT:
        log("::error::TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHANNEL_ID yo'q"); sys.exit(1)
    cfg = json.load(open(os.path.join(ROOT, "data", "channel.json"), encoding="utf-8"))
    chat = call("getChat", {"chat_id": CHAT})
    log(f"Kanal: {chat.get('title')}")
    errors = 0

    def step(name, fn):
        nonlocal errors
        if name not in acts:
            return
        try:
            fn(); log(f"✅ {name}")
        except Exception as e:  # noqa
            errors += 1; log(f"::error::{name}: {e}")

    def title():
        if chat.get("title") == cfg["title"]:
            log("Nom allaqachon shu"); return
        call("setChatTitle", {"chat_id": CHAT, "title": cfg["title"]})

    def description():
        if (chat.get("description") or "") == cfg["description"]:
            log("Tavsif allaqachon shu"); return
        call("setChatDescription", {"chat_id": CHAT, "description": cfg["description"][:255]})

    def photo():
        call("setChatPhoto", {"chat_id": CHAT}, files={"photo": os.path.join(ROOT, cfg["photo"])})

    def welcome():
        msg = call("sendPhoto", {"chat_id": CHAT, "caption": cfg["welcome_text"], "parse_mode": "HTML"},
                   files={"photo": os.path.join(ROOT, cfg["welcome_image"])})
        log(f"Salomlashish posti: message_id={msg['message_id']}")
        if cfg.get("pin_welcome"):
            call("pinChatMessage", {"chat_id": CHAT, "message_id": msg["message_id"], "disable_notification": True})
            log("📌 Pin qilindi")

    for n, f in (("title", title), ("description", description), ("photo", photo), ("welcome", welcome)):
        step(n, f)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
