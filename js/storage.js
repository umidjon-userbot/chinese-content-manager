// Ma'lumotlar: serverdagi JSON fayllar + brauzerdagi (localStorage) ishchi nusxa.
import { clone, stableStringify, nowISO, parse, byTime } from './utils.js';
import { setConfig } from './formatter.js';

const K_POSTS = 'ccm.posts.v1';
const K_PRISTINE = 'ccm.pristine.v1';
const K_SETTINGS = 'ccm.settings.v1';
const K_DELETED = 'ccm.deleted.v1';

const DEFAULT_SETTINGS = {
  owner: '',
  repo: '',
  branch: 'main',
  slots: ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'],
  perDay: 6,
  theme: 'auto',
};

export const state = {
  posts: [],
  server: { posts: [], meta: null, published: { items: [] }, status: null, ok: false, error: null },
  settings: { ...DEFAULT_SETTINGS },
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage mavjud emas */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* storage mavjud emas */ } }

function detectRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    return { owner, repo: seg && !seg.includes('.') ? seg : `${owner}.github.io` };
  }
  return { owner: '', repo: '' };
}

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(lsGet(K_SETTINGS) || '{}') || {}; } catch { saved = {}; }
  const det = detectRepo();
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
  if (!state.settings.owner) state.settings.owner = det.owner;
  if (!state.settings.repo) state.settings.repo = det.repo;
  if (!Array.isArray(state.settings.slots) || state.settings.slots.length < 1) {
    state.settings.slots = [...DEFAULT_SETTINGS.slots];
  }
  normalizePerDay();
}

function normalizePerDay() {
  const n = state.settings.slots.length;
  const v = Math.round(Number(state.settings.perDay)) || n;
  state.settings.perDay = Math.min(Math.max(v, 1), n);
}

/** Vaqt slotlari data/config.json dan olinadi (GitHub Actions jadvali bilan bir xil bo'lishi uchun) */
function applyConfigSlots(cfg) {
  const ok = Array.isArray(cfg && cfg.slots) && cfg.slots.length && cfg.slots.every((t) => /^\d{2}:\d{2}$/.test(t));
  if (!ok) return;
  state.settings.slots = [...cfg.slots].sort();
  state.settings.perDay = state.settings.slots.length;
}

export function saveSettings() {
  lsSet(K_SETTINGS, JSON.stringify(state.settings));
}

async function fetchJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export async function loadServer() {
  const [posts, published, status, config] = await Promise.allSettled([
    fetchJSON('data/posts.json'),
    fetchJSON('data/published.json'),
    fetchJSON('data/status.json'),
    fetchJSON('data/config.json'),
  ]);
  if (config.status === 'fulfilled' && config.value) { setConfig(config.value); applyConfigSlots(config.value); }
  const s = state.server;
  if (posts.status === 'fulfilled' && posts.value && Array.isArray(posts.value.posts)) {
    s.posts = posts.value.posts;
    s.meta = posts.value;
    s.ok = true;
    s.error = null;
  } else {
    s.ok = false;
    s.error = "data/posts.json o'qib bo'lmadi" + (posts.reason ? ` (${posts.reason.message})` : '');
  }
  s.published = published.status === 'fulfilled' && published.value && Array.isArray(published.value.items)
    ? published.value : { items: [] };
  s.status = status.status === 'fulfilled' ? status.value : null;
}

export function publishedMap() {
  const m = new Map();
  for (const it of state.server.published.items || []) if (it && it.id) m.set(it.id, it);
  return m;
}

/** published.json har doim ustun: u yerdagi ID'lar Published deb belgilanadi */
export function applyPublished(list = state.posts) {
  const map = publishedMap();
  for (const p of list) {
    const it = map.get(p.id);
    if (it && p.status !== 'Published') {
      p.status = 'Published';
      p.published_at = it.sent_at || p.published_at || null;
      if (it.message_id != null) p.message_id = it.message_id;
      delete p.last_error;
    }
  }
  return list;
}

function serverView() {
  return applyPublished(clone(state.server.posts));
}

