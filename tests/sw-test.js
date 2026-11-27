// サービスワーカーのテスト：sw.js を登録して、アプリのファイルが全部、端末に保存されるかを確かめる
import { test, assert, eq, run, waitFor } from './harness.js';

let reg = null;

function listedFiles(swText) {
  const start = swText.indexOf('const APP_FILES');
  const block = swText.slice(start, swText.indexOf('];', start));
  return [...block.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
}

test('sw.js を登録でき、動き出す', async () => {
  reg = await navigator.serviceWorker.register('../sw.js', { scope: '../' });
  // reg.active が入ってから state が変わるまでには少し間があるので、activated（動作中）になるまで待つ
  await waitFor(() => reg.active?.state === 'activated', 20000, `サービスワーカーが動き出す（保存に失敗すると動かない。今の状態：${reg.active?.state || reg.installing?.state}）`);
  eq(reg.active.state, 'activated');
});

test('アプリのファイルが全部保存されている', async () => {
  const swText = await (await fetch('../sw.js', { cache: 'no-store' })).text();
  const files = listedFiles(swText);
  assert(files.length >= 20, `一覧の数：${files.length}`);
  const name = (await caches.keys()).find((k) => k.startsWith('kaimono-app-'));
  assert(name, '保存の入れ物がある');
  const cache = await caches.open(name);
  const missing = [];
  for (const f of files) {
    if (!(await cache.match(new URL(f, new URL('../', location.href)).href))) missing.push(f);
  }
  eq(missing, [], '保存されていないファイル');
});

test('後かたづけ（登録と保存を消す）', async () => {
  await reg.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  eq((await caches.keys()).length, 0);
});

run('サービスワーカー');
