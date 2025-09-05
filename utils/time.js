// 時刻・繰り返し計算ユーティリティ（ES Modules）
// JSDoc 型定義を併記し、サービスワーカーとポップアップで共用する。

/**
 * @typedef {{ type: 'none' } | { type: 'daily', interval: number } | { type: 'weekly', interval: number, byWeekday: number[] } | { type: 'monthly', interval: number, byDay?: number }} RepeatRule
 */

/**
 * @typedef {'low'|'normal'|'high'} Priority
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string=} note
 * @property {number} dueAt        // 次回発火
 * @property {number} baseAt       // 初回基準（時刻固定用）
 * @property {RepeatRule} repeat
 * @property {Priority=} priority
 * @property {string[]=} tags
 * @property {boolean} done
 * @property {boolean=} archived
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// 内部ユーティリティ
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** 指定日の 00:00:00.000（週の開始は常に日曜） */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 指定した開始曜日の週の開始（00:00）: weekStartsOn=0(日) or 1(月) */
function startOfWeek(ts, weekStartsOn = 0) {
  const d = new Date(startOfDay(ts));
  const dow = d.getDay(); // 0..6 (Sun..Sat)
  let shift = dow - (weekStartsOn === 1 ? 1 : 0);
  if (shift < 0) shift += 7; // 月曜始まりの場合の負補正
  d.setDate(d.getDate() - shift);
  return d.getTime();
}

/** baseAt の時分秒ミリ秒を維持したまま date に適用 */
function withTimeOf(baseAt, dateTs) {
  const b = new Date(baseAt);
  const d = new Date(dateTs);
  d.setHours(b.getHours(), b.getMinutes(), b.getSeconds(), b.getMilliseconds());
  return d.getTime();
}

/** 月の末日を返す */
function lastDayOfMonth(year, month /* 0=Jan */) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 次回発火時刻を計算する（now を超える最小のもの）。
 * 繰り返しなし({type:'none'})は null を返す。
 * @param {number} nowMs
 * @param {Task} task
 * @param {{weekStartsOn?: 0|1}=} opts 週の開始曜日（weekly のみ）
 * @returns {number|null}
 */
export function nextOccurrence(nowMs, task, opts = {}) {
  const r = task.repeat;
  if (!r || r.type === 'none') return null;
  const base = task.baseAt;
  if (r.type === 'daily') {
    const interval = Math.max(1, r.interval | 0);
    const diff = nowMs - base;
    const steps = Math.max(0, Math.ceil(diff / (interval * DAY)));
    let candidate = base + steps * interval * DAY;
    if (candidate <= nowMs) candidate += interval * DAY;
    return candidate;
  }
  if (r.type === 'weekly') {
    const interval = Math.max(1, r.interval | 0);
    const days = Array.isArray(r.byWeekday) && r.byWeekday.length ? [...r.byWeekday].sort((a,b)=>a-b) : [new Date(base).getDay()];
    // 週単位の間隔を満たす週のみ許可し、日ごとに先を探索（最大2年分）
    const limit = nowMs + 2 * 365 * DAY;
    // 現在日から順に探索
    let cursor = startOfDay(nowMs);
    while (cursor < limit) {
      const d = new Date(cursor);
      const dow = d.getDay();
      if (days.includes(dow)) {
        const cand = withTimeOf(base, cursor);
        const wso = opts.weekStartsOn === 1 ? 1 : 0;
        const weeksBetween = Math.floor((startOfWeek(cand, wso) - startOfWeek(base, wso)) / (7 * DAY));
        if (weeksBetween % interval === 0 && cand > nowMs) return cand;
      }
      cursor += DAY;
    }
    return null;
  }
  if (r.type === 'monthly') {
    const interval = Math.max(1, r.interval | 0);
    const baseDate = new Date(base);
    const baseDay = r.byDay ? clamp(r.byDay, 1, 31) : baseDate.getDate();
    const nowD = new Date(nowMs);
    const monthsBase = baseDate.getFullYear() * 12 + baseDate.getMonth();
    const monthsNow = nowD.getFullYear() * 12 + nowD.getMonth();
    let k = Math.max(0, Math.ceil((monthsNow - monthsBase) / interval));
    while (k < 240) { // 最大20年分の安全弁
      const y = Math.floor((monthsBase + k * interval) / 12);
      const m = (monthsBase + k * interval) % 12;
      const ld = lastDayOfMonth(y, m);
      const day = clamp(baseDay, 1, ld);
      const cand = withTimeOf(base, new Date(y, m, day).getTime());
      if (cand > nowMs) return cand;
      k += 1;
    }
    return null;
  }
  return null;
}

/** 簡易フォーマッタ（ローカル時刻） */
export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

