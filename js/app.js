// Asosiy ilova: routing, sahifalar, amallar.
import {
  state, loadSettings, saveSettings, loadServer, initPosts, persist, isDirty, diffSummary,
  resetToServer, clearLocal, getPost, upsertPost, deletePost, exportPayload, backupPayload,
  restoreBackup, applyPublished,
} from './storage.js';
import { TYPES, STATUSES, STATUS_UZ, formatPost, renderTgPreview, TG_LIMIT, CAPTION_LIMIT, imageUrl } from './formatter.js';
import { normalizePost, validatePost, findDuplicates, parseImport, normalizeHanzi } from './validator.js';
import { renderMonth, renderWeek } from './calendar.js';
import * as U from './utils.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = () => $('#main');
let timers = [];
const ui = {
  postsFilter: { status: 'all', type: 'all', q: '' },
  cal: { mode: 'week', anchor: U.todayKey() },
  importReport: null,
};

const PENDING = new Set(['Approved', 'Scheduled']);
const WINDOW_MS = 12 * 3600 * 1000;
const EMOJIS = ['📚', '📐', '🐉', '🏮', '✍️', '💬', '😎', '💡', '🎯', '🌐', '🇨🇳', '🇺🇿', '🔥', '⭐', '✅', '❗', '🎉', '🍜', '🥟', '🍵', '🧧', '🐼', '📝', '🗣️', '🎧', '💪', '❤️', '😂', '🤔', '👉'];

/* ---------- Umumiy UI ---------- */

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function confirmBox(msg, okText = 'Ha', danger = false) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <p>${U.esc(msg)}</p>
      <div class="row end">
        <button class="btn ghost" data-a="no">Bekor qilish</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${U.esc(okText)}</button>
      </div></div>`;
    m.hidden = false;
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target === m || a) {
        m.hidden = true;
        m.innerHTML = '';
        resolve(a === 'yes');
      }
    };
  });
}

const statusBadge = (s) => `<span class="badge st-${s}">${STATUS_UZ[s] || U.esc(s)}</span>`;
const typeBadge = (t) => {
  const x = TYPES[t];
  return `<span class="type-badge">${x ? `${x.emoji} ${U.esc(x.uz)}` : U.esc(t || '—')}</span>`;
};
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#111114' : '#C8102E';
}

function updateChrome() {
  const dirty = isDirty();
  const pill = $('#dirtyPill');
  pill.hidden = !dirty;
  const banner = $('#banner');
  if (!state.server.ok) {
    banner.hidden = false;
    banner.className = 'banner bad';
    banner.innerHTML = `<span class="banner-text">⚠️ ${U.esc(state.server.error || "Ma'lumot yuklanmadi")}. Brauzerdagi nusxa ko'rsatilmoqda.</span>`;
  } else if (dirty) {
    const d = diffSummary();
    banner.hidden = false;
    banner.className = 'banner warn';
    banner.innerHTML = `<span class="banner-text">📝 Saqlanmagan o'zgarishlar: +${d.added} yangi, ${d.changed} o'zgargan, −${d.removed} o'chirilgan. Kanalga ketishi uchun <b>posts.json</b> ni repo'ga yuklang.</span>
      <a class="btn small primary" href="#export">Eksport qilish</a>`;
  } else {
    banner.hidden = true;
  }
}

function nextFreeSlot(fromKey = U.addDays(U.todayKey(), 1), exceptId = null) {
  const slots = state.settings.slots.slice(0, state.settings.perDay);
  const taken = new Set(state.posts.filter((p) => p.id !== exceptId && p.scheduled_at && p.status !== 'Failed')
    .map((p) => `${U.postKey(p)} ${U.postTime(p)}`));
  for (let i = 0; i < 400; i++) {
    const dk = U.addDays(fromKey, i);
    for (const t of slots) {
      if (dk === U.todayKey() && U.parse(U.toISO(dk, t)).getTime() <= Date.now()) continue;
      if (!taken.has(`${dk} ${t}`)) return U.toISO(dk, t);
    }
  }
  return null;
}

/** Tasdiqlangan, vaqti yo'q postlarni bo'sh slotlarga turiga qarab joylashtiradi */
function autoDistribute() {
  const slots = state.settings.slots.slice(0, state.settings.perDay);
  const pool = state.posts.filter((p) => p.status === 'Approved' && !p.scheduled_at);
  if (!pool.length) return 0;
  const occupied = new Map();
  for (const p of state.posts) {
    if (!p.scheduled_at || p.status === 'Failed') continue;
    const k = U.postKey(p);
    if (!occupied.has(k)) occupied.set(k, { times: new Set(), types: new Set() });
    occupied.get(k).times.add(U.postTime(p));
    occupied.get(k).types.add(p.type);
  }
  let count = 0;
  let dk = U.todayKey();
  for (let day = 0; day < 400 && pool.length; day++, dk = U.addDays(dk, 1)) {
    if (!occupied.has(dk)) occupied.set(dk, { times: new Set(), types: new Set() });
    const o = occupied.get(dk);
    slots.forEach((time, idx) => {
      if (!pool.length || o.times.has(time)) return;
      if (U.parse(U.toISO(dk, time)).getTime() <= Date.now() + 10 * 60000) return;
      const want = slots.length === 1 ? null : (idx < slots.length / 2 ? 'am' : 'pm');
      let i = pool.findIndex((p) => (!want || TYPES[p.type]?.slot === want) && !o.types.has(p.type));
      if (i < 0) i = pool.findIndex((p) => !o.types.has(p.type));
      if (i < 0) return;
      const [p] = pool.splice(i, 1);
      p.scheduled_at = U.toISO(dk, time);
      p.status = 'Scheduled';
      p.updated_at = U.nowISO();
      o.times.add(time);
      o.types.add(p.type);
      count++;
    });
  }
  persist();
  return count;
}


