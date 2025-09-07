// 背景サービスワーカー（MV3, ES Modules）
// - アラームの直近1件のみを登録
// - 起動/インストール/アイドル復帰/アラーム発火で補填・再スケジュール
// - 通知アクション：完了/スヌーズ

import { nextOccurrence, fmtDateTime, MIN, DAY } from './utils/time.js';
import { createI18n } from './utils/i18n.js';

/** @typedef {import('./utils/time.js').Task} Task */

// 定数・デフォルト設定
const ALARM_NAME = 'nextDue';
const DEFAULT_SETTINGS = {
  /** @type {number} 既定スヌーズ(分) */
  defaultSnoozeMin: 10,
  /** @type {boolean} スヌーズ機能の有効/無効 */
  enableSnooze: true,
  /** @type {boolean} 通知保持(requireInteraction) */
  notificationRequireInteraction: false,
  /** @type {0|1} 週開始（日曜=0/月曜=1） */
  weekStartsOn: 0,
  /** @type {number} 補填ウィンドウ(ms) */
  catchupWindowMs: 12 * 60 * 60 * 1000,
  /** @type {number} 個別補填の上限 */
  maxIndividualCatchup: 5,
  /** @type {'system'|'light'|'dark'} テーマ */
  themeMode: 'system',
  /** @type {boolean} 完了一覧の折りたたみ既定 */
  completedCollapsed: true,
  /** @type {boolean} タグ機能の有効/無効（UI用） */
  showTags: true,
  /** @type {number} 完了タスクの自動削除(保持日数)。0以下で無効 */
  completedRetentionDays: 30,
  /** @type {'en'|'ja'|'auto'} UI 言語（既定: Auto） */
  language: 'auto',
};

// chrome.storage ラッパ（Promise化）
const storage = {
  syncGet: (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
  syncSet: (obj) => new Promise((resolve) => chrome.storage.sync.set(obj, resolve)),
  localGet: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
  localSet: (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve)),
};

// 設定・タスク取得
async function getSettings() {
  const { settings } = await storage.syncGet(['settings']);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getTasks() {
  const { tasks } = await storage.syncGet(['tasks']);
  return Array.isArray(tasks) ? /** @type {Task[]} */(tasks) : /** @type {Task[]} */([]);
}

async function saveTasks(tasks) {
  await storage.syncSet({ tasks });
}

function genId() {
  // 簡易ID（重複回避のため時刻+乱数）
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 完了タスクの自動削除
async function pruneCompleted() {
  const settings = await getSettings();
  const days = Number(settings.completedRetentionDays || 0);
  if (!days || days <= 0) return; // 無効
  const cutoff = Date.now() - days * DAY;
  const tasks = await getTasks();
  const before = tasks.length;
  const kept = tasks.filter(t => {
    if (!t.done) return true;
    const stamp = t.updatedAt || t.dueAt || 0;
    return stamp > cutoff;
  });
  if (kept.length !== before) {
    await saveTasks(kept);
  }
}

// 通知ユーティリティ
async function showNotification(task) {
  const settings = await getSettings();
  const notifId = `task::${task.id}::${Date.now()}`;
  const whenText = fmtDateTime(task.dueAt);
  const icon = chrome.runtime.getURL('assets/icon128.png');
  const { t } = await createI18n();
  try {
    /** @type {chrome.notifications.NotificationOptions<true>} */
    const opts = {
      type: 'basic',
      iconUrl: icon,
      // 製品名を通知タイトルに併記（ブランド明示）
      title: t('notifTitle', task.title),
      message: task.note ? `${task.note}\n(${whenText})` : `${whenText}`,
      requireInteraction: !!settings.notificationRequireInteraction,
      priority: 2,
    };
    // ボタンは条件付きで付与
    /** @type {chrome.notifications.ButtonOptions[]} */
    const buttons = [{ title: t('notifBtnDone') }];
    if (settings.enableSnooze) {
      buttons.push({ title: t('notifBtnSnooze', String(settings.defaultSnoozeMin)) });
    }
    if (buttons.length) opts.buttons = buttons;
    await chrome.notifications.create(notifId, opts);
  } catch (e) {
    console.warn('通知作成に失敗しました。アイコンURLを再試行します:', e);
    // 念のためパス文字列でも再試行
    try {
      /** @type {chrome.notifications.NotificationOptions<true>} */
      const opts2 = {
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        // 再試行時も同様に製品名を併記
        title: t('notifTitle', task.title),
        message: task.note ? `${task.note}\n(${whenText})` : `${whenText}`,
        requireInteraction: !!settings.notificationRequireInteraction,
        priority: 2,
      };
      const buttons2 = [{ title: t('notifBtnDone') }];
      if (settings.enableSnooze) buttons2.push({ title: t('notifBtnSnooze', String(settings.defaultSnoozeMin)) });
      if (buttons2.length) opts2.buttons = buttons2;
      await chrome.notifications.create(notifId, opts2);
    } catch (e2) {
      console.error('通知作成に失敗（再試行も失敗）:', e2);
    }
  }
}

async function showSummaryNotification(count) {
  const notifId = `summary::${Date.now()}`;
  const icon = chrome.runtime.getURL('assets/icon128.png');
  const { t } = await createI18n();
  try {
    await chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: icon,
      title: t('summaryTitle'),
      message: t('summaryMessage', String(count)),
      requireInteraction: false,
      priority: 1,
    });
  } catch (e) {
    console.error('サマリー通知作成に失敗:', e);
  }
}

