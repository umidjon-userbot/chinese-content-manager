// card.html dan kartalarni chizadi. node render.js _tmp/cards.json
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pinyin } = require('pinyin-pro');
const { syl } = require('./talaffuz');

function toneless(p) {
  return p.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase().replace(/[^a-zü]/g, '');
}
// Pinyin → o'zbekcha talaffuz (masalan bāngmáng → bang-mang)
function tal(hanzi, py) {
  const chars = [...hanzi].filter((c) => /\p{Script=Han}/u.test(c));
  let rest = toneless(py.split(' / ')[0].replace(/ü/g, 'v')).replace(/v/g, 'ü');
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '儿' && i > 0 && chars[i - 1] !== '女' && rest.startsWith('r') && !rest.startsWith('er')) { out[out.length - 1] += 'r'; rest = rest.slice(1); continue; }
    const opts = pinyin(ch, { toneType: 'none', multiple: true, type: 'array' }).map((s) => s.replace(/v/g, 'ü'));
    opts.sort((a, b) => b.length - a.length);
    let m = opts.find((o) => rest.startsWith(o));
    if (!m) m = pinyin(ch, { toneType: 'none' }).replace(/v/g, 'ü');
    out.push(syl(m)); rest = rest.slice(m.length);
  }
  return out.join('-');
}
const MASCOTS = { heart: 'mascot_heart.png', sun: 'mascot_sun.png', glasses: 'mascot_glasses.png' };

(async () => {
  const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outDir = path.dirname(path.resolve(process.argv[2]));
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
  await page.goto('file://' + path.join(__dirname, 'card.html'));
  for (const c of cards) {
    c.talaffuz = tal(c.hanzi, c.pinyin);
    const m = c.mascot ? 'file://' + c.mascot : MASCOTS[['heart', 'sun', 'glasses'][[...c.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 3]];
    await page.evaluate(([card, mascot]) => window.renderCard(card, mascot), [c, m]);
    await page.screenshot({ path: path.join(outDir, `${c.id}.jpg`), type: 'jpeg', quality: 85 });
  }
  await browser.close();
})();