/** "Hozir yuborish": token brauzerda yo'q, shuning uchun GitHub Actions'ni post ID bilan qo'lda ishga tushirish yo'riqnomasi */
async function sendNowDialog(id) {
  const p = getPost(id);
  if (!p) return;
  const s = state.settings;
  const onServer = state.server.posts.some((q) => q.id === id);
  const localChanged = isDirty();
  const url = s.owner && s.repo
    ? `https://github.com/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/actions/workflows/publish.yml`
    : '';
  const copied = await U.copyText(id);
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card send-now" role="dialog" aria-modal="true">
    <h3>⚡ Hozir yuborish</h3>
    <p class="muted">Bot tokeni xavfsizlik uchun faqat GitHub'da turadi, shuning uchun yuborishni GitHub Actions bajaradi (30–60 soniya).</p>
    ${!onServer ? '<div class="msg err">❌ Bu post hali repo\'da yo\'q. Avval <a href="#export">Eksport</a> sahifasidan posts.json ni yuklang.</div>'
    : (localChanged ? '<div class="msg warn">⚠️ Brauzerda saqlanmagan o\'zgarishlar bor — repo\'dagi (eski) matn yuboriladi. Avval eksport qiling.</div>' : '')}
    <ol class="steps">
      <li>Post ID: <code class="mono">${U.esc(id)}</code> ${copied ? '<span class="muted">— nusxa olindi ✓</span>' : ''}</li>
      <li>${url ? `<a href="${url}" target="_blank" rel="noopener">GitHub → Publish to Telegram</a>` : 'GitHub → Actions → Publish to Telegram'} sahifasini oching.</li>
      <li><b>Run workflow</b> → "Hozir yuboriladigan post ID" maydoniga ID ni qo'ying → yashil <b>Run workflow</b>.</li>
      <li>Bir daqiqadan so'ng post kanalda bo'ladi; dashboardda ↻ bosing.</li>
    </ol>
    <div class="row end">
      <button class="btn ghost" data-a="copy">📋 ID nusxa</button>
      ${url && onServer ? `<a class="btn primary" href="${url}" target="_blank" rel="noopener" data-a="open">GitHub'ni ochish</a>` : ''}
      <button class="btn" data-a="close">Yopish</button>
    </div></div>`;
  m.hidden = false;
  m.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'copy') { toast(await U.copyText(id) ? 'ID nusxa olindi' : "Nusxa olib bo'lmadi"); return; }
    if (e.target === m || a === 'close' || a === 'open') { m.hidden = true; m.innerHTML = ''; }
  };
}

/* ---------- Dashboard ---------- */

function renderDashboard(el) {
  const now = Date.now();
  const today = U.todayKey();
  const posts = state.posts;
  const todays = posts.filter((p) => U.postKey(p) === today).sort(U.byTime);
  const pending = posts.filter((p) => PENDING.has(p.status) && p.scheduled_at
    && U.parse(p.scheduled_at).getTime() > now - WINDOW_MS).sort(U.byTime);
  const next = pending[0];
  const published = [...(state.server.published.items || [])].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at))).slice(0, 10);
  const count = (s) => posts.filter((p) => p.status === s).length;
  const upcoming7 = posts.filter((p) => {
    const k = U.postKey(p);
    return k && k >= today && k <= U.addDays(today, 6);
  }).sort(U.byTime);

  el.innerHTML = `
  <div class="page-head"><div><h1>Dashboard <span class="zh">控制台</span></h1><p class="sub">${U.fmtDate(today)} · Asia/Tashkent</p></div>
    <div class="row"><a class="btn primary" href="#editor/new">+ Yangi post</a></div></div>

  <div class="stats">
    <div class="stat"><span class="stat-label">Bugungi postlar</span><b>${todays.length}</b></div>
    <div class="stat"><span class="stat-label">Jami tayyorlangan</span><b>${posts.length}</b></div>
    <div class="stat"><span class="stat-label">Rejalashtirilgan</span><b>${pending.length}</b><small>${count('Draft')} qoralama</small></div>
    <div class="stat"><span class="stat-label">Nashr qilingan</span><b>${(state.server.published.items || []).length}</b></div>
    <div class="stat ${count('Failed') ? 'alert' : ''}"><span class="stat-label">Xato</span><b>${count('Failed')}</b></div>
  </div>

  <div class="grid-2">
    <div class="card next-card">
      <h3>Keyingi post</h3>
      ${next ? `
        <div class="next-main" data-open="${U.esc(next.id)}">
          <div class="next-hanzi">${U.esc(next.hanzi || '(matn)')}</div>
          <div>${typeBadge(next.type)} ${statusBadge(next.status)}</div>
          <div class="next-when">${U.fmtDT(next.scheduled_at)}</div>
          <div class="countdown" id="countdown" data-at="${U.esc(next.scheduled_at)}">—</div>
        </div>` : `<div class="empty">Rejalashtirilgan post yo'q. <a href="#posts">Postlarni</a> tasdiqlang va kalendarga joylang.</div>`}
    </div>
    <div class="card">
      <h3>Telegram holati</h3>
      ${tgStatusHTML()}
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <h3>Bugun</h3>
      ${todays.length ? `<ul class="list">${todays.map(rowItem).join('')}</ul>` : '<div class="empty">Bugunga post yo\'q.</div>'}
      <h3 class="mt">Yaqin 7 kun</h3>
      ${upcoming7.length ? `<ul class="list">${upcoming7.map(rowItem).join('')}</ul>` : '<div class="empty">Bo\'sh. <a href="#calendar">Kalendarni</a> oching.</div>'}
    </div>
    <div class="card">
      <h3>Oxirgi nashrlar</h3>
      ${published.length ? `<ul class="list">${published.map((it) => `<li class="li" data-open="${U.esc(it.id)}">
          <span class="li-hanzi">${U.esc(it.hanzi || it.id)}</span>
          <span class="li-meta">${U.fmtDT(it.sent_at)}</span>
          ${statusBadge('Published')}</li>`).join('')}</ul>` : '<div class="empty">Hali nashr yo\'q.</div>'}
    </div>
  </div>`;

  $$('[data-open]', el).forEach((n) => n.addEventListener('click', () => {
    if (getPost(n.dataset.open)) go(`#editor/${encodeURIComponent(n.dataset.open)}`);
  }));
  const cd = $('#countdown');
  if (cd) {
    const tick = () => {
      const ms = U.parse(cd.dataset.at).getTime() - Date.now();
      cd.textContent = ms > 0 ? U.countdown(ms) : 'navbatda — GitHub Actions yuboradi';
    };
    tick();
    timers.push(setInterval(tick, 1000));
  }
}

function rowItem(p) {
  return `<li class="li" data-open="${U.esc(p.id)}">
    <span class="li-time">${U.postTime(p) || '—'}</span>
    <span class="li-hanzi">${U.esc(p.hanzi || '(matn)')}</span>
    <span class="li-meta">${TYPES[p.type]?.emoji || ''} ${U.esc(p.translation_uz || '')}</span>
    ${statusBadge(p.status)}</li>`;
}