// アラーム再スケジュール（全タスクから直近1件のみ登録）
async function rehydrateAll() {
  await pruneCompleted();
  const tasks = await getTasks();
  const now = Date.now();
  const candidates = tasks.filter(t => !t.done && !t.archived && typeof t.dueAt === 'number' && t.dueAt > now);
  const next = candidates.sort((a, b) => a.dueAt - b.dueAt)[0];
  await new Promise((r) => chrome.alarms.clear(ALARM_NAME, () => r(null)));
  if (next) {
    chrome.alarms.create(ALARM_NAME, { when: next.dueAt });
  }
}

// 期限到来の処理（onAlarm 用）
async function processDueNow() {
  const now = Date.now();
  const tasks = await getTasks();
  const settings = await getSettings();
  let changed = false;
  for (const t of tasks) {
    if (t.done || t.archived) continue;
    if (t.dueAt <= now) {
      await showNotification(t);
      // 繰り返しはロールフォワード
      const n = nextOccurrence(now, t, { weekStartsOn: settings.weekStartsOn });
      if (n != null) {
        t.dueAt = n;
        t.updatedAt = now;
        changed = true;
      }
    }
  }
  if (changed) await saveTasks(tasks);
  // 最終チェック時刻を更新（重複補填防止）
  await storage.localSet({ lastCheckedAt: now });
  await pruneCompleted();
  await rehydrateAll();
}

// スリープ復帰などの補填
async function catchUp() {
  const now = Date.now();
  const settings = await getSettings();
  const { lastCheckedAt } = await storage.localGet(['lastCheckedAt']);
  // 初回は補填せず基準を今に設定
  if (!lastCheckedAt) {
    await storage.localSet({ lastCheckedAt: now });
    await rehydrateAll();
    return;
  }
  const windowStart = Math.max(lastCheckedAt, now - settings.catchupWindowMs);
  const tasks = await getTasks();
  const due = tasks
    .filter(t => !t.done && !t.archived && t.dueAt > windowStart && t.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
  if (due.length === 0) {
    await storage.localSet({ lastCheckedAt: now });
    await rehydrateAll();
    return;
  }
  const indivLimit = Math.max(0, settings.maxIndividualCatchup | 0);
  const head = due.slice(0, indivLimit);
  const rest = due.slice(indivLimit);
  for (const t of head) {
    await showNotification(t);
  }
  if (rest.length > 0) {
    showSummaryNotification(rest.length);
  }
  // 繰り返しはロールフォワード
  let changed = false;
  for (const t of due) {
    const n = nextOccurrence(now, t, { weekStartsOn: settings.weekStartsOn });
    if (n != null) {
      t.dueAt = n;
      t.updatedAt = now;
      changed = true;
    }
  }
  if (changed) await saveTasks(tasks);
  await storage.localSet({ lastCheckedAt: now });
  await pruneCompleted();
  await rehydrateAll();
}

// メッセージ受信（UI→SW）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'rehydrate') {
        await rehydrateAll();
        sendResponse({ ok: true });
      } else if (msg?.type === 'catchUp') {
        await catchUp();
        sendResponse({ ok: true });
      } else if (msg?.type === 'createQuickTask') {
        // テスト用：簡易作成
        const tasks = await getTasks();
        const now = Date.now();
        tasks.push(/** @type {Task} */({
          id: genId(),
          title: msg.title || (await createI18n()).t('quickTask'),
          note: msg.note || '',
          dueAt: now + 5 * MIN,
          baseAt: now + 5 * MIN,
          repeat: { type: 'none' },
          priority: 'normal',
          tags: [],
          done: false,
          archived: false,
          createdAt: now,
          updatedAt: now,
        }));
        await saveTasks(tasks);
        await rehydrateAll();
        sendResponse({ ok: true });
      } else if (msg?.type === 'settings-updated') {
        // 設定反映（通知保持など）。スケジュールは必要に応じて更新
        await pruneCompleted();
        await rehydrateAll();
        sendResponse({ ok: true });
      }
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  // 非同期で sendResponse するため true
  return true;
});

// 通知ボタンのハンドラ
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  try {
    if (!notificationId.startsWith('task::')) return;
    const [, taskId] = notificationId.split('::');
    const tasks = await getTasks();
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    const now = Date.now();
    const settings = await getSettings();
    if (buttonIndex === 0) {
      // 完了
      t.done = true;
      t.updatedAt = now;
      await saveTasks(tasks);
      chrome.notifications.clear(notificationId);
      await rehydrateAll();
    } else if (buttonIndex === 1 && settings.enableSnooze) {
      // スヌーズ
      t.dueAt = now + (settings.defaultSnoozeMin || 10) * MIN;
      t.updatedAt = now;
      await saveTasks(tasks);
      chrome.notifications.clear(notificationId);
      await rehydrateAll();
    }
  } catch (e) {
    console.error('通知ハンドラエラー', e);
  }
});

// 重要イベント登録
chrome.runtime.onInstalled.addListener(async () => {
  const now = Date.now();
  await storage.localSet({ lastCheckedAt: now });
  await pruneCompleted();
  await catchUp();
  await rehydrateAll();
});

chrome.runtime.onStartup.addListener(async () => {
  await pruneCompleted();
  await catchUp();
  await rehydrateAll();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name === ALARM_NAME) {
    await processDueNow();
  }
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') {
    await catchUp();
  }
});
