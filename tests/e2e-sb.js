// Supabase を設定したときの流れの画面テスト（にせの Supabase〔sb-config.js〕を使う。本物にはつながない）
// ログイン → はじめてのリスト → 送信 → リアルタイム → 写真 → 共有 → つながらないとき → 読み込み直し → ログアウト → 設定まちがい
import { test, assert, eq, run, sleep, waitFor } from './harness.js';

const frame = document.getElementById('app');
const NS = `sb-${Date.now()}`;
const errors = [];
const W = () => frame.contentWindow;
const D = () => frame.contentDocument;
const q = (sel) => D().querySelector(sel);
const qa = (sel) => [...D().querySelectorAll(sel)];
const text = (sel) => (q(sel)?.textContent || '').trim();
const fake = () => W().__fakeSupabase;
const visible = (sel) => q(sel) && !q(sel).hidden;
const openLayers = () => qa('.sheet-layer:not(.is-closing)');
const topLayer = () => openLayers().at(-1);
const itemWrap = (name) => qa('.item-wrap').find((w) => w.querySelector('.name-text')?.textContent === name);
const cardByName = (name) => qa('.list-card').find((c) => c.querySelector('.lc-name')?.textContent === name);

function watchErrors() {
  W().addEventListener('error', (e) => errors.push(String(e.message)));
  W().addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));
  D().addEventListener('securitypolicyviolation', (e) => errors.push(`CSP 違反：${e.violatedDirective} ${e.blockedURI}`));
}

async function load(url) {
  const loaded = new Promise((r) => { frame.onload = r; });
  frame.src = url;
  await loaded;
  watchErrors();
}

const appUrl = () => `/__sbtest/index.html?test&nosw&ns=${NS}`;
const click = (el, label = '') => { if (!el) throw new Error(`押す場所が見つかりません：${label}`); el.click(); };

function setValue(input, v) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function login(email, password) {
  setValue(q('#auth-email'), email);
  setValue(q('#auth-password'), password);
  q('#auth-form').requestSubmit();
}

async function quickAdd(name) {
  setValue(q('#quick-input'), name);
  q('#quick-add').requestSubmit();
  await sleep(60);
}

async function closeTopSheet() {
  const n = openLayers().length;
  click(topLayer().querySelector('.sheet-close'), '閉じる');
  await waitFor(() => openLayers().length === n - 1, 2000, 'シートが閉じる');
}

async function openMenu(act) {
  click(q('#btn-list-menu'), 'メニュー');
  await waitFor(() => topLayer()?.querySelector(`[data-menu="${act}"]`), 2000, `メニュー ${act}`);
  click(topLayer().querySelector(`[data-menu="${act}"]`));
}

const currentListId = () => decodeURIComponent(W().location.hash.replace('#/list/', ''));

/** リストを開く（サーバーから取り直すと一覧が描き直されるので、開けるまで押し直す） */
async function openList(name) {
  await waitFor(() => {
    if (visible('#view-list') && text('#list-name') === name) return true;
    cardByName(name)?.querySelector('.lc-link')?.click();
    return false;
  }, 5000, `「${name}」を開く`);
}

function remoteItem(listId, name) {
  const t = new Date().toISOString();
  return { id: `remote-${Date.now()}`, list_id: listId, name, quantity: '', note: '', category: 'dairy', photo_path: null,
    store: '', price: null, checked: false, checked_at: null, position: 50, created_by: 'user-other', created_at: t, updated_at: t };
}

async function photoFile() {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dcf6ec';
  ctx.fillRect(0, 0, 1200, 900);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new (W().File)([blob], 'テスト.png', { type: 'image/png' });
}

function idbGet(dbName, key) {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); resolve(undefined); return; }
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => { db.close(); resolve(undefined); };
    };
    req.onerror = () => resolve(undefined);
  });
}

// ---------- ここからテスト ----------
test('Supabase の設定があると、ログインの画面が出る（デモモードにならない）', async () => {
  localStorage.removeItem('kaimono-fake-db');
  localStorage.removeItem('kaimono-fake-auth');
  await load(appUrl());
  await waitFor(() => visible('#view-auth'), 8000, 'ログインの画面');
  eq(text('#auth-title'), 'おかえりなさい');
  assert(q('#view-home').hidden, '一覧は出ない');
});