function tgStatusHTML() {
  const s = state.server.status;
  if (!s || !s.last_run) {
    return `<div class="tg-state unknown"><span class="dot"></span><div><b>Hali ishga tushmagan</b>
      <p>GitHub Actions'dagi <i>Publish to Telegram</i> birinchi marta ishlagach, holat shu yerda chiqadi. Sinash uchun Actions → Publish to Telegram → Run workflow.</p></div></div>`;
  }
  const age = Date.now() - (U.parse(s.last_run)?.getTime() || 0);
  let cls = 'good';
  let title = 'Ulangan';
  if (s.secrets_ok === false) { cls = 'bad'; title = 'Secrets sozlanmagan'; }
  else if (s.bot_ok === false) { cls = 'bad'; title = "Bot token noto'g'ri"; }
  else if (s.channel_ok === false) { cls = 'bad'; title = 'Kanalga ulanib bo\'lmadi'; }
  else if ((s.failed || []).length) { cls = 'warn'; title = 'Oxirgi ishga tushishda xato bor'; }
  else if (age > 26 * 3600e3) { cls = 'warn'; title = 'Actions uzoq vaqt ishlamagan'; }
  return `<div class="tg-state ${cls}"><span class="dot"></span><div>
    <b>${title}</b>
    <p>${s.bot_username ? `Bot: @${U.esc(s.bot_username)}` : ''}${s.channel_title ? ` · Kanal: ${U.esc(s.channel_title)}` : ''}</p>
    <p class="muted">Oxirgi tekshiruv: ${U.fmtDT(s.last_run)} (${U.ago(s.last_run)})${s.dry_run ? ' · sinov rejimi' : ''}</p>
    ${s.message ? `<p class="muted">${U.esc(s.message)}</p>` : ''}
    ${(s.failed || []).map((f) => `<p class="err">❌ ${U.esc(f.id)}: ${U.esc(f.error)}</p>`).join('')}
    ${(s.expired || []).length ? `<p class="warn-text">⏰ Muddati o'tib ketgan (yuborilmagan): ${s.expired.map(U.esc).join(', ')}</p>` : ''}
    ${s.last_sent_at ? `<p class="muted">Oxirgi yuborilgan: ${U.fmtDT(s.last_sent_at)}</p>` : ''}
  </div></div>`;
}

/* ---------- Postlar ro'yxati ---------- */

function renderPosts(el) {
  const f = ui.postsFilter;
  el.innerHTML = `
  <div class="page-head"><div><h1>Postlar <span class="zh">帖子</span></h1><p class="sub">${state.posts.length} ta post</p></div>
    <div class="row">
      <button class="btn ghost" id="autoDist">⚡ Avto-taqsimlash</button>
      <a class="btn primary" href="#editor/new">+ Yangi post</a>
    </div></div>
  <div class="card">
    <div class="filters">
      <input type="search" id="fq" placeholder="Qidirish: hanzi, pinyin, tarjima..." value="${U.esc(f.q)}">
      <select id="fs"><option value="all">Barcha statuslar</option>${STATUSES.map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${STATUS_UZ[s]}</option>`).join('')}</select>
      <select id="ft"><option value="all">Barcha turlar</option>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${t.emoji} ${t.uz}</option>`).join('')}</select>
    </div>
    <div class="bulk" id="bulk" hidden>
      <span id="bulkCount"></span>
      <button class="btn small" data-bulk="approve">✓ Tasdiqlash</button>
      <button class="btn small" data-bulk="draft">Qoralamaga qaytarish</button>
      <button class="btn small danger" data-bulk="delete">O'chirish</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th><input type="checkbox" id="selAll" aria-label="Hammasini tanlash"></th><th>Vaqt</th><th>Tur</th><th>Hanzi</th><th class="hide-sm">Pinyin</th><th class="hide-sm">Tarjima</th><th>Status</th><th></th></tr></thead>
      <tbody id="tbody"></tbody>
    </table></div>
  </div>`;

  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const rows = state.posts.filter((p) => (f.status === 'all' || p.status === f.status)
      && (f.type === 'all' || p.type === f.type)
      && (!q || [p.hanzi, p.pinyin, p.translation_uz, p.id, p.explanation_uz].some((x) => String(x || '').toLowerCase().includes(q))))
      .sort(U.byTime);
    $('#tbody').innerHTML = rows.length ? rows.map((p) => `<tr data-id="${U.esc(p.id)}">
      <td><input type="checkbox" class="sel" value="${U.esc(p.id)}" aria-label="Tanlash"></td>
      <td class="nowrap">${p.scheduled_at ? U.fmtDT(p.scheduled_at) : '<span class="muted">—</span>'}</td>
      <td>${typeBadge(p.type)}</td>
      <td class="hanzi-cell">${U.esc(p.hanzi || '(matn)')}${p.image ? ' <span title="Rasm bor">🖼</span>' : ''}</td>
      <td class="hide-sm">${U.esc(p.pinyin)}</td>
      <td class="hide-sm">${U.esc(p.translation_uz)}</td>
      <td>${statusBadge(p.status)}${p.last_error ? `<div class="err small" title="${U.esc(p.last_error)}">${U.esc(p.last_error.slice(0, 60))}</div>` : ''}</td>
      <td class="nowrap actions">
        <a class="icon-btn" href="#editor/${encodeURIComponent(p.id)}" title="Tahrirlash">✎</a>
        ${p.status !== 'Published' ? `<button class="icon-btn" data-send="${U.esc(p.id)}" title="Hozir yuborish">⚡</button>` : ''}
        <button class="icon-btn" data-dup="${U.esc(p.id)}" title="Nusxa ko'paytirish">⧉</button>
        ${p.status !== 'Published' ? `<button class="icon-btn danger" data-del="${U.esc(p.id)}" title="O'chirish">🗑</button>` : ''}
      </td></tr>`).join('') : '<tr><td colspan="8" class="empty">Post topilmadi. <a href="#import">Import</a> qiling yoki yangi post yarating.</td></tr>';
    syncBulk();
  };

  const selected = () => $$('.sel:checked', el).map((c) => c.value);
  const syncBulk = () => {
    const n = selected().length;
    $('#bulk').hidden = !n;
    $('#bulkCount').textContent = `${n} ta tanlandi`;
  };

  $('#fq').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
  $('#fs').addEventListener('change', (e) => { f.status = e.target.value; draw(); });
  $('#ft').addEventListener('change', (e) => { f.type = e.target.value; draw(); });
  $('#selAll').addEventListener('change', (e) => { $$('.sel', el).forEach((c) => { c.checked = e.target.checked; }); syncBulk(); });
  el.addEventListener('change', (e) => { if (e.target.classList.contains('sel')) syncBulk(); });
  el.addEventListener('click', async (e) => {
    const send = e.target.closest('[data-send]');
    if (send) { sendNowDialog(send.dataset.send); return; }
    const dup = e.target.closest('[data-dup]');
    const del = e.target.closest('[data-del]');
    const bulk = e.target.closest('[data-bulk]');
    const row = e.target.closest('tr[data-id]');
    if (dup) { duplicatePost(dup.dataset.dup); return; }
    if (del) {
      if (await confirmBox("Post o'chirilsinmi?", "O'chirish", true)) { deletePost(del.dataset.del); toast("O'chirildi"); draw(); updateChrome(); }
      return;
    }
    if (bulk) {
      const ids = selected();
      if (bulk.dataset.bulk === 'delete') {
        const ok = await confirmBox(`${ids.length} ta post o'chirilsinmi? (Nashr qilinganlar o'chirilmaydi)`, "O'chirish", true);
        if (!ok) return;
        ids.forEach((id) => { if (getPost(id)?.status !== 'Published') deletePost(id); });
        toast("O'chirildi");
      } else {
        let done = 0; let skipped = 0;
        for (const id of ids) {
          const p = getPost(id);
          if (!p || p.status === 'Published') { skipped++; continue; }
          if (bulk.dataset.bulk === 'approve') {
            if (validatePost(p).errors.length) { skipped++; continue; }
            p.status = p.scheduled_at ? 'Scheduled' : 'Approved';
          } else p.status = 'Draft';
          upsertPost(p);
          done++;
        }
        toast(`${done} ta yangilandi${skipped ? `, ${skipped} ta o'tkazib yuborildi` : ''}`, skipped ? 'warn' : 'ok');
      }
      draw();
      updateChrome();
      return;
    }
    if (row && !e.target.closest('input,a,button')) go(`#editor/${encodeURIComponent(row.dataset.id)}`);
  });
  $('#autoDist').addEventListener('click', () => {
    const n = autoDistribute();
    toast(n ? `${n} ta post kalendarga joylandi` : "Joylanadigan post yo'q (vaqtsiz Tasdiqlangan postlar kerak)", n ? 'ok' : 'warn');
    draw();
    updateChrome();
  });
  draw();
}

function duplicatePost(id) {
  const src = getPost(id);
  if (!src) return;
  const p = U.clone(src);
  p.id = U.uid('post');
  p.status = 'Draft';
  p.scheduled_at = null;
  p.created_at = U.nowISO();
  delete p.published_at; delete p.message_id; delete p.last_error; delete p.status_updated_at;
  upsertPost(p);
  toast('Nusxa yaratildi');
  go(`#editor/${encodeURIComponent(p.id)}`);
}

/* ---------- Editor ---------- */

function blankPost(date, time) {
  return {
    id: U.uid('post'), type: 'vocabulary', title_zh: '', hanzi: '', pinyin: '', translation_uz: '',
    explanation_uz: '', examples: [{ zh: '', pinyin: '', uz: '' }, { zh: '', pinyin: '', uz: '' }],
    emoji: '', hsk_level: null, tags: [], text_override: null, image: null,
    scheduled_at: date ? U.toISO(date, time || state.settings.slots[0]) : null,
    status: 'Draft', created_at: U.nowISO(),
  };
}

