// 表示の明るさ（自動・ライト・ダーク）
// 自動のときは端末の設定（ダークモードかどうか）に合わせる。選んだ設定は端末に保存する。
import { lsGet, lsSet } from '../util.js';

const BAR = { light: '#ffeaf3', dark: '#221c27' }; // スマホ上部のバーの色

export function currentTheme() {
  return lsGet('theme') || 'auto';
}

export function initTheme(override) {
  applyTheme(override || currentTheme());
}

export function setTheme(mode) {
  lsSet('theme', mode);
  applyTheme(mode);
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const own = (m.media || '').includes('dark') ? 'dark' : 'light';
    m.content = BAR[mode === 'light' || mode === 'dark' ? mode : own];
  }
}
