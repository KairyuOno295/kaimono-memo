// リストの中身の画面（品目の表示・名前だけで追加・入力候補・チェック・スワイプ削除）
import { $, vibrate, openViewer, reducedMotion } from './dom.js';
import { esc, formatPrice, formatQty, byPosition, lsGet, lsSet } from '../util.js';
import { CHECK_SVG } from './constants.js';
import { attachSwipe } from './gestures.js';
import { addOrRevive, deleteWithUndo, photoUrl } from './actions.js';
import { openItemSheet } from './item-sheet.js';
import { openListMenu } from './sheets.js';

const CHECK_ANIM_MS = 420; // チェックのアニメーションを見せてから、下へ移す
const checking = new Set();

export function initList(ctx) {
  $('#btn-back').addEventListener('click', () => { location.hash = '#/'; });
  $('#btn-list-menu').addEventListener('click', () => openListMenu(ctx, ctx.listId));
  $('#fab-add').addEventListener('click', () => openItemSheet(ctx, { listId: ctx.listId }));
  $('#btn-clear-checked').addEventListener('click', () => clearChecked(ctx));
  $('#items').addEventListener('click', (e) => onItemsClick(ctx, e));
  attachSwipe($('#items'), {
    onBusy: (on) => ctx.setBusy(on),
    onDelete: (id) => swipeDelete(ctx, id),
  });
  initQuickAdd(ctx);
}

export function renderList(ctx, listId) {
  const list = ctx.store.data.lists[listId];
  if (ctx.listId !== listId) { ctx.listId = listId; $('#quick-input').value = ''; }
  $('#view-list').dataset.color = list.color;
  $('#list-emoji').textContent = list.emoji;
  $('#list-name').textContent = list.name;
  document.title = `${list.name} - かいものメモ`;
  const items = ctx.store.itemsOf(listId);
  const open = items.filter((i) => !i.checked).sort(byPosition);
  const done = items.filter((i) => i.checked)
    .sort((a, b) => String(b.checked_at || '').localeCompare(String(a.checked_at || '')));
  $('#items').innerHTML = items.length ? groupsHtml(ctx, open) + doneHtml(listId, open, done) : emptyHtml();
  const btn = $('#btn-clear-checked');
  btn.hidden = done.length === 0;
  btn.textContent = `🧹 チェック済みを削除（${done.length}）`;
  hydratePhotos(ctx);
  highlight(ctx);
}

function groupsHtml(ctx, open) {
  const cats = ctx.store.categories();
  const known = new Set(cats.map((c) => c.id));
  const groups = new Map();
  for (const it of open) {
    const cid = known.has(it.category) ? it.category : 'other';
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(it);
  }
  return cats.filter((c) => groups.has(c.id)).map((c) => groupHtml(c, groups.get(c.id))).join('');
}

function groupHtml(cat, items) {
  return `<section class="group" data-cat="${esc(cat.id)}">
    <h2 class="group-title"><span class="g-emoji" aria-hidden="true">${esc(cat.emoji)}</span>${esc(cat.name)}<span class="g-count">${items.length}</span></h2>
    <ul class="cards">${items.map(itemHtml).join('')}</ul></section>`;
}

function doneHtml(listId, open, done) {
  if (!done.length) return '';
  const collapsed = lsGet(`collapsed:${listId}`) === '1';
  const cheer = open.length ? '' : '<p class="all-done">🎉 ぜんぶ買えたね！おつかれさま</p>';
  return `${cheer}<section class="group done-group${collapsed ? ' is-collapsed' : ''}">
    <h2 class="group-title"><button type="button" class="collapse-btn" data-act="collapse" aria-expanded="${!collapsed}">
      <span class="g-emoji" aria-hidden="true">✅</span>チェック済み<span class="g-count">${done.length}</span><span class="chev" aria-hidden="true">▾</span></button></h2>
    <ul class="cards">${collapsed ? '' : done.map(itemHtml).join('')}</ul></section>`;
}

function itemHtml(it) {
  const meta = [it.note, it.store && `🏪 ${it.store}`, formatPrice(it.price)]
    .filter(Boolean).map(esc).join('<span class="dot">・</span>');
  const qty = it.quantity ? `<span class="qty">${esc(formatQty(it.quantity))}</span>` : '';
  const thumb = it.photo_path
    ? `<button type="button" class="thumb" data-act="photo" data-path="${esc(it.photo_path)}" aria-label="「${esc(it.name)}」の写真を大きく見る"><img alt=""></button>`
    : '';
  return `<li class="item-wrap${it.checked ? ' is-checked' : ''}" data-id="${esc(it.id)}">
    <div class="item-bg" aria-hidden="true"><span>🗑️ 削除</span></div>
    <div class="item">
      <button type="button" class="check" aria-pressed="${!!it.checked}" aria-label="${it.checked ? 'チェックを外す' : 'チェックする'}：${esc(it.name)}">${CHECK_SVG}</button>
      <button type="button" class="item-body" data-act="edit" aria-label="「${esc(it.name)}」の詳細を開く">
        <span class="item-name"><span class="name-text">${esc(it.name)}</span>${qty}</span>${meta ? `<span class="item-meta">${meta}</span>` : ''}
      </button>${thumb}
    </div></li>`;
}