function renderEditor(el, arg) {
  const [idPart, query] = String(arg || 'new').split('?');
  const params = new URLSearchParams(query || '');
  const isNew = idPart === 'new';
  const existing = isNew ? null : getPost(idPart);
  if (!isNew && !existing) {
    el.innerHTML = '<div class="card empty">Post topilmadi. <a href="#posts">Postlar ro\'yxatiga</a> qayting.</div>';
    return;
  }
  const p = isNew ? blankPost(params.get('date'), params.get('time')) : U.clone(existing);
  const ro = p.status === 'Published';
  const dis = ro ? 'disabled' : '';
  const date = U.postKey(p) || '';
  const time = U.postTime(p) || '';

  el.innerHTML = `
  <div class="page-head"><div><h1>${isNew ? 'Yangi post' : 'Postni tahrirlash'} <span class="zh">编辑</span></h1>
    <p class="sub">${statusBadge(p.status)} <span class="muted mono">${U.esc(p.id)}</span></p></div>
    <div class="row"><a class="btn ghost" href="#posts">← Ro'yxat</a></div></div>
  ${ro ? `<div class="banner info">✅ Bu post ${U.fmtDT(p.published_at)} da nashr qilingan, uni tahrirlab bo'lmaydi. Nusxa ko'paytirib yangisini yaratishingiz mumkin.</div>` : ''}
  ${p.last_error ? `<div class="banner bad">❌ Oxirgi xato: ${U.esc(p.last_error)}. Matnni tekshirib, qayta rejalashtiring.</div>` : ''}
  <div class="editor">
    <form class="card form" id="form" autocomplete="off">
      <div class="grid-form">
        <label>Tur<select name="type" ${dis}>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${t.emoji} ${t.uz}</option>`).join('')}</select></label>
        <label>Sarlavha (xitoycha)<input name="title_zh" value="${U.esc(p.title_zh)}" placeholder="${U.esc(TYPES[p.type]?.zh || '')}" ${dis}></label>
        <label>Hanzi<input name="hanzi" class="hanzi-input" value="${U.esc(p.hanzi)}" placeholder="努力" ${dis}></label>
        <label>Pinyin<input name="pinyin" value="${U.esc(p.pinyin)}" placeholder="nǔlì" ${dis}></label>
        <label class="span-2">O'zbekcha tarjima<input name="translation_uz" value="${U.esc(p.translation_uz)}" ${dis}></label>
        <label class="span-2">Sodda tushuntirish<textarea name="explanation_uz" rows="3" ${dis}>${U.esc(p.explanation_uz)}</textarea></label>
      </div>

      <div class="section-title">Misollar <button type="button" class="btn small ghost" id="addEx" ${dis}>+ Misol</button></div>
      <div id="examples"></div>

      <div class="grid-form">
        <label>Emoji<input name="emoji" value="${U.esc(p.emoji)}" placeholder="${TYPES[p.type]?.emoji || ''}" ${dis}></label>
        <label>HSK darajasi<select name="hsk_level" ${dis}><option value="">—</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${p.hsk_level === n ? 'selected' : ''}>HSK ${n}</option>`).join('')}</select></label>
        <label class="span-2">Teglar (vergul bilan)<input name="tags" value="${U.esc((p.tags || []).join(', '))}" placeholder="HSK3, so'zlar" ${dis}></label>
        <label class="span-2">Rasm (ixtiyoriy)<input name="image" value="${U.esc(p.image || '')}" placeholder="assets/images/rasm.jpg yoki https://..." ${dis}>
          <span class="muted small">Rasmni GitHub'dagi <code>assets/images</code> papkasiga yuklang va yo'lini yozing, yoki internetdagi rasm manzilini qo'ying.</span></label>
        <label>Sana<input type="date" name="date" value="${date}" ${dis}></label>
        <label>Vaqt<input type="time" name="time" value="${time}" list="slotTimes" ${dis}>
          <datalist id="slotTimes">${state.settings.slots.map((t) => `<option value="${t}">`).join('')}</datalist></label>
      </div>
      ${ro ? '' : '<div class="row"><button type="button" class="btn small ghost" id="pickSlot">📅 Keyingi bo\'sh slot</button><button type="button" class="btn small ghost" id="clearDate">Vaqtni olib tashlash</button></div>'}

      <div class="emoji-bar" ${ro ? 'hidden' : ''}>${EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>

      <details class="override" ${p.text_override ? 'open' : ''} ${ro ? 'hidden' : ''}>
        <summary>Matnni qo'lda tahrirlash (Telegram HTML)</summary>
        <p class="muted small">To'ldirilsa, avtomatik format o'rniga aynan shu matn yuboriladi. Ruxsat etilgan teglar: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;s&gt;, &lt;code&gt;, &lt;blockquote&gt;, &lt;tg-spoiler&gt;, &lt;a href&gt;.</p>
        <div class="toolbar">
          <button type="button" data-wrap="b"><b>B</b></button>
          <button type="button" data-wrap="i"><i>I</i></button>
          <button type="button" data-wrap="u"><u>U</u></button>
          <button type="button" data-wrap="code">&lt;/&gt;</button>
          <button type="button" data-wrap="tg-spoiler">Spoiler</button>
          <button type="button" id="fromAuto">Avtomatik matndan boshlash</button>
          <button type="button" id="clearOverride">Tozalash</button>
        </div>
        <textarea name="text_override" rows="12" class="mono">${U.esc(p.text_override || '')}</textarea>
      </details>

      <div id="validation"></div>

      <div class="actions-bar">
        ${ro ? '<button type="button" class="btn" data-act="dup">⧉ Nusxa ko\'paytirish</button>' : `
        <button type="button" class="btn ghost" data-act="draft">💾 Qoralama</button>
        <button type="button" class="btn" data-act="approve">✓ Tasdiqlash</button>
        <button type="button" class="btn primary" data-act="schedule">📅 Rejalashtirish</button>
        ${isNew ? '' : '<button type="button" class="btn ghost" data-act="sendnow">⚡ Hozir yuborish</button><button type="button" class="btn ghost" data-act="dup">⧉ Nusxa</button><button type="button" class="btn danger ghost" data-act="delete">🗑 O\'chirish</button>'}`}
      </div>
    </form>

    <aside class="preview-col">
      <div class="card preview-card">
        <div class="tg-head"><span class="tg-avatar">中</span><div><b>Kanal</b><small>Telegram preview</small></div></div>
        <img id="previewImg" class="tg-image" alt="" hidden><div class="tg-bubble" id="preview"></div>
        <div class="counter" id="counter"></div>
      </div>
    </aside>
  </div>`;

  const form = $('#form');
  const exBox = $('#examples');
  let lastFocused = null;

  const drawExamples = () => {
    exBox.innerHTML = p.examples.map((x, i) => `<div class="example">
      <div class="ex-num">${i + 1}</div>
      <div class="ex-fields">
        <input data-ex="${i}" data-k="zh" value="${U.esc(x.zh)}" placeholder="Xitoycha gap" class="hanzi-input" ${dis}>
        <input data-ex="${i}" data-k="pinyin" value="${U.esc(x.pinyin)}" placeholder="Pinyin" ${dis}>
        <input data-ex="${i}" data-k="uz" value="${U.esc(x.uz)}" placeholder="O'zbekcha tarjima" ${dis}>
      </div>
      ${ro ? '' : `<button type="button" class="icon-btn danger" data-rmex="${i}" title="Olib tashlash">✕</button>`}
    </div>`).join('') || '<div class="muted small">Misol yo\'q</div>';
  };

  const collect = () => {
    const fd = new FormData(form);
    p.type = fd.get('type') ?? p.type;
    for (const k of ['title_zh', 'hanzi', 'pinyin', 'translation_uz', 'explanation_uz', 'emoji']) {
      if (fd.has(k)) p[k] = String(fd.get(k)).trim();
    }
    if (fd.has('hsk_level')) p.hsk_level = fd.get('hsk_level') ? Number(fd.get('hsk_level')) : null;
    if (fd.has('tags')) p.tags = String(fd.get('tags')).split(',').map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
    if (fd.has('image')) p.image = String(fd.get('image')).trim() || null;
    const ov = fd.get('text_override');
    if (ov !== null) p.text_override = String(ov).trim() ? String(ov) : null;
    const d = fd.get('date');
    const t = fd.get('time');
    if (d !== null) p.scheduled_at = d ? U.toISO(d, t || state.settings.slots[0]) : null;
    $$('[data-ex]', exBox).forEach((inp) => { p.examples[+inp.dataset.ex][inp.dataset.k] = inp.value.trim(); });
  };

  const refresh = () => {
    if (!ro) collect();
    const text = formatPost(p);
    $('#preview').innerHTML = renderTgPreview(text);
    const v = validatePost(p);
    const img = $('#previewImg');
    const src = imageUrl(p.image);
    if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
    const c = $('#counter');
    c.textContent = src
      ? `${v.length} belgi · rasm bilan: ${v.length <= CAPTION_LIMIT ? 'bitta xabar' : 'rasm + alohida matn'}`
      : `${v.length} / ${TG_LIMIT} belgi`;
    c.classList.toggle('over', v.length > TG_LIMIT);
    const dups = findDuplicates(p, state.posts, state.server.published.items);
    const sched = U.parse(p.scheduled_at);
    const past = sched && sched.getTime() < Date.now() && !ro;
    const sameDay = p.scheduled_at ? state.posts.filter((q) => q.id !== p.id && U.postKey(q) === U.postKey(p) && q.type === p.type && q.type !== 'hsk' && q.status !== 'Failed') : [];
    const sameSlot = p.scheduled_at ? state.posts.filter((q) => q.id !== p.id && q.scheduled_at && U.postKey(q) === U.postKey(p) && U.postTime(q) === U.postTime(p) && q.status !== 'Failed') : [];
    $('#validation').innerHTML = `
      ${v.errors.map((x) => `<div class="msg err">❌ ${U.esc(x)}</div>`).join('')}
      ${v.warnings.map((x) => `<div class="msg warn">⚠️ ${U.esc(x)}</div>`).join('')}
      ${past ? '<div class="msg warn">⏰ Tanlangan vaqt o\'tib ketgan — yangi vaqt tanlang.</div>' : ''}
      ${sameDay.length ? `<div class="msg warn">📆 Shu kuni yana ${sameDay.length} ta "${U.esc(TYPES[p.type]?.uz || p.type)}" posti bor.</div>` : ''}
      ${sameSlot.length ? `<div class="msg warn">🕘 Shu vaqtda boshqa post ham bor: ${sameSlot.map((q) => U.esc(q.hanzi || q.id)).join(', ')}</div>` : ''}
      ${dups.map((d) => `<div class="msg warn">🔁 Takror: "${U.esc(d.hanzi)}" — ${d.source === 'published' ? 'nashr qilingan' : STATUS_UZ[d.status]} ${d.when ? '(' + U.fmtDT(d.when) + ')' : ''}
        ${d.source === 'post' ? `<a href="#editor/${encodeURIComponent(d.id)}">ochish</a>` : ''}</div>`).join('')}
      ${!v.errors.length && !v.warnings.length && !dups.length && !past ? '<div class="msg ok">✅ Hammasi joyida</div>' : ''}`;
    return v;
  };

  drawExamples();
  refresh();
  if (ro) return wireReadonly();

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('focusin', (e) => { if (e.target.matches('input,textarea')) lastFocused = e.target; });

  $('#addEx').addEventListener('click', () => {
    collect();
    if (p.examples.length >= 5) { toast("Ko'pi bilan 5 ta misol", 'warn'); return; }
    p.examples.push({ zh: '', pinyin: '', uz: '' });
    drawExamples();
    refresh();
  });
  exBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rmex]');
    if (!b) return;
    collect();
    p.examples.splice(+b.dataset.rmex, 1);
    drawExamples();
    refresh();
  });
  $('#pickSlot').addEventListener('click', () => {
    const iso = nextFreeSlot(U.todayKey(), p.id);
    if (!iso) return;
    form.date.value = iso.slice(0, 10);
    form.time.value = iso.slice(11, 16);
    refresh();
  });
  $('#clearDate').addEventListener('click', () => { form.date.value = ''; form.time.value = ''; refresh(); });

  const ta = form.text_override;
  $$('.emoji-btn', el).forEach((b) => b.addEventListener('click', () => {
    const target = lastFocused && lastFocused.closest('form') === form && lastFocused.name !== 'emoji' ? lastFocused : null;
    if (target && target.type !== 'date' && target.type !== 'time' && target.tagName !== 'SELECT') {
      const s = target.selectionStart ?? target.value.length;
      target.setRangeText(b.dataset.emoji, s, target.selectionEnd ?? s, 'end');
      target.focus();
    } else {
      form.emoji.value = b.dataset.emoji;
    }
    refresh();
  }));
  $$('[data-wrap]', el).forEach((b) => b.addEventListener('click', () => {
    const tag = b.dataset.wrap;
    const s = ta.selectionStart; const e2 = ta.selectionEnd;
    const sel = ta.value.slice(s, e2);
    ta.setRangeText(`<${tag}>${sel}</${tag}>`, s, e2, 'select');
    ta.focus();
    refresh();
  }));
  $('#fromAuto').addEventListener('click', () => {
    const saved = p.text_override;
    p.text_override = null;
    ta.value = formatPost(p);
    p.text_override = saved;
    refresh();
  });
  $('#clearOverride').addEventListener('click', () => { ta.value = ''; refresh(); });

  $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'sendnow') { sendNowDialog(p.id); return; }
    if (act === 'dup') { collect(); duplicatePost(p.id); return; }
    if (act === 'delete') {
      if (await confirmBox("Post o'chirilsinmi?", "O'chirish", true)) {
        deletePost(p.id);
        toast("O'chirildi");
        go('#posts');
      }
      return;
    }
    collect();
    const np = normalizePost(p);
    if (act === 'draft') {
      np.status = 'Draft';
    } else {
      if (act === 'schedule' && !np.scheduled_at) {
        np.scheduled_at = nextFreeSlot(U.todayKey(), np.id);
        toast(`Keyingi bo'sh slot tanlandi: ${U.fmtDT(np.scheduled_at)}`);
      }
      np.status = act === 'approve' ? 'Approved' : 'Scheduled';
      const v = validatePost(np);
      if (v.errors.length) { toast('Xatolarni tuzating: ' + v.errors[0], 'bad'); refresh(); return; }
      if (np.scheduled_at && U.parse(np.scheduled_at).getTime() < Date.now()) {
        toast("O'tib ketgan vaqtga rejalashtirib bo'lmaydi", 'bad');
        return;
      }
    }
    if (np.status !== 'Failed') delete np.last_error;
    upsertPost(np);
    toast(act === 'draft' ? 'Qoralama saqlandi' : (np.status === 'Approved' ? (np.scheduled_at ? 'Tasdiqlandi va vaqtga qo\'yildi' : 'Tasdiqlandi (vaqti yo\'q — avto-taqsimlashda joylanadi)') : 'Rejalashtirildi'));
    go(`#editor/${encodeURIComponent(np.id)}`);
  }));

  function wireReadonly() {
    $$('[data-act="dup"]', el).forEach((b) => b.addEventListener('click', () => duplicatePost(p.id)));
  }
}

