// Haftalik va oylik kalendar (drag & drop bilan qayta rejalashtirish).
import { TYPES, STATUS_UZ } from './formatter.js';
import * as U from './utils.js';

function groupByDay(posts) {
  const m = new Map();
  for (const p of posts) {
    const k = U.postKey(p);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  for (const list of m.values()) list.sort(U.byTime);
  return m;
}

function typeClash(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.status === 'Failed' || p.type === 'hsk') continue; // HSK so'zlar seriyasi kuniga 2 tadan bo'lishi tabiiy
    if (seen.has(p.type)) return true;
    seen.add(p.type);
  }
  return false;
}

function chip(p) {
  const t = TYPES[p.type];
  const drag = p.status !== 'Published';
  return `<button class="chip st-${p.status}" data-id="${U.esc(p.id)}" draggable="${drag}" title="${U.esc(STATUS_UZ[p.status] || p.status)}">
    <span class="chip-time">${U.postTime(p)}</span>
    <span class="chip-emoji">${t ? t.emoji : '•'}</span>
    <span class="chip-text">${U.esc(p.hanzi || '(matn)')}</span>
  </button>`;
}

function wire(el, { onOpen, onNew, onMove }) {
  el.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', (e) => { e.stopPropagation(); onOpen(c.dataset.id); });
    c.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', c.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('dragging');
    });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
  el.querySelectorAll('[data-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-over'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) onMove(id, cell.dataset.date, cell.dataset.time || null);
    });
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.chip')) return;
      onNew(cell.dataset.date, cell.dataset.time || null);
    });
  });
}

export function renderMonth(el, { year, month, posts, ...cb }) {
  const first = `${year}-${U.pad(month)}-01`;
  const start = U.addDays(first, -U.dowOf(first));
  const today = U.todayKey();
  const byDay = groupByDay(posts);
  let html = '<div class="cal-month"><div class="cal-head">' + U.DAYS.map((d) => `<div>${d}</div>`).join('') + '</div><div class="cal-grid">';
  for (let i = 0; i < 42; i++) {
    const dk = U.addDays(start, i);
    const inMonth = Number(dk.slice(5, 7)) === month;
    const list = byDay.get(dk) || [];
    const clash = typeClash(list);
    html += `<div class="cal-cell ${inMonth ? '' : 'muted'} ${dk === today ? 'today' : ''} ${clash ? 'clash' : ''}" data-drop data-date="${dk}">
      <div class="cal-date">${Number(dk.slice(8))}${clash ? ' <span class="clash-ico" title="Bir kunda bir xil tur takrorlangan">⚠️</span>' : ''}</div>
      <div class="cal-chips">${list.map(chip).join('')}</div>
    </div>`;
  }
  html += '</div></div>';
  el.innerHTML = html;
  wire(el, cb);
}

export function renderWeek(el, { startKey, posts, slots, ...cb }) {
  const today = U.todayKey();
  const byDay = groupByDay(posts);
  let html = '<div class="cal-week">';
  for (let i = 0; i < 7; i++) {
    const dk = U.addDays(startKey, i);
    const list = byDay.get(dk) || [];
    const clash = typeClash(list);
    html += `<div class="wk-col ${dk === today ? 'today' : ''} ${clash ? 'clash' : ''}">
      <div class="wk-head"><b>${U.DAYS_FULL[i]}</b><span>${U.fmtDate(dk)}</span>${clash ? '<span class="clash-ico" title="Bir kunda bir xil tur takrorlangan">⚠️</span>' : ''}</div>`;
    for (const time of slots) {
      const inSlot = list.filter((p) => U.postTime(p) === time);
      html += `<div class="wk-slot ${inSlot.length ? '' : 'empty'}" data-drop data-date="${dk}" data-time="${time}">
        <div class="wk-time">${time}</div>
        ${inSlot.length ? inSlot.map(chip).join('') : '<div class="wk-empty">+ bo\'sh slot</div>'}
      </div>`;
    }
    const other = list.filter((p) => !slots.includes(U.postTime(p)));
    if (other.length) {
      html += `<div class="wk-slot other" data-drop data-date="${dk}"><div class="wk-time">Boshqa vaqt</div>${other.map(chip).join('')}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
  wire(el, cb);
}
