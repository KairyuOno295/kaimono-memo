// 単体テスト：データの処理を確かめる（架空のデータだけを使う。外部への通信はしない）
import { test, assert, eq, run, sleep } from './harness.js';
import { setDbNamespace, kv } from '../js/db.js';
import { nameKey, parsePrice, stepQuantity, formatQty, formatPrice, esc, isValidEmail, isConfigured, uuid } from '../js/util.js';
import { guessCategory, allCategories, DEFAULT_CATEGORIES } from '../js/categories.js';
import { iconName, emojiIcon } from '../js/ui/icons.js';
import { LIST_EMOJIS, CATEGORY_EMOJIS } from '../js/ui/constants.js';
import { STARTER_LISTS } from '../js/seed.js';
import { fitSize, resizeToJpeg } from '../js/image.js';
import { Store, mergeRows } from '../js/store.js';
import { SupabaseBackend, classify, setupHint, isSetupMessage } from '../js/backend-supabase.js';
import { createLocalBackend } from '../js/backend-local.js';
import { FakeBackend, createFakeSupabase } from './fakes.js';
// 画面のファイルも読み込んで、書き間違い（構文エラー・読み込みの失敗）がないことを確かめる
import '../js/ui/main.js';
import '../js/ui/auth.js';
import '../js/seed.js';

setDbNamespace(`unit-${Date.now()}`);

async function newStore(be = new FakeBackend()) {
  const s = new Store({ backend: be, user: { id: `u-${uuid()}`, email: 'test@example.com' } });
  await s.load();
  return s;
}

/** 送信待ちが落ち着くまで待つ */
async function settle(s) {
  for (let i = 0; i < 4; i += 1) {
    await s.flush();
    await sleep(40);
  }
}

const L = (name = 'テスト') => ({ name, emoji: '🛒', color: 'pink' });

