// Supabase（ログイン・データベース・写真の保存・リアルタイム同期）とのやりとり
// - supabase-js（Supabase 公式のライブラリ）は、Supabase を使うときだけ CDN から読み込む。
//   一度読み込めば、サービスワーカーが端末に保存するので、オフラインでも起動できる。
// - 送信の結果は { ok, transient, message } で返す（transient＝一時的な失敗。あとで送り直す）。
// - データを見られる人の制限は、サーバー側の RLS（行ごとの権限。supabase/schema.sql）で守る。
import { loadScript } from './util.js';

export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
export const PHOTO_BUCKET = 'item-photos';
const PAGE = 1000; // 一度に取る行数（Supabase の初期設定の上限）
const REALTIME_TABLES = ['items', 'lists', 'list_members', 'list_invites', 'categories'];

// サーバーに送ってよい列（ここにない列は送らない）
const INSERT_COLUMNS = {
  lists: ['id', 'owner_id', 'name', 'emoji', 'color'],
  items: ['id', 'list_id', 'name', 'quantity', 'note', 'category', 'photo_path', 'store', 'price', 'checked', 'checked_at', 'position'],
  categories: ['id', 'owner_id', 'name', 'emoji', 'position'],
  item_history: ['user_id', 'name_key', 'name', 'category', 'use_count', 'last_used_at'],
};
const UPDATE_COLUMNS = {
  lists: ['name', 'emoji', 'color'],
  items: ['name', 'quantity', 'note', 'category', 'photo_path', 'store', 'price', 'checked', 'checked_at', 'position'],
  categories: ['name', 'emoji', 'position'],
  list_members: ['position'],
};

export function pick(obj, cols) {
  const out = {};
  for (const c of cols || []) if (obj && c in obj) out[c] = obj[c];
  return out;
}

// 設定まちがいのときのエラー → どの手順を見ればよいかの案内（はじめて設定する人が迷わないように）
const SETUP_HINTS = [
  [/schema cache|does not exist|PGRST20[25]|42P01|42883/i, 'Supabase にデータの表がありません。SETUP.md の手順2（schema.sql の実行）をしてください'],
  [/invalid api key|no api key/i, 'config.js の anon キーがちがうようです。SETUP.md の手順3を確かめてください'],
];

/** 設定まちがいのエラーなら案内の文を、そうでなければ '' を返す */
export function setupHint(message) {
  const hit = SETUP_HINTS.find(([re]) => re.test(String(message || '')));
  return hit ? hit[1] : '';
}

/** setupHint が返した案内の文か */
export function isSetupMessage(message) {
  return SETUP_HINTS.some(([, text]) => text === message);
}

/** supabase-js の結果を { ok, transient, message, setup } にする（setup：設定まちがいの案内） */
export function classify(res, okCodes = []) {
  const err = res?.error;
  if (!err) return { ok: true };
  if (okCodes.includes(String(err.code))) return { ok: true };
  const status = Number(res.status ?? err.status ?? err.statusCode ?? 0) || 0;
  const transient = status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
  const hint = setupHint(err.message);
  return { ok: false, transient, message: hint || err.message || String(err), setup: !!hint };
}

function applyMatch(query, match) {
  let q = query;
  for (const [k, v] of Object.entries(match || {})) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
  return q;
}

