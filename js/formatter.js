// Post → Telegram HTML matni. scripts/publish.py dagi format_post() bilan AYNAN bir xil natija beradi.
import { esc } from './utils.js';

export const TG_LIMIT = 4096;
export const CAPTION_LIMIT = 1024; // rasm ostidagi matn chegarasi

export const TYPES = {
  vocabulary:   { emoji: '📚', zh: '今日词汇', uz: "Kun so'zi",          slot: 'am' },
  grammar:      { emoji: '📐', zh: '语法',     uz: 'Grammatika',          slot: 'pm' },
  chengyu:      { emoji: '🐉', zh: '成语故事', uz: 'Chengyu hikoyasi',    slot: 'pm' },
  culture:      { emoji: '🏮', zh: '中国文化', uz: 'Xitoy madaniyati',    slot: 'pm' },
  characters:   { emoji: '✍️', zh: '汉字',     uz: 'Ieroglif sirlari',    slot: 'am' },
  conversation: { emoji: '💬', zh: '日常对话', uz: 'Kundalik suhbat',     slot: 'am' },
  slang:        { emoji: '😎', zh: '流行语',   uz: 'Xitoycha slang',      slot: 'pm' },
  facts:        { emoji: '💡', zh: '趣味知识', uz: 'Qiziqarli faktlar',   slot: 'am' },
  hsk:          { emoji: '🎯', zh: 'HSK词汇',  uz: "HSK so'zlari",        slot: 'am' },
  internet:     { emoji: '🌐', zh: '网络用语', uz: 'Internet tili',       slot: 'pm' },
};

export const STATUSES = ['Draft', 'Approved', 'Scheduled', 'Published', 'Failed'];
export const STATUS_UZ = {
  Draft: 'Qoralama',
  Approved: 'Tasdiqlangan',
  Scheduled: 'Rejalashtirilgan',
  Published: 'Nashr qilingan',
  Failed: 'Xato',
};

/** Telegram HTML uchun escape: faqat & < > */
export function tgEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function hashtag(s) {
  return String(s ?? '').replace(/[^\p{L}\p{N}_]/gu, '');
}

/** data/config.json: { channel_link, footer_text } — har bir post ostiga havola qo'shiladi */
let CONFIG = { channel_link: '', footer_text: '' };
export function setConfig(cfg) {
  CONFIG = { channel_link: '', footer_text: '', ...(cfg || {}) };
}
export function getConfig() {
  return CONFIG;
}

function footerLine() {
  const url = String(CONFIG.channel_link || '').trim();
  if (!url) return '';
  const text = String(CONFIG.footer_text || '').trim() || url;
  const href = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `👉 <a href="${href}">${tgEscape(text)}</a>`;
}

export function formatPost(p) {
  const body = formatBody(p);
  const foot = footerLine();
  return foot ? `${body}\n\n${foot}` : body;
}

function formatBody(p) {
  if (p.text_override && String(p.text_override).trim()) return String(p.text_override).trim();
  const t = TYPES[p.type] || TYPES.vocabulary;
  const emoji = String(p.emoji || '').trim() || t.emoji;
  const title = String(p.title_zh || '').trim() || t.zh;
  const e = tgEscape;
  const L = [];
  L.push(`${emoji} <b>${e(title)} | ${e(t.uz)}</b>`);
  L.push('');
  let head = `<b>${e(p.hanzi || '')}</b>`;
  if (p.pinyin) head += ` — <i>${e(p.pinyin)}</i>`;
  L.push(head);
  if (p.translation_uz) L.push(`🇺🇿 ${e(p.translation_uz)}`);
  if (p.explanation_uz) {
    L.push('');
    L.push(`📖 ${e(p.explanation_uz)}`);
  }
  const ex = (p.examples || []).filter((x) => x && (x.zh || x.uz));
  if (ex.length) {
    L.push('');
    L.push('✏️ <b>Misollar:</b>');
    ex.forEach((x, i) => {
      L.push(`${i + 1}. ${e(x.zh || '')}`);
      if (x.pinyin) L.push(`   <i>${e(x.pinyin)}</i>`);
      if (x.uz) L.push(`   ${e(x.uz)}`);
    });
  }
  const tags = [];
  for (const raw of [...(p.tags || []), p.type]) {
    const h = hashtag(raw);
    if (h && !tags.includes(h)) tags.push(h);
  }
  if (tags.length) {
    L.push('');
    L.push(tags.map((x) => '#' + x).join(' '));
  }
  return L.join('\n');
}

function unescapeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|lt|gt|amp|quot);/gi, (m, g) => {
    const k = g.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}

/** Telegram ko'rsatadigan belgilar soni (teglarsiz, UTF-16 birliklarda) */
export function tgLength(text) {
  return unescapeEntities(String(text).replace(/<[^>]*>/g, '')).length;
}

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'blockquote', 'tg-spoiler']);

/** Rasm manzili: to'liq https URL yoki repo ichidagi yo'l (assets/images/...) */
export function imageUrl(image) {
  const s = String(image || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.replace(/^\/+/, '');
}

/** Telegram HTML matnini xavfsiz preview HTML'ga aylantiradi */
export function renderTgPreview(text) {
  const parts = String(text).split(/(<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?>)/);
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?>$/);
    if (m) {
      const close = m[1];
      const tag = m[2].toLowerCase();
      if (tag === 'a') {
        if (close) { out += '</a>'; continue; }
        const href = (m[3] || '').match(/href\s*=\s*"([^"]*)"/i);
        const url = href ? unescapeEntities(href[1]) : '';
        out += /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">` : '<a>';
        continue;
      }
      if (tag === 'tg-spoiler') { out += close ? '</span>' : '<span class="tg-spoiler">'; continue; }
      if (ALLOWED.has(tag)) { out += `<${close}${tag}>`; continue; }
      continue; // ruxsat etilmagan teg ko'rsatilmaydi
    }
    out += esc(unescapeEntities(part));
  }
  return out;
}
