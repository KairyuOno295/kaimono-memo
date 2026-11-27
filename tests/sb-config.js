// テスト用：Supabase の設定と「にせの Supabase」（本物の Supabase にはつながない）
// - tests\run_tests.py の仮サーバーが、/__sbtest/ の下のページにだけ、config.js の代わりにこのファイルを返す
// - 本物と同じ形（ログイン・表・RLS〔見てよい行の制限〕・招待の関数・写真の保存・リアルタイム）をまねる
// - データ（架空）は localStorage の kaimono-fake-db に入れる（読み込み直しても残るように）
// - テストのページは window.__fakeSupabase で中を見たり、ほかの人の変更をまねたりする
window.KAIMONO_CONFIG = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'test-anon-key-0123456789abcdef',
};

(function () {
  'use strict';
  const DB_KEY = 'kaimono-fake-db';
  const AUTH_KEY = 'kaimono-fake-auth';
  const TABLES = ['lists', 'list_members', 'list_invites', 'items', 'categories', 'item_history'];
  const ME = { id: 'user-me', email: 'me@example.com', password: 'password1', confirmed: true };
  const OTHER = { id: 'user-other', email: 'family@example.com', password: 'password2', confirmed: true };
  const state = loadState();
  const handlers = [];
  const authCbs = [];
  const files = new Map();
  const fake = { state, files, failNetwork: false, missingTables: false, calls: [] };

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
      if (s) return s;
    } catch (e) { /* 壊れていたら作り直す */ }
    const s = { users: [{ ...ME }, { ...OTHER }] };
    TABLES.forEach((t) => { s[t] = []; });
    return s;
  }

  const save = () => localStorage.setItem(DB_KEY, JSON.stringify(state));
  const now = () => new Date().toISOString();
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ---------- ログイン ----------
  function session() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }

  function me() {
    const s = session();
    return s ? state.users.find((u) => u.id === s.user.id) || null : null;
  }

  function emitAuth(event, s) {
    authCbs.slice().forEach((cb) => setTimeout(() => cb(event, s), 0));
  }

  function signIn({ email, password }) {
    if (fake.failNetwork) return { data: { session: null }, error: { message: 'Failed to fetch', status: 0 } };
    const u = state.users.find((x) => x.email === String(email).toLowerCase());
    if (!u || u.password !== password) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400 } };
    if (!u.confirmed) return { data: { session: null, user: null }, error: { message: 'Email not confirmed', status: 400 } };
    const s = { access_token: `fake-token-${u.id}`, user: { id: u.id, email: u.email } };
    localStorage.setItem(AUTH_KEY, JSON.stringify(s));
    emitAuth('SIGNED_IN', s);
    return { data: { session: s, user: s.user }, error: null };
  }

  function signUp({ email, password }) {
    const e = String(email).toLowerCase();
    if (!state.users.some((x) => x.email === e)) {
      state.users.push({ id: `user-${state.users.length + 1}`, email: e, password, confirmed: false });
      save();
    }
    return { data: { user: { email: e }, session: null }, error: null }; // 「メールの確認が必要」の設定のまね
  }

  const auth = {
    getSession: async () => ({ data: { session: session() }, error: null }),
    signInWithPassword: async (args) => signIn(args),
    signUp: async (args) => signUp(args),
    signOut: async () => { localStorage.removeItem(AUTH_KEY); emitAuth('SIGNED_OUT', null); return { error: null }; },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: {}, error: null }),
    onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
  };

  // ---------- RLS（見てよい行・変えてよい行）のまね ----------
  const isMember = (listId, uid) => state.list_members.some((m) => m.list_id === listId && m.user_id === uid);
  const isOwner = (listId, uid) => state.list_members.some((m) => m.list_id === listId && m.user_id === uid && m.role === 'owner');
  const sharesWith = (uid, other) => uid === other
    || state.list_members.some((a) => a.user_id === uid && isMember(a.list_id, other));

  const CAN_SEE = {
    lists: (r, u) => r.owner_id === u.id || isMember(r.id, u.id),
    list_members: (r, u) => isMember(r.list_id, u.id),
    list_invites: (r, u) => isOwner(r.list_id, u.id) || r.email === u.email,
    items: (r, u) => isMember(r.list_id, u.id),
    categories: (r, u) => sharesWith(u.id, r.owner_id),
    item_history: (r, u) => r.user_id === u.id,
  };
  const CAN_INSERT = {
    lists: (r, u) => r.owner_id === u.id,
    items: (r, u) => isMember(r.list_id, u.id),
    categories: (r, u) => r.owner_id === u.id,
    item_history: (r, u) => r.user_id === u.id,
  };
  const CAN_CHANGE = {
    lists: (r, u, op) => (op === 'delete' ? r.owner_id === u.id : true),
    list_members: (r, u, op) => (op === 'delete' ? r.role !== 'owner' && (r.user_id === u.id || isOwner(r.list_id, u.id)) : r.user_id === u.id),
    list_invites: (r, u) => isOwner(r.list_id, u.id),
    items: () => true,
    categories: (r, u) => r.owner_id === u.id,
    item_history: (r, u) => r.user_id === u.id,
  };
  const KEYS = { list_members: ['list_id', 'user_id'], list_invites: ['list_id', 'email'], item_history: ['user_id', 'name_key'] };
  const keyCols = (t) => KEYS[t] || ['id'];
  const keyOf = (t, r) => keyCols(t).map((c) => r[c]).join('|');
  const pkOf = (t, r) => Object.fromEntries(keyCols(t).map((c) => [c, r[c]]));

  // ---------- リアルタイム ----------
  function emit(table, type, row, old) {
    handlers.filter((h) => h.table === table).forEach((h) => setTimeout(() => {
      h.cb({ eventType: type, new: row ? copy(row) : {}, old: old ? copy(old) : {} });
    }, 0));
  }

  function channel() {
    const mine = [];
    const ch = {
      on(type, filter, cb) { const h = { table: filter.table, cb }; mine.push(h); handlers.push(h); return ch; },
      subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return ch; },
      handlers: mine,
    };
    return ch;
  }

  function removeChannel(ch) {
    (ch.handlers || []).forEach((h) => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); });
  }

  // ---------- 表の読み書き ----------
  function addMember(listId, u, role) {
    const pos = Math.max(0, ...state.list_members.filter((m) => m.user_id === u.id).map((m) => m.position || 0)) + 1;
    const row = { list_id: listId, user_id: u.id, email: u.email, role, position: pos, created_at: now() };
    state.list_members.push(row);
    emit('list_members', 'INSERT', row);
  }

  function removeRow(table, r) {
    state[table] = state[table].filter((x) => x !== r);
    emit(table, 'DELETE', null, pkOf(table, r));
    if (table !== 'lists') return;
    for (const t of ['items', 'list_members', 'list_invites']) {
      state[t].filter((x) => x.list_id === r.id).forEach((x) => removeRow(t, x)); // リストを消すと中も消える（cascade のまね）
    }
  }

  function visible(q, u) {
    return state[q.table].filter((r) => CAN_SEE[q.table](r, u) && q.filters.every((f) => f(r)));
  }

  const OK = (status) => ({ data: null, error: null, status });
  const DENIED = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 };

  function insertRows(q, u) {
    for (const row of [].concat(q.payload)) {
      const r = { created_at: now(), updated_at: now(), ...row };
      if (q.table === 'items') r.created_by = u.id;
      if (state[q.table].some((x) => keyOf(q.table, x) === keyOf(q.table, r))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, status: 409 };
      }
      if (!CAN_INSERT[q.table] || !CAN_INSERT[q.table](r, u)) return DENIED;
      state[q.table].push(r);
      emit(q.table, 'INSERT', r);
      if (q.table === 'lists') addMember(r.id, u, 'owner'); // リストを作ると持ち主がメンバーになる（トリガーのまね）
    }
    save();
    return OK(201);
  }

  function upsertRow(q, u) {
    const r = { ...q.payload };
    if (!CAN_INSERT[q.table] || !CAN_INSERT[q.table](r, u)) return DENIED;
    const cur = state[q.table].find((x) => keyOf(q.table, x) === keyOf(q.table, r));
    if (cur) Object.assign(cur, r);
    else state[q.table].push(r);
    emit(q.table, cur ? 'UPDATE' : 'INSERT', cur || r);
    save();
    return OK(201);
  }

  function updateRows(q, u) {
    for (const r of visible(q, u).filter((x) => CAN_CHANGE[q.table](x, u, 'update'))) {
      Object.assign(r, q.payload);
      if (q.table === 'lists' || q.table === 'items') r.updated_at = now();
      emit(q.table, 'UPDATE', r);
    }
    save();
    return OK(204);
  }

  function deleteRows(q, u) {
    visible(q, u).filter((x) => CAN_CHANGE[q.table](x, u, 'delete')).forEach((r) => removeRow(q.table, r));
    save();
    return OK(204);
  }

  function selectRows(q, u) {
    let rows = visible(q, u).map(copy);
    for (const [k, asc] of q.orders.slice().reverse()) rows.sort((a, b) => cmp(a[k], b[k]) * (asc ? 1 : -1));
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);
    return { data: rows, error: null, status: 200 };
  }

  const OPS = { select: selectRows, insert: insertRows, upsert: upsertRow, update: updateRows, delete: deleteRows };

  function run(q) {
    fake.calls.push(`${q.op} ${q.table}`);
    if (fake.failNetwork) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
    if (fake.missingTables) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${q.table}' in the schema cache` }, status: 404 };
    }
    const u = me();
    if (!u) return { data: null, error: { message: 'JWT expired' }, status: 401 };
    return OPS[q.op](q, u);
  }

  function from(table) {
    const q = { table, op: 'select', filters: [], orders: [], range: null, limit: null, payload: null };
    const b = {
      select: () => b,
      insert: (rows) => { q.op = 'insert'; q.payload = rows; return b; },
      update: (patch) => { q.op = 'update'; q.payload = patch; return b; },
      upsert: (row) => { q.op = 'upsert'; q.payload = row; return b; },
      delete: () => { q.op = 'delete'; return b; },
      eq: (k, v) => { q.filters.push((r) => r[k] === v); return b; },
      in: (k, vs) => { q.filters.push((r) => vs.includes(r[k])); return b; },
      order: (k, o) => { q.orders.push([k, !o || o.ascending !== false]); return b; },
      range: (a, z) => { q.range = [a, z]; return b; },
      limit: (n) => { q.limit = n; return b; },
      then: (ok, ng) => Promise.resolve().then(() => run(q)).then(ok, ng),
    };
    return b;
  }

  // ---------- 関数（invite_to_list・claim_invites）のまね ----------
  function claimInvites(u) {
    if (!u.confirmed) return 0;
    const mine = state.list_invites.filter((i) => i.email === u.email);
    mine.forEach((i) => {
      removeRow('list_invites', i);
      if (!isMember(i.list_id, u.id)) addMember(i.list_id, u, 'member');
    });
    save();
    return mine.length;
  }

  function inviteToList(u, args) {
    const listId = args.p_list_id;
    const e = String(args.p_email || '').trim().toLowerCase();
    if (!isOwner(listId, u.id)) return { data: null, error: { message: 'このリストに招待できるのは、リストの持ち主だけです' }, status: 400 };
    if (state.list_members.some((m) => m.list_id === listId && m.email === e)) return { data: 'already', error: null, status: 200 };
    if (!state.list_invites.some((i) => i.list_id === listId && i.email === e)) {
      const row = { list_id: listId, email: e, invited_by: u.id, created_at: now() };
      state.list_invites.push(row);
      emit('list_invites', 'INSERT', row);
    }
    save();
    return { data: 'invited', error: null, status: 200 };
  }

  async function rpc(fn, args) {
    fake.calls.push(`rpc ${fn}`);
    if (fake.failNetwork) return { data: null, error: { message: 'Failed to fetch' }, status: 0 };
    const u = me();
    if (!u) return { data: null, error: { message: 'JWT expired' }, status: 401 };
    if (fn === 'claim_invites') return { data: claimInvites(u), error: null, status: 200 };
    if (fn === 'invite_to_list') return inviteToList(u, args || {});
    return { data: null, error: { message: `unknown function ${fn}` }, status: 404 };
  }

  // ---------- 写真の保存場所のまね（先頭のリストの ID で権限を見る） ----------
  function canPhoto(path) {
    const u = me();
    return !!u && isMember(String(path).split('/')[0], u.id);
  }

  const bucket = {
    upload: async (path, blob) => {
      if (fake.failNetwork) return { data: null, error: { message: 'Failed to fetch' } };
      if (!canPhoto(path)) return { data: null, error: { message: 'new row violates row-level security policy', status: 403 } };
      files.set(path, blob);
      return { data: { path }, error: null };
    },
    download: async (path) => (files.has(path) && canPhoto(path)
      ? { data: files.get(path), error: null }
      : { data: null, error: { message: 'Object not found', status: 404 } }),
    remove: async (paths) => { paths.filter(canPhoto).forEach((p) => files.delete(p)); return { data: [], error: null }; },
  };

  // ---------- テストのページから使う道具（ほかの人の操作のまね） ----------
  fake.remoteInsert = (table, row) => { state[table].push(row); save(); emit(table, 'INSERT', row); };
  fake.remoteUpdate = (table, id, patch) => {
    const r = state[table].find((x) => x.id === id);
    Object.assign(r, patch, { updated_at: now() });
    save();
    emit(table, 'UPDATE', r);
  };
  fake.remoteDelete = (table, id) => { removeRow(table, state[table].find((x) => x.id === id)); save(); };
  fake.shareListFromOther = (name) => {
    const id = 'list-from-other';
    const t = now();
    state.lists.push({ id, owner_id: OTHER.id, name, emoji: '🍙', color: 'peach', created_at: t, updated_at: t });
    state.list_members.push({ list_id: id, user_id: OTHER.id, email: OTHER.email, role: 'owner', position: 1, created_at: t });
    const m = { list_id: id, user_id: ME.id, email: ME.email, role: 'member', position: 99, created_at: t };
    state.list_members.push(m);
    save();
    emit('list_members', 'INSERT', m);
    return id;
  };

  const client = {
    auth, from, rpc, channel, removeChannel,
    storage: { from: () => bucket },
    realtime: { setAuth() {} },
  };
  window.supabase = { createClient: () => client };
  window.__fakeSupabase = fake;
})();
