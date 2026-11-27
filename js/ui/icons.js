// リスト・カテゴリの線のアイコン（2026-11-27 KM-012）
// - データには今までどおり絵文字を保存し、画面に出すときだけ線のアイコンに置き換える
//   （Supabase の表を変えずに済み、古い版のアプリを開いている家族の端末とも食い違わない）
// - 対応のない絵文字（前の版で選んだ物など）は、そのまま絵文字で表示する
// - 形は 24×24 の線画。色は文字の色（currentColor）に合わせる
import { esc } from '../util.js';

const PATHS = {
  cart: '<path d="M3 4h2.5l2.2 10.5h9.8L20 7H6.6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  basket: '<path d="M3.5 10h17l-1.8 9a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2z"/><path d="M8 10l3-6M16 10l-3-6M9 13.5v3.5M12 13.5v3.5M15 13.5v3.5"/>',
  leaf: '<path d="M5 19c0-8.3 5.7-14 14-14 0 8.3-5.7 14-14 14z"/><path d="M5 19l8-8"/>',
  fish: '<path d="M7 12c2.4-3.3 5.3-5 8.2-5 2.5 0 4.6 1.7 6.3 5-1.7 3.3-3.8 5-6.3 5-2.9 0-5.8-1.7-8.2-5z"/><path d="M7 12L2.5 8.5v7z"/><path d="M16.5 10.8v.4"/>',
  milk: '<path d="M8.5 3h7v3l2.5 3.5V21H6V9.5L8.5 6z"/><path d="M6 10.5h12"/>',
  bread: '<path d="M6 11a4 4 0 0 1 1-7.5h10A4 4 0 0 1 18 11v9H6z"/>',
  salt: '<path d="M8 9.5L9 5h6l1 4.5"/><path d="M7 9.5h10V20a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20z"/><path d="M11 3h2M10.5 14.5h.01M13.5 14.5h.01M12 17h.01"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5"/>',
  cookie: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9.5h.01M14.5 8.5h.01M15 14h.01M9.5 15h.01M12 12h.01"/>',
  juice: '<path d="M6 7h12l-1.5 13.5a1 1 0 0 1-1 .9h-7a1 1 0 0 1-1-.9z"/><path d="M12 7l2-4.5h3M6.5 11h11"/>',
  roll: '<circle cx="8" cy="9" r="4.5"/><circle cx="8" cy="9" r="1.2"/><path d="M8 4.5h8.5A4.5 4.5 0 0 1 21 9v11.5h-8.5V9"/>',
  pill: '<path d="M10.5 3.9a4.4 4.4 0 0 1 6.2 6.2l-6.6 6.6a4.4 4.4 0 0 1-6.2-6.2z"/><path d="M7.2 7.2l6.2 6.2"/>',
  shirt: '<path d="M8.5 3.5L4 6l-1.5 4.5 3 1.2L6 21h12l.5-9.3 3-1.2L20 6l-4.5-2.5c-.5 1.5-2 2.5-3.5 2.5s-3-1-3.5-2.5z"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  box: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5l8.5 4 8.5-4M12 11.5v9"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8.5h14V12M12 8v12.5"/><path d="M12 8C10.5 4.5 7 4 7 6.3 7 8 10 8 12 8zM12 8c1.5-3.5 5-4 5-1.7C17 8 14 8 12 8z"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  cake: '<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 12V8"/><path d="M12 5.8c.9-.6.9-1.5 0-2.8-.9 1.3-.9 2.2 0 2.8z"/>',
  cup: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.7.8-.7 1.7 0 2.5M12 3.5c-.7.8-.7 1.7 0 2.5"/>',
  beer: '<path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 10.5h1.5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H16M6 8V6.5A2.5 2.5 0 0 1 8.5 4h5A2.5 2.5 0 0 1 16 6.5V8M9.5 12v5M12.5 12v5"/>',
  bottle: '<path d="M10 2.5h4v3h-4z"/><path d="M10 5.5L8 8.5V20a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 20V8.5l-2-3M8 12h8"/>',
  gamepad: '<path d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.8 3.8a2.2 2.2 0 0 1-3.9.9L15 16H9l-1.7 2.1a2.2 2.2 0 0 1-3.9-.9l-.8-3.8A4.5 4.5 0 0 1 7 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1 5.2-2.4l-2.7 2.7.4 2 2 .4 2.7-2.7a4 4 0 0 1-5.3 5.1L9 19.4a2.1 2.1 0 0 1-3-3z"/>',
  paw: '<circle cx="6.5" cy="10.5" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="17.5" cy="10.5" r="1.8"/><path d="M12 11.5c-2.6 0-5 3.2-5 5.6 0 1.6 1.2 2.4 2.6 2.4 1 0 1.6-.5 2.4-.5s1.4.5 2.4.5c1.4 0 2.6-.8 2.6-2.4 0-2.4-2.4-5.6-5-5.6z"/>',
  house: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  flower: '<path d="M12 21v-9"/><path d="M12 12c-3 0-5-2-5-5.5L9.5 8 12 4l2.5 4L17 6.5C17 10 15 12 12 12z"/><path d="M12 17.5c-2.5 0-4-1.2-4.5-3M12 18.5c2.5 0 4-1.2 4.5-3"/>',
  plane: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3L10 13"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>',
  bento: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 5v14M12 12h9"/>',
  noodle: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z"/><path d="M8 20h8M14 11l5-7.5M11 11l6-7"/>',
  drop: '<path d="M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.4 5.5-10z"/>',
  battery: '<rect x="3" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3M6.5 10.5v3M9.5 10.5v3"/>',
  pencil: '<path d="M15.5 4.5l4 4L8.5 19.5l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>',
  tree: '<path d="M12 3L6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1v.5h6V15c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3z"/>',
};