/* ---------- Kalendar ---------- */

function renderCalendarView(el) {
  const c = ui.cal;
  const slots = state.settings.slots.slice(0, state.settings.perDay);
  const weekStart = U.addDays(c.anchor, -U.dowOf(c.anchor));
  const [ay, am] = c.anchor.split('-').map(Number);
  const title = c.mode === 'week'
    ? `${U.fmtDate(weekStart)} — ${U.fmtDate(U.addDays(weekStart, 6))}`
    : `${U.MONTHS[am - 1]} ${ay}`;

  el.innerHTML = `
  <div class="page-head"><div><h1>Kontent kalendari <span class="zh">日历</span></h1><p class="sub">Slotlar: ${slots.join(', ')} · Asia/Tashkent</p></div>
    <div class="row"><button class="btn ghost" id="autoDist">⚡ Avto-taqsimlash</button></div></div>
  <div class="card">
    <div class="cal-bar">
      <div class="seg"><button class="${c.mode === 'week' ? 'on' : ''}" data-mode="week">Hafta</button><button class="${c.mode === 'month' ? 'on' : ''}" data-mode="month">Oy</button></div>
      <div class="row"><button class="btn small ghost" id="prev" aria-label="Oldingi">‹</button><button class="btn small ghost" id="today">Bugun</button><button class="btn small ghost" id="next" aria-label="Keyingi">›</button></div>
      <b class="cal-title">${title}</b>
    </div>
    <div class="legend">${STATUSES.map((s) => `<span class="lg st-${s}">${STATUS_UZ[s]}</span>`).join('')}</div>
    <div id="cal"></div>
    <p class="muted small">Postni boshqa kun yoki slotga sudrab o'tkazing. Bo'sh joyni bossangiz — o'sha vaqtga yangi post. Telefonda: postni ochib sanasini o'zgartiring.</p>
  </div>`;

  const cb = {
    onOpen: (id) => go(`#editor/${encodeURIComponent(id)}`),
    onNew: (date, time) => go(`#editor/new?date=${date}${time ? `&time=${time}` : ''}`),
    onMove: (id, date, time) => {
      const p = getPost(id);
      if (!p || p.status === 'Published') return;
      const t = time || U.postTime(p) || slots[0];
      const iso = U.toISO(date, t);
      if (U.parse(iso).getTime() < Date.now()) { toast("O'tgan vaqtga ko'chirib bo'lmaydi", 'bad'); return; }
      p.scheduled_at = iso;
      if (p.status === 'Failed') { p.status = 'Scheduled'; delete p.last_error; }
      upsertPost(p);
      toast(`Ko'chirildi: ${U.fmtDT(iso)}`);
      renderCalendarView(el);
      updateChrome();
    },
  };
  const box = $('#cal');
  if (c.mode === 'week') renderWeek(box, { startKey: weekStart, posts: state.posts, slots, ...cb });
  else renderMonth(box, { year: ay, month: am, posts: state.posts, ...cb });

  $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => { c.mode = b.dataset.mode; renderCalendarView(el); }));
  $('#prev').addEventListener('click', () => { c.anchor = shift(-1); renderCalendarView(el); });
  $('#next').addEventListener('click', () => { c.anchor = shift(1); renderCalendarView(el); });
  $('#today').addEventListener('click', () => { c.anchor = U.todayKey(); renderCalendarView(el); });
  $('#autoDist').addEventListener('click', () => {
    const n = autoDistribute();
    toast(n ? `${n} ta post joylandi` : "Joylanadigan post yo'q (vaqtsiz Tasdiqlangan postlar kerak)", n ? 'ok' : 'warn');
    renderCalendarView(el);
    updateChrome();
  });

  function shift(dir) {
    if (c.mode === 'week') return U.addDays(c.anchor, dir * 7);
    let y = ay; let m = am + dir;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    return `${y}-${U.pad(m)}-01`;
  }
}

