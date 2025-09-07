// - タブ切替（一覧/追加）
// - タスクの追加/編集/一覧/検索/操作（完了/スヌーズ/削除）
// - 追加・更新後はサービスワーカーに再スケジュール依頼
// - i18n 対応（英語既定・オプションで切替）

import { fmtDateTime, MIN } from '../utils/time.js';
import { createI18n, applyI18nDom } from '../utils/i18n.js';

// Promise ラッパ
const storage = {
  syncGet: (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
  syncSet: (obj) => new Promise((resolve) => chrome.storage.sync.set(obj, resolve)),
};

function genId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getSettings() {
  const { settings } = await storage.syncGet(['settings']);
  return {
    defaultSnoozeMin: 10,
    notificationRequireInteraction: false,
    weekStartsOn: 0,
    catchupWindowMs: 12 * 60 * 60 * 1000,
    maxIndividualCatchup: 5,
    enableSnooze: true,
    themeMode: 'system',
    completedCollapsed: true,
    ...(settings || {}),
  };
}

async function getTasks() {
  const { tasks } = await storage.syncGet(['tasks']);
  return Array.isArray(tasks) ? tasks : [];
}

async function saveTasks(tasks) {
  await storage.syncSet({ tasks });
}

function parseDateTimeLocal(v) {
  // 'YYYY-MM-DDTHH:mm' -> ローカル時刻として Date に渡す
  return new Date(v).getTime();
}

function toDateTimeLocalValue(ms) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth()+1).padStart(2,'0');
  const DD = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${yyyy}-${MM}-${DD}T${hh}:${mm}`;
}

// DOM 取得
const $ = (sel) => /** @type {HTMLElement} */(document.querySelector(sel));
const form = /** @type {HTMLFormElement} */($('#taskForm'));
const idEl = /** @type {HTMLInputElement} */($('#taskId'));
const titleEl = /** @type {HTMLInputElement} */($('#title'));
const noteEl = /** @type {HTMLTextAreaElement} */($('#note'));
const dueEl = /** @type {HTMLInputElement} */($('#due'));
const priorityEl = /** @type {HTMLSelectElement} */($('#priority'));
const tagsEl = /** @type {HTMLInputElement} */($('#tags'));
const repeatTypeEl = /** @type {HTMLSelectElement} */($('#repeatType'));
const intervalEl = /** @type {HTMLInputElement} */($('#interval'));
const weeklyOpts = $('#weeklyOpts');
const monthlyOpts = $('#monthlyOpts');
const byDayEl = /** @type {HTMLInputElement} */($('#byDay'));
const listEl = $('#list');
const qEl = /** @type {HTMLInputElement} */($('#q'));
const sortEl = /** @type {HTMLSelectElement} */($('#sort'));
const tabList = /** @type {HTMLButtonElement} */(document.getElementById('tab-list'));
const tabAdd = /** @type {HTMLButtonElement} */(document.getElementById('tab-add'));
const viewList = /** @type {HTMLElement} */(document.getElementById('view-list'));
const viewAdd = /** @type {HTMLElement} */(document.getElementById('view-add'));
const saveBtn = /** @type {HTMLButtonElement} */(document.getElementById('saveBtn'));

function showRepeatFields() {
  const t = repeatTypeEl.value;
  weeklyOpts.classList.toggle('hidden', t !== 'weekly');
  monthlyOpts.classList.toggle('hidden', t !== 'monthly');
}

repeatTypeEl.addEventListener('change', showRepeatFields);

$('#resetBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  form.reset();
  idEl.value = '';
  intervalEl.value = '1';
  showRepeatFields();
  const { t } = await createI18n();
  if (saveBtn) saveBtn.textContent = t('save');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tasks = await getTasks();
  const now = Date.now();
  const id = idEl.value || genId();
  const title = titleEl.value.trim();
  if (!title) return;
  const dueAt = parseDateTimeLocal(dueEl.value);
  const baseAt = dueAt;
  const repeatType = repeatTypeEl.value;
  const interval = Math.max(1, parseInt(intervalEl.value || '1', 10));
  /** @type {import('../utils/time.js').RepeatRule} */
  let repeat;
  if (repeatType === 'daily') {
    repeat = { type: 'daily', interval };
  } else if (repeatType === 'weekly') {
    const checks = Array.from(weeklyOpts.querySelectorAll('input[type="checkbox"]'));
    const byWeekday = checks.filter(c => c.checked).map(c => parseInt(c.value, 10));
    repeat = { type: 'weekly', interval, byWeekday: byWeekday.length ? byWeekday : [new Date(baseAt).getDay()] };
  } else if (repeatType === 'monthly') {
    const byDay = parseInt(byDayEl.value || '0', 10) || new Date(baseAt).getDate();
    repeat = { type: 'monthly', interval, byDay };
  } else {
    repeat = { type: 'none' };
  }
  const priority = /** @type {'low'|'normal'|'high'} */(priorityEl.value);
  const sAll = await getSettings();
  const tags = (sAll.showTags !== false && tagsEl.value)
    ? tagsEl.value.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const existing = tasks.find(t => t.id === id);
  if (existing) {
    // 編集
    existing.title = title;
    existing.note = noteEl.value;
    existing.dueAt = dueAt;
    existing.baseAt = baseAt;
    existing.repeat = repeat;
    existing.priority = priority;
    existing.tags = tags;
    existing.updatedAt = now;
  } else {
    // 追加
    tasks.push({
      id,
      title,
      note: noteEl.value,
      dueAt,
      baseAt,
      repeat,
      priority,
      tags,
      done: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  await saveTasks(tasks);
  // 期日が現在以前なら補填を走らせる（すぐ通知させる）
  const actionType = dueAt <= Date.now() ? 'catchUp' : 'rehydrate';
  await chrome.runtime.sendMessage({ type: actionType });
  form.reset();
  idEl.value = '';
  intervalEl.value = '1';
  await render();
  switchView('list');
  if (saveBtn) { const { t } = await createI18n(); saveBtn.textContent = t('save'); }
});

qEl.addEventListener('input', () => render());
sortEl.addEventListener('change', () => render());

async function render() {
  const { t } = await createI18n();
  const tasks = await getTasks();
  const settings = await getSettings();
  try { applyTheme(settings.themeMode || 'system'); } catch {}
  try { if (tagsEl) tagsEl.style.display = settings.showTags !== false ? '' : 'none'; } catch {}
  try { if (qEl) qEl.placeholder = settings.showTags !== false ? t('searchPlaceholderWithTags') : t('searchPlaceholderTitleOnly'); } catch {}

  const q = (qEl.value || '').trim().toLowerCase();
  let items = tasks.filter(x => !x.archived);
  if (q) {
    items = items.filter(x => {
      const inTitle = (x.title || '').toLowerCase().includes(q);
      if (inTitle) return true;
      if (settings.showTags !== false) {
        return (x.tags || []).some(tag => tag.toLowerCase().includes(q));
      }
      return false;
    });
  }

  const order = { high: 0, normal: 1, low: 2 };
  const sorter = (a, b) => {
    if (sortEl.value === 'due') return a.dueAt - b.dueAt;
    return (order[a.priority || 'normal'] - order[b.priority || 'normal']) || (a.dueAt - b.dueAt);
  };

  const now = Date.now();
  const startOfDay = (ms) => { const dd = new Date(ms); dd.setHours(0,0,0,0); return dd.getTime(); };
  const todayStart = startOfDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  const tomorrowStart = todayStart + dayMs;
  const wso = settings.weekStartsOn === 1 ? 1 : 0;
  const startOfWeek = (ms) => { const sd = new Date(startOfDay(ms)); let dow = sd.getDay(); let shift = dow - (wso===1?1:0); if (shift<0) shift+=7; sd.setDate(sd.getDate()-shift); return sd.getTime(); };
  const weekEnd = startOfWeek(now) + 7 * dayMs - 1;

  const overdue = items.filter(x => !x.done && x.dueAt < now).sort(sorter);
  const today = items.filter(x => x.dueAt >= Math.max(now, todayStart) && x.dueAt < tomorrowStart).sort(sorter);
  const tomorrow = items.filter(x => x.dueAt >= tomorrowStart && x.dueAt < tomorrowStart + dayMs).sort(sorter);
  const thisWeek = items.filter(x => x.dueAt >= (tomorrowStart + dayMs) && x.dueAt <= weekEnd).sort(sorter);
  const later = items.filter(x => x.dueAt > weekEnd).sort(sorter);

  listEl.innerHTML = '';
  const renderSection = (title, arr) => {
    if (!arr.length) return;
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = title;
    listEl.appendChild(h);
    for (const item of arr) {
      const div = document.createElement('div');
      div.className = 'task' + (item.dueAt < now && !item.done ? ' task--overdue' : '');
      const repeatKey = item.repeat?.type === 'daily' ? 'repeatDaily'
        : item.repeat?.type === 'weekly' ? 'repeatWeekly'
        : item.repeat?.type === 'monthly' ? 'repeatMonthly' : '';
      const prioChip = item.priority === 'high' ? `<span class="chip chip--prio-high">${t('priorityHigh')}</span>`
        : item.priority === 'low' ? `<span class="chip chip--prio-low">${t('priorityLow')}</span>`
        : `<span class="chip chip--prio-normal">${t('priorityNormal')}</span>`;
      const tags = settings.showTags !== false ? (item.tags || []).map(x => `<span class="tag">${x}</span>`).join('') : '';
      div.innerHTML = `
        <h4>${item.done ? '✅' : ''}<span>${item.title}</span></h4>
        <div class="meta">
          <div class="chips">
            ${prioChip}
            ${repeatKey ? `<span class="chip">${t(repeatKey)}</span>` : ''}
            ${tags}
          </div>
          <div class="small">${t('labelDueAt')} ${fmtDateTime(item.dueAt)}</div>
        </div>
        ${item.note ? `<div class="small" style="margin-top:6px;">${item.note.replace(/</g,'&lt;')}</div>` : ''}
        <div class="actions" style="margin-top:8px;">
          <button class="btn" data-act="done" data-id="${item.id}">${t('actionDone')}</button>
          ${settings.enableSnooze ? `<button class="btn" data-act="snooze" data-id="${item.id}">${t('actionSnooze')}</button>` : ''}
          <button class="btn" data-act="edit" data-id="${item.id}">${t('actionEdit')}</button>
          <button class="btn btn--danger" data-act="delete" data-id="${item.id}">${t('actionDelete')}</button>
        </div>
      `;
      listEl.appendChild(div);
    }
  };

  renderSection(t('sectionOverdue'), overdue);
  renderSection(t('sectionToday'), today);
  renderSection(t('sectionTomorrow'), tomorrow);
  renderSection(t('sectionThisWeek'), thisWeek);
  renderSection(t('sectionLater'), later);

  const completed = items.filter(x => x.done).sort((a, b) => b.updatedAt - a.updatedAt);
  const ch = document.createElement('div');
  const collapsed = !!settings.completedCollapsed;
  ch.className = 'section-title';
  ch.setAttribute('data-role', 'toggle-completed');
  ch.style.cursor = 'pointer';
  ch.textContent = `${t('completed')} (${completed.length}) ${collapsed ? '▸' : '▾'}`;
  listEl.appendChild(ch);
  if (!collapsed) {
    for (const task of completed) {
      const div = document.createElement('div');
      div.className = 'task';
      const tags = (task.tags || []).map(x => `<span class="tag">${x}</span>`).join('');
      div.innerHTML = `
        <h4>✅ <span>${task.title}</span></h4>
        <div class="meta">
          <div class="chips">${tags}</div>
          <div class="small">${t('labelDoneAt')} ${fmtDateTime(task.updatedAt || task.dueAt)}</div>
        </div>
        ${task.note ? `<div class="small" style="margin-top:6px;">${task.note.replace(/</g,'&lt;')}</div>` : ''}
        <div class="actions" style="margin-top:8px;">
          <button class="btn" data-act="edit" data-id="${task.id}">${t('actionEdit')}</button>
          <button class="btn btn--danger" data-act="delete" data-id="${task.id}">${t('actionDelete')}</button>
        </div>
      `;
      listEl.appendChild(div);
    }
  }

  if (![overdue.length, today.length, tomorrow.length, thisWeek.length, later.length].some(Boolean)) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `${t('emptyNoTasks')}<div style="margin-top:10px;"><button class="btn btn--primary js-go-add">${t('addNow')}</button></div>`;
    listEl.appendChild(empty);
  }

  listEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (ev) => onAction(ev.currentTarget));
  });
  const goAdd = listEl.querySelector('.js-go-add');
  if (goAdd) goAdd.addEventListener('click', () => switchView('add'));
  const toggleCompleted = listEl.querySelector('[data-role="toggle-completed"]');
  if (toggleCompleted) toggleCompleted.addEventListener('click', async () => {
    const s = await getSettings();
    s.completedCollapsed = !s.completedCollapsed;
    await storage.syncSet({ settings: s });
    await render();
  });
}

async function onAction(btn) {
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  const tasks = await getTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const now = Date.now();
  if (act === 'done') {
    t.done = true;
    t.updatedAt = now;
    await saveTasks(tasks);
    await chrome.runtime.sendMessage({ type: 'rehydrate' });
  } else if (act === 'snooze') {
    const s = await getSettings();
    if (!s.enableSnooze) return;
    t.dueAt = now + (s.defaultSnoozeMin || 10) * MIN;
    t.updatedAt = now;
    await saveTasks(tasks);
    await chrome.runtime.sendMessage({ type: 'rehydrate' });
  } else if (act === 'edit') {
    // フォームに詰め直し
    idEl.value = t.id;
    titleEl.value = t.title;
    noteEl.value = t.note || '';
    dueEl.value = toDateTimeLocalValue(t.dueAt);
    priorityEl.value = t.priority || 'normal';
    tagsEl.value = (t.tags || []).join(',');
    repeatTypeEl.value = t.repeat?.type || 'none';
    intervalEl.value = String(t.repeat?.interval || 1);
    showRepeatFields();
    if (t.repeat?.type === 'weekly') {
      weeklyOpts.querySelectorAll('input[type="checkbox"]').forEach(ch => { ch.checked = false; });
      for (const dow of (t.repeat.byWeekday || [])) {
        const el = weeklyOpts.querySelector(`input[value="${dow}"]`);
        if (el) el.checked = true;
      }
    }
    if (t.repeat?.type === 'monthly') {
      byDayEl.value = String(t.repeat.byDay || new Date(t.baseAt).getDate());
    }
    switchView('add');
    if (saveBtn) { const { t } = await createI18n(); saveBtn.textContent = t('update'); }
    titleEl.focus();
  } else if (act === 'delete') {
    const idx = tasks.findIndex(x => x.id === id);
    if (idx >= 0) tasks.splice(idx, 1);
    await saveTasks(tasks);
    await chrome.runtime.sendMessage({ type: 'rehydrate' });
  }
  await render();
}

// 初期表示
(async function init() {
  // 先にタブのリスナーを登録（描画失敗時でも切替可）
  if (tabList && tabAdd) {
    tabList.addEventListener('click', () => switchView('list'));
    tabAdd.addEventListener('click', () => switchView('add'));
  }
  // i18n 適用（静的テキスト）
  try { const { t } = await createI18n(); await applyI18nDom(t); } catch {}
  // due 初期値は 30 分後
  const next = new Date(Date.now() + 30 * MIN);
  dueEl.value = toDateTimeLocalValue(next.getTime());
  showRepeatFields();
  // テーマ適用
  try {
    const s = await getSettings();
    applyTheme(s.themeMode || 'system');
  } catch {}
  // レンダリング（失敗しても他操作は動くように）
  try { await render(); } catch (e) { /* noop */ }
  switchView('list');
})();

/**
 * タブ表示切替（一覧/追加）
 * @param {'list'|'add'} which
 */
function switchView(which) {
  const onList = which === 'list';
  if (viewList && viewAdd && tabList && tabAdd) {
    viewList.classList.toggle('hidden', !onList);
    viewAdd.classList.toggle('hidden', onList);
    tabList.classList.toggle('active', onList);
    tabList.setAttribute('aria-selected', String(onList));
    tabAdd.classList.toggle('active', !onList);
    tabAdd.setAttribute('aria-selected', String(!onList));
  }
}

/**
 * テーマ適用（system/light/dark）
 * @param {'system'|'light'|'dark'} mode
 */
function applyTheme(mode) {
  if (mode === 'dark') document.body.dataset.theme = 'dark';
  else if (mode === 'light') document.body.dataset.theme = 'light';
  else delete document.body.dataset.theme;
}
