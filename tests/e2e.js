// 画面の操作テスト：アプリ（デモモード）を枠の中で開き、人の操作のまねをして主要な機能を確かめる
// 架空のデータだけを使う。保存場所は ns で分けるので、ふだんのデータには影響しない。
import { test, assert, eq, run, sleep, waitFor } from './harness.js';

const frame = document.getElementById('app');
const NS = `e2e-${Date.now()}`;
const errors = [];
const W = () => frame.contentWindow;
const D = () => frame.contentDocument;
const q = (sel) => D().querySelector(sel);
const qa = (sel) => [...D().querySelectorAll(sel)];
const text = (sel) => (q(sel)?.textContent || '').trim();

async function openApp() {
  const loaded = new Promise((r) => { frame.onload = r; });
  frame.src = `../index.html?demo&nosw&test&ns=${NS}`;
  await loaded;
  W().addEventListener('error', (e) => errors.push(String(e.message)));
  W().addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));
  D().addEventListener('securitypolicyviolation', (e) => errors.push(`CSP 違反：${e.violatedDirective} ${e.blockedURI}`));
  await waitFor(() => W().__kaimono && !q('#view-home').hidden, 8000, 'リスト一覧の表示');
}

function click(el, label = '') {
  if (!el) throw new Error(`押す場所が見つかりません：${label}`);
  el.click();
}

function setValue(input, v) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const openLayers = () => qa('.sheet-layer:not(.is-closing)');
const topLayer = () => openLayers().at(-1);
const itemWrap = (name) => qa('.item-wrap').find((w) => w.querySelector('.name-text')?.textContent === name);
const store = () => W().__kaimono.store;
const listView = () => !q('#view-list').hidden;

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

/** 指で左にスワイプするまね（Pointer Events を順に送る） */
async function swipe(el, dx) {
  const r = el.getBoundingClientRect();
  const x0 = r.left + r.width * 0.75;
  const y = r.top + r.height / 2;
  const PE = W().PointerEvent;
  const opt = (x) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 });
  el.dispatchEvent(new PE('pointerdown', opt(x0)));
  for (let i = 1; i <= 8; i += 1) {
    el.dispatchEvent(new PE('pointermove', opt(x0 + (dx * i) / 8)));
    await sleep(16);
  }
  el.dispatchEvent(new PE('pointerup', opt(x0 + dx)));
}

async function makePhotoFile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd3e5';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6ed6b4';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h / 3, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new (W().File)([blob], 'テスト写真.png', { type: 'image/png' });
}

// ---------- ここからテスト ----------
test('起動するとデモモードでリスト一覧が出る', async () => {
  await openApp();
  eq(qa('.list-card').length, 3, '最初のリストは3つ');
  assert(!q('#demo-banner').hidden, 'デモモードの表示');
  assert(text('.list-cards').includes('スーパー'), '「スーパー」がある');
});

test('新しいリストを作れる（絵文字・色を選べる）', async () => {
  click(q('#btn-new-list'), '新しいリスト');
  await waitFor(() => topLayer()?.querySelector('.list-form'), 2000, 'リストのシート');
  setValue(topLayer().querySelector('[name="name"]'), 'テスト用リスト');
  click(topLayer().querySelector('[data-pick-emoji="🍰"]'), '絵文字');
  click(topLayer().querySelector('[data-pick-color="sky"]'), '色');
  eq(topLayer().querySelector('.list-preview').dataset.color, 'sky', 'プレビューの色');
  topLayer().querySelector('form').requestSubmit();
  await waitFor(() => listView() && text('#list-name') === 'テスト用リスト', 3000, 'リストの画面');
  eq(q('#view-list').dataset.color, 'sky');
  eq(q('#list-emoji svg')?.dataset.icon, 'cake', '選んだ🍰は線のアイコン（ケーキ）で出る'); // 2026-11-27 KM-012
});

test('空のリストには、イラストとひとことが出る', async () => {
  await waitFor(() => q('#items .empty'), 2000, '空の表示');
  assert(text('#items .empty').includes('まだ品目がありません'));
});

