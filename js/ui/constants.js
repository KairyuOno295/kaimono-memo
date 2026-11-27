// 画面で使う選択肢（リストの色・絵文字、カテゴリの絵文字、アイコン）
export const APP_VERSION = '1.1.0';

// リストの色。ID は保存したデータと合わせるため前のまま（pink など）で、見える色だけを変えた（2026-11-27 KM-012）。
// 新しいリストには、上から順に、まだ使っていない色を付ける。
export const COLORS = [
  { id: 'sky', name: 'ブルー' },
  { id: 'lavender', name: 'インディゴ' },
  { id: 'mint', name: 'ティール' },
  { id: 'lilac', name: 'バイオレット' },
  { id: 'cocoa', name: 'スレート' },
  { id: 'lemon', name: 'アンバー' },
  { id: 'peach', name: 'オレンジ' },
  { id: 'pink', name: 'ローズ' },
];

// リスト・カテゴリに付けるアイコン。保存するのは絵文字の文字で、画面では icons.js の線のアイコンで表示する。
// 選べるのは、線のアイコンがある物だけ（2026-11-27 KM-012）
export const LIST_EMOJIS = ['🛒', '🧺', '🥬', '🍰', '☕', '🍺', '💊', '🧴', '🧻', '🎁',
  '⭐', '👗', '📚', '🎮', '📱', '🔧', '🐾', '🏠', '🌷', '✈️'];

export const CATEGORY_EMOJIS = ['🏷️', '🐾', '🍱', '🍜', '🍺', '🍰', '☕', '🧴', '🧼',
  '🔧', '🔋', '✏️', '🎮', '🌷', '🎄', '💡', '🏠', '⭐'];

// ボタンや見出しで使う線のアイコン（2026-11-27 KM-012。色は文字の色〔currentColor〕に合わせる）
const uiSvg = (d, w = 2) => `<svg class="ui-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const UI_ICONS = {
  sort: uiSvg('<path d="M8 4v16M4.5 7.5L8 4l3.5 3.5M16 20V4M12.5 16.5L16 20l3.5-3.5"/>'),
  done: uiSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  trash: uiSvg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
  users: uiSvg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.6.7 2.7 2.4 3 4.7"/>'),
  chevron: uiSvg('<path d="M9 5.5l6.5 6.5L9 18.5"/>'),
  cart: uiSvg('<path d="M3 4h2.5l2.2 10.5h9.8L20 7H6.6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>', 1.8),
  edit: uiSvg('<path d="M15.5 4.5l4 4L8.5 19.5l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>', 1.8),
  tag: uiSvg('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>', 1.8),
  leave: uiSvg('<path d="M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15"/>', 1.8),
  camera: uiSvg('<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5l1.5-2.5h6L16.5 7H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="13" r="3.2"/>', 1.8),
  image: uiSvg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/>', 1.8),
  mail: uiSvg('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>', 1.8),
  history: uiSvg('<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/><path d="M12 8v4.5l3 1.8"/>', 1.8),
  sync: uiSvg('<path d="M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5"/><path d="M17.5 3.5V7H14M6.5 20.5V17H10"/>', 1.8),
  plus: uiSvg('<path d="M12 5v14M5 12h14"/>', 2.2),
};

export const CHECK_SVG ='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 12.5l4 4L18.5 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
