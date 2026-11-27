// 写真を「長辺800px・JPEG」に縮小する（アップロードの前に使う）
// スマホの写真は大きい（数MB）ので、送る量と保存する量を減らす。
// 写真の向き（縦横）は、いまのブラウザが写真の情報（EXIF）を見て自動で直してくれる。

export const MAX_SIDE = 800;
export const JPEG_QUALITY = 0.82;

/** 縦横の比を保ったまま、長い方の辺が max 以下になる大きさを返す（小さい写真は拡大しない） */
export function fitSize(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

/** 画像ファイルを縮小して JPEG の Blob にする → { blob, width, height } */
export async function resizeToJpeg(file, max = MAX_SIDE, quality = JPEG_QUALITY) {
  const img = await loadImage(file);
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEG は透明を持てないので、透明な部分は白にする
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('画像の圧縮に失敗しました');
  return { blob, width, height };
}