test('名前だけで追加でき、カテゴリごとにまとまる', async () => {
  for (const name of ['トマト', '牛乳', 'ふしぎな物']) await quickAdd(name);
  await waitFor(() => itemWrap('ふしぎな物'), 2000, '追加した品目');
  assert(q('.group[data-cat="veg"]')?.textContent.includes('トマト'), 'トマトは野菜・果物');
  assert(q('.group[data-cat="dairy"]')?.textContent.includes('牛乳'), '牛乳は乳製品・卵');
  assert(q('.group[data-cat="other"]')?.textContent.includes('ふしぎな物'), 'わからない物はその他');
  eq(q('#quick-input').value, '', '入力欄は空に戻る');
});

test('同じ名前は二重に追加しない（ひらがなでも同じとみなす）', async () => {
  await quickAdd('とまと');
  await sleep(100);
  eq(qa('.name-text').filter((n) => n.textContent === 'トマト').length, 1);
  assert(text('#toast-root').includes('もうリストにある'), 'お知らせが出る');
});

test('過去に追加した品目が入力候補に出て、タップで追加できる', async () => {
  const input = q('#quick-input');
  input.focus();
  setValue(input, 'きゃ');
  await waitFor(() => !q('#suggest').hidden && text('#suggest').includes('キャベツ'), 2000, '候補「キャベツ」');
  click(qa('#suggest [data-name]').find((b) => b.dataset.name === 'キャベツ'), '候補');
  await waitFor(() => itemWrap('キャベツ'), 2000, 'キャベツの追加');
  setValue(input, '');
  await waitFor(() => q('#suggest .chips'), 2000, '「よく買うもの」');
  input.blur();
});

test('タップでチェック → チェック済みは下にまとまる・外すこともできる', async () => {
  click(itemWrap('トマト').querySelector('.check'), 'チェック');
  await waitFor(() => q('.done-group')?.textContent.includes('トマト'), 3000, 'チェック済みへ移動');
  assert(itemWrap('トマト').classList.contains('is-checked'));
  assert(!q('#btn-clear-checked').hidden && text('#btn-clear-checked').includes('1'), '削除ボタンが出る');
  click(itemWrap('トマト').querySelector('.check'), 'チェックを外す');
  await waitFor(() => q('.group[data-cat="veg"]')?.textContent.includes('トマト'), 2000, '元のカテゴリへ');
  click(itemWrap('トマト').querySelector('.check'), 'もう一度チェック');
  await waitFor(() => itemWrap('トマト')?.classList.contains('is-checked'), 3000, 'チェック済み');
});

test('タップで詳細を編集できる（数量・メモ・お店・価格・カテゴリ）', async () => {
  click(itemWrap('牛乳').querySelector('.item-body'), '品目');
  await waitFor(() => topLayer()?.querySelector('.item-form'), 2000, '詳細のシート');
  const f = topLayer().querySelector('.item-form');
  click(f.querySelector('[data-step="1"]'));
  click(f.querySelector('[data-step="1"]'));
  eq(f.querySelector('[name="quantity"]').value, '3', '＋を2回で 3');
  setValue(f.querySelector('[name="note"]'), '低脂肪');
  setValue(f.querySelector('[name="store"]'), '駅前の店');
  setValue(f.querySelector('[name="price"]'), '198');
  click(f.querySelector('[data-cat="drink"]'), 'カテゴリ');
  f.requestSubmit();
  await waitFor(() => openLayers().length === 0, 2000, 'シートが閉じる');
  await waitFor(() => q('.group[data-cat="drink"]')?.textContent.includes('牛乳'), 2000, 'カテゴリが変わる');
  const w = itemWrap('牛乳');
  eq(w.querySelector('.qty').textContent, '×3');
  const meta = w.querySelector('.item-meta').textContent;
  assert(meta.includes('低脂肪') && meta.includes('駅前の店') && meta.includes('¥198'), `表示：${meta}`);
});

