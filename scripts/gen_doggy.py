#!/usr/bin/env python3
"""Cloudflare Workers AI (FLUX.1 schnell) orqali Doggy illyustratsiyalarini yasaydi.

python3 scripts/gen_doggy.py --ids hsk1-005,hsk1-006   yoki   --range 5-14
Natija: assets/doggy/raw/<id>.jpg  (mavjud bo'lsa o'tkazib yuboriladi, --force bilan qayta yasaydi)
Secrets: CF_ACCOUNT_ID, CF_API_TOKEN
"""
import argparse, base64, json, os, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACC = os.environ.get("CF_ACCOUNT_ID", "").strip()
TOK = os.environ.get("CF_API_TOKEN", "").strip()
MODEL = "@cf/black-forest-labs/flux-1-schnell"

STYLE = ("Cute cartoon white Shiba Inu puppy mascot with a curled fluffy tail, small triangle ears and rosy red cheeks. "
         "Simple hand-drawn black ink doodle line art, thick clean confident outlines, flat white fill, "
         "only a few small red accents, minimal, no shading, no gradients. "
         "Centered single character with props, lots of empty space, plain pure white background. "
         "Absolutely no text, no letters, no numbers written as text, no Chinese characters, no watermark, no frame. "
         "Scene: the puppy is {scene}.")


def run(prompt, seed):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/ai/run/{MODEL}"
    body = json.dumps({"prompt": prompt, "steps": 4}).encode()
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                res = json.load(r)
            img = (res.get("result") or {}).get("image")
            if not img:
                raise RuntimeError(f"rasm yo'q: {str(res)[:200]}")
            return base64.b64decode(img)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="ignore")[:300]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(10 * (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code}: {msg}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--range", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max", type=int, default=150, help="bir ishga tushishda ko'pi bilan (kunlik bepul limit ~170)")
    a = ap.parse_args()
    if not ACC or not TOK:
        print("::error::CF_ACCOUNT_ID yoki CF_API_TOKEN yo'q"); sys.exit(1)
    ids = [i.strip() for i in a.ids.split(",") if i.strip()]
    if a.range:
        lo, hi = (int(x) for x in a.range.split("-"))
        ids += [f"hsk1-{n:03d}" for n in range(lo, hi + 1)]
    cards_path = os.path.join(ROOT, "data", "cards.json")
    cards = json.load(open(cards_path, encoding="utf-8")) if os.path.exists(cards_path) else []
    cards = cards.get("cards", cards) if isinstance(cards, dict) else cards
    posts = {c["id"]: c for c in cards}
    scenes_path = os.path.join(ROOT, "data", "doggy_scenes.json")
    scenes = json.load(open(scenes_path, encoding="utf-8")) if os.path.exists(scenes_path) else {}
    out = os.path.join(ROOT, "assets", "doggy", "raw"); os.makedirs(out, exist_ok=True)
    done = fail = 0
    for pid in ids:
        if done >= a.max:
            print("Limit yetdi, qolganlari keyingi safar"); break
        path = os.path.join(out, f"{pid}.jpg")
        if os.path.exists(path) and not a.force:
            continue
        p = posts.get(pid, {})
        scene = scenes.get(pid) or f"happily acting out the meaning of the word '{(p.get('en') or pid).split(';')[0]}'"
        seed = int(pid.split("-")[-1]) * 7919 % 100000 if pid.split("-")[-1].isdigit() else 42
        try:
            data = run(STYLE.format(scene=scene), seed)
            open(path, "wb").write(data); done += 1
            print(f"✅ {pid}: {scene[:60]}")
        except Exception as e:  # noqa
            fail += 1; print(f"::warning::{pid}: {e}")
            if "10000" in str(e) or "neuron" in str(e).lower() or "4006" in str(e):
                print("Kunlik limit tugadi"); break
    print(f"Tayyor: {done}, xato: {fail}")
    sys.exit(1 if fail and not done else 0)


if __name__ == "__main__":
    main()
