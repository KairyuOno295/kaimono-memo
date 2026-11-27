// 画面全体のまとめ役（表示の切り替え・再描画・同期の状態の表示）
// URL の # で画面を切り替える：#/ ＝リスト一覧、#/list/<ID> ＝リストの中身
// （スマホの「戻る」で一覧に戻れるように）
import { $, $$, toast, closeAllSheets, initDomBasics } from './dom.js';
import { initHome, renderHome } from './home.js';
import { initList, renderList } from './list.js';

let ctx = null;
let rafId = 0;
let pillTimer = 0;

export function startUi(store, opts = {}) {
  ctx = {
    store, mode: opts.mode || 'local', backend: opts.backend || null, onLogout: opts.onLogout || null,
    busy: false, pendingRender: false, reorder: false, listId: null, newId: null, flashId: null,
  };
  ctx.render = scheduleRender;
  ctx.setBusy = (on) => {
    ctx.busy = on;
    if (!on && ctx.pendingRender) { ctx.pendingRender = false; scheduleRender(); }
  };
  initDomBasics();
  initHome(ctx);
  initList(ctx);
  store.on(scheduleRender);
  store.onDrop = (op, res) => toast(res?.setup ? res.message : '変更の一部をサーバーに保存できませんでした（権限がない など）', { ms: res?.setup ? 9000 : 2600 });
  window.addEventListener('hashchange', () => {
    closeAllSheets();
    ctx.reorder = false;
    render();
    window.scrollTo(0, 0);
  });
  window.addEventListener('online', scheduleRender);
  window.addEventListener('offline', scheduleRender);
  render();
  return ctx;
}

function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}

function render() {
  if (ctx.busy) { ctx.pendingRender = true; return; } // スワイプ中は描き直さない
  const route = resolveRoute(ctx.store);
  for (const v of ['home', 'list']) $(`#view-${v}`).hidden = v !== route.name;
  document.body.dataset.view = route.name;
  if (route.name === 'list') renderList(ctx, route.id);
  else renderHome(ctx);
  renderSyncPills();
}

function resolveRoute(store) {
  const m = location.hash.match(/^#\/list\/([^/?#]+)/);
  if (!m) return { name: 'home' };
  let id = decodeURIComponent(m[1]);
  if (id.startsWith('@')) id = store.sortedLists()[Number(id.slice(1)) - 1]?.id || ''; // 「@1」＝1番目のリスト
  if (!store.data.lists[id]) {
    history.replaceState(null, '', '#/');
    return { name: 'home' };
  }
  return { name: 'list', id };
}

/** 同期の状態（オフライン・送信待ち）。何もなければ null（表示しない） */
export function syncLabel(c) {
  if (c.mode === 'local') return null;
  const n = c.store.outbox.length;
  if (!navigator.onLine) {
    return { state: 'offline', text: n ? `☁️ オフライン・未送信 ${n}` : '☁️ オフライン', title: 'つながったら自動で同期します' };
  }
  if (!n) return null;
  const waiting = Date.now() - Date.parse(c.store.outbox[0].at || 0);
  if (c.store.status.error) return { state: 'error', text: `⚠️ 同期待ち ${n}`, title: c.store.status.error };
  if (waiting > 2000) return { state: 'busy', text: '🔄 同期中', title: '' };
  return null;
}

function renderSyncPills() {
  const s = syncLabel(ctx);
  for (const pill of $$('.sync-pill')) {
    pill.hidden = !s;
    if (!s) continue;
    pill.textContent = s.text;
    pill.dataset.state = s.state;
    pill.title = s.title;
  }
  clearTimeout(pillTimer);
  if (ctx.store.outbox.length) pillTimer = setTimeout(scheduleRender, 2500); // 送信待ちが残っていれば、表示を見直す
}