async function makePng(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ff94bc');
  g.addColorStop(1, '#6ed6b4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, Math.min(h, 200));
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = Math.random() * 255; // PNG が大きくなるように模様を入れる
  ctx.putImageData(img, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

async function makeJpeg() {
  return (await resizeToJpeg(await makePng(400, 300))).blob;
}

// ---------- 道具 ----------
test('品目名のキー：カタカナ・ひらがな・全角半角をそろえる', () => {
  eq(nameKey('トマト'), nameKey('とまと'));
  eq(nameKey('ＡＢＣ　ミルク'), nameKey('abc みるく'));
  assert(nameKey('牛乳') !== nameKey('豆乳'));
});

test('価格の読み取りと表示', () => {
  eq(parsePrice('¥1,280'), 1280);
  eq(parsePrice('１２８０円'), 1280);
  eq(parsePrice('198.5'), 198.5);
  eq(parsePrice(''), null);
  eq(parsePrice('abc'), null);
  eq(parsePrice('-5'), null);
  eq(formatPrice(1280), '¥1,280');
  eq(formatPrice(null), '');
});

test('数量の＋−と表示', () => {
  eq(stepQuantity('', 1), '2');
  eq(stepQuantity('2', -1), '');
  eq(stepQuantity('3個', 1), '4個');
  eq(stepQuantity('1個', -1), '1個');
  eq(stepQuantity('少し', 1), '少し');
  eq(formatQty('2'), '×2');
  eq(formatQty('500g'), '500g');
});

test('HTML の無害化・メールの形・設定の判定', () => {
  eq(esc('<b>"&\''), '&lt;b&gt;&quot;&amp;&#39;');
  assert(isValidEmail('a@example.com'));
  assert(!isValidEmail('a@b'));
  assert(!isValidEmail('a b@example.com'));
  assert(!isConfigured({ supabaseUrl: '', supabaseAnonKey: '' }), '空ならデモモード');
  assert(!isConfigured({ supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co', supabaseAnonKey: 'YOUR-ANON-KEY' }), 'サンプルのままならデモモード');
  assert(isConfigured({ supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: 'x'.repeat(40) }), '本物の形なら Supabase');
});

test('カテゴリの推測', () => {
  eq(guessCategory('キャベツ'), 'veg');
  eq(guessCategory('牛乳'), 'dairy');
  eq(guessCategory('アイスコーヒー'), 'drink');
  eq(guessCategory('塩鮭'), 'meat');
  eq(guessCategory('トイレットペーパー 12ロール'), 'daily');
  eq(guessCategory('ふしぎな物'), '');
});

test('カテゴリの並び：標準 → 追加したもの → その他', () => {
  const cats = allCategories([{ id: 'c2', name: 'B', emoji: '🐾', position: 2 }, { id: 'c1', name: 'A', emoji: '🎀', position: 1 }]);
  eq(cats[0].id, 'veg');
  eq(cats.at(-1).id, 'other');
  eq(cats.slice(-3, -1).map((c) => c.id), ['c1', 'c2']);
});

test('線のアイコン：選べる物・標準のカテゴリ・最初のリストは全部アイコンで出て、対応のない絵文字はそのまま', () => {
  const all = [...LIST_EMOJIS, ...CATEGORY_EMOJIS, ...DEFAULT_CATEGORIES.map((c) => c.emoji), ...STARTER_LISTS.map((l) => l.emoji)];
  eq(all.filter((e) => !iconName(e)).join(' '), '', 'アイコンのない絵文字');
  assert(emojiIcon('🏷️').includes('data-icon="tag"'), '異体字セレクタ付きでも見つかる');
  eq(iconName('\u{1F3F7}'), 'tag', '異体字セレクタなしでも同じアイコン');
  const fb = emojiIcon('🦄');
  assert(fb.startsWith('<span class="emo">') && fb.includes('🦄'), '対応のない絵文字は絵文字のまま');
  assert(!emojiIcon('<b>x</b>').includes('<b>'), '文字が入っていても無害化する');
  eq(new Set(LIST_EMOJIS).size, LIST_EMOJIS.length, 'リストの選択肢に重複がない');
  eq(new Set(CATEGORY_EMOJIS).size, CATEGORY_EMOJIS.length, 'カテゴリの選択肢に重複がない');
});

// ---------- 写真 ----------
test('写真の大きさの計算（長辺800px・小さい写真は拡大しない）', () => {
  eq(fitSize(4000, 3000), { width: 800, height: 600 });
  eq(fitSize(1000, 2000), { width: 400, height: 800 });
  eq(fitSize(300, 200), { width: 300, height: 200 });
});

test('写真を JPEG に縮小する', async () => {
  const src = await makePng(1600, 1000);
  const { blob, width, height } = await resizeToJpeg(src);
  eq([width, height], [800, 500]);
  eq(blob.type, 'image/jpeg');
  const bmp = await createImageBitmap(blob);
  eq([bmp.width, bmp.height], [800, 500], '実際の画像の大きさ');
  assert(blob.size < src.size, `小さくなること（${src.size} → ${blob.size} バイト）`);
});

// ---------- データ・同期 ----------
test('オフラインで追加 → 送信待ちに残る → つながったら送られる', async () => {
  const be = new FakeBackend();
  be.offline = true;
  const s = await newStore(be);
  const l = s.addList(L());
  const it = s.addItem(l.id, 'トマト');
  s.toggleItem(it.id);
  await settle(s);
  assert(s.outbox.length >= 4, `送信待ち ${s.outbox.length} 件`);
  eq(be.tables.items.size, 0, 'サーバーにはまだない');
  eq(s.data.items[it.id].category, 'veg', 'カテゴリは自動で野菜');
  be.offline = false;
  await settle(s);
  eq(s.outbox.length, 0, '送信待ちが空になる');
  eq(be.tables.lists.get(l.id).name, 'テスト');
  eq(be.tables.items.get(it.id).checked, true);
  assert(be.tables.item_history.get(nameKey('トマト')), '入力候補の履歴も送られる');
});

test('端末に保存したデータと送信待ちは、読み込み直しても残る', async () => {
  const be = new FakeBackend();
  be.offline = true;
  const s = await newStore(be);
  const l = s.addList(L('保存'));
  s.addItem(l.id, 'パン');
  await settle(s);
  await s.persist();
  const s2 = new Store({ backend: be, user: s.user });
  await s2.load();
  eq(Object.keys(s2.data.lists).length, 1);
  eq(s2.itemsOf(l.id).length, 1);
  eq(s2.outbox.length, s.outbox.length);
});

test('取り直しても、まだ送っていない変更は消えない（サーバーの変更は入る）', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L('合わせ'));
  const a = s.addItem(l.id, '牛乳');
  const c = s.addItem(l.id, 'たまご');
  const d = s.addItem(l.id, 'バター');
  await settle(s);
  eq(s.outbox.length, 0);
  be.failExec = true;
  const b = s.addItem(l.id, 'パン');
  s.updateItem(a.id, { note: '低脂肪' });
  be.tables.items.get(c.id).name = 'たまご（10個）'; // ほかの人がサーバーで変えた
  be.tables.items.delete(d.id); // ほかの人がサーバーで消した
  assert(await s.pull(), '取り直しに成功');
  assert(s.data.items[b.id], '送っていない新規は残る');
  eq(s.data.items[a.id].note, '低脂肪', '送っていない変更は残る');
  eq(s.data.items[c.id].name, 'たまご（10個）', 'サーバーの変更は入る');
  assert(!s.data.items[d.id], 'サーバーで消えたものは消える');
  be.failExec = false;
  await settle(s);
  eq(be.tables.items.get(a.id).note, '低脂肪');
  assert(be.tables.items.get(b.id));
});

test('権限のない操作はあきらめて、画面に知らせる', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L());
  await settle(s);
  be.denyTables.add('items');
  let dropped = 0;
  s.onDrop = () => { dropped += 1; };
  s.addItem(l.id, '権限なし');
  await settle(s);
  eq(s.outbox.length, 0, '送信待ちに残らない');
  eq(dropped, 1, '1回知らせる');
});

test('リアルタイムの変更を反映する（送信待ちのものは上書きしない）', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L());
  const a = s.addItem(l.id, 'りんご');
  await settle(s);
  const id2 = uuid();
  s.applyRemote({ table: 'items', type: 'INSERT', new: { id: id2, list_id: l.id, name: 'みかん', checked: false, position: 9, price: '120' } });
  eq(s.data.items[id2].name, 'みかん');
  eq(s.data.items[id2].price, 120);
  s.applyRemote({ table: 'items', type: 'UPDATE', new: { ...s.data.items[a.id], checked: true } });
  eq(s.data.items[a.id].checked, true);
  be.failExec = true;
  s.updateItem(a.id, { note: '自分の変更' });
  await settle(s);
  s.applyRemote({ table: 'items', type: 'UPDATE', new: { ...s.data.items[a.id], note: '古い変更' } });
  eq(s.data.items[a.id].note, '自分の変更', '送信待ちを優先');
  s.applyRemote({ table: 'items', type: 'DELETE', old: { id: id2 } });
  assert(!s.data.items[id2], '削除が届けば消える');
  s.applyRemote({ table: 'lists', type: 'UPDATE', new: { ...s.data.lists[l.id], name: '名前が変わった', position: 99 } });
  eq(s.data.lists[l.id].name, '名前が変わった');
  assert(s.data.lists[l.id].position !== 99, '並び順は自分のまま');
  be.failExec = false;
  await settle(s);
});

