// 品目の詳細シート（＋ボタンからの追加・品目をタップしての編集）
// 編集のときは、シートを閉じたとき（✕・外側・保存ボタン）に変更を保存する。
import { toast, openSheet } from './dom.js';
import { esc, parsePrice, stepQuantity, nameKey } from '../util.js';
import { guessCategory } from '../categories.js';
import { resizeToJpeg } from '../image.js';
import { addOrRevive, deleteWithUndo, photoUrl } from './actions.js';
import { openCategoryEditor } from './sheets.js';
import { UI_ICONS } from './constants.js';
import { emojiIcon } from './icons.js';

export function openItemSheet(ctx, { itemId = null, listId = null }) {
  const item = itemId ? ctx.store.data.items[itemId] : null;
  if (itemId && !item) return null;
  const lid = item ? item.list_id : listId;
  const list = ctx.store.data.lists[lid];
  if (!list) return null;
  const st = {
    item, listId: lid, category: item ? item.category : '', catTouched: !!item,
    photoBlob: null, photoRemoved: false, deleted: false, form: null,
  };
  const sheet = openSheet({
    title: item ? '詳細の編集' : 'アイテムを追加', className: 'item-sheet', color: list.color,
    body: formHtml(item), onClose: () => saveOnClose(ctx, st),
  });
  st.form = sheet.el.querySelector('form');
  bindForm(ctx, st, sheet);
  renderChips(ctx, st);
  if (item?.photo_path) photoUrl(ctx.store, item.photo_path).then((u) => { if (u && !st.photoRemoved && !st.photoBlob) showPreview(st, u); });
  if (!item) field(st, 'name').focus();
  return sheet;
}

function field(st, name) {
  return st.form.querySelector(`[name="${name}"]`);
}

function formHtml(item) {
  const v = (k) => esc(item?.[k] ?? '');
  const actions = item
    ? `<button type="button" class="btn btn-danger-soft" data-act="delete">${UI_ICONS.trash}削除</button><button type="submit" class="btn btn-primary">保存する</button>`
    : `<button type="submit" class="btn btn-primary btn-block">${UI_ICONS.plus}追加する</button>`;
  return `<form class="item-form" novalidate>
  <label class="field"><span class="field-label">名前</span><input name="name" type="text" maxlength="200" required value="${v('name')}" placeholder="例：牛乳" autocomplete="off" enterkeyhint="done"></label>
  <div class="field-row">
    <div class="field"><span class="field-label">数量</span><div class="stepper">
      <button type="button" class="step-btn" data-step="-1" aria-label="数量をへらす">−</button>
      <input name="quantity" type="text" maxlength="30" value="${v('quantity')}" placeholder="例：2、500g" aria-label="数量">
      <button type="button" class="step-btn" data-step="1" aria-label="数量をふやす">＋</button></div></div>
  </div>
  <div class="field"><span class="field-label">カテゴリ</span><div class="chips cat-chips" role="radiogroup" aria-label="カテゴリ"></div></div>
  <label class="field"><span class="field-label">メモ</span><textarea name="note" rows="2" maxlength="1000" placeholder="例：特売なら2つ">${v('note')}</textarea></label>
  <div class="field"><span class="field-label">写真</span><div class="photo-field">
    <div class="photo-preview" hidden><img alt="写真のプレビュー"><button type="button" class="photo-remove" data-act="photo-remove" aria-label="写真を外す">✕</button></div>
    <div class="photo-buttons">
      <label class="btn btn-soft btn-photo">${UI_ICONS.camera}撮影する<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-file="camera"></label>
      <label class="btn btn-soft btn-photo">${UI_ICONS.image}写真を選ぶ<input type="file" accept="image/*" class="visually-hidden" data-file="library"></label>
    </div></div></div>
  <div class="field-row">
    <label class="field"><span class="field-label">お店</span><input name="store" type="text" maxlength="100" value="${v('store')}" placeholder="例：駅前のスーパー"></label>
    <label class="field field-price"><span class="field-label">価格（円）</span><input name="price" type="text" inputmode="decimal" maxlength="14" value="${v('price')}" placeholder="例：198"></label>
  </div>
  <div class="sheet-actions">${actions}</div>
</form>`;
}

function bindForm(ctx, st, sheet) {
  st.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (st.item) sheet.close();
    else submitNew(ctx, st);
  });
  st.form.addEventListener('click', (e) => onFormClick(ctx, st, sheet, e));
  st.form.addEventListener('change', (e) => {
    if (e.target.matches('[data-file]')) onPhotoChosen(st, e.target);
  });
  field(st, 'name').addEventListener('input', () => autoCategory(ctx, st));
}

