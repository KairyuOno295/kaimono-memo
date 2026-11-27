// テスト用の「にせもの」
// - FakeBackend：サーバーのかわり（メモリの中の表）。オフラインや権限エラーのまねができる
// - createFakeSupabase：supabase-js のかわり。呼ばれた内容を記録して、決めた結果を返す
// どちらも架空のデータだけを使う。外部への通信はしない。

function matches(row, match) {
  return Object.entries(match || {}).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
}

export class FakeBackend {
  constructor() {
    this.mode = 'fake';
    this.offline = false; // true：送信も受信も失敗する
    this.failExec = false; // true：送信だけ失敗する（一時的な失敗）
    this.denyTables = new Set(); // ここにある表への送信は「権限なし」で失敗する
    this.tables = { lists: new Map(), items: new Map(), categories: new Map(), item_history: new Map() };
    this.files = new Map();
    this.log = [];
  }

  async exec(op, blob) {
    if (this.offline || this.failExec) return { ok: false, transient: true, message: 'つながりません（テスト）' };
    if (this.denyTables.has(op.table)) return { ok: false, transient: false, message: '権限がありません（テスト）' };
    this.log.push(op);
    this.apply(op, blob);
    return { ok: true };
  }

  apply(op, blob) {
    if (op.kind === 'upload') { this.files.set(op.path, blob); return; }
    if (op.kind === 'remove_file') { op.paths.forEach((p) => this.files.delete(p)); return; }
    if (op.table === 'list_members') { // 並び順は、テストでは lists の行に入れておく
      const l = this.tables.lists.get(op.match.list_id);
      if (l) Object.assign(l, op.patch);
      return;
    }
    const t = this.tables[op.table];
    if (op.kind === 'insert') { if (!t.has(op.row.id)) t.set(op.row.id, { ...op.row }); return; }
    if (op.kind === 'upsert') { t.set(op.row.name_key, { ...op.row }); return; }
    for (const [k, row] of [...t.entries()]) {
      if (!matches(row, op.match)) continue;
      if (op.kind === 'update') Object.assign(row, op.patch);
      else t.delete(k);
    }
  }

  async pull() {
    if (this.offline) throw new Error('つながりません（テスト）');
    return {
      lists: [...this.tables.lists.values()].map((l) => ({ ...l, role: 'owner' })),
      items: [...this.tables.items.values()].map((i) => ({ ...i })),
      categories: [...this.tables.categories.values()],
      history: [...this.tables.item_history.values()],
      members: {},
      invites: {},
    };
  }

  async downloadPhoto(path) {
    return this.files.get(path) || null;
  }
}

/** supabase-js のにせもの。responder(call) が返したものを、そのまま結果にする */
export function createFakeSupabase(responder = () => ({ data: [], error: null, status: 200 })) {
  const calls = [];
  const builder = (table) => {
    const call = { table, ops: [] };
    calls.push(call);
    const b = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'range', 'limit']) {
      b[m] = (...args) => { call.ops.push([m, ...args]); return b; };
    }
    b.then = (ok, ng) => Promise.resolve().then(() => responder(call)).then(ok, ng);
    return b;
  };
  const storageOp = (bucket, name) => async (...args) => {
    const call = { storage: name, bucket, args };
    calls.push(call);
    return responder(call);
  };
  return {
    calls,
    from: builder,
    rpc: (fn, args) => {
      const call = { rpc: fn, args, ops: [] };
      calls.push(call);
      return Promise.resolve(responder(call));
    },
    storage: { from: (bucket) => ({ upload: storageOp(bucket, 'upload'), remove: storageOp(bucket, 'remove'), download: storageOp(bucket, 'download') }) },
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  };
}