test('元に戻せる削除：元に戻す／時間がたつと確定', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L());
  const a = s.addItem(l.id, 'ケーキ');
  const b = s.addItem(l.id, 'プリン');
  await settle(s);
  const h = s.softDeleteItems([a.id], 10000);
  eq(s.itemsOf(l.id).map((i) => i.name), ['プリン'], 'すぐ隠れる');
  h.undo();
  eq(s.itemsOf(l.id).length, 2, '元に戻る');
  assert(be.tables.items.has(a.id), 'サーバーには残っている');
  s.softDeleteItems([b.id], 50);
  await sleep(120);
  await settle(s);
  assert(!s.data.items[b.id], '時間がたつと消える');
  assert(!be.tables.items.has(b.id), 'サーバーからも消える');
});

test('入力候補：よく使う順・ひらがなでも見つかる・リストにある物は「よく買うもの」から外す', async () => {
  const s = await newStore(new FakeBackend());
  const l = s.addList(L());
  const x = s.addItem(l.id, 'キャベツ');
  const kiwi = s.addItem(l.id, 'キウイ');
  s.addItem(l.id, 'きゅうり');
  s.deleteItems([x.id]);
  s.addItem(l.id, 'キャベツ'); // 2回目
  eq(s.suggestions(l.id, 'き')[0].name, 'キャベツ', '使った回数が多い順');
  eq(s.suggestions(l.id, 'きゃ').map((h) => h.name), ['キャベツ']);
  assert(s.suggestions(l.id, 'きゃ')[0].inList, '「リストにあり」の印');
  s.deleteItems([kiwi.id]);
  const chips = s.suggestions(l.id, '').map((h) => h.name);
  assert(!chips.includes('キャベツ'), 'リストにある物は出さない');
  assert(chips.includes('キウイ'), 'リストにない物は出す');
  await settle(s);
});