test('入力が足りないと知らせる・パスワードがちがうと入れない', async () => {
  await login('', '');
  assert(text('#auth-msg').includes('メールアドレス'), `表示：${text('#auth-msg')}`);
  await login('me@example.com', 'wrong-pass');
  await waitFor(() => text('#auth-msg').includes('ちがいます'), 3000, 'パスワードちがいの表示');
  assert(q('#view-home').hidden, '入れない');
});

test('新規登録すると、確認メールの案内が出る', async () => {
  click(q('#auth-toggle'), '新規登録へ');
  eq(text('#auth-title'), 'はじめまして！');
  await login('new-person@example.com', 'password9');
  await waitFor(() => text('#auth-msg').includes('確認のメール'), 3000, '確認メールの案内');
  assert(fake().state.users.some((u) => u.email === 'new-person@example.com' && !u.confirmed), 'サーバーに登録された（確認前）');
  click(q('#auth-toggle'), 'ログインへ');
});

test('ログインすると、はじめての人にはリストが3つでき、サーバーにも入る', async () => {
  await login('me@example.com', 'password1');
  await waitFor(() => visible('#view-home') && qa('.list-card').length === 3, 8000, 'リスト一覧（3つ）');
  assert(q('#demo-banner').hidden, 'デモモードの表示は出ない');
  await waitFor(() => fake().state.lists.length === 3, 8000, 'サーバーのリスト');
  assert(fake().state.lists.every((l) => l.owner_id === 'user-me'), '持ち主は自分');
  eq(fake().state.list_members.filter((m) => m.role === 'owner').length, 3, '持ち主としてメンバーに入る');
});

test('品目を追加すると、サーバーに送られる', async () => {
  click(cardByName('スーパー').querySelector('.lc-link'), 'スーパー');
  await waitFor(() => visible('#view-list'), 3000, 'リストの画面');
  await quickAdd('牛乳');
  const listId = currentListId();
  await waitFor(() => fake().state.items.some((i) => i.name === '牛乳' && i.list_id === listId), 5000, 'サーバーの品目');
  await waitFor(() => fake().state.item_history.some((h) => h.name === '牛乳' && h.user_id === 'user-me'), 5000, '入力候補の履歴');
  const row = fake().state.items.find((i) => i.name === '牛乳');
  eq(row.category, 'dairy', 'カテゴリも送られる');
});

test('ほかの人の追加・チェック・削除が、リアルタイムで届く', async () => {
  const row = remoteItem(currentListId(), 'たまご（家族が追加）');
  fake().remoteInsert('items', row);
  await waitFor(() => itemWrap(row.name), 3000, '家族が追加した品目');
  fake().remoteUpdate('items', row.id, { checked: true, checked_at: new Date().toISOString() });
  await waitFor(() => itemWrap(row.name)?.classList.contains('is-checked'), 3000, '家族のチェック');
  fake().remoteDelete('items', row.id);
  await waitFor(() => !itemWrap(row.name), 3000, '家族の削除');
});

test('写真を付けると、サーバーの保存場所に入る', async () => {
  click(itemWrap('牛乳').querySelector('.item-body'), '牛乳');
  await waitFor(() => topLayer()?.querySelector('.item-form'), 2000, '詳細のシート');
  const input = topLayer().querySelector('[data-file="library"]');
  const dt = new (W().DataTransfer)();
  dt.items.add(await photoFile());
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !topLayer().querySelector('.photo-preview').hidden, 4000, 'プレビュー');
  await closeTopSheet();
  const listId = currentListId();
  await waitFor(() => [...fake().files.keys()].some((p) => p.startsWith(`${listId}/`)), 5000, 'サーバーの写真');
  await waitFor(() => fake().state.items.find((i) => i.name === '牛乳')?.photo_path?.startsWith(`${listId}/`), 5000, '品目の写真の場所');
});

test('共有：招待すると「招待中」に出て、取り消せる', async () => {
  await openMenu('share');
  await waitFor(() => topLayer()?.querySelector('.members')?.textContent.includes('me@example.com'), 4000, 'メンバー（自分）');
  assert(topLayer().querySelector('.members').textContent.includes('オーナー'), '自分は持ち主');
  setValue(topLayer().querySelector('[name="email"]'), 'family@example.com');
  topLayer().querySelector('.invite-form').requestSubmit();
  await waitFor(() => topLayer()?.querySelector('.member.is-invite')?.textContent.includes('family@example.com'), 5000, '招待中の表示');
  eq(fake().state.list_invites.length, 1, 'サーバーの招待');
  click(topLayer().querySelector('[data-share="cancel"]'), '取り消し');
  await waitFor(() => !topLayer()?.querySelector('.member.is-invite'), 5000, '招待の取り消し');
  eq(fake().state.list_invites.length, 0);
  await closeTopSheet();
});