/* ---------- Import va prompt ---------- */

let promptTemplate = null;
async function getPromptTemplate() {
  if (promptTemplate) return promptTemplate;
  try {
    const r = await fetch('prompts/content_prompt.md', { cache: 'no-cache' });
    if (r.ok) promptTemplate = await r.text();
  } catch { /* oflayn */ }
  return promptTemplate || 'prompts/content_prompt.md yuklanmadi. Sahifani internetga ulangan holda qayta oching.';
}

function renderImport(el) {
  const tomorrow = U.addDays(U.todayKey(), 1);
  el.innerHTML = `
  <div class="page-head"><div><h1>Import va Claude prompt <span class="zh">导入</span></h1>
    <p class="sub">Postlarni Claude chatida tayyorlang → JSON'ni shu yerga qo'ying → tekshiring → import qiling.</p></div></div>
  <div class="grid-2 wide-left">
    <div class="card">
      <h3>1. Claude uchun prompt</h3>
      <div class="grid-form">
        <label>Boshlanish sanasi<input type="date" id="pStart" value="${tomorrow}"></label>
        <label>Necha kun<input type="number" id="pDays" value="7" min="1" max="31"></label>
        <label>Kuniga<select id="pPer">${state.settings.slots.map((_, i) => `<option value="${i + 1}" ${state.settings.perDay === i + 1 ? 'selected' : ''}>${i + 1} ta</option>`).join('')}</select></label>
      </div>
      <div class="type-checks">${Object.entries(TYPES).map(([k, t]) => `<label class="check"><input type="checkbox" value="${k}" checked> ${t.emoji} ${t.uz}</label>`).join('')}</div>
      <label>Qo'shimcha talab (ixtiyoriy)<input id="pExtra" placeholder="Masalan: HSK 2–3 darajasi, mavzu — oila"></label>
      <div class="row"><button class="btn primary" id="genPrompt">Promptni yaratish</button><button class="btn" id="copyPrompt">📋 Nusxa olish</button></div>
      <textarea id="promptOut" rows="10" class="mono" readonly placeholder="Bu yerda tayyor prompt chiqadi"></textarea>
    </div>
    <div class="card">
      <h3>2. JSON import</h3>
      <textarea id="importText" rows="10" class="mono" placeholder='Claude javobini shu yerga qo&apos;ying (\`\`\`json bloki bilan ham bo&apos;ladi)'></textarea>
      <div class="row">
        <label class="btn ghost file-btn">📂 Fayl tanlash<input type="file" id="importFile" accept=".json,application/json,text/plain" hidden></label>
        <button class="btn" id="checkImport">🔍 Tekshirish</button>
        <button class="btn primary" id="doImport">⬇️ Import qilish</button>
      </div>
      <label class="check"><input type="checkbox" id="skipDup" checked> Takroriy hanzili postlarni o'tkazib yuborish</label>
      <label class="check"><input type="checkbox" id="replaceId"> Bir xil ID bo'lsa, eskisini almashtirish (nashr qilinganlar bundan mustasno)</label>
      <label class="check"><input type="checkbox" id="asDraft" checked> Hammasini Qoralama sifatida import qilish</label>
      <div id="report"></div>
    </div>
  </div>`;

  const out = $('#promptOut');
  $('#genPrompt').addEventListener('click', async () => {
    const tpl = await getPromptTemplate();
    const start = $('#pStart').value || tomorrow;
    const days = Math.max(1, Math.min(31, Number($('#pDays').value) || 7));
    const per = Math.min(Math.max(Number($('#pPer').value) || 1, 1), state.settings.slots.length);
    const types = $$('.type-checks input:checked', el).map((c) => c.value);
    if (!types.length) { toast('Kamida bitta tur tanlang', 'warn'); return; }
    const slots = state.settings.slots.slice(0, per);
    const used = [...new Set([
      ...state.posts.map((p) => p.hanzi),
      ...(state.server.published.items || []).map((i) => i.hanzi),
    ].filter(Boolean))];
    const map = {
      START: start,
      END: U.addDays(start, days - 1),
      DAYS: days,
      PER_DAY: per,
      COUNT: days * per,
      SLOTS: slots.join(' va '),
      AM: slots.slice(0, Math.ceil(slots.length / 2)).join(', '),
      PM: slots.slice(Math.ceil(slots.length / 2)).join(', ') || slots[0],
      TYPES: types.map((k) => `${k} (${TYPES[k].uz})`).join(', '),
      TYPE_KEYS: Object.keys(TYPES).join(' | '),
      USED_HANZI: used.length ? used.join('、') : "(hali yo'q)",
      EXTRA: $('#pExtra').value.trim() || "Yo'q",
    };
    out.value = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? String(map[k]) : m));
    toast('Prompt tayyor — nusxa olib Claude chatiga yuboring');
  });
  $('#copyPrompt').addEventListener('click', async () => {
    if (!out.value) { toast('Avval promptni yarating', 'warn'); return; }
    toast(await U.copyText(out.value) ? 'Nusxa olindi' : "Nusxa olib bo'lmadi", 'ok');
  });

  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#importText').value = await f.text();
    toast(`${f.name} o'qildi`);
  });

  const analyze = () => {
    let rawList;
    try {
      rawList = parseImport($('#importText').value);
    } catch (err) {
      $('#report').innerHTML = `<div class="msg err">❌ ${U.esc(err.message)}</div>`;
      return null;
    }
    const asDraft = $('#asDraft').checked;
    const replace = $('#replaceId').checked;
    const skipDup = $('#skipDup').checked;
    const seenKeys = new Set();
    const pubIds = new Set((state.server.published.items || []).map((i) => i.id));
    const rows = rawList.map((raw) => {
      const p = normalizePost(raw);
      if (asDraft) p.status = 'Draft';
      if (p.status === 'Published' && !pubIds.has(p.id)) p.status = 'Draft';
      const v = validatePost(p);
      const dups = findDuplicates(p, state.posts.filter((q) => !(replace && q.id === p.id)), state.server.published.items);
      const key = normalizeHanzi(p.hanzi);
      const dupInBatch = key && seenKeys.has(key);
      if (key) seenKeys.add(key);
      const existing = getPost(p.id);
      let action = 'add';
      if (v.errors.length) action = 'error';
      else if (existing && existing.status === 'Published') action = 'skip-published';
      else if (existing && !replace) { p.id = U.uid('post'); action = 'add-newid'; }
      else if (existing && replace) action = 'replace';
      if (action !== 'error' && action !== 'skip-published' && skipDup && (dups.length || dupInBatch)) action = 'skip-dup';
      return { p, v, dups, dupInBatch, action };
    });
    const label = {
      add: "✅ qo'shiladi", 'add-newid': "✅ qo'shiladi (ID band — yangi ID)", replace: '♻️ almashtiriladi',
      error: '❌ xato', 'skip-dup': "⏭ takror — o'tkaziladi", 'skip-published': "⏭ nashr qilingan — o'tkaziladi",
    };
    const ok = rows.filter((r) => ['add', 'add-newid', 'replace'].includes(r.action)).length;
    $('#report').innerHTML = `<div class="report-sum">Jami: ${rows.length} · import qilinadi: <b>${ok}</b> · o'tkaziladi: ${rows.length - ok}</div>
      <div class="table-wrap"><table class="table small"><thead><tr><th>Hanzi</th><th>Tur</th><th>Vaqt</th><th>Natija</th><th>Izoh</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="hanzi-cell">${U.esc(r.p.hanzi || '—')}</td><td>${typeBadge(r.p.type)}</td><td class="nowrap">${U.fmtDT(r.p.scheduled_at)}</td>
        <td class="nowrap">${label[r.action]}</td>
        <td>${[...r.v.errors.map((x) => `<div class="err">${U.esc(x)}</div>`), ...r.v.warnings.map((x) => `<div class="warn-text">${U.esc(x)}</div>`),
    ...r.dups.map((d) => `<div class="warn-text">🔁 takror: ${U.esc(d.hanzi)} (${d.source === 'published' ? 'nashr qilingan' : STATUS_UZ[d.status]})</div>`),
    r.dupInBatch ? '<div class="warn-text">🔁 shu import ichida takror</div>' : ''].join('')}</td></tr>`).join('')}
      </tbody></table></div>`;
    return rows;
  };

  $('#checkImport').addEventListener('click', analyze);
  $('#doImport').addEventListener('click', () => {
    const rows = analyze();
    if (!rows) return;
    let n = 0;
    for (const r of rows) {
      if (!['add', 'add-newid', 'replace'].includes(r.action)) continue;
      upsertPost(r.p);
      n++;
    }
    applyPublished();
    persist();
    updateChrome();
    toast(n ? `${n} ta post import qilindi` : 'Import qilinadigan post yo\'q', n ? 'ok' : 'warn');
  });
}

/* ---------- Eksport ---------- */

function renderExport(el) {
  const s = state.settings;
  const dirty = isDirty();
  const d = diffSummary();
  const base = s.owner && s.repo ? `https://github.com/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}` : '';
  el.innerHTML = `
  <div class="page-head"><div><h1>Eksport va repo'ga yuklash <span class="zh">导出</span></h1>
    <p class="sub">Dashboard repo'ga o'zi yozmaydi — xavfsizlik uchun token saqlanmaydi.</p></div></div>
  <div class="grid-2">
    <div class="card">
      <h3>Holat</h3>
      ${dirty ? `<div class="msg warn">📝 Repo'dagi versiyadan farq bor: +${d.added} yangi, ${d.changed} o'zgargan, −${d.removed} o'chirilgan.</div>`
    : '<div class="msg ok">✅ Brauzerdagi ma\'lumot repo\'dagi posts.json bilan bir xil.</div>'}
      <div class="row wrap">
        <button class="btn primary" id="dl">⬇️ posts.json yuklab olish</button>
        <button class="btn" id="cp">📋 JSON nusxa olish</button>
      </div>
      <h3 class="mt">Repo'ga joylash</h3>
      <ol class="steps">
        <li><b>posts.json</b> ni yuklab oling (yoki nusxa oling).</li>
        <li>${base ? `<a href="${base}/upload/${encodeURIComponent(s.branch)}/data" target="_blank" rel="noopener">GitHub → data papkasiga yuklash</a>` : 'GitHub → repo → <code>data</code> papkasi → Add file → Upload files'} sahifasida faylni tashlang va <b>Commit changes</b> bosing.</li>
        <li>Yoki ${base ? `<a href="${base}/edit/${encodeURIComponent(s.branch)}/data/posts.json" target="_blank" rel="noopener">posts.json'ni GitHub'da tahrirlash</a>` : 'GitHub\'da data/posts.json ni oching → ✎'} sahifasida hammasini o'chirib, nusxani qo'ying va commit qiling.</li>
        <li>1–2 daqiqada sayt yangilanadi, Actions esa postlarni o'z vaqtida yuboradi.</li>
      </ol>
      ${base ? '' : '<div class="msg warn">Sozlamalarda GitHub foydalanuvchi va repo nomini kiriting — shunda havolalar to\'g\'ridan-to\'g\'ri ochiladi.</div>'}
      <p class="muted small">Eslatma: GitHub Actions yuborgan postlarni posts.json'da "Nashr qilingan" deb belgilaydi. Eskirgan fayl yuklansa ham, published.json tufayli post qayta yuborilmaydi.</p>
    </div>
    <div class="card">
      <h3>Sinxronlash</h3>
      <p class="muted">Boshqa qurilmada tahrir qilgan bo'lsangiz yoki Actions holatlarni yangilagan bo'lsa:</p>
      <div class="row wrap">
        <button class="btn" id="refresh">🔄 Serverdan yangilash</button>
        <button class="btn danger ghost" id="reset">↩️ Repo'dagi versiyani qayta yuklash</button>
      </div>
      <h3 class="mt">Zaxira</h3>
      <p class="muted">Barcha postlar va sozlamalar bitta faylda.</p>
      <div class="row wrap">
        <button class="btn" id="backup">💾 Zaxira yuklab olish</button>
        <label class="btn ghost file-btn">📂 Zaxirani tiklash<input type="file" id="restore" accept=".json" hidden></label>
      </div>
    </div>
  </div>`;

  const json = () => JSON.stringify(exportPayload(), null, 2) + '\n';
  $('#dl').addEventListener('click', () => { U.download('posts.json', json()); toast('posts.json yuklab olindi'); });
  $('#cp').addEventListener('click', async () => toast(await U.copyText(json()) ? 'Nusxa olindi' : "Nusxa olib bo'lmadi"));
  $('#refresh').addEventListener('click', refreshServer);
  $('#reset').addEventListener('click', async () => {
    if (!await confirmBox("Brauzerdagi saqlanmagan o'zgarishlar o'chadi va repo'dagi posts.json yuklanadi. Davom etilsinmi?", 'Qayta yuklash', true)) return;
    await loadServer();
    resetToServer();
    toast("Repo'dagi versiya yuklandi");
    route();
  });
  $('#backup').addEventListener('click', () => U.download(`ccm-zaxira-${U.todayKey()}.json`, JSON.stringify(backupPayload(), null, 2)));
  $('#restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!await confirmBox(`Zaxiradan ${data.posts?.length ?? 0} ta post tiklansinmi? Hozirgi brauzerdagi nusxa almashtiriladi.`, 'Tiklash', true)) return;
      restoreBackup(data);
      applyTheme();
      toast('Zaxira tiklandi');
      route();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

/* ---------- Sozlamalar ---------- */

function renderSettings(el) {
  const s = state.settings;
  el.innerHTML = `
  <div class="page-head"><div><h1>Sozlamalar <span class="zh">设置</span></h1></div></div>
  <div class="grid-2">
    <form class="card form" id="sform">
      <h3>Jadval</h3>
      <div class="grid-form">
        <label class="span-2">Post vaqtlari (kuniga ${s.slots.length} ta)<input value="${U.esc(s.slots.join(', '))}" disabled></label>
        <label>Mavzu<select name="theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Tizimga mos</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Yorug'</option><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Qorong'i</option></select></label>
      </div>
      <p class="muted small">Vaqtlar <code>data/config.json</code> dagi <code>slots</code> ro'yxatidan olinadi. O'zgartirsangiz, <code>.github/workflows/publish.yml</code> dagi cron qatorlarini ham yangilang (Toshkent vaqti − 5 soat = UTC).</p>
      <h3 class="mt">GitHub</h3>
      <div class="grid-form">
        <label>Foydalanuvchi<input name="owner" value="${U.esc(s.owner)}" placeholder="username"></label>
        <label>Repository<input name="repo" value="${U.esc(s.repo)}" placeholder="chinese-content-manager"></label>
        <label>Branch<input name="branch" value="${U.esc(s.branch)}"></label>
      </div>
      <p class="muted small">Bu faqat havolalar uchun. Token kiritilmaydi va saqlanmaydi.</p>
      <div class="row"><button class="btn primary" type="submit">Saqlash</button></div>
    </form>
    <div class="card">
      <h3>Brauzer ma'lumotlari</h3>
      <p class="muted">Postlar shu brauzerning xotirasida (localStorage) saqlanadi va repo'ga eksport qilinmaguncha boshqa qurilmada ko'rinmaydi.</p>
      <button class="btn danger ghost" id="wipe">🧹 Brauzerdagi ma'lumotlarni tozalash</button>
      <h3 class="mt">Ilova haqida</h3>
      <p class="muted">AI Chinese Content Manager · GitHub Pages + GitHub Actions + Telegram Bot API. Hammasi bepul.</p>
    </div>
  </div>`;

  $('#sform').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.settings = {
      ...state.settings,
      theme: fd.get('theme'),
      owner: String(fd.get('owner')).trim(),
      repo: String(fd.get('repo')).trim(),
      branch: String(fd.get('branch')).trim() || 'main',
    };
    saveSettings();
    applyTheme();
    toast('Saqlandi');
  });
  $('#wipe').addEventListener('click', async () => {
    if (!await confirmBox("Brauzerdagi barcha postlar va sozlamalar o'chadi (repo'dagi fayllarga ta'sir qilmaydi). Davom etilsinmi?", 'Tozalash', true)) return;
    clearLocal();
    loadSettings();
    initPosts();
    applyTheme();
    toast('Tozalandi');
    route();
  });
}

/* ---------- Router va ishga tushirish ---------- */

const VIEWS = {
  dashboard: renderDashboard,
  posts: renderPosts,
  editor: renderEditor,
  calendar: renderCalendarView,
  import: renderImport,
  export: renderExport,
  settings: renderSettings,
};

function route() {
  timers.forEach(clearInterval);
  timers = [];
  const hash = location.hash.slice(1) || 'dashboard';
  const slash = hash.indexOf('/');
  const name = slash < 0 ? hash : hash.slice(0, slash);
  const arg = slash < 0 ? undefined : decodeURIComponent(hash.slice(slash + 1));
  const view = VIEWS[name] ? name : 'dashboard';
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.body.classList.remove('nav-open');
  const el = main();
  const fresh = el.cloneNode(false);
  el.replaceWith(fresh);
  VIEWS[view](fresh, arg);
  updateChrome();
  window.scrollTo(0, 0);
}

async function refreshServer() {
  const btn = $('#refreshBtn');
  btn.classList.add('spin');
  await loadServer();
  initPosts();
  btn.classList.remove('spin');
  toast(state.server.ok ? 'Yangilandi' : state.server.error, state.server.ok ? 'ok' : 'bad');
  route();
}

async function init() {
  loadSettings();
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    state.settings.theme = cur === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  });
  $('#refreshBtn').addEventListener('click', refreshServer);
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  await loadServer();
  initPosts();
  window.addEventListener('hashchange', route);
  route();
  $('#app').classList.remove('loading');
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWA ixtiyoriy */ });
  }
}

init();
