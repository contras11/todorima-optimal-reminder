// オプション画面：設定の保存と読込（i18n 対応）
import { createI18n, applyI18nDom } from '../utils/i18n.js';

const storage = {
  syncGet: (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
  syncSet: (obj) => new Promise((resolve) => chrome.storage.sync.set(obj, resolve)),
};

const DEFAULTS = {
  defaultSnoozeMin: 10,
  enableSnooze: true,
  notificationRequireInteraction: false,
  weekStartsOn: 0,
  catchupWindowMs: 12 * 60 * 60 * 1000,
  maxIndividualCatchup: 5,
  themeMode: 'system',
  completedCollapsed: true,
  showTags: true,
  completedRetentionDays: 30,
  // 既定言語は Auto（ブラウザ）
  language: 'auto',
};

const $ = (sel) => /** @type {HTMLElement} */(document.querySelector(sel));
const snoozeEl = /** @type {HTMLInputElement} */($('#defaultSnoozeMin'));
const requireEl = /** @type {HTMLInputElement} */($('#requireInteraction'));
const weekEl = /** @type {HTMLSelectElement} */($('#weekStartsOn'));
const catchupEl = /** @type {HTMLInputElement} */($('#catchupHours'));
const maxEl = /** @type {HTMLInputElement} */($('#maxIndividualCatchup'));
// 新規: スヌーズ機能のオン/オフ
let enableSnoozeEl = /** @type {HTMLInputElement} */(document.getElementById('enableSnooze'));
// 新規: テーマ選択
const themeEl = /** @type {HTMLSelectElement} */(document.getElementById('themeMode'));
// 新規: 完了一覧折りたたみ既定
const collapseDoneEl = /** @type {HTMLInputElement} */(document.getElementById('completedCollapsed'));
// 新規: 完了自動削除日数
const retentionEl = /** @type {HTMLInputElement} */(document.getElementById('completedRetentionDays'));
// 新規: タグ機能の有効/無効
const showTagsEl = /** @type {HTMLInputElement} */(document.getElementById('showTags'));
const statusEl = $('#status');
const toastEl = /** @type {HTMLDivElement} */(document.getElementById('toast'));
const langEl = /** @type {HTMLSelectElement} */(document.getElementById('language'));

async function load() {
  const { t } = await createI18n();
  await applyI18nDom(t);
  const { settings } = await storage.syncGet(['settings']);
  const s = { ...DEFAULTS, ...(settings || {}) };
  snoozeEl.value = String(s.defaultSnoozeMin);
  if (enableSnoozeEl) enableSnoozeEl.checked = !!s.enableSnooze;
  requireEl.checked = !!s.notificationRequireInteraction;
  weekEl.value = String(s.weekStartsOn);
  catchupEl.value = String(Math.max(1, Math.round(s.catchupWindowMs / (60*60*1000))));
  maxEl.value = String(s.maxIndividualCatchup);
  if (themeEl) themeEl.value = s.themeMode || 'system';
  if (collapseDoneEl) collapseDoneEl.checked = !!s.completedCollapsed;
  applyThemePreview(s.themeMode || 'system');
  if (retentionEl) retentionEl.value = String(Math.max(0, s.completedRetentionDays ?? 30));
  if (showTagsEl) showTagsEl.checked = s.showTags !== false;
  if (langEl) langEl.value = s.language || 'auto';
}

async function save(e) {
  e.preventDefault();
  const { t } = await createI18n();
  const s = {
    defaultSnoozeMin: Math.max(1, parseInt(snoozeEl.value || '10', 10)),
    enableSnooze: !!(enableSnoozeEl && enableSnoozeEl.checked),
    notificationRequireInteraction: !!requireEl.checked,
    weekStartsOn: /** @type {0|1} */(parseInt(weekEl.value, 10) === 1 ? 1 : 0),
    catchupWindowMs: Math.max(1, parseInt(catchupEl.value || '12', 10)) * 60 * 60 * 1000,
    maxIndividualCatchup: Math.max(0, parseInt(maxEl.value || '5', 10)),
    themeMode: themeEl ? /** @type {'system'|'light'|'dark'} */(themeEl.value) : 'system',
    completedCollapsed: !!(collapseDoneEl && collapseDoneEl.checked),
    completedRetentionDays: Math.max(0, parseInt((retentionEl && retentionEl.value) || '30', 10)),
    showTags: !!(showTagsEl && showTagsEl.checked),
    language: langEl ? /** @type {'en'|'ja'|'auto'} */(langEl.value) : 'en',
  };
  await storage.syncSet({ settings: s });
  // 視覚的な保存完了表示（トースト＋ボタン表示）
  if (toastEl) {
    toastEl.textContent = t('saveToast');
    toastEl.style.display = 'block';
    setTimeout(() => { toastEl.style.display = 'none'; }, 1600);
  }
  const btn = /** @type {HTMLButtonElement} */(document.querySelector('button[type="submit"]'));
  const old = btn?.textContent;
  if (btn) { btn.textContent = t('saveDoneBtn'); btn.disabled = true; }
  setTimeout(() => { if (btn) { btn.textContent = old || t('saveBtn'); btn.disabled = false; } }, 1600);
  await chrome.runtime.sendMessage({ type: 'settings-updated' });
  // 言語が変わった場合、文言を再適用
  const { t: t2 } = await createI18n();
  await applyI18nDom(t2);
}

document.getElementById('optForm').addEventListener('submit', save);
load();

function applyThemePreview(mode) {
  if (mode === 'dark') document.body.dataset.theme = 'dark';
  else if (mode === 'light') document.body.dataset.theme = 'light';
  else delete document.body.dataset.theme;
}

if (themeEl) themeEl.addEventListener('change', () => applyThemePreview(themeEl.value));
