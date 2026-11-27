// 共通の小さな道具（ID・日時・文字の正規化・HTMLの無害化・端末の保存など）
// 使い方：ほかのファイルから import して使う。画面やデータには直接さわらない。

let lsPrefix = 'kaimono:';

/** localStorage のキーの頭につける文字を決める（テストで保存場所を分けるため） */
export function setStoragePrefix(ns) {
  lsPrefix = ns ? `kaimono:${ns}:` : 'kaimono:';
}

export function lsGet(key) {
  try { return localStorage.getItem(lsPrefix + key); } catch { return null; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(lsPrefix + key, value); } catch { /* 保存できない環境（プライベートモードなど）では何もしない */ }
}

export function lsDel(key) {
  try { localStorage.removeItem(lsPrefix + key); } catch { /* 同上 */ }
}

/** ランダムな ID（UUID）。オフラインで作った品目にも、先に ID を付けておける */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML に埋め込む文字を無害化する（入力された文字がタグとして動かないように） */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** カタカナ → ひらがな（入力候補で「トマト」と「とまと」を同じに扱う） */
export function toHiragana(s) {
  return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 品目名を比べるためのキー（全角半角・大文字小文字・カタカナひらがな・空白の違いをそろえる） */
export function nameKey(name) {
  const s = String(name ?? '').normalize('NFKC').trim().toLowerCase();
  return toHiragana(s).replace(/\s+/g, ' ');
}

/** 価格の表示（例：1280 → ¥1,280）。空なら '' */
export function formatPrice(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return `¥${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`;
}

/** 価格の入力を数値にする（「¥1,280」「１２８０円」も可）。空・数字でないときは null */
export function parsePrice(text) {
  const t = String(text ?? '').normalize('NFKC').replace(/[¥￥,円\s]/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n < 1e10 ? Math.round(n * 100) / 100 : null;
}

/** 数量の表示（数字だけなら「×2」、単位つきならそのまま） */
export function formatQty(q) {
  const s = String(q ?? '').trim();
  return /^\d+$/.test(s.normalize('NFKC')) ? `×${s.normalize('NFKC')}` : s;
}

/** 数量の＋−（先頭の数字だけを増減。空は 1 とみなす。1 より小さくはしない） */
export function stepQuantity(q, delta) {
  const s = String(q ?? '').normalize('NFKC').trim();
  const m = s.match(/^(\d+)(.*)$/);
  if (!m && s !== '') return s; // 「少し」など、数字で始まらない数量は変えない
  const num = m ? Number(m[1]) : 1;
  const unit = m ? m[2] : '';
  const next = Math.max(1, num + delta);
  return next === 1 && !unit ? '' : `${next}${unit}`;
}

export function isValidEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s ?? '').trim());
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 決めた時間内に終わらなければ失敗にする */
export function withTimeout(promise, ms, message = '時間切れになりました') {
  let timer = 0;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const scriptLoads = new Map();

/** 外部のスクリプトを1回だけ読み込む（失敗したら次に呼ばれたときにもう一度試す） */
export function loadScript(src) {
  if (!scriptLoads.has(src)) {
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        scriptLoads.delete(src);
        reject(new Error('ライブラリを読み込めませんでした（ネットにつながっていないかもしれません）'));
      };
      document.head.append(s);
    });
    scriptLoads.set(src, p);
  }
  return scriptLoads.get(src);
}

/** 並び順（position）→ 作成日時 の順にくらべる */
export function byPosition(a, b) {
  return (Number(a.position) || 0) - (Number(b.position) || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

export function maxOf(rows, field) {
  let m = 0;
  for (const r of rows) m = Math.max(m, Number(r[field]) || 0);
  return m;
}

/** 今日の日付（例：11月26日（木）） */
export function formatToday(d = new Date()) {
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}

/** 日時の表示（例：11/26 14:05） */
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function errMessage(e) {
  return String(e?.message || e || '不明なエラー');
}

/** config.js に、本物の Supabase の設定が書かれているか（空・サンプルのままなら false＝デモモード） */
export function isConfigured(cfg) {
  const url = String(cfg?.supabaseUrl || '');
  const key = String(cfg?.supabaseAnonKey || '');
  return /^https:\/\/[^/]+/.test(url) && key.length > 20 && !/YOUR[-_]/i.test(url + key);
}