test('写真を付けると、長辺800px・JPEG に縮小され、サムネイルと拡大表示が出る', async () => {
  click(itemWrap('牛乳').querySelector('.item-body'));
  await waitFor(() => topLayer()?.querySelector('.item-form'), 2000, '詳細のシート');
  const input = topLayer().querySelector('[data-file="library"]');
  const dt = new (W().DataTransfer)();
  dt.items.add(await makePhotoFile(1600, 1200));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !topLayer().querySelector('.photo-preview').hidden, 4000, 'プレビュー');
  await closeTopSheet();
  await waitFor(() => itemWrap('牛乳')?.querySelector('.thumb img')?.src.startsWith('blob:'), 4000, 'サムネイル');
  const path = store().data.items[itemWrap('牛乳').dataset.id].photo_path; // 「スーパー」にも牛乳があるので、ID で探す
  const blob = await store().photoBlob(path);
  eq(blob.type, 'image/jpeg');
  const bmp = await createImageBitmap(blob);
  eq([bmp.width, bmp.height], [800, 600], '縮小後の大きさ');
  click(itemWrap('牛乳').querySelector('.thumb'), 'サムネイル');
  await waitFor(() => !q('#viewer').hidden && q('#viewer img').src.startsWith('blob:'), 2000, '拡大表示');
  click(q('#viewer'));
  await waitFor(() => q('#viewer').hidden, 2000, '拡大表示を閉じる');
});

test('新しいカテゴリ（絵文字つき）を追加して使える', async () => {
  click(itemWrap('ふしぎな物').querySelector('.item-body'));
  await waitFor(() => topLayer()?.querySelector('.item-form'), 2000, '詳細のシート');
  click(topLayer().querySelector('[data-act="add-cat"]'), 'カテゴリの追加');
  await waitFor(() => topLayer()?.querySelector('.cat-form'), 2000, 'カテゴリのシート');
  setValue(topLayer().querySelector('[name="name"]'), 'ペット用品');
  click(topLayer().querySelector('[data-pick-emoji="🐾"]'));
  topLayer().querySelector('form').requestSubmit();
  await waitFor(() => topLayer()?.querySelector('.chip.is-on')?.textContent.includes('ペット用品'), 2000, '追加したカテゴリが選ばれる');
  await closeTopSheet();
  await waitFor(() => qa('.group-title').some((h) => h.querySelector('svg[data-icon="paw"]') && h.textContent.includes('ペット用品')), 2000, 'カテゴリの見出し（🐾は線のアイコン）');
});

test('左スワイプで削除 → 「元に戻す」で戻せる', async () => {
  await swipe(itemWrap('ふしぎな物').querySelector('.item'), -320);
  await waitFor(() => !itemWrap('ふしぎな物'), 2000, '消える');
  const btn = await waitFor(() => q('#toast-root .toast-btn'), 2000, '元に戻すボタン');
  eq(btn.textContent, '元に戻す');
  click(btn);
  await waitFor(() => itemWrap('ふしぎな物'), 2000, '戻る');
});

test('スワイプの削除は、数秒たつと確定する', async () => {
  await swipe(itemWrap('ふしぎな物').querySelector('.item'), -320);
  await waitFor(() => !itemWrap('ふしぎな物'), 2000, '消える');
  await sleep(5600);
  assert(!Object.values(store().data.items).some((i) => i.name === 'ふしぎな物'), 'データからも消える');
});

test('少しだけのスワイプでは削除しない', async () => {
  await swipe(itemWrap('キャベツ').querySelector('.item'), -40);
  await sleep(300);
  assert(itemWrap('キャベツ'), '残っている');
});

test('「チェック済みをまとめて削除」（元に戻せる）', async () => {
  click(q('#btn-clear-checked'), 'まとめて削除');
  await waitFor(() => !q('.done-group'), 2000, 'チェック済みが消える');
  click(await waitFor(() => q('#toast-root .toast-btn'), 2000, '元に戻す'));
  await waitFor(() => q('.done-group'), 2000, '戻る');
  click(q('#btn-clear-checked'));
  await sleep(5600);
  assert(!Object.values(store().data.items).some((i) => i.name === 'トマト'), 'データからも消える');
});