test('並べ替え：自分の並び順として送る', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const a = s.addList(L('A'));
  const b = s.addList(L('B'));
  const c = s.addList(L('C'));
  await settle(s);
  s.reorderLists([c.id, a.id, b.id]);
  eq(s.sortedLists().map((l) => l.name), ['C', 'A', 'B']);
  const ops = s.outbox.filter((o) => o.table === 'list_members');
  assert(ops.length >= 1, '並び順の送信がある');
  assert(ops.every((o) => o.match.user_id === s.user.id), '自分の行だけを変える');
  await settle(s);
  eq(be.tables.lists.get(c.id).position, 1);
});

test('写真：付ける・差し替える（古い写真は消す）・ダウンロード・外す', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L());
  const it = s.addItem(l.id, 'ねこ缶');
  await s.setItemPhoto(it.id, await makeJpeg());
  await settle(s);
  const p1 = s.data.items[it.id].photo_path;
  assert(p1.startsWith(`${l.id}/${it.id}-`), 'ファイル名はリストのIDから始まる（権限の確認に使う）');
  eq(be.tables.items.get(it.id).photo_path, p1);
  eq((await s.photoBlob(p1)).type, 'image/jpeg');
  await sleep(5);
  await s.setItemPhoto(it.id, await makeJpeg());
  await settle(s);
  const p2 = s.data.items[it.id].photo_path;
  assert(p2 !== p1 && !be.files.has(p1) && be.files.has(p2), '差し替えると古い写真は消える');
  await kv.del(`photo:${p2}`);
  assert(await s.photoBlob(p2), '端末になければダウンロードする');
  s.removeItemPhoto(it.id);
  await settle(s);
  eq(be.tables.items.get(it.id).photo_path, null);
  assert(!be.files.has(p2), '外すとサーバーからも消える');
});

test('リストの削除：写真の削除を先に送り、品目も消える', async () => {
  const be = new FakeBackend();
  const s = await newStore(be);
  const l = s.addList(L());
  const it = s.addItem(l.id, '写真つき');
  await s.setItemPhoto(it.id, await makeJpeg());
  await settle(s);
  const path = s.data.items[it.id].photo_path;
  assert(be.files.has(path));
  be.failExec = true;
  s.deleteList(l.id);
  const kinds = s.outbox.map((o) => o.kind);
  assert(kinds.indexOf('remove_file') >= 0 && kinds.indexOf('remove_file') < kinds.indexOf('delete'), '写真の削除が先');
  eq(s.itemsOf(l.id, true).length, 0);
  be.failExec = false;
  await settle(s);
  assert(!be.files.has(path));
  assert(!be.tables.lists.has(l.id));
});

test('mergeRows：基本の動き', () => {
  const local = { a: { id: 'a', v: 'local' }, b: { id: 'b', v: 'new' } };
  const out = mergeRows(local, [{ id: 'a', v: 'server' }, { id: 'c', v: 'server' }], (id) => id === 'b');
  eq(Object.keys(out).sort(), ['a', 'b', 'c']);
  eq(out.a.v, 'server');
});

// ---------- Supabase とのやりとり（にせのクライアントで確かめる） ----------
function sbWith(responder) {
  const fake = createFakeSupabase(responder);
  const be = new SupabaseBackend({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'x'.repeat(40) }, () => fake);
  be.setUser({ id: 'user-1', email: 'me@example.com' });
  return { be, fake };
}

test('Supabase：送ってよい列だけを送る', async () => {
  const { be, fake } = sbWith(() => ({ error: null, status: 201 }));
  const res = await be.exec({ kind: 'insert', table: 'lists', row: { id: 'L1', owner_id: 'user-1', name: 'A', emoji: '🛒', color: 'pink', position: 3, role: 'owner', created_at: 'x' } });
  eq(res.ok, true);
  const ins = fake.calls[0].ops.find((o) => o[0] === 'insert')[1];
  eq(Object.keys(ins).sort(), ['color', 'emoji', 'id', 'name', 'owner_id']);
  await be.exec({ kind: 'update', table: 'items', match: { id: ['a', 'b'] }, patch: { checked: true, updated_at: 'x' } });
  eq(fake.calls[1].ops, [['update', { checked: true }], ['in', 'id', ['a', 'b']]]);
  eq((await be.exec({ kind: 'update', table: 'lists', match: { id: 'L1' }, patch: { updated_at: 'x' } })).ok, true);
  assert(!fake.calls.at(-1).ops.some((o) => o[0] === 'update'), '送れる列がなければ送らない');
});