function norm(list) {
  return stableStringify([...list].sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

/** Serverdagi (Actions yozgan) Published/Failed holatlarini, mahalliy tahrirdan yangiroq bo'lsa, qabul qiladi */
function syncStatuses() {
  const byId = new Map(state.server.posts.map((p) => [p.id, p]));
  for (const p of state.posts) {
    const s = byId.get(p.id);
    if (!s || !s.status_updated_at || s.status === p.status) continue;
    const st = parse(s.status_updated_at)?.getTime() || 0;
    const lt = parse(p.updated_at)?.getTime() || 0;
    if (st > lt) {
      p.status = s.status;
      p.status_updated_at = s.status_updated_at;
      if (s.last_error) p.last_error = s.last_error; else delete p.last_error;
      if (s.published_at) p.published_at = s.published_at;
      if (s.message_id != null) p.message_id = s.message_id;
    }
  }
}

function deletedIds() {
  try { return new Set(JSON.parse(lsGet(K_DELETED) || '[]')); } catch { return new Set(); }
}

/** Serverda bor, lekin brauzerda yo'q postlarni qo'shadi (foydalanuvchi o'zi o'chirganlaridan tashqari) */
function addMissingFromServer() {
  const have = new Set(state.posts.map((p) => p.id));
  const del = deletedIds();
  let n = 0;
  for (const sp of state.server.posts) {
    if (!have.has(sp.id) && !del.has(sp.id)) { state.posts.push(clone(sp)); n++; }
  }
  return n;
}

function adoptServer() {
  state.posts = serverView();
  lsSet(K_PRISTINE, norm(state.posts));
  lsDel(K_DELETED);
}

export function initPosts() {
  let local = null;
  try { local = JSON.parse(lsGet(K_POSTS) || 'null'); } catch { local = null; }
  if (!Array.isArray(local)) {
    adoptServer();
  } else {
    state.posts = local;
    const localNorm = norm(local);
    // Mahalliy nusxa tahrir qilinmagan yoki serverdagiga teng bo'lsa — serverning yangi versiyasini olamiz
    if (localNorm === lsGet(K_PRISTINE) || localNorm === norm(serverView())) {
      adoptServer();
    } else {
      syncStatuses();
      addMissingFromServer();
      applyPublished();
    }
  }
  persist();
}

export function persist() {
  lsSet(K_POSTS, JSON.stringify(state.posts));
}

export function isDirty() {
  if (!state.server.ok) return false;
  return norm(state.posts) !== norm(serverView());
}

export function diffSummary() {
  const srv = new Map(serverView().map((p) => [p.id, p]));
  const loc = new Map(state.posts.map((p) => [p.id, p]));
  let added = 0; let changed = 0; let removed = 0;
  for (const [id, p] of loc) {
    if (!srv.has(id)) added++;
    else if (stableStringify(p) !== stableStringify(srv.get(id))) changed++;
  }
  for (const id of srv.keys()) if (!loc.has(id)) removed++;
  return { added, changed, removed };
}

export function resetToServer() {
  adoptServer();
  persist();
}

export function clearLocal() {
  lsDel(K_POSTS);
  lsDel(K_PRISTINE);
  lsDel(K_SETTINGS);
  lsDel(K_DELETED);
}

export function getPost(id) {
  return state.posts.find((p) => p.id === id) || null;
}

export function upsertPost(p) {
  p.updated_at = nowISO();
  const i = state.posts.findIndex((x) => x.id === p.id);
  if (i >= 0) state.posts[i] = p; else state.posts.push(p);
  persist();
}

export function deletePost(id) {
  state.posts = state.posts.filter((p) => p.id !== id);
  if (state.server.posts.some((p) => p.id === id)) {
    const del = deletedIds(); del.add(id); lsSet(K_DELETED, JSON.stringify([...del]));
  }
  persist();
}

export function exportPayload() {
  return {
    version: 1,
    updated_at: nowISO(),
    posts: clone(state.posts).sort(byTime),
  };
}

export function backupPayload() {
  return { kind: 'ccm-backup', version: 1, created_at: nowISO(), settings: state.settings, posts: state.posts };
}

export function restoreBackup(data) {
  if (!data || data.kind !== 'ccm-backup' || !Array.isArray(data.posts)) throw new Error("Bu zaxira fayli emas");
  state.posts = data.posts;
  if (data.settings) { state.settings = { ...state.settings, ...data.settings }; saveSettings(); }
  applyPublished();
  persist();
}
