// JSON sxema tekshiruvi, normallashtirish va takrorlanish tekshiruvi.
import { TYPES, STATUSES, formatPost, tgLength, TG_LIMIT } from './formatter.js';
import { parse, uid, nowISO } from './utils.js';

const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ]/;
const NUM_TONE = /[a-zü]+[1-5](?![0-9])/i;
const ALLOWED_TAGS = /^\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|a)$/i;

export function normalizeHanzi(s) {
  return String(s || '').replace(/[\s，。！？、,.!?…：:；;“”"'《》]/g, '');
}

/** Import qilingan xom obyektni to'liq post ko'rinishiga keltiradi */
export function normalizePost(raw) {
  const p = { ...(raw || {}) };
  p.id = String(p.id ?? '').trim() || uid('post');
  p.type = String(p.type ?? '').trim().toLowerCase();
  for (const k of ['title_zh', 'hanzi', 'pinyin', 'translation_uz', 'explanation_uz', 'emoji']) {
    p[k] = String(p[k] ?? '').trim();
  }
  p.examples = Array.isArray(p.examples)
    ? p.examples.map((x) => ({
      zh: String(x?.zh ?? '').trim(),
      pinyin: String(x?.pinyin ?? '').trim(),
      uz: String(x?.uz ?? '').trim(),
    }))
    : [];
  if (typeof p.tags === 'string') p.tags = p.tags.split(/[,\s]+/).filter(Boolean);
  p.tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean) : [];
  p.text_override = p.text_override && String(p.text_override).trim() ? String(p.text_override) : null;
  const lvl = Number(p.hsk_level);
  p.hsk_level = Number.isInteger(lvl) && lvl >= 1 && lvl <= 9 ? lvl : null;
  p.scheduled_at = p.scheduled_at ? String(p.scheduled_at).trim() : null;
  p.status = STATUSES.includes(p.status) ? p.status : 'Draft';
  p.created_at = p.created_at || nowISO();
  return p;
}

export function validatePost(p) {
  const errors = [];
  const warnings = [];
  const override = !!(p.text_override && String(p.text_override).trim());

  if (!TYPES[p.type]) errors.push(`Noma'lum tur: "${p.type || '—'}"`);
  if (!override) {
    if (!p.hanzi) errors.push("hanzi bo'sh");
    if (!p.pinyin) errors.push("pinyin bo'sh");
    if (!p.translation_uz) errors.push("translation_uz bo'sh");
  }
  if (p.pinyin) {
    if (NUM_TONE.test(p.pinyin)) warnings.push('Pinyin raqamli tonda yozilgan (ni3) — ton belgilaridan foydalaning');
    else if (!TONE.test(p.pinyin)) warnings.push('Pinyinda ton belgisi topilmadi');
  }
  if (!override) {
    const n = (p.examples || []).length;
    if (n < 2 || n > 3) warnings.push(`Misollar soni ${n} ta (2–3 ta tavsiya etiladi)`);
    (p.examples || []).forEach((x, i) => {
      if (!x.zh || !x.pinyin || !x.uz) warnings.push(`${i + 1}-misolda maydon to'liq emas`);
      else if (NUM_TONE.test(x.pinyin)) warnings.push(`${i + 1}-misol pinyini raqamli tonda`);
      else if (!TONE.test(x.pinyin)) warnings.push(`${i + 1}-misol pinyinida ton belgisi yo'q`);
    });
  }
  if (p.scheduled_at && !parse(p.scheduled_at)) errors.push("scheduled_at noto'g'ri formatda");
  if (p.status === 'Scheduled' && !p.scheduled_at) errors.push('Scheduled post uchun vaqt kerak');

  const length = tgLength(formatPost(p));
  if (length > TG_LIMIT) errors.push(`Matn juda uzun: ${length}/${TG_LIMIT} belgi`);

  if (override) {
    const tags = [...String(p.text_override).matchAll(/<\s*(\/?[a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]);
    const bad = [...new Set(tags.filter((t) => !ALLOWED_TAGS.test(t)))];
    if (bad.length) warnings.push("Telegram qo'llamaydigan teglar: " + bad.join(', '));
    const opens = (String(p.text_override).match(/</g) || []).length;
    const closes = (String(p.text_override).match(/>/g) || []).length;
    if (opens !== closes) warnings.push("< yoki > belgisi juft emas — oddiy matnda &lt; va &gt; yozing");
  }
  return { errors, warnings, length };
}

/** Bir xil hanzi'li boshqa post yoki nashrlarni topadi */
export function findDuplicates(p, posts, publishedItems) {
  const key = normalizeHanzi(p.hanzi);
  if (!key) return [];
  const out = [];
  for (const q of posts) {
    if (q.id !== p.id && normalizeHanzi(q.hanzi) === key) {
      out.push({ source: 'post', id: q.id, hanzi: q.hanzi, status: q.status, when: q.scheduled_at });
    }
  }
  const ids = new Set(out.map((x) => x.id));
  for (const it of publishedItems || []) {
    if (it.id !== p.id && !ids.has(it.id) && normalizeHanzi(it.hanzi) === key) {
      out.push({ source: 'published', id: it.id, hanzi: it.hanzi, status: 'Published', when: it.sent_at });
    }
  }
  return out;
}

/** Matndan postlar ro'yxatini ajratadi (```json bloklari, massiv, {posts:[]}, bitta obyekt) */
export function parseImport(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t) throw new Error("Matn bo'sh");
  let data;
  try {
    data = JSON.parse(t);
  } catch (e) {
    throw new Error("JSON o'qib bo'lmadi: " + e.message);
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.posts)) return data.posts;
  if (data && typeof data === 'object' && (data.hanzi || data.type)) return [data];
  throw new Error("Postlar topilmadi: massiv, {\"posts\": [...]} yoki bitta post obyekti kutilgan");
}