async function selectAll(c, table, cols, orderCols) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = c.from(table).select(cols);
    for (const o of orderCols) q = q.order(o);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(setupHint(error.message) || `${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

function groupBy(rows, field, map = (r) => r) {
  const out = {};
  for (const r of rows) (out[r[field]] ||= []).push(map(r));
  return out;
}

/** サーバーから取った行を、アプリで使う形にする */
export function shapePull(user, r) {
  const mine = new Map(r.members.filter((m) => m.user_id === user.id).map((m) => [m.list_id, m]));
  const lists = [];
  for (const l of r.lists) {
    const m = mine.get(l.id);
    if (!m && l.owner_id !== user.id) continue;
    lists.push({ ...l, position: m?.position ?? 0, role: m?.role ?? 'owner' });
  }
  return {
    lists,
    items: r.items.map((it) => ({ ...it, price: it.price == null ? null : Number(it.price) })),
    categories: r.categories,
    history: r.history,
    members: groupBy(r.members, 'list_id', (m) => ({ user_id: m.user_id, email: m.email || '', role: m.role })),
    invites: groupBy(r.invites, 'list_id', (i) => ({ email: i.email, created_at: i.created_at })),
  };
}

// ログインのエラーを、わかりやすい日本語にする
const AUTH_MESSAGES = [
  [/invalid api key|no api key/i, 'config.js の anon キーがちがうようです（SETUP.md の手順3）'],
  [/invalid login credentials/i, 'メールアドレスかパスワードがちがいます'],
  [/email not confirmed/i, 'メールの確認がまだです。届いたメールのリンクを開いてください'],
  [/already registered|already exists/i, 'このメールアドレスはもう登録されています'],
  [/password should be at least|weak password/i, 'パスワードが短すぎます（6文字以上にしてください）'],
  [/rate limit|too many/i, '回数が多すぎます。少し時間をおいてから試してください'],
  [/failed to fetch|network|fetch/i, 'ネットにつながっていないようです'],
];

export function friendlyAuthError(error) {
  const m = String(error?.message || error || '');
  const hit = AUTH_MESSAGES.find(([re]) => re.test(m));
  return hit ? hit[1] : (m || 'うまくいきませんでした');
}

function appUrl() {
  return `${location.origin}${location.pathname}`;
}

export class SupabaseBackend {
  /** cfg：config.js の内容。createClient：テストでにせのクライアントを渡すとき */
  constructor(cfg, createClient = null) {
    this.cfg = cfg;
    this.mode = 'supabase';
    this.user = null;
    this.channel = null;
    this._client = null;
    this._createClient = createClient;
  }

  async client() {
    if (this._client) return this._client;
    let create = this._createClient;
    if (!create) {
      if (!window.supabase?.createClient) await loadScript(SUPABASE_JS_URL);
      create = window.supabase.createClient;
    }
    this._client = create(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kaimono-auth' },
    });
    return this._client;
  }

  setUser(user) {
    this.user = user;
  }

  // ---------- ログイン ----------
  async getSession() {
    const c = await this.client();
    const { data, error } = await c.auth.getSession();
    return { session: data?.session || null, error: error || null };
  }

  async signIn(email, password) {
    const c = await this.client();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error));
    return data.session;
  }

  async signUp(email, password) {
    const c = await this.client();
    const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
    if (error) throw new Error(friendlyAuthError(error));
    return { session: data.session || null };
  }

  async signOut() {
    const c = await this.client();
    await c.auth.signOut({ scope: 'local' }); // この端末だけログアウト
  }

  async resetPassword(email) {
    const c = await this.client();
    const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async updatePassword(password) {
    const c = await this.client();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async onAuthChange(cb) {
    const c = await this.client();
    c.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && c.realtime?.setAuth) c.realtime.setAuth(session.access_token);
      cb(event, session);
    });
  }

  // ---------- 送信（送信待ちの操作を1つ実行） ----------
  async exec(op, blob) {
    const c = await this.client();
    if (op.kind === 'upload') {
      const opts = { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' };
      return classify(await c.storage.from(PHOTO_BUCKET).upload(op.path, blob, opts));
    }
    if (op.kind === 'remove_file') return classify(await c.storage.from(PHOTO_BUCKET).remove(op.paths));
    const res = await this.execTable(c, op);
    // 23505＝同じ ID がもうある（前に送ったときに届いていた）→ 成功とみなす
    return classify(res, op.kind === 'insert' ? ['23505'] : []);
  }

  execTable(c, op) {
    const t = c.from(op.table);
    if (op.kind === 'insert') return t.insert(pick(op.row, INSERT_COLUMNS[op.table]));
    if (op.kind === 'upsert') return t.upsert(pick(op.row, INSERT_COLUMNS[op.table]), { onConflict: op.onConflict });
    if (op.kind === 'delete') return applyMatch(t.delete(), op.match);
    if (op.kind === 'update') {
      const patch = pick(op.patch, UPDATE_COLUMNS[op.table]);
      if (!Object.keys(patch).length) return Promise.resolve({ error: null });
      return applyMatch(t.update(patch), op.match);
    }
    return Promise.resolve({ error: { message: `不明な操作です：${op.kind}` }, status: 400 });
  }

  // ---------- 受信 ----------
  async pull(user) {
    const c = await this.client();
    await c.rpc('claim_invites'); // 自分あての招待があれば、メンバーになる（エラーは無視してよい）
    const [members, lists, items, categories, history, invites] = await Promise.all([
      selectAll(c, 'list_members', 'list_id,user_id,email,role,position', ['list_id', 'user_id']),
      selectAll(c, 'lists', '*', ['id']),
      selectAll(c, 'items', '*', ['id']),
      selectAll(c, 'categories', '*', ['id']),
      this.selectHistory(c, user.id),
      selectAll(c, 'list_invites', 'list_id,email,created_at', ['list_id', 'email']),
    ]);
    return shapePull(user, { members, lists, items, categories, history, invites });
  }

  async selectHistory(c, userId) {
    const { data, error } = await c.from('item_history').select('*').eq('user_id', userId)
      .order('last_used_at', { ascending: false }).limit(500);
    if (error) throw new Error(setupHint(error.message) || `item_history: ${error.message}`);
    return data || [];
  }

  async downloadPhoto(path) {
    const c = await this.client();
    const { data, error } = await c.storage.from(PHOTO_BUCKET).download(path);
    return error ? null : data;
  }

  /** リアルタイムの変更を受け取る（RLS により、見てよい行の変更だけが届く） */
  async subscribe(handler) {
    const c = await this.client();
    if (this.channel) c.removeChannel(this.channel);
    const { data } = await c.auth.getSession();
    if (data?.session?.access_token && c.realtime?.setAuth) c.realtime.setAuth(data.session.access_token);
    const ch = c.channel(`kaimono-${this.user.id}`);
    for (const table of REALTIME_TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table },
        (p) => handler({ table, type: p.eventType, new: p.new, old: p.old }));
    }
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') handler({ type: 'resync' }); });
    this.channel = ch;
    return () => c.removeChannel(ch);
  }

  // ---------- 共有（オンラインのときだけ） ----------
  async invite(listId, email) {
    const c = await this.client();
    const { data, error } = await c.rpc('invite_to_list', { p_list_id: listId, p_email: email });
    if (error) throw new Error(setupHint(error.message) || error.message || '招待できませんでした');
    return data;
  }

  async cancelInvite(listId, email) {
    const c = await this.client();
    const { error } = await c.from('list_invites').delete().eq('list_id', listId).eq('email', email);
    if (error) throw new Error(error.message);
  }

  async removeMember(listId, userId) {
    const c = await this.client();
    const { error } = await c.from('list_members').delete().eq('list_id', listId).eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
}
