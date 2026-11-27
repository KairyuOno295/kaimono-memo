// データの中心（画面に出すデータ・端末への保存・送信待ち・同期）
// - 操作は、まず端末の中のデータに反映して画面をすぐ変え、「送信待ち（outbox）」に積む。
//   つながっていれば順番に送り、オフラインなら保存しておいて、つながったときに送る。
// - サーバーから取り直したときは、まだ送れていない自分の変更を優先する（変更が消えないように）。
// - backend（送り先）は2種類：Supabase（backend-supabase.js）と、デモモード（backend-local.js）。
import { kv } from './db.js';
import { uuid, nowIso, nameKey, byPosition, maxOf, errMessage } from './util.js';
import { guessCategory, allCategories } from './categories.js';

const RETRY_MS = [3000, 8000, 20000, 60000]; // 送れなかったときに、もう一度送るまでの待ち時間
export const UNDO_MS = 5000; // 「元に戻す」を押せる時間

function emptyData() {
  return { lists: {}, members: {}, invites: {}, items: {}, categories: {}, history: {} };
}

/** サーバーのデータと端末のデータを合わせる（送信待ちのものは端末を優先） */
export function mergeRows(local, rows, isPending, idField = 'id') {
  const out = {};
  for (const row of rows || []) {
    const id = row[idField];
    if (!isPending(id)) out[id] = row;
    else if (local[id]) out[id] = local[id]; // まだ送っていない変更がある → 端末の内容を残す
    // 端末にない＝削除を送る前 → 入れない
  }
  for (const [id, row] of Object.entries(local)) {
    if (!(id in out) && isPending(id)) out[id] = row; // まだ送っていない新規
  }
  return out;
}

async function blobToRecord(blob) {
  return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
}

function recordToBlob(rec) {
  if (rec instanceof Blob) return rec;
  return new Blob([rec.data], { type: rec.type || 'image/jpeg' });
}

export class Store {
  constructor({ backend, user }) {
    this.backend = backend;
    this.user = user; // { id, email }
    this.data = emptyData();
    this.outbox = [];
    this.hidden = new Set(); // 「元に戻す」を待っている間、隠しておく品目
    this.softDeletes = new Set();
    this.listeners = new Set();
    this.inflight = new Map();
    this.status = { flushing: false, lastSyncAt: null, error: '' };
    this.retryIndex = 0;
    this.onDrop = null; // 送れずにあきらめた操作を画面に知らせる
  }