function onFormClick(ctx, st, sheet, e) {
  const step = e.target.closest('[data-step]');
  if (step) {
    const q = field(st, 'quantity');
    q.value = stepQuantity(q.value, Number(step.dataset.step));
    return;
  }
  const chip = e.target.closest('[data-cat]');
  if (chip) {
    st.category = chip.dataset.cat;
    st.catTouched = true;
    renderChips(ctx, st);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'add-cat') openCategoryEditor(ctx, null, (cat) => { st.category = cat.id; st.catTouched = true; renderChips(ctx, st); });
  else if (act === 'photo-remove') removePreview(st);
  else if (act === 'delete') deleteFromSheet(ctx, st, sheet);
}

function renderChips(ctx, st) {
  const cats = ctx.store.categories();
  const sel = cats.some((c) => c.id === st.category) ? st.category : 'other';
  st.form.querySelector('.cat-chips').innerHTML = cats.map((c) => {
    const on = c.id === sel;
    return `<button type="button" class="chip${on ? ' is-on' : ''}" data-cat="${esc(c.id)}" role="radio" aria-checked="${on}">${emojiIcon(c.emoji)}${esc(c.name)}</button>`;
  }).join('') + `<button type="button" class="chip chip-add" data-act="add-cat">${UI_ICONS.plus}新しいカテゴリ</button>`;
}

/** 追加のとき：名前からカテゴリを自動で選ぶ（自分で選んだあとは変えない） */
function autoCategory(ctx, st) {
  if (st.catTouched) return;
  const name = field(st, 'name').value;
  st.category = ctx.store.data.history[nameKey(name)]?.category || guessCategory(name);
  renderChips(ctx, st);
}

async function onPhotoChosen(st, input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.type && !file.type.startsWith('image/')) { toast('画像のファイルを選んでね'); return; }
  st.form.classList.add('is-busy');
  try {
    const { blob } = await resizeToJpeg(file);
    st.photoBlob = blob;
    st.photoRemoved = false;
    showPreview(st, URL.createObjectURL(blob));
  } catch {
    toast('写真を読み込めませんでした');
  } finally {
    st.form.classList.remove('is-busy');
  }
}

function showPreview(st, url) {
  const box = st.form.querySelector('.photo-preview');
  box.querySelector('img').src = url;
  box.hidden = false;
}

function removePreview(st) {
  st.photoBlob = null;
  st.photoRemoved = true;
  st.form.querySelector('.photo-preview').hidden = true;
}

function readForm(st) {
  const val = (n) => field(st, n).value.trim();
  const priceText = val('price');
  const price = parsePrice(priceText);
  return {
    name: val('name'), quantity: val('quantity'), note: val('note'), store: val('store'),
    price, priceBad: priceText !== '' && price === null, category: st.category || '',
  };
}

function submitNew(ctx, st) {
  const v = readForm(st);
  if (!v.name) { toast('名前を入れてね'); field(st, 'name').focus(); return; }
  if (v.priceBad) { toast('価格は数字で入れてね'); return; }
  const extra = { quantity: v.quantity, note: v.note, store: v.store, price: v.price, category: v.category };
  const { item, status } = addOrRevive(ctx, st.listId, v.name, extra);
  if (status === 'exists' || !item) return;
  if (st.photoBlob) ctx.store.setItemPhoto(item.id, st.photoBlob);
  toast(`「${v.name}」を追加したよ`);
  st.form.reset();
  st.category = '';
  st.catTouched = false;
  removePreview(st);
  renderChips(ctx, st);
  field(st, 'name').focus();
}

/** 編集のとき：閉じたら、変わったところだけ保存する */
function saveOnClose(ctx, st) {
  if (!st.item || st.deleted) return;
  const cur = ctx.store.data.items[st.item.id];
  if (!cur) return;
  const v = readForm(st);
  if (v.priceBad) toast('価格が数字ではなかったので、価格は変えずにおきました');
  const next = { name: v.name || cur.name, quantity: v.quantity, note: v.note, store: v.store, category: v.category };
  if (!v.priceBad) next.price = v.price;
  const patch = {};
  for (const [k, val] of Object.entries(next)) if ((cur[k] ?? '') !== (val ?? '')) patch[k] = val;
  if (Object.keys(patch).length) ctx.store.updateItem(cur.id, patch);
  if (st.photoBlob) ctx.store.setItemPhoto(cur.id, st.photoBlob);
  else if (st.photoRemoved && cur.photo_path) ctx.store.removeItemPhoto(cur.id);
}

function deleteFromSheet(ctx, st, sheet) {
  st.deleted = true;
  sheet.close();
  deleteWithUndo(ctx, [st.item.id], `「${st.item.name}」を削除しました`);
}
