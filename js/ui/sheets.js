// いろいろなシート（リストの作成・編集、リストのメニュー、共有、設定、カテゴリの管理、新しいパスワード）
import { toast, openSheet, confirmSheet } from './dom.js';
import { esc, isValidEmail, formatTime } from '../util.js';
import { COLORS, LIST_EMOJIS, CATEGORY_EMOJIS, APP_VERSION, UI_ICONS } from './constants.js';
import { emojiIcon } from './icons.js';
import { currentTheme, setTheme } from './theme.js';
import { deleteWithUndo } from './actions.js';

// ---------- リストの作成・編集 ----------
export function openListEditor(ctx, listId) {
  const list = listId ? ctx.store.data.lists[listId] : null;
  const st = { emoji: list?.emoji || LIST_EMOJIS[0], color: list?.color || nextColor(ctx) };
  const sheet = openSheet({ title: list ? 'リストを編集' : '新しいリスト', className: 'list-sheet', body: listFormHtml(list, st) });
  const form = sheet.el.querySelector('form');
  form.addEventListener('click', (e) => {
    const c = e.target.closest('[data-pick-color]');
    const em = e.target.closest('[data-pick-emoji]');
    if (c) st.color = c.dataset.pickColor;
    if (em) st.emoji = em.dataset.pickEmoji;
    if (c || em) updateListPreview(form, st);
  });
  form.addEventListener('input', () => updateListPreview(form, st));
  form.addEventListener('submit', (e) => { e.preventDefault(); saveListForm(ctx, list, st, form, sheet); });
  updateListPreview(form, st);
  if (!list) form.querySelector('[name="name"]').focus();
}

function nextColor(ctx) {
  const used = new Set(ctx.store.sortedLists().map((l) => l.color));
  return (COLORS.find((c) => !used.has(c.id)) || COLORS[used.size % COLORS.length]).id;
}

function listFormHtml(list, st) {
  const swatches = COLORS.map((c) => `<button type="button" class="swatch" data-color="${c.id}" data-pick-color="${c.id}" aria-label="${c.name}"></button>`).join('');
  const emojis = LIST_EMOJIS.map((e, i) => `<button type="button" class="emoji-btn" data-pick-emoji="${e}" aria-label="アイコン ${i + 1}">${emojiIcon(e)}</button>`).join('');
  return `<form class="list-form" novalidate>
    <div class="list-preview" data-color="${esc(st.color)}"><span class="lc-emoji" aria-hidden="true"></span><span class="lp-name"></span></div>
    <label class="field"><span class="field-label">リストの名前</span><input name="name" type="text" maxlength="100" required value="${esc(list?.name || '')}" placeholder="例：スーパー、100円ショップ" autocomplete="off"></label>
    <div class="field"><span class="field-label">色</span><div class="swatches">${swatches}</div></div>
    <div class="field"><span class="field-label">アイコン</span><div class="emoji-grid">${emojis}</div></div>
    <div class="sheet-actions"><button type="submit" class="btn btn-primary btn-block">${list ? '保存する' : '作成する'}</button></div>
  </form>`;
}

function updateListPreview(form, st) {
  const p = form.querySelector('.list-preview');
  p.dataset.color = st.color;
  p.querySelector('.lc-emoji').innerHTML = emojiIcon(st.emoji);
  p.querySelector('.lp-name').textContent = form.querySelector('[name="name"]').value.trim() || 'リストの名前';
  form.querySelectorAll('[data-pick-color]').forEach((b) => b.classList.toggle('is-on', b.dataset.pickColor === st.color));
  form.querySelectorAll('[data-pick-emoji]').forEach((b) => b.classList.toggle('is-on', b.dataset.pickEmoji === st.emoji));
}

function saveListForm(ctx, list, st, form, sheet) {
  const name = form.querySelector('[name="name"]').value.trim();
  if (!name) { toast('リストの名前を入れてね'); return; }
  if (list) {
    ctx.store.updateList(list.id, { name, emoji: st.emoji, color: st.color });
    sheet.close();
    return;
  }
  const created = ctx.store.addList({ name, emoji: st.emoji, color: st.color });
  sheet.close();
  location.hash = `#/list/${created.id}`;
}