// 絵文字 → アイコンの名前。今の選択肢・標準のカテゴリに加えて、前の版の選択肢も、近い形があるものは入れた
const EMOJI_ICON = {
  '🛒': 'cart', '🧺': 'basket', '🥬': 'leaf', '🥕': 'leaf', '🍀': 'leaf', '🪴': 'leaf',
  '🍖': 'fish', '🐟': 'fish', '🥛': 'milk', '🍞': 'bread', '🧂': 'salt', '🧊': 'snow', '🍪': 'cookie',
  '🧃': 'juice', '🧻': 'roll', '💊': 'pill', '👗': 'shirt', '📱': 'phone', '📚': 'book', '📦': 'box',
  '🎁': 'gift', '💝': 'gift', '🎀': 'gift', '⭐': 'star', '🍰': 'cake', '🎂': 'cake', '☕': 'cup',
  '🍺': 'beer', '🧴': 'bottle', '🎮': 'gamepad', '🔧': 'wrench', '🐾': 'paw', '🐱': 'paw', '🐶': 'paw',
  '🏠': 'house', '🌷': 'flower', '🌸': 'flower', '✈️': 'plane', '🏷️': 'tag', '🍱': 'bento', '🍙': 'bento',
  '🥟': 'bento', '🍜': 'noodle', '🧼': 'drop', '🔋': 'battery', '✏️': 'pencil', '🎄': 'tree', '💡': 'bulb',
};

// 異体字セレクタ（U+FE0F）の有無で別の文字にならないよう、外してから比べる
const plain = (s) => String(s ?? '').replace(/️/g, '');
const TABLE = new Map(Object.entries(EMOJI_ICON).map(([e, name]) => [plain(e), name]));

/** その絵文字に対応するアイコンの名前（なければ ''） */
export function iconName(emoji) {
  return TABLE.get(plain(emoji)) || '';
}

/** 絵文字を、線のアイコン（SVG）の HTML にする。対応がなければ絵文字のまま（無害化して）返す */
export function emojiIcon(emoji) {
  const name = iconName(emoji);
  if (!name) return `<span class="emo">${esc(emoji)}</span>`;
  return `<svg class="line-ic" data-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}
