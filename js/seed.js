// 最初に作るリスト
// - Supabase を使うとき：はじめてログインした人に、からっぽのリストを3つ作る
// - デモモードのとき：お試し用の品目も入れる（架空のデータ）

export const STARTER_LISTS = [
  { name: 'スーパー', emoji: '🛒', color: 'pink' },
  { name: 'ドラッグストア', emoji: '💊', color: 'mint' },
  { name: '欲しいもの', emoji: '🎁', color: 'lavender' },
];

export const DEMO_ITEMS = {
  スーパー: [
    { name: 'キャベツ' },
    { name: '牛乳', extra: { quantity: '2' } },
    { name: '鶏むね肉', extra: { note: '特売なら2パック' } },
    { name: '食パン', extra: { quantity: '6枚切り' } },
    { name: 'バナナ' },
    { name: 'たまご', extra: { checked: true } },
  ],
  ドラッグストア: [
    { name: 'シャンプー', extra: { store: '駅前のドラッグストア' } },
    { name: 'ティッシュ', extra: { quantity: '5箱' } },
    { name: '目薬' },
  ],
  欲しいもの: [
    { name: 'ワイヤレスイヤホン', extra: { price: 12800, store: '家電のお店' } },
    { name: '春物のカーディガン', extra: { note: 'ミントグリーンがいいな' } },
  ],
};