test('Supabase：失敗の分け方（一時的なら送り直す／それ以外はあきらめる）', async () => {
  eq(classify({ error: null }).ok, true);
  eq(classify({ error: { message: 'Failed to fetch' }, status: 0 }).transient, true);
  eq(classify({ error: { message: 'x' }, status: 503 }).transient, true);
  eq(classify({ error: { message: 'JWT expired' }, status: 401 }).transient, true);
  eq(classify({ error: { message: 'rls', code: '42501' }, status: 403 }).transient, false);
  const { be } = sbWith(() => ({ error: { message: 'duplicate key', code: '23505' }, status: 409 }));
  eq((await be.exec({ kind: 'insert', table: 'items', row: { id: 'i1', list_id: 'L1', name: 'x' } })).ok, true, '同じIDの追加（前に届いていた）は成功とみなす');
});

test('Supabase：設定まちがいのエラーは、どの手順を見ればよいかの案内にする', () => {
  assert(setupHint("Could not find the table 'public.lists' in the schema cache").includes('schema.sql'), '表がない（PostgREST）');
  assert(setupHint('relation "public.items" does not exist').includes('schema.sql'), '表がない（PostgreSQL）');
  assert(setupHint('Invalid API key').includes('anon キー'), 'キーがちがう');
  eq(setupHint('TypeError: Failed to fetch'), '', 'つながらないだけなら案内しない');
  const r = classify({ error: { code: 'PGRST205', message: "Could not find the table 'public.items' in the schema cache" }, status: 404 });
  eq([r.ok, r.transient, r.setup], [false, false, true]);
  assert(isSetupMessage(r.message), '案内の文になっている');
});

test('Supabase：写真のアップロード・削除', async () => {
  const { be, fake } = sbWith(() => ({ data: {}, error: null }));
  await be.exec({ kind: 'upload', path: 'L1/i1-1.jpg' }, new Blob(['x'], { type: 'image/jpeg' }));
  const up = fake.calls.find((c) => c.storage === 'upload');
  eq(up.bucket, 'item-photos');
  eq(up.args[0], 'L1/i1-1.jpg');
  eq(up.args[2].contentType, 'image/jpeg');
  await be.exec({ kind: 'remove_file', paths: ['L1/i1-1.jpg'] });
  eq(fake.calls.find((c) => c.storage === 'remove').args[0], ['L1/i1-1.jpg']);
});

test('Supabase：全部取り直す（1000行ずつ・自分の並び順と役割・招待の受け取り）', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `i${i}`, list_id: 'L1', name: `n${i}`, price: '10.50' }));
  const { be, fake } = sbWith((call) => {
    if (call.rpc) return { data: 0, error: null };
    const range = call.ops.find((o) => o[0] === 'range');
    if (call.table === 'items') return { data: range[1] === 0 ? many : [{ id: 'last', list_id: 'L1', name: 'last', price: null }], error: null };
    if (call.table === 'lists') return { data: [{ id: 'L1', owner_id: 'other' }, { id: 'L2', owner_id: 'stranger' }], error: null };
    if (call.table === 'list_members') {
      return { data: [{ list_id: 'L1', user_id: 'user-1', email: 'me@example.com', role: 'member', position: 4 }, { list_id: 'L1', user_id: 'other', email: 'o@example.com', role: 'owner', position: 1 }], error: null };
    }
    return { data: [], error: null };
  });
  const r = await be.pull({ id: 'user-1' });
  eq(r.items.length, 1001, '2ページ目も取る');
  eq(r.items[0].price, 10.5);
  eq(r.lists.map((l) => [l.id, l.role, l.position]), [['L1', 'member', 4]], 'メンバーでないリストは入れない');
  eq(r.members.L1.length, 2);
  assert(fake.calls.some((c) => c.rpc === 'claim_invites'), '招待の受け取りを呼ぶ');
});

test('デモモードの送り先は、何もせず成功を返す（共有は使えない）', async () => {
  const be = createLocalBackend();
  eq((await be.exec({ kind: 'insert' })).ok, true);
  eq(await be.pull(), null);
  let threw = false;
  try { await be.invite('L', 'a@example.com'); } catch { threw = true; }
  assert(threw, '招待はエラーになる');
});

run('単体テスト');
