// 画面の共通部品（要素の検索・トースト・下から出るシート・確認・写真の拡大表示）
import { esc } from '../util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** HTML の文字から要素を1つ作る */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function vibrate(ms) {
  try { navigator.vibrate?.(ms); } catch { /* 使えない端末では何もしない */ }
}

/** トースト（画面の下に少しだけ出るお知らせ）。action を渡すとボタン付き（例：元に戻す） */
export function toast(message, { action = '', onAction = null, ms = 2600 } = {}) {
  const root = $('#toast-root');
  const node = el(`<div class="toast" role="status"><span class="toast-msg"></span>${action ? '<button type="button" class="toast-btn"></button>' : ''}</div>`);
  node.querySelector('.toast-msg').textContent = message;
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    node.classList.remove('is-shown');
    setTimeout(() => node.remove(), 250);
  };
  if (action) {
    const btn = node.querySelector('.toast-btn');
    btn.textContent = action;
    btn.addEventListener('click', () => { onAction?.(); hide(); });
  }
  root.replaceChildren(node); // いつも1つだけ表示する
  requestAnimationFrame(() => node.classList.add('is-shown'));
  timer = setTimeout(hide, ms);
  return { hide };
}

const sheets = [];

/** 下から出るシート（ダイアログ）を開く。戻り値の el にフォームなどを入れる */
export function openSheet({ title, body = '', onClose = null, className = '', color = '' }) {
  const node = el(`<div class="sheet-layer">
    <div class="sheet-backdrop"></div>
    <div class="sheet ${esc(className)}" role="dialog" aria-modal="true" aria-label="${esc(title)}"${color ? ` data-color="${esc(color)}"` : ''}>
      <div class="sheet-grab" aria-hidden="true"></div>
      <header class="sheet-head"><h2></h2><button type="button" class="icon-btn sheet-close" aria-label="閉じる">✕</button></header>
      <div class="sheet-body"></div>
    </div></div>`);
  node.querySelector('h2').textContent = title;
  const bodyEl = node.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  const api = { el: bodyEl, root: node, closed: false, close: () => closeSheet(api, node, onClose) };
  node.querySelector('.sheet-backdrop').addEventListener('click', api.close);
  node.querySelector('.sheet-close').addEventListener('click', api.close);
  $('#sheet-root').append(node);
  sheets.push(api);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => node.classList.add('is-open'));
  return api;
}

function closeSheet(api, node, onClose) {
  if (api.closed) return;
  api.closed = true;
  try {
    onClose?.();
  } finally {
    sheets.splice(sheets.indexOf(api), 1);
    node.classList.remove('is-open');
    node.classList.add('is-closing');
    setTimeout(() => node.remove(), 260);
    if (!sheets.length) document.body.classList.remove('has-sheet');
  }
}

export function closeAllSheets() {
  [...sheets].reverse().forEach((s) => s.close());
}

export function topSheet() {
  return sheets[sheets.length - 1] || null;
}

/** 確認のシート。「はい」なら true */
export function confirmSheet({ title, message, ok = 'OK', cancel = 'やめる', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({
      title, className: 'confirm-sheet', onClose: () => resolve(result),
      body: `<p class="confirm-msg"></p><div class="sheet-actions">
        <button type="button" class="btn btn-soft" data-confirm="0">${esc(cancel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="1">${esc(ok)}</button></div>`,
    });
    s.el.querySelector('.confirm-msg').textContent = message;
    s.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-confirm]');
      if (!b) return;
      result = b.dataset.confirm === '1';
      s.close();
    });
  });
}

/** 写真の拡大表示 */
export function openViewer(src) {
  const v = $('#viewer');
  v.querySelector('img').src = src;
  v.hidden = false;
  requestAnimationFrame(() => v.classList.add('is-open'));
}

export function closeViewer() {
  const v = $('#viewer');
  v.classList.remove('is-open');
  setTimeout(() => { v.hidden = true; }, 200);
}

export function initDomBasics() {
  $('#viewer').addEventListener('click', closeViewer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#viewer').hidden) closeViewer();
    else topSheet()?.close();
  });
}
