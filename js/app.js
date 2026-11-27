// かいものメモ：起動の処理
// 流れ：config.js を読む → Supabase の設定がなければ「デモモード」（この端末だけに保存）
//       → 設定があればログイン → 端末に保存したデータを表示 → サーバーと同期
// URL の後ろにつける指定（テスト・確認用）：
//   ?demo … 設定があってもデモモードで動かす／?nosw … サービスワーカーを使わない
//   ?ns=名前 … 保存場所を分ける／?theme=dark・light … 表示の明るさ／?test … テスト用の窓口を開く
import { setDbNamespace } from './db.js';
import { setStoragePrefix, lsGet, lsSet, lsDel, withTimeout, isConfigured } from './util.js';
import { Store } from './store.js';
import { createLocalBackend } from './backend-local.js';
import { SupabaseBackend, isSetupMessage } from './backend-supabase.js';
import { toast } from './ui/dom.js';
import { STARTER_LISTS, DEMO_ITEMS } from './seed.js';
import { startUi } from './ui/main.js';
import { showAuth, hideAuth } from './ui/auth.js';
import { initTheme } from './ui/theme.js';
import { openNewPasswordSheet } from './ui/sheets.js';

const params = new URLSearchParams(location.search);
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap';

async function boot() {
  const ns = params.get('ns') || '';
  setStoragePrefix(ns);
  setDbNamespace(ns);
  initTheme(params.get('theme'));
  loadFonts();
  if (!params.has('nosw')) registerServiceWorker();
  if (params.has('test') && params.get('screen') === 'auth') { showAuth(null, () => {}); return; }
  const cfg = window.KAIMONO_CONFIG || {};
  if (params.has('demo') || !isConfigured(cfg)) await startLocal();
  else await startSupabase(cfg);
}

function loadFonts() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_CSS;
  document.head.append(link);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('サービスワーカーを登録できませんでした', e));
}

function exposeForTest(store, backend) {
  if (params.has('test')) window.__kaimono = { store, backend };
}

// ---------- デモモード ----------
async function startLocal() {
  const store = new Store({ backend: createLocalBackend(), user: { id: 'local', email: '' } });
  await store.load();
  if (!lsGet('seeded:local') && store.sortedLists().length === 0) store.seed(STARTER_LISTS, DEMO_ITEMS);
  lsSet('seeded:local', '1');
  startUi(store, { mode: 'local' });
  watchPageHide(store);
  exposeForTest(store, null);
}

function watchPageHide(store) {
  window.addEventListener('pagehide', () => store.commitSoftDeletes());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.commitSoftDeletes();
  });
}

// ---------- Supabase ----------
async function startSupabase(cfg) {
  const recovery = /type=recovery/.test(location.hash); // パスワード再設定のメールから開いた
  const backend = new SupabaseBackend(cfg);
  const last = readLastUser();
  const { session, failed } = await safeSession(backend);
  if (session) { await enterSupabase(backend, toUser(session), recovery); return; }
  if (last && (failed || !navigator.onLine)) { await enterSupabase(backend, last, false); return; } // オフラインで起動
  showAuth(backend, (s) => enterSupabase(backend, toUser(s), false));
}

async function safeSession(backend) {
  try {
    const r = await withTimeout(backend.getSession(), 8000);
    return { session: r.session, failed: !!r.error };
  } catch {
    return { session: null, failed: true };
  }
}

function toUser(session) {
  return { id: session.user.id, email: session.user.email || '' };
}

function readLastUser() {
  try { return JSON.parse(lsGet('lastUser') || 'null'); } catch { return null; }
}

async function enterSupabase(backend, user, recovery) {
  hideAuth();
  lsSet('lastUser', JSON.stringify(user));
  backend.setUser(user);
  const store = new Store({ backend, user });
  await store.load();
  startUi(store, { mode: 'supabase', backend, onLogout: () => logout(store, backend) });
  watchPageHide(store);
  connectSync(store, backend);
  exposeForTest(store, backend);
  if (recovery) openNewPasswordSheet(backend);
}

function connectSync(store, backend) {
  let warned = false;
  const pull = () => store.pull().then((ok) => {
    if (ok) { seedIfNew(store); return; }
    if (warned || !isSetupMessage(store.status.error)) return;
    warned = true; // 設定まちがい（表がない・キーがちがう）は、1回だけ長めに知らせる
    toast(store.status.error, { ms: 9000 });
  });
  const subscribe = () => backend.subscribe((evt) => store.applyRemote(evt)).catch(() => {});
  window.addEventListener('online', () => {
    store.flush();
    pull();
    if (!backend.channel) subscribe();
  });
  window.addEventListener('offline', () => store.emit('sync'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  backend.onAuthChange((event, session) => onAuthEvent(event, session, store)).catch(() => {});
  subscribe();
  pull();
}

/** はじめてログインした人には、からっぽのリストを3つ作る（1回だけ） */
function seedIfNew(store) {
  const key = `seeded:${store.user.id}`;
  if (lsGet(key)) return;
  if (store.sortedLists().length === 0) store.seed(STARTER_LISTS);
  lsSet(key, '1');
}

function onAuthEvent(event, session, store) {
  if (event === 'SIGNED_OUT' && !store.loggingOut) { lsDel('lastUser'); location.reload(); return; }
  if (event === 'SIGNED_IN' && session?.user?.id && session.user.id !== store.user.id) location.reload();
  if (event === 'PASSWORD_RECOVERY') openNewPasswordSheet(store.backend);
}

async function logout(store, backend) {
  store.loggingOut = true;
  await backend.signOut().catch(() => {});
  await store.clearLocal().catch(() => {});
  lsDel('lastUser');
  location.replace(location.pathname);
}

boot().catch((err) => {
  console.error(err);
  const box = document.getElementById('fatal');
  if (box) { box.hidden = false; box.querySelector('pre').textContent = String(err?.stack || err); }
}).finally(() => {
  document.getElementById('boot')?.remove();
});
