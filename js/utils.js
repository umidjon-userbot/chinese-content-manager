// Umumiy yordamchi funksiyalar. Barcha vaqtlar Asia/Tashkent (UTC+05:00, DST yo'q).

export const pad = (n) => String(n).padStart(2, '0');
const OFFSET_MS = 5 * 60 * 60 * 1000;

export const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
export const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
export const DAYS_FULL = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

/** Sana qismlarini Toshkent vaqtida qaytaradi. dow: 0 = dushanba */
export function tk(date = new Date()) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(),
    dow: (d.getUTCDay() + 6) % 7,
  };
}

export function dateKey(date = new Date()) {
  const p = tk(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
export const todayKey = () => dateKey(new Date());

export function toISO(dk, time) {
  return `${dk}T${time}:00+05:00`;
}

export function nowISO() {
  const p = tk();
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}+05:00`;
}

export function parse(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

export function postKey(p) {
  const d = parse(p && p.scheduled_at);
  return d ? dateKey(d) : null;
}

export function postTime(p) {
  const d = parse(p && p.scheduled_at);
  if (!d) return '';
  const x = tk(d);
  return `${pad(x.hh)}:${pad(x.mm)}`;
}

export function addDays(dk, n) {
  const [y, m, d] = dk.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dowOf(dk) {
  const [y, m, d] = dk.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function fmtDate(dk) {
  if (!dk) return '—';
  const [y, m, d] = dk.split('-').map(Number);
  return `${d}-${MONTHS[m - 1].toLowerCase()}, ${y}`;
}

export function fmtDT(s) {
  const d = parse(s);
  if (!d) return '—';
  const p = tk(d);
  return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.hh)}:${pad(p.mm)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix = 'post') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function countdown(ms) {
  if (ms <= 0) return 'hozir';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (d ? `${d} kun ` : '') + `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function ago(s) {
  const d = parse(s);
  if (!d) return '—';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'hozirgina';
  if (m < 60) return `${m} daqiqa oldin`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} soat oldin`;
  return `${Math.round(h / 24)} kun oldin`;
}

export function stableStringify(o) {
  if (Array.isArray(o)) return '[' + o.map(stableStringify).join(',') + ']';
  if (o && typeof o === 'object') {
    return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
  }
  return JSON.stringify(o ?? null);
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function byTime(a, b) {
  const ta = parse(a.scheduled_at)?.getTime() ?? Infinity;
  const tb = parse(b.scheduled_at)?.getTime() ?? Infinity;
  if (ta !== tb) return ta - tb;
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}