function emptyHtml() {
  return `<div class="empty">
    <div class="empty-art" aria-hidden="true">🧺<span class="empty-spark">✨</span></div>
    <p class="empty-title">まだなにもないよ</p>
    <p class="empty-sub">上の入力欄に名前を入れて<br>「追加」を押してね ♪</p></div>`;
}

function onItemsClick(ctx, e) {
  const actEl = e.target.closest('[data-act]');
  if (actEl?.dataset.act === 'collapse') { toggleCollapse(ctx); return; }
  const wrap = e.target.closest('.item-wrap');
  if (!wrap) return;
  if (e.target.closest('.check')) onCheck(ctx, wrap);
  else if (actEl?.dataset.act === 'photo') showPhoto(ctx, actEl.dataset.path);
  else if (actEl?.dataset.act === 'edit') openItemSheet(ctx, { itemId: wrap.dataset.id });
}

function onCheck(ctx, wrap) {
  const id = wrap.dataset.id;
  const it = ctx.store.data.items[id];
  if (!it || checking.has(id)) return;
  if (it.checked) { ctx.store.toggleItem(id); return; }
  checking.add(id);
  wrap.classList.add('is-checking');
  burst(wrap);
  vibrate(12);
  setTimeout(() => {
    checking.delete(id);
    ctx.store.toggleItem(id);
  }, reducedMotion() ? 0 : CHECK_ANIM_MS);
}

/** チェックしたときの、きらきらのアニメーション */
function burst(wrap) {
  if (reducedMotion()) return;
  const box = document.createElement('span');
  box.className = 'burst';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = Array.from({ length: 8 }, (_, i) => `<i style="--a:${i * 45}deg"></i>`).join('');
  wrap.querySelector('.check').append(box);
  setTimeout(() => box.remove(), 700);
}

async function showPhoto(ctx, path) {
  const url = await photoUrl(ctx.store, path);
  if (url) openViewer(url);
}

function swipeDelete(ctx, id) {
  const it = ctx.store.data.items[id];
  if (it) deleteWithUndo(ctx, [id], `「${it.name}」を削除しました`);
}

export function clearChecked(ctx) {
  const ids = ctx.store.itemsOf(ctx.listId).filter((i) => i.checked).map((i) => i.id);
  deleteWithUndo(ctx, ids, `チェック済み ${ids.length} 件を削除しました`);
}

function toggleCollapse(ctx) {
  const key = `collapsed:${ctx.listId}`;
  lsSet(key, lsGet(key) === '1' ? '0' : '1');
  ctx.render();
}

function hydratePhotos(ctx) {
  for (const btn of $('#items').querySelectorAll('.thumb[data-path]')) {
    photoUrl(ctx.store, btn.dataset.path).then((url) => {
      if (url) btn.querySelector('img').src = url;
      else btn.classList.add('is-missing');
    });
  }
}

/** 追加した品目・すでにある品目を目立たせる */
function highlight(ctx) {
  for (const [key, cls] of [['newId', 'is-new'], ['flashId', 'is-flash']]) {
    const id = ctx[key];
    if (!id) continue;
    ctx[key] = null;
    const node = $('#items').querySelector(`.item-wrap[data-id="${CSS.escape(id)}"]`);
    if (!node) continue;
    node.classList.add(cls);
    node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
}

// ---------- 名前だけで追加・入力候補 ----------
function initQuickAdd(ctx) {
  const input = $('#quick-input');
  const box = $('#suggest');
  $('#quick-add').addEventListener('submit', (e) => { e.preventDefault(); quickAdd(ctx, input.value); });
  input.addEventListener('input', () => renderSuggest(ctx));
  input.addEventListener('focus', () => renderSuggest(ctx));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') box.hidden = true; });
  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== input) box.hidden = true;
  }, 150));
  box.addEventListener('mousedown', (e) => e.preventDefault()); // 候補を押してもキーボードを閉じない
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-name]');
    if (b) quickAdd(ctx, b.dataset.name);
  });
}

function quickAdd(ctx, raw) {
  const name = String(raw || '').trim();
  if (!name) return;
  addOrRevive(ctx, ctx.listId, name);
  $('#quick-input').value = '';
  renderSuggest(ctx);
}

function renderSuggest(ctx) {
  const input = $('#quick-input');
  const box = $('#suggest');
  const q = input.value.trim();
  const rows = document.activeElement === input ? ctx.store.suggestions(ctx.listId, q, q ? 6 : 10) : [];
  box.hidden = rows.length === 0;
  if (!rows.length) return;
  const cats = new Map(ctx.store.categories().map((c) => [c.id, c.emoji]));
  const emoji = (r) => esc(cats.get(r.category) || '📦');
  box.innerHTML = q
    ? rows.map((r) => `<button type="button" class="suggest-row" data-name="${esc(r.name)}"><span aria-hidden="true">${emoji(r)}</span><span class="s-name">${esc(r.name)}</span>${r.inList ? '<span class="s-tag">リストにあり</span>' : ''}</button>`).join('')
    : `<p class="suggest-head">よく買うもの</p><div class="chips">${rows.map((r) => `<button type="button" class="chip" data-name="${esc(r.name)}">${emoji(r)} ${esc(r.name)}</button>`).join('')}</div>`;
}