// ---------- リストのメニュー ----------
export function openListMenu(ctx, listId) {
  const list = ctx.store.data.lists[listId];
  if (!list) return;
  const owner = list.role !== 'member';
  const hasDone = ctx.store.itemsOf(listId).some((i) => i.checked);
  const rows = [
    ['edit', UI_ICONS.edit, '名前・色・アイコンを変える'],
    ['share', UI_ICONS.users, '家族と共有する'],
    ['categories', UI_ICONS.tag, 'カテゴリを管理する'],
    hasDone && ['clear', UI_ICONS.done, 'チェック済みをまとめて削除'],
    owner ? ['delete', UI_ICONS.trash, 'このリストを削除', true] : ['leave', UI_ICONS.leave, 'このリストから抜ける', true],
  ].filter(Boolean);
  const html = rows.map(([act, icon, label, danger]) => `<button type="button" class="menu-row${danger ? ' is-danger' : ''}" data-menu="${act}"><span class="menu-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('');
  const sheet = openSheet({ title: list.name, className: 'menu-sheet', color: list.color, body: `<div class="menu">${html}</div>` });
  sheet.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    sheet.close();
    runListMenu(ctx, listId, b.dataset.menu);
  });
}

function runListMenu(ctx, listId, act) {
  if (act === 'edit') openListEditor(ctx, listId);
  else if (act === 'share') openShareSheet(ctx, listId);
  else if (act === 'categories') openCategoryManager(ctx);
  else if (act === 'delete') confirmDeleteList(ctx, listId);
  else if (act === 'leave') confirmLeaveList(ctx, listId);
  else if (act === 'clear') {
    const ids = ctx.store.itemsOf(listId).filter((i) => i.checked).map((i) => i.id);
    deleteWithUndo(ctx, ids, `チェック済み ${ids.length} 件を削除しました`);
  }
}

async function confirmDeleteList(ctx, listId) {
  const list = ctx.store.data.lists[listId];
  const n = ctx.store.itemsOf(listId).length;
  const shared = (ctx.store.data.members[listId] || []).length > 1;
  const ok = await confirmSheet({
    title: 'リストを削除しますか？', ok: '削除する', danger: true,
    message: `「${list.name}」と、中のアイテム ${n} 件を削除します。${shared ? '共有しているメンバーからも消えます。' : ''}元には戻せません。`,
  });
  if (!ok) return;
  ctx.store.deleteList(listId);
  location.hash = '#/';
  toast(`「${list.name}」を削除しました`);
}

async function confirmLeaveList(ctx, listId) {
  const list = ctx.store.data.lists[listId];
  if (!navigator.onLine) { toast('オンラインのときに操作してね'); return; }
  const ok = await confirmSheet({
    title: 'このリストから抜けますか？', ok: '抜ける', danger: true,
    message: `「${list.name}」があなたの一覧から消えます。もう一度入るには、持ち主に招待してもらってください。`,
  });
  if (!ok) return;
  try {
    await ctx.backend.removeMember(listId, ctx.store.user.id);
  } catch (e) {
    toast(e.message || '抜けられませんでした');
    return;
  }
  location.hash = '#/';
  await ctx.store.pull();
  toast(`「${list.name}」から抜けました`);
}

// ---------- 共有 ----------
export function openShareSheet(ctx, listId) {
  const list = ctx.store.data.lists[listId];
  if (!list) return;
  let off = () => {};
  const sheet = openSheet({ title: '家族と共有', className: 'share-sheet', color: list.color, body: shareHtml(ctx, list), onClose: () => off() });
  if (ctx.mode === 'local') return;
  const draw = () => {
    const ul = sheet.el.querySelector('.members');
    if (ul && ctx.store.data.lists[listId]) ul.innerHTML = membersHtml(ctx, ctx.store.data.lists[listId]);
  };
  off = ctx.store.on(draw);
  draw();
  sheet.el.addEventListener('submit', (e) => { e.preventDefault(); invite(ctx, listId, sheet.el); });
  sheet.el.addEventListener('click', (e) => onShareClick(ctx, listId, e));
  if (navigator.onLine) ctx.store.pull();
}

function shareHtml(ctx, list) {
  if (ctx.mode === 'local') {
    return '<div class="notice">デモモードでは共有できません。<br>SETUP.md の手順で Supabase を設定すると、メールアドレスで家族を招待できるようになります。</div>';
  }
  const tail = list.role !== 'member'
    ? `<form class="invite-form" novalidate>
        <label class="field"><span class="field-label">招待する人のメールアドレス</span><input type="email" name="email" inputmode="email" autocomplete="email" placeholder="例：family@example.com" required></label>
        <button type="submit" class="btn btn-primary btn-block">${UI_ICONS.mail}招待する</button></form>
       <p class="hint">招待された人が、このアプリに同じメールアドレスで登録（ログイン）すると、このリストが表示されます。変更はリアルタイムで反映されます。</p>`
    : `<button type="button" class="btn btn-danger-soft btn-block" data-share="leave">${UI_ICONS.leave}このリストから抜ける</button>`;
  return `<h3 class="sub-title">メンバー</h3><ul class="members"></ul>${tail}`;
}

function membersHtml(ctx, list) {
  const me = ctx.store.user.id;
  const owner = list.role !== 'member';
  const rows = (ctx.store.data.members[list.id] || []).map((m) => {
    const canRemove = owner && m.user_id !== me && m.role !== 'owner';
    const remove = canRemove ? `<button type="button" class="icon-btn small" data-share="remove" data-user="${esc(m.user_id)}" aria-label="${esc(m.email)} をメンバーから外す">✕</button>` : '';
    return `<li class="member"><span class="avatar" aria-hidden="true">${esc((m.email || '?').slice(0, 1).toUpperCase())}</span>
      <span class="m-email">${esc(m.email || '（メール不明）')}${m.user_id === me ? ' <small>（あなた）</small>' : ''}</span>
      <span class="badge">${m.role === 'owner' ? 'オーナー' : 'メンバー'}</span>${remove}</li>`;
  });
  const invites = (ctx.store.data.invites[list.id] || []).map((i) => `<li class="member is-invite"><span class="avatar" aria-hidden="true">${UI_ICONS.mail}</span>
      <span class="m-email">${esc(i.email)}</span><span class="badge badge-soft">招待中</span>
      ${owner ? `<button type="button" class="icon-btn small" data-share="cancel" data-email="${esc(i.email)}" aria-label="${esc(i.email)} への招待を取り消す">✕</button>` : ''}</li>`);
  return rows.concat(invites).join('') || '<li class="member muted">読み込み中…</li>';
}

async function invite(ctx, listId, root) {
  const input = root.querySelector('[name="email"]');
  const email = input.value.trim().toLowerCase();
  if (!isValidEmail(email)) { toast('メールアドレスの形を確かめてね'); return; }
  if (email === String(ctx.store.user.email || '').toLowerCase()) { toast('自分のメールアドレスは招待できないよ'); return; }
  if (!navigator.onLine) { toast('オンラインのときに招待してね'); return; }
  try {
    const r = await ctx.backend.invite(listId, email);
    toast(r === 'already' ? 'その人はもうメンバーです' : `${email} を招待しました 💌`);
    input.value = '';
    await ctx.store.pull();
  } catch (e) {
    toast(e.message || '招待できませんでした');
  }
}

async function onShareClick(ctx, listId, e) {
  const b = e.target.closest('[data-share]');
  if (!b) return;
  const act = b.dataset.share;
  if (act === 'leave') { confirmLeaveList(ctx, listId); return; }
  if (!navigator.onLine) { toast('オンラインのときに操作してね'); return; }
  try {
    if (act === 'remove' && await confirmSheet({ title: 'メンバーから外しますか？', message: 'この人は、このリストを見られなくなります。', ok: '外す', danger: true })) {
      await ctx.backend.removeMember(listId, b.dataset.user);
    } else if (act === 'cancel') {
      await ctx.backend.cancelInvite(listId, b.dataset.email);
    }
    await ctx.store.pull();
  } catch (err) {
    toast(err.message || 'うまくいきませんでした');
  }
}

// ---------- 設定 ----------
export function openSettings(ctx) {
  let off = () => {};
  const sheet = openSheet({ title: '設定', className: 'settings-sheet', body: settingsHtml(ctx), onClose: () => off() });
  off = ctx.store.on(() => drawSync(ctx, sheet.el));
  drawSync(ctx, sheet.el);
  sheet.el.addEventListener('click', (e) => onSettingsClick(ctx, sheet, e));
}

function settingsHtml(ctx) {
  const theme = currentTheme();
  const seg = [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) => `<button type="button" class="seg${v === theme ? ' is-on' : ''}" data-theme-set="${v}" role="radio" aria-checked="${v === theme}">${l}</button>`).join('');
  const account = ctx.mode === 'local'
    ? '<p class="set-text">デモモードで動いています。データはこの端末の中だけに保存されます。<br>家族との共有やほかの端末との同期には、SETUP.md の手順で Supabase を設定してください。</p>'
    : `<p class="set-text">ログイン中：<b>${esc(ctx.store.user.email || '')}</b></p><button type="button" class="btn btn-soft btn-block" data-set="logout">ログアウト</button>`;
  const sync = ctx.mode === 'local' ? '' : `<section class="set-group"><h3>同期</h3><div class="sync-info"></div><button type="button" class="btn btn-soft btn-block" data-set="sync">${UI_ICONS.sync}今すぐ同期</button></section>`;
  return `<div class="settings">
    <section class="set-group"><h3>表示</h3><div class="segmented" role="radiogroup" aria-label="表示の明るさ">${seg}</div></section>
    <section class="set-group"><h3>カテゴリ・入力候補</h3>
      <button type="button" class="set-row" data-set="categories"><span class="set-label">${UI_ICONS.tag}カテゴリを管理する</span>${UI_ICONS.chevron}</button>
      <button type="button" class="set-row" data-set="clear-history"><span class="set-label">${UI_ICONS.history}入力候補の履歴を消す</span>${UI_ICONS.chevron}</button></section>
    ${sync}
    <section class="set-group"><h3>アカウント</h3>${account}</section>
    <p class="version">かいものメモ v${APP_VERSION}</p></div>`;
}

function drawSync(ctx, root) {
  const box = root.querySelector('.sync-info');
  if (!box) return;
  const s = ctx.store.status;
  const last = s.lastSyncAt ? formatTime(s.lastSyncAt) : 'まだ';
  const net = navigator.onLine ? '<span class="net is-on">オンライン</span>' : '<span class="net">オフライン</span>';
  box.innerHTML = `<p class="set-text">${net}　未送信：${ctx.store.outbox.length} 件<br>最後に同期：${esc(last)}${s.error ? `<br><span class="set-error">${esc(s.error)}</span>` : ''}</p>`;
}

async function onSettingsClick(ctx, sheet, e) {
  const t = e.target.closest('[data-theme-set]');
  if (t) {
    setTheme(t.dataset.themeSet);
    sheet.el.querySelectorAll('[data-theme-set]').forEach((b) => {
      b.classList.toggle('is-on', b === t);
      b.setAttribute('aria-checked', String(b === t));
    });
    return;
  }
  const act = e.target.closest('[data-set]')?.dataset.set;
  if (act === 'categories') openCategoryManager(ctx);
  else if (act === 'clear-history') confirmClearHistory(ctx);
  else if (act === 'logout') confirmLogout(ctx);
  else if (act === 'sync') {
    const ok = await ctx.store.pull();
    toast(ok ? '同期しました ✨' : '同期できませんでした（あとで自動でやり直します）');
  }
}

async function confirmClearHistory(ctx) {
  const ok = await confirmSheet({ title: '入力候補の履歴を消しますか？', message: '過去に追加した品目の候補が出なくなります。リストの中身は消えません。', ok: '消す', danger: true });
  if (!ok) return;
  ctx.store.clearHistory();
  toast('入力候補の履歴を消しました');
}

async function confirmLogout(ctx) {
  const n = ctx.store.outbox.length;
  const ok = await confirmSheet({
    title: 'ログアウトしますか？', ok: 'ログアウト', danger: n > 0,
    message: n ? `まだ送れていない変更が ${n} 件あります。ログアウトすると、その変更は消えます。` : 'この端末に保存した一覧や写真も消します（サーバーのデータは残ります）。',
  });
  if (ok) ctx.onLogout?.();
}

// ---------- カテゴリ ----------
export function openCategoryManager(ctx) {
  let off = () => {};
  const sheet = openSheet({
    title: 'カテゴリの管理', className: 'cat-sheet', onClose: () => off(),
    body: `<div class="cat-manage"></div><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-cat-act="add">${UI_ICONS.plus}カテゴリを追加</button></div>`,
  });
  const draw = () => { sheet.el.querySelector('.cat-manage').innerHTML = catManageHtml(ctx); };
  off = ctx.store.on(draw);
  draw();
  sheet.el.addEventListener('click', (e) => onCatManageClick(ctx, e));
}

function catManageHtml(ctx) {
  const me = ctx.store.user.id;
  return ctx.store.categories().map((c) => {
    const mine = c.custom && c.owner_id === me;
    let tag = '';
    if (!c.custom) tag = '<span class="badge badge-soft">標準</span>';
    else if (!mine) tag = '<span class="badge badge-soft">共有メンバー</span>';
    const btns = mine
      ? `<button type="button" class="icon-btn small" data-cat-act="edit" data-id="${esc(c.id)}" aria-label="${esc(c.name)} を編集">${UI_ICONS.edit}</button><button type="button" class="icon-btn small" data-cat-act="delete" data-id="${esc(c.id)}" aria-label="${esc(c.name)} を削除">${UI_ICONS.trash}</button>`
      : '';
    return `<div class="cat-row"><span class="cat-emoji" aria-hidden="true">${emojiIcon(c.emoji)}</span><span class="cat-name">${esc(c.name)}</span>${tag}${btns}</div>`;
  }).join('');
}

async function onCatManageClick(ctx, e) {
  const b = e.target.closest('[data-cat-act]');
  if (!b) return;
  const { catAct, id } = b.dataset;
  if (catAct === 'add') { openCategoryEditor(ctx, null); return; }
  if (catAct === 'edit') { openCategoryEditor(ctx, id); return; }
  const c = ctx.store.data.categories[id];
  if (!c) return;
  const ok = await confirmSheet({ title: 'カテゴリを削除しますか？', message: `「${c.name}」を削除します。このカテゴリのアイテムは「その他」に表示されます。`, ok: '削除する', danger: true });
  if (ok) ctx.store.deleteCategory(id);
}

/** カテゴリの追加・編集。onSaved に作ったカテゴリを渡す */
export function openCategoryEditor(ctx, catId, onSaved = null) {
  const cat = catId ? ctx.store.data.categories[catId] : null;
  const st = { emoji: cat?.emoji || CATEGORY_EMOJIS[0] };
  const emojis = CATEGORY_EMOJIS.map((e, i) => `<button type="button" class="emoji-btn${e === st.emoji ? ' is-on' : ''}" data-pick-emoji="${e}" aria-label="アイコン ${i + 1}">${emojiIcon(e)}</button>`).join('');
  const sheet = openSheet({
    title: cat ? 'カテゴリを編集' : '新しいカテゴリ', className: 'cat-edit-sheet',
    body: `<form class="cat-form" novalidate>
      <label class="field"><span class="field-label">カテゴリの名前</span><input name="name" type="text" maxlength="30" required value="${esc(cat?.name || '')}" placeholder="例：ペット用品" autocomplete="off"></label>
      <div class="field"><span class="field-label">アイコン</span><div class="emoji-grid">${emojis}</div></div>
      <div class="sheet-actions"><button type="submit" class="btn btn-primary btn-block">${cat ? '保存する' : '追加する'}</button></div></form>`,
  });
  const form = sheet.el.querySelector('form');
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-emoji]');
    if (!b) return;
    st.emoji = b.dataset.pickEmoji;
    form.querySelectorAll('[data-pick-emoji]').forEach((x) => x.classList.toggle('is-on', x === b));
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); saveCategory(ctx, cat, st, form, sheet, onSaved); });
  form.querySelector('[name="name"]').focus();
}

function saveCategory(ctx, cat, st, form, sheet, onSaved) {
  const name = form.querySelector('[name="name"]').value.trim();
  if (!name) { toast('カテゴリの名前を入れてね'); return; }
  if (ctx.store.categories().some((c) => c.name === name && c.id !== cat?.id)) { toast('同じ名前のカテゴリがあるよ'); return; }
  let saved;
  if (cat) {
    ctx.store.updateCategory(cat.id, { name, emoji: st.emoji });
    saved = ctx.store.data.categories[cat.id];
  } else {
    saved = ctx.store.addCategory({ name, emoji: st.emoji });
  }
  sheet.close();
  if (onSaved) onSaved(saved);
}

// ---------- パスワードの再設定（メールのリンクから開いたとき） ----------
export function openNewPasswordSheet(backend) {
  const sheet = openSheet({
    title: '新しいパスワード', className: 'pw-sheet',
    body: `<form class="pw-form" novalidate><p class="set-text">新しいパスワードを決めてください（6文字以上）。</p>
      <label class="field"><span class="field-label">新しいパスワード</span><input type="password" name="pw" minlength="6" autocomplete="new-password" required></label>
      <div class="sheet-actions"><button type="submit" class="btn btn-primary btn-block">変更する</button></div></form>`,
  });
  const form = sheet.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = form.querySelector('[name="pw"]').value;
    if (pw.length < 6) { toast('6文字以上にしてね'); return; }
    try {
      await backend.updatePassword(pw);
      toast('パスワードを変更しました');
      sheet.close();
    } catch (err) {
      toast(err.message);
    }
  });
}
