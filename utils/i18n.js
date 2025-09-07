// 簡易 i18n ユーティリティ（MV3 共通 / ES Modules）
// - options/popup では DOM の data-i18n 属性を適用
// - service_worker/popup/options いずれでも t(key, subs) で文言取得

/** @typedef {{ [key: string]: { message: string } }} Messages */

let cachedLang = null;
/** @type {Messages|null} */
let cachedDict = null;

/** 指定言語のメッセージ辞書を読み込む（'en' | 'ja' | 'auto'） */
async function loadDict(lang) {
  if (lang === 'auto') return null; // ブラウザ言語に任せる
  if (cachedLang === lang && cachedDict) return cachedDict;
  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  const res = await fetch(url);
  const dict = /** @type {Messages} */(await res.json());
  cachedLang = lang;
  cachedDict = dict;
  return dict;
}

/**
 * i18n 取得関数を生成
 * 既定は英語（settings.language 未設定時は 'en'）
 */
export async function createI18n() {
  const { settings } = await chrome.storage.sync.get(['settings']);
  /** @type {'auto'|'en'|'ja'} */
  const lang = (settings && /** @type {any} */(settings).language) || 'auto';
  const dict = await loadDict(lang);
  const getMessage = dict
    ? (key, substitutions) => {
        const entry = dict[key];
        let msg = entry?.message || key;
        if (substitutions != null) {
          const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
          subs.forEach((s, i) => { msg = msg.replace(new RegExp(`\\$${i+1}`, 'g'), String(s)); });
        }
        return msg;
      }
    : (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  return {
    t: /** @param {string} key @param {string|string[]=} substitutions */(key, substitutions) => getMessage(key, substitutions),
    lang,
  };
}

/** DOM の data-i18n 属性を適用（オプション） */
export async function applyI18nDom(t) {
  try {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    document.querySelectorAll('[data-i18n-value]').forEach((el) => {
      const key = el.getAttribute('data-i18n-value');
      if (key) el.setAttribute('value', t(key));
    });
  } catch {}
}
