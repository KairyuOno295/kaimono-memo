// リスト一覧の画面（リストを開く・新しいリスト・並べ替え）
import { $ } from './dom.js';
import { esc, formatToday } from '../util.js';
import { attachDragSort } from './gestures.js';
import { openListEditor, openSettings } from './sheets.js';
import { UI_ICONS } from './constants.js';
import { emojiIcon } from './icons.js';

export function initHome(ctx) {
  $('#btn-new-list').addEventListener('click', () => openListEditor(ctx, null));
  $('#btn-settings').addEventListener('click', () => openSettings(ctx));
  $('#btn-reorder').addEventListener('click', () => { ctx.reorder = !ctx.reorder; ctx.render(); });
  $('#list-cards').addEventListener('click', (e) => onCardsClick(ctx, e));
  attachDragSort($('#list-cards'), {
    item: '.list-card',
    handle: '.lc-handle',
    onBusy: (on) => ctx.setBusy(on),
    onEnd: (ids) => ctx.store.reorderLists(ids),
  });
}

export function renderHome(ctx) {
  const lists = ctx.store.sortedLists();
  if (lists.length < 2) ctx.reorder = false;
  document.title = 'かいものメモ';
  $('#home-date').textContent = formatToday();
  $('#demo-banner').hidden = ctx.mode !== 'local';
  $('#home-empty').hidden = lists.length > 0;
  const ul = $('#list-cards');
  ul.classList.toggle('is-reorder', ctx.reorder);
  ul.innerHTML = lists.map((l, i) => cardHtml(ctx, l, i, lists.length)).join('');
  const btn = $('#btn-reorder');
  btn.hidden = lists.length < 2;
  btn.innerHTML = ctx.reorder ? `${UI_ICONS.done}完了` : `${UI_ICONS.sort}並べ替え`;
  btn.classList.toggle('is-active', ctx.reorder);
  $('#btn-new-list').hidden = ctx.reorder;
}

function cardHtml(ctx, l, i, n) {
  const { left, total } = ctx.store.listStats(l.id);
  const shared = (ctx.store.data.members[l.id] || []).length > 1 || l.role === 'member';
  const allDone = total > 0 && left === 0;
  let sub = `のこり ${left} 件`;
  if (total === 0) sub = '品目なし';
  else if (allDone) sub = 'すべて完了';
  const count = total === 0 ? '' : (left || UI_ICONS.done);
  const tail = ctx.reorder
    ? reorderHtml(l, i, n)
    : `<span class="lc-tail" aria-hidden="true"><span class="lc-count${left ? '' : ' is-zero'}">${count}</span>${UI_ICONS.chevron}</span>`;
  return `<li class="list-card" data-id="${esc(l.id)}" data-color="${esc(l.color)}">
    <a class="lc-link" href="#/list/${encodeURIComponent(l.id)}"${ctx.reorder ? ' tabindex="-1" aria-disabled="true"' : ''}>
      <span class="lc-emoji" aria-hidden="true">${emojiIcon(l.emoji)}</span>
      <span class="lc-body"><span class="lc-name">${esc(l.name)}</span>
        <span class="lc-sub${allDone ? ' is-done' : ''}">${sub}${shared ? `<span class="lc-shared">${UI_ICONS.users}共有</span>` : ''}</span></span>
    </a>${tail}</li>`;
}

function reorderHtml(l, i, n) {
  return `<span class="lc-reorder">
    <button type="button" class="icon-btn small" data-move="-1"${i === 0 ? ' disabled' : ''} aria-label="「${esc(l.name)}」を上へ">▲</button>
    <button type="button" class="icon-btn small" data-move="1"${i === n - 1 ? ' disabled' : ''} aria-label="「${esc(l.name)}」を下へ">▼</button>
    <span class="lc-handle" aria-hidden="true">≡</span></span>`;
}

function onCardsClick(ctx, e) {
  if (!ctx.reorder) return;
  if (e.target.closest('.lc-link')) e.preventDefault(); // 並べ替え中は開かない
  const b = e.target.closest('[data-move]');
  if (!b) return;
  const ids = ctx.store.sortedLists().map((l) => l.id);
  const i = ids.indexOf(b.closest('.list-card').dataset.id);
  const j = i + Number(b.dataset.move);
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  ctx.store.reorderLists(ids);
}
