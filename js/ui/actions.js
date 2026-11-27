// 画面どうしで共通の操作（名前で追加・元に戻せる削除・写真の表示用 URL）
import { toast } from './dom.js';
import { UNDO_MS } from '../store.js';

/**
 * 品目を追加する。同じ名前がもうあれば追加しない／チェック済みにあれば、買う物に戻す。
 * 戻り値：{ item, status }（status：added・revived・exists・invalid）
 */
export function addOrRevive(ctx, listId, name, extra = {}) {
  const { store } = ctx;
  const open = store.findItem(listId, name, false);
  if (open) {
    toast(`「${open.name}」はもうリストにあるよ`);
    ctx.flashId = open.id;
    ctx.render();
    return { item: open, status: 'exists' };
  }
  const done = store.findItem(listId, name, true);
  if (done) {
    store.reviveItem(done.id, extra);
    ctx.newId = done.id;
    return { item: done, status: 'revived' };
  }
  const item = store.addItem(listId, name, extra);
  if (item) ctx.newId = item.id;
  return { item, status: item ? 'added' : 'invalid' };
}

/** 削除して、数秒だけ「元に戻す」ボタンを出す */
export function deleteWithUndo(ctx, ids, message) {
  if (!ids.length) return;
  const handle = ctx.store.softDeleteItems(ids, UNDO_MS);
  toast(message, { action: '元に戻す', onAction: () => handle.undo(), ms: UNDO_MS });
}

const urls = new Map();

/** 写真を表示するための URL（端末の中だけで使える blob: の URL） */
export async function photoUrl(store, path) {
  if (!path) return null;
  if (urls.has(path)) return urls.get(path);
  const blob = await store.photoBlob(path);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return url;
}
