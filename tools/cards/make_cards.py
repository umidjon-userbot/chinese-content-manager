"""HSK so'z kartalarini yasaydi (GitHub Actions'da yoki kompyuterda).

    python tools/cards/make_cards.py --range hsk3:501-520
    python tools/cards/make_cards.py --ids hsk3-501,hsk3-502

1) data/posts.json dan postlarni oladi (hanzi, pinyin, translation_uz, title_zh)
2) assets/doggy/raw/<id>.jpg bo'lsa — oq fonini olib tashlaydi (doggy png)
3) Chrome (Playwright) bilan card.html dan rasm chizadi
4) assets/images/<id>.jpg (864x1152, sifat 80) ga saqlaydi va postning "image" maydonini to'ldiradi
"""
import argparse, json, os, re, subprocess, sys
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POSTS_F = os.path.join(ROOT, "data", "posts.json")
RAW = os.path.join(ROOT, "assets", "doggy", "raw")
IMG = os.path.join(ROOT, "assets", "images")
TMP = os.path.join(HERE, "_tmp")


def uz_label(t):
    t = (t or "").split("(")[0].replace(";", ",").strip().rstrip(",")
    if len(t) > 30 and "," in t:
        t = ",".join(t.split(",")[:2])
    return t.upper()


def num_label(p):
    m = re.search(r"HSK\s*(\d)\D+(\d+)\s*/\s*(\d+)", p.get("title_zh") or "")
    return f"HSK {m.group(1)} · {m.group(2)}/{m.group(3)}" if m else ""


def cutout(src, dst):
    im = Image.open(src).convert("RGB")
    g = im.convert("L").filter(ImageFilter.MinFilter(5))
    a = g.point(lambda v: max(0, min(255, (255 - v) * 4)))
    out = im.copy(); out.putalpha(a); out.save(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--range", default="", help="masalan hsk3:501-520")
    a = ap.parse_args()
    ids = [i.strip() for i in a.ids.split(",") if i.strip()]
    if a.range:
        pre, rng = a.range.split(":", 1) if ":" in a.range else ("hsk1", a.range)
        lo, hi = (int(x) for x in rng.split("-"))
        ids += [f"{pre.strip()}-{n:03d}" for n in range(lo, hi + 1)]
    data = json.load(open(POSTS_F, encoding="utf-8"))
    posts = {p["id"]: p for p in data["posts"]}
    os.makedirs(TMP, exist_ok=True); os.makedirs(IMG, exist_ok=True)
    cards = []
    for pid in ids:
        p = posts.get(pid)
        if not p:
            print(f"::warning::{pid} posts.json da yo'q — o'tkazib yuborildi"); continue
        mascot = None
        raw = os.path.join(RAW, f"{pid}.jpg")
        if os.path.exists(raw):
            mascot = os.path.join(TMP, f"{pid}.png"); cutout(raw, mascot)
        cards.append({"id": pid, "hanzi": p["hanzi"], "pinyin": p["pinyin"], "uz": uz_label(p.get("translation_uz")),
                      "label": num_label(p), "mascot": mascot})
    if not cards:
        print("Karta yo'q"); return
    jf = os.path.join(TMP, "cards.json")
    json.dump(cards, open(jf, "w", encoding="utf-8"), ensure_ascii=False)
    subprocess.run(["node", os.path.join(HERE, "render.js"), jf], check=True, cwd=HERE)
    changed = 0
    for c in cards:
        shot = os.path.join(TMP, f"{c['id']}.jpg")
        if not os.path.exists(shot):
            continue
        Image.open(shot).convert("RGB").resize((864, 1152), Image.LANCZOS).save(os.path.join(IMG, f"{c['id']}.jpg"), quality=80)
        rel = f"assets/images/{c['id']}.jpg"
        if posts[c["id"]].get("image") != rel:
            posts[c["id"]]["image"] = rel; changed += 1
        print(("🐶 " if c["mascot"] else "🖼 ") + c["id"])
    if changed:
        json.dump(data, open(POSTS_F, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Tayyor: {len(cards)} ta karta, {changed} ta postga rasm ulandi")


if __name__ == "__main__":
    main()