  // ---------- 通知 ----------
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of [...this.listeners]) {
      try { fn(reason); } catch (e) { console.error(e); }
    }
  }

  // ---------- 端末への保存 ----------
  key(name) {
    return `${name}:${this.user.id}`;
  }

  async load() {
    const [snap, outbox] = await Promise.all([kv.get(this.key('snap')), kv.get(this.key('outbox'))]);
    if (snap && typeof snap === 'object') this.data = { ...emptyData(), ...snap };
    if (Array.isArray(outbox)) this.outbox = outbox;
    this.emit('load');
  }

  /** データと送信待ちを保存する（同じタイミングの保存は1回にまとめる） */
  persist() {
    if (!this.persisting) {
      this.persisting = Promise.resolve().then(async () => {
        this.persisting = null;
        await kv.setMany([[this.key('snap'), this.data], [this.key('outbox'), this.outbox]]);
      }).catch((e) => console.error('保存に失敗しました', e));
    }
    return this.persisting;
  }

  /** この端末に保存したデータを消す（ログアウトのとき） */
  async clearLocal() {
    this.outbox = [];
    this.data = emptyData();
    const keys = (await kv.keys()).filter((k) => String(k).startsWith('photo:'));
    await kv.delMany([this.key('snap'), this.key('outbox'), ...keys]);
  }

  // ---------- 読み出し ----------
  sortedLists() {
    return Object.values(this.data.lists).sort(byPosition);
  }

  itemsOf(listId, includeHidden = false) {
    return Object.values(this.data.items)
      .filter((i) => i.list_id === listId && (includeHidden || !this.hidden.has(i.id)));
  }

  listStats(listId) {
    const items = this.itemsOf(listId);
    return { total: items.length, left: items.filter((i) => !i.checked).length };
  }

  categories() {
    return allCategories(Object.values(this.data.categories));
  }

  /** 同じ名前の品目を探す（checked：チェック済みを探すなら true） */
  findItem(listId, name, checked) {
    const k = nameKey(name);
    return this.itemsOf(listId).find((i) => !!i.checked === checked && nameKey(i.name) === k) || null;
  }

  /** 入力候補（過去に追加した品目）。query が空なら、よく買う物でリストにまだない物 */
  suggestions(listId, query = '', limit = 8) {
    const q = nameKey(query);
    const inList = new Set(this.itemsOf(listId).filter((i) => !i.checked).map((i) => nameKey(i.name)));
    const rows = Object.values(this.data.history)
      .filter((h) => (q ? h.name_key.includes(q) : !inList.has(h.name_key)));
    const cmp = (a, b) => (Number(b.name_key.startsWith(q)) - Number(a.name_key.startsWith(q)))
      || (b.use_count || 0) - (a.use_count || 0)
      || String(b.last_used_at).localeCompare(String(a.last_used_at));
    return rows.sort(cmp).slice(0, limit).map((h) => ({ ...h, inList: inList.has(h.name_key) }));
  }

  nextItemPosition(listId) {
    return maxOf(this.itemsOf(listId, true), 'position') + 1;
  }

  // ---------- リスト ----------
  addList({ name, emoji, color }) {
    const t = nowIso();
    const list = {
      id: uuid(), owner_id: this.user.id, name: String(name).trim().slice(0, 100), emoji, color,
      created_at: t, updated_at: t, position: maxOf(Object.values(this.data.lists), 'position') + 1, role: 'owner',
    };
    this.data.lists[list.id] = list;
    this.data.members[list.id] = [{ user_id: this.user.id, email: this.user.email || '', role: 'owner' }];
    this.commit([{ kind: 'insert', table: 'lists', keys: [`lists:${list.id}`], row: { ...list } }], 'lists');
    return list;
  }

  updateList(id, patch) {
    const list = this.data.lists[id];
    if (!list) return;
    Object.assign(list, patch, { updated_at: nowIso() });
    this.commit([{ kind: 'update', table: 'lists', keys: [`lists:${id}`], match: { id }, patch }], 'lists');
  }

  /** 並べ替え（並び順は人ごと。list_members の position に保存する） */
  reorderLists(orderedIds) {
    const ops = [];
    orderedIds.forEach((id, i) => {
      const list = this.data.lists[id];
      if (!list || list.position === i + 1) return;
      list.position = i + 1;
      ops.push({
        kind: 'update', table: 'list_members', keys: [`pos:${id}`],
        match: { list_id: id, user_id: this.user.id }, patch: { position: i + 1 },
      });
    });
    if (ops.length) this.commit(ops, 'lists');
  }

  deleteList(id) {
    if (!this.data.lists[id]) return;
    const items = this.itemsOf(id, true);
    const ops = items.filter((i) => i.photo_path).map((i) => this.forgetPhoto(i.photo_path));
    for (const it of items) delete this.data.items[it.id];
    delete this.data.lists[id];
    delete this.data.members[id];
    delete this.data.invites[id];
    // 写真の削除はリストの削除より先に送る（リストが消えると、写真を消す権限もなくなるため）
    ops.push({ kind: 'delete', table: 'lists', keys: [`lists:${id}`], match: { id } });
    this.commit(ops, 'lists');
  }

  // ---------- 品目 ----------
  addItem(listId, name, extra = {}) {
    const clean = String(name ?? '').trim().slice(0, 200);
    if (!clean || !this.data.lists[listId]) return null;
    const t = nowIso();
    const hist = this.data.history[nameKey(clean)];
    const item = {
      id: uuid(), list_id: listId, name: clean, quantity: '', note: '',
      category: hist?.category || guessCategory(clean), photo_path: null, store: '', price: null,
      checked: false, checked_at: null, position: this.nextItemPosition(listId), created_at: t, updated_at: t,
      ...extra,
    };
    if (item.checked && !item.checked_at) item.checked_at = t;
    this.data.items[item.id] = item;
    const insert = { kind: 'insert', table: 'items', keys: [`items:${item.id}`], row: { ...item } };
    this.commit([insert, this.touchHistory(item, 1)], 'items');
    return item;
  }

  updateItem(id, patch) {
    const it = this.data.items[id];
    if (!it) return;
    Object.assign(it, patch, { updated_at: nowIso() });
    const ops = [{ kind: 'update', table: 'items', keys: [`items:${id}`], match: { id }, patch }];
    if ('name' in patch || 'category' in patch) ops.push(this.touchHistory(it, 0));
    this.commit(ops, 'items');
  }

  toggleItem(id) {
    const it = this.data.items[id];
    if (!it) return;
    const checked = !it.checked;
    this.updateItem(id, { checked, checked_at: checked ? nowIso() : null });
  }

  /** チェック済みの品目を、もう一度買う物に戻す（同じ名前を追加したとき） */
  reviveItem(id, extra = {}) {
    const it = this.data.items[id];
    if (!it) return;
    const patch = { ...extra, checked: false, checked_at: null };
    Object.assign(it, patch, { updated_at: nowIso() });
    const update = { kind: 'update', table: 'items', keys: [`items:${id}`], match: { id }, patch };
    this.commit([update, this.touchHistory(it, 1)], 'items');
  }

  deleteItems(ids) {
    const live = ids.filter((id) => this.data.items[id]);
    if (!live.length) return;
    const ops = [];
    for (const id of live) {
      const it = this.data.items[id];
      if (it.photo_path) ops.push(this.forgetPhoto(it.photo_path));
      delete this.data.items[id];
    }
    ops.push({ kind: 'delete', table: 'items', keys: live.map((id) => `items:${id}`), match: { id: live } });
    this.commit(ops, 'items');
  }

  /** 「元に戻す」付きの削除：すぐ隠して、数秒たったら本当に消す */
  softDeleteItems(ids, ms = UNDO_MS) {
    const live = ids.filter((id) => this.data.items[id]);
    live.forEach((id) => this.hidden.add(id));
    this.emit('items');
    let timer = 0;
    const finish = (undo) => {
      if (!this.softDeletes.delete(finish)) return; // もう終わっている
      clearTimeout(timer);
      live.forEach((id) => this.hidden.delete(id));
      if (undo) this.emit('items');
      else this.deleteItems(live);
    };
    this.softDeletes.add(finish);
    timer = setTimeout(() => finish(false), ms);
    return { undo: () => finish(true), commit: () => finish(false) };
  }

  /** 待っている削除をすぐ確定する（アプリを閉じるとき） */
  commitSoftDeletes() {
    [...this.softDeletes].forEach((finish) => finish(false));
  }

  // ---------- 写真 ----------
  async setItemPhoto(id, blob) {
    if (!this.data.items[id] || !blob) return;
    const path = `${this.data.items[id].list_id}/${id}-${Date.now()}.jpg`;
    await kv.set(`photo:${path}`, await blobToRecord(blob));
    const it = this.data.items[id];
    if (!it) return; // 保存を待っている間に消された
    const old = it.photo_path;
    it.photo_path = path;
    it.updated_at = nowIso();
    const ops = [
      { kind: 'upload', path, keys: [`file:${path}`] },
      { kind: 'update', table: 'items', keys: [`items:${id}`], match: { id }, patch: { photo_path: path } },
    ];
    if (old) ops.push(this.forgetPhoto(old));
    this.commit(ops, 'items');
  }

  removeItemPhoto(id) {
    const it = this.data.items[id];
    if (!it?.photo_path) return;
    const old = it.photo_path;
    it.photo_path = null;
    it.updated_at = nowIso();
    const update = { kind: 'update', table: 'items', keys: [`items:${id}`], match: { id }, patch: { photo_path: null } };
    this.commit([update, this.forgetPhoto(old)], 'items');
  }

  /** 端末の写真を消し、サーバーの写真を消す操作を返す */
  forgetPhoto(path) {
    kv.del(`photo:${path}`).catch(() => {});
    return { kind: 'remove_file', paths: [path], keys: [`file:${path}`] };
  }

  /** 写真の Blob を返す（端末になければダウンロードして、端末に保存する） */
  async photoBlob(path) {
    if (!path) return null;
    const rec = await kv.get(`photo:${path}`).catch(() => null);
    if (rec) return recordToBlob(rec);
    if (!this.inflight.has(path)) {
      this.inflight.set(path, this.fetchPhoto(path).finally(() => this.inflight.delete(path)));
    }
    return this.inflight.get(path);
  }

  async fetchPhoto(path) {
    const blob = await this.backend.downloadPhoto(path).catch(() => null);
    if (blob) await kv.set(`photo:${path}`, await blobToRecord(blob)).catch(() => {});
    return blob;
  }

  // ---------- カテゴリ ----------
  addCategory({ name, emoji }) {
    const cat = {
      id: uuid(), owner_id: this.user.id, name: String(name).trim().slice(0, 30), emoji,
      position: maxOf(Object.values(this.data.categories), 'position') + 1, created_at: nowIso(),
    };
    this.data.categories[cat.id] = cat;
    this.commit([{ kind: 'insert', table: 'categories', keys: [`cats:${cat.id}`], row: { ...cat } }], 'categories');
    return cat;
  }

  updateCategory(id, patch) {
    const cat = this.data.categories[id];
    if (!cat) return;
    Object.assign(cat, patch);
    this.commit([{ kind: 'update', table: 'categories', keys: [`cats:${id}`], match: { id }, patch }], 'categories');
  }

  deleteCategory(id) {
    if (!this.data.categories[id]) return;
    delete this.data.categories[id];
    this.commit([{ kind: 'delete', table: 'categories', keys: [`cats:${id}`], match: { id } }], 'categories');
  }

  // ---------- 入力候補の履歴 ----------
  /** 履歴を更新して、サーバーに送る操作を返す（inc：使った回数に足す数） */
  touchHistory(item, inc = 0) {
    const key = nameKey(item.name);
    const prev = this.data.history[key];
    const h = {
      name_key: key, name: item.name, category: item.category || '',
      use_count: Math.max(1, (prev?.use_count || 0) + inc), last_used_at: nowIso(),
    };
    this.data.history[key] = h;
    return { kind: 'upsert', table: 'item_history', keys: [`hist:${key}`], onConflict: 'user_id,name_key', row: { user_id: this.user.id, ...h } };
  }

  clearHistory() {
    const keys = Object.keys(this.data.history);
    if (!keys.length) return;
    this.data.history = {};
    const op = { kind: 'delete', table: 'item_history', keys: keys.map((k) => `hist:${k}`), match: { user_id: this.user.id } };
    this.commit([op], 'history');
  }

  // ---------- 送信 ----------
  commit(ops, reason) {
    const at = nowIso();
    for (const op of ops) this.outbox.push({ ...op, qid: uuid(), at });
    this.emit(reason);
    this.persist();
    this.flushSoon();
  }

  flushSoon(ms = 30) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), ms);
  }

  /** 送信待ちを順番に送る（送っている最中に呼ばれたら、その送信が終わるのを待つ） */
  flush() {
    if (!this.flushPromise) {
      this.status.flushing = true;
      this.flushPromise = this.flushLoop().finally(() => {
        this.flushPromise = null;
        this.status.flushing = false;
        this.emit('sync');
      });
    }
    return this.flushPromise;
  }

  async flushLoop() {
    while (this.outbox.length) {
      if (this.backend.mode !== 'local' && navigator.onLine === false) { this.scheduleRetry(); return; }
      const op = this.outbox[0];
      const res = await this.execSafe(op);
      if (!res.ok && res.transient) {
        this.status.error = res.message || '送信できませんでした';
        this.scheduleRetry();
        return;
      }
      if (!res.ok) this.dropped(op, res);
      if (this.outbox[0] === op) this.outbox.shift();
      this.retryIndex = 0;
      this.status.error = '';
      await this.persist();
    }
  }

  async execSafe(op) {
    try {
      if (op.kind !== 'upload') return await this.backend.exec(op);
      const rec = await kv.get(`photo:${op.path}`);
      if (!rec) return { ok: true }; // 写真がもう差し替え・削除されている → 送る必要なし
      return await this.backend.exec(op, recordToBlob(rec));
    } catch (e) {
      return { ok: false, transient: true, message: errMessage(e) };
    }
  }

  scheduleRetry() {
    const ms = RETRY_MS[Math.min(this.retryIndex, RETRY_MS.length - 1)];
    this.retryIndex += 1;
    this.flushSoon(ms);
  }

  /** 送れない操作（権限がないなど）をあきらめる。サーバーの状態に合わせ直す */
  dropped(op, res) {
    console.warn('送信できなかった操作を取り消しました', op.kind, op.table || '', res.message);
    if (this.onDrop) this.onDrop(op, res);
    this.pullSoon();
  }

  pendingKeys() {
    const s = new Set();
    for (const op of this.outbox) for (const k of op.keys || []) s.add(k);
    return s;
  }

  // ---------- 受信 ----------
  pullSoon(ms = 400) {
    clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => this.pull(), ms);
  }

  /** サーバーから全部取り直す（同時に呼ばれたら1回にまとめる）。成功したら true */
  pull() {
    if (!this.pulling) this.pulling = this.pullOnce().finally(() => { this.pulling = null; });
    return this.pulling;
  }

  async pullOnce() {
    await this.flush();
    let server;
    try {
      server = await this.backend.pull(this.user);
    } catch (e) {
      this.status.error = errMessage(e);
      this.emit('sync');
      return false;
    }
    if (!server) return false;
    this.merge(server);
    this.status.lastSyncAt = nowIso();
    this.status.error = '';
    await this.persist();
    this.emit('pull');
    return true;
  }

  merge(server) {
    const pending = this.pendingKeys();
    const has = (prefix) => (id) => pending.has(`${prefix}:${id}`);
    const listPending = (id) => pending.has(`lists:${id}`) || pending.has(`pos:${id}`);
    const oldMembers = this.data.members;
    this.data.lists = mergeRows(this.data.lists, server.lists, listPending);
    this.data.items = mergeRows(this.data.items, server.items, has('items'));
    this.data.categories = mergeRows(this.data.categories, server.categories, has('cats'));
    this.data.history = mergeRows(this.data.history, server.history, has('hist'), 'name_key');
    this.data.members = { ...(server.members || {}) };
    this.data.invites = { ...(server.invites || {}) };
    for (const id of Object.keys(this.data.lists)) {
      if (!this.data.members[id] && oldMembers[id]) this.data.members[id] = oldMembers[id];
    }
    this.dropOrphans(pending);
  }

  /** リストがなくなった品目を消す（送信待ちのものは残す） */
  dropOrphans(pending) {
    for (const [id, it] of Object.entries(this.data.items)) {
      if (!this.data.lists[it.list_id] && !pending.has(`items:${id}`)) delete this.data.items[id];
    }
  }

  /** リアルタイムで届いた変更を反映する */
  applyRemote(evt) {
    if (evt.type === 'resync') { this.pullSoon(100); return; }
    const pending = this.pendingKeys();
    if (evt.table === 'items') this.applyRemoteItem(evt, pending);
    else if (evt.table === 'lists' && evt.type === 'UPDATE') this.applyRemoteList(evt.new, pending);
    else if (evt.table === 'lists' && evt.type === 'DELETE') this.removeListLocal(evt.old?.id, pending);
    else this.pullSoon(); // メンバー・招待・カテゴリなどは取り直す
  }

  applyRemoteItem({ type, new: row, old }, pending) {
    const id = type === 'DELETE' ? old?.id : row?.id;
    if (!id || pending.has(`items:${id}`)) return;
    if (type === 'DELETE') {
      if (!this.data.items[id]) return;
      delete this.data.items[id];
    } else if (this.data.lists[row.list_id]) {
      this.data.items[id] = { ...this.data.items[id], ...row, price: row.price == null ? null : Number(row.price) };
    } else {
      this.pullSoon(); // まだ知らないリスト（共有されたばかり など）
      return;
    }
    this.changed('remote');
  }

  applyRemoteList(row, pending) {
    const cur = row && this.data.lists[row.id];
    if (!cur || pending.has(`lists:${row.id}`)) return;
    this.data.lists[row.id] = { ...cur, ...row, position: cur.position, role: cur.role };
    this.changed('remote');
  }

  removeListLocal(id, pending) {
    if (!id || !this.data.lists[id] || pending.has(`lists:${id}`)) return;
    delete this.data.lists[id];
    this.dropOrphans(pending);
    this.changed('remote');
  }

  changed(reason) {
    this.emit(reason);
    this.persist();
  }

  // ---------- 最初のデータ ----------
  /** リストを作る（itemsByName：リスト名 → 品目の配列。デモモードのお試しデータ用） */
  seed(lists, itemsByName = {}) {
    for (const l of lists) {
      const list = this.addList(l);
      for (const it of itemsByName[l.name] || []) this.addItem(list.id, it.name, it.extra || {});
    }
  }
}