test('リストの名前・色を変えられる', async () => {
  click(q('#btn-list-menu'), 'メニュー');
  await waitFor(() => topLayer()?.querySelector('[data-menu="edit"]'), 2000, 'メニュー');
  click(topLayer().querySelector('[data-menu="edit"]'));
  await waitFor(() => topLayer()?.querySelector('.list-form'), 2000, 'リストのシート');
  setValue(topLayer().querySelector('[name="name"]'), 'テスト用リスト2');
  click(topLayer().querySelector('[data-pick-color="mint"]'));
  topLayer().querySelector('form').requestSubmit();
  await waitFor(() => text('#list-name') === 'テスト用リスト2', 2000, '名前が変わる');
  eq(q('#view-list').dataset.color, 'mint');
});

test('共有の画面（デモモードでは説明が出る）', async () => {
  click(q('#btn-list-menu'));
  await waitFor(() => topLayer()?.querySelector('[data-menu="share"]'), 2000, 'メニュー');
  click(topLayer().querySelector('[data-menu="share"]'));
  await waitFor(() => topLayer()?.querySelector('.notice'), 2000, '共有のシート');
  assert(topLayer().querySelector('.notice').textContent.includes('デモモード'));
  await closeTopSheet();
});

test('リスト一覧で並べ替えできる', async () => {
  click(q('#btn-back'), '戻る');
  await waitFor(() => !q('#view-home').hidden, 2000, 'リスト一覧');
  const before = qa('.lc-name').map((n) => n.textContent);
  click(q('#btn-reorder'), '並べ替え');
  await waitFor(() => q('.list-cards.is-reorder'), 2000, '並べ替えの表示');
  click(q('.list-card [data-move="1"]'), '下へ');
  await waitFor(() => qa('.lc-name')[0].textContent === before[1], 2000, '順番が変わる');
  click(q('#btn-reorder'), '完了');
  eq(store().sortedLists().map((l) => l.name).slice(0, 2), [before[1], before[0]]);
});

test('ダークモードに切り替えられる', async () => {
  click(q('#btn-settings'), '設定');
  await waitFor(() => topLayer()?.querySelector('[data-theme-set="dark"]'), 2000, '設定のシート');
  click(topLayer().querySelector('[data-theme-set="dark"]'));
  eq(D().documentElement.dataset.theme, 'dark');
  const bg = W().getComputedStyle(D().body).backgroundColor;
  eq(bg, 'rgb(11, 17, 32)', '背景が暗い色'); // #0b1120（2026-11-27 KM-012 の紺）
  click(topLayer().querySelector('[data-theme-set="auto"]'));
  assert(!D().documentElement.dataset.theme, '自動に戻す');
  await closeTopSheet();
});

test('読み込み直してもデータが残る（この端末に保存）', async () => {
  await openApp();
  assert(qa('.lc-name').some((n) => n.textContent === 'テスト用リスト2'), 'リストが残る');
  click(qa('.list-card').find((c) => c.textContent.includes('テスト用リスト2')).querySelector('.lc-link'));
  await waitFor(() => listView() && itemWrap('牛乳'), 3000, '品目が残る');
  eq(itemWrap('牛乳').querySelector('.qty').textContent, '×3');
  await waitFor(() => itemWrap('牛乳').querySelector('.thumb img')?.src.startsWith('blob:'), 3000, '写真も残る');
});

test('リストを削除できる（確認あり）', async () => {
  click(q('#btn-list-menu'));
  await waitFor(() => topLayer()?.querySelector('[data-menu="delete"]'), 2000, 'メニュー');
  click(topLayer().querySelector('[data-menu="delete"]'));
  await waitFor(() => topLayer()?.querySelector('[data-confirm="1"]'), 2000, '確認');
  click(topLayer().querySelector('[data-confirm="1"]'));
  await waitFor(() => !q('#view-home').hidden, 2000, 'リスト一覧へ');
  assert(!qa('.lc-name').some((n) => n.textContent === 'テスト用リスト2'), '一覧から消える');
});

test('操作中にエラーが出ていない', () => {
  eq(errors, [], 'エラーの一覧');
});

run('画面の操作テスト');