test('家族から共有されたリストが、リアルタイムで一覧に出る', async () => {
  click(q('#btn-back'), '戻る');
  await waitFor(() => visible('#view-home'), 2000, '一覧');
  fake().shareListFromOther('家族のリスト');
  await waitFor(() => cardByName('家族のリスト'), 5000, '共有されたリスト');
  assert(cardByName('家族のリスト').textContent.includes('共有'), '共有の印');
  click(cardByName('家族のリスト').querySelector('.lc-link'));
  await waitFor(() => visible('#view-list') && text('#list-name') === '家族のリスト', 3000, '共有されたリストを開く');
  click(q('#btn-list-menu'));
  await waitFor(() => topLayer()?.querySelector('[data-menu="leave"]'), 2000, 'メニュー');
  assert(!topLayer().querySelector('[data-menu="delete"]'), 'メンバーは削除できない（抜けるだけ）');
  await closeTopSheet();
});

test('つながらないときは「同期待ち」が出て、つながったら送られる', async () => {
  fake().failNetwork = true;
  await quickAdd('おにぎり');
  await waitFor(() => visible('.view-list .sync-pill') && text('.view-list .sync-pill').includes('同期待ち'), 6000, '同期待ちの表示');
  assert(!fake().state.items.some((i) => i.name === 'おにぎり'), 'まだサーバーにない');
  fake().failNetwork = false;
  await waitFor(() => fake().state.items.some((i) => i.name === 'おにぎり'), 15000, 'つながったら送られる');
  await waitFor(() => !visible('.view-list .sync-pill'), 6000, '同期待ちの表示が消える');
});

test('読み込み直しても、ログインしたまま・データも残る', async () => {
  await load(appUrl());
  await waitFor(() => visible('#view-home') && cardByName('家族のリスト'), 8000, '一覧（ログインの画面は出ない）');
  eq(qa('.list-card').length, 4);
  await openList('スーパー');
  await waitFor(() => itemWrap('牛乳'), 3000, '「スーパー」の牛乳が残る');
  click(q('#btn-back'), '戻る');
  await openList('家族のリスト'); // 「おにぎり」は、共有されたリストを開いているときに追加した
  await waitFor(() => itemWrap('おにぎり'), 3000, '「家族のリスト」のおにぎりが残る（メンバーの追加もサーバーに入った）');
  assert(fake().state.items.find((i) => i.name === 'おにぎり').list_id === 'list-from-other', 'サーバーでも共有されたリストに入っている');
});

test('ログアウトすると、この端末のデータを消して、ログインの画面に戻る', async () => {
  click(q('#btn-back'));
  await waitFor(() => visible('#view-home'), 2000, '一覧');
  click(q('#btn-settings'), '設定');
  await waitFor(() => topLayer()?.querySelector('[data-set="logout"]'), 2000, '設定のシート');
  assert(topLayer().textContent.includes('me@example.com'), 'ログイン中のメールアドレスが出る');
  const loaded = new Promise((r) => { frame.onload = r; });
  click(topLayer().querySelector('[data-set="logout"]'), 'ログアウト');
  await waitFor(() => topLayer()?.querySelector('[data-confirm="1"]'), 2000, '確認');
  click(topLayer().querySelector('[data-confirm="1"]'));
  await loaded;
  watchErrors();
  await waitFor(() => visible('#view-auth'), 8000, 'ログインの画面');
  eq(localStorage.getItem('kaimono-fake-auth'), null, 'ログインの情報が消える');
  eq(await idbGet(`kaimono-memo-${NS}`, 'snap:user-me'), undefined, '端末の一覧が消える');
  assert(fake().state.items.some((i) => i.name === '牛乳'), 'サーバーのデータは残る');
});

test('設定まちがい（SQL を実行していない）のときは、わかるように知らせる', async () => {
  fake().missingTables = true;
  await login('me@example.com', 'password1');
  await waitFor(() => visible('#view-home'), 8000, '一覧');
  await waitFor(() => text('#toast-root').includes('schema.sql'), 6000, '設定の案内のトースト');
  fake().missingTables = false;
});

test('操作中にエラーが出ていない', () => {
  eq(errors, [], 'エラーの一覧');
});

run('Supabase の流れのテスト（にせの Supabase）');
