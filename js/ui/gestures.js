// 指の操作：品目の「左スワイプで削除」と、リストの「つまんで並べ替え」
// どちらも Pointer Events（指・マウス・ペンを同じように扱うしくみ）で作っている。

const SWIPE_START = 12; // これ以上横に動いたらスワイプとみなす（px）
const DELETE_RATIO = 0.35; // 幅の 35% 以上動かして離したら削除

function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* テストの疑似操作などでは失敗するが、動きには影響しない */ }
}

class Swipe {
  constructor(container, { onDelete, onBusy }) {
    this.c = container;
    this.onDelete = onDelete;
    this.onBusy = onBusy || (() => {});
    this.st = null;
    this.suppress = false;
    container.addEventListener('pointerdown', (e) => this.down(e));
    container.addEventListener('pointermove', (e) => this.move(e));
    container.addEventListener('pointerup', (e) => this.up(e));
    container.addEventListener('pointercancel', () => this.cancel());
    // スワイプした直後のクリック（タップ）は無視する
    container.addEventListener('click', (e) => {
      if (this.suppress) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  down(e) {
    const item = e.target.closest('.item');
    if (!item || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.st = { item, wrap: item.closest('.item-wrap'), x0: e.clientX, y0: e.clientY, dx: 0, active: false, pid: e.pointerId };
  }

  move(e) {
    const st = this.st;
    if (!st || e.pointerId !== st.pid) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.active && !this.begin(e, dx, dy)) return;
    st.dx = Math.min(0, dx);
    st.item.style.transform = `translateX(${st.dx}px)`;
    st.wrap.classList.toggle('will-delete', -st.dx > st.item.offsetWidth * DELETE_RATIO);
  }

  begin(e, dx, dy) {
    if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) { this.st = null; return false; } // 縦のスクロール
    if (dx > -SWIPE_START || Math.abs(dx) < Math.abs(dy)) return false;
    this.st.active = true;
    this.st.wrap.classList.add('is-swiping');
    capture(this.st.item, e.pointerId);
    this.onBusy(true);
    return true;
  }

  up(e) {
    const st = this.st;
    if (!st || e.pointerId !== st.pid) return;
    this.st = null;
    if (!st.active) return;
    this.suppress = true;
    setTimeout(() => { this.suppress = false; }, 350);
    st.wrap.classList.remove('is-swiping');
    if (-st.dx <= st.item.offsetWidth * DELETE_RATIO) { this.reset(st); return; }
    st.wrap.classList.add('is-removing');
    st.item.style.transform = 'translateX(-110%)';
    setTimeout(() => { this.onDelete(st.wrap.dataset.id); this.onBusy(false); }, 200);
  }

  cancel() {
    if (this.st?.active) this.reset(this.st);
    this.st = null;
  }

  reset(st) {
    st.item.style.transform = '';
    st.wrap.classList.remove('will-delete', 'is-swiping');
    this.onBusy(false);
  }
}

export function attachSwipe(container, opts) {
  return new Swipe(container, opts);
}

class DragSort {
  constructor(container, { item, handle, onEnd, onBusy }) {
    this.c = container;
    this.o = { item, handle, onEnd, onBusy: onBusy || (() => {}) };
    this.st = null;
    container.addEventListener('pointerdown', (e) => this.down(e));
    container.addEventListener('pointermove', (e) => this.move(e));
    container.addEventListener('pointerup', () => this.up());
    container.addEventListener('pointercancel', () => this.up());
  }

  down(e) {
    const h = e.target.closest(this.o.handle);
    if (!h) return;
    const el = h.closest(this.o.item);
    e.preventDefault();
    this.st = { el, pid: e.pointerId, grab: e.clientY - el.getBoundingClientRect().top };
    el.classList.add('is-dragging');
    capture(el, e.pointerId);
    this.o.onBusy(true);
  }

  move(e) {
    const st = this.st;
    if (!st || e.pointerId !== st.pid) return;
    this.shift(e.clientY);
    const naturalTop = this.c.getBoundingClientRect().top + st.el.offsetTop;
    st.el.style.transform = `translateY(${e.clientY - st.grab - naturalTop}px)`;
  }

  /** 指が隣の項目の真ん中を越えたら、順番を入れ替える */
  shift(y) {
    const { el } = this.st;
    const next = el.nextElementSibling;
    const prev = el.previousElementSibling;
    const mid = (n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
    if (next && y > mid(next)) this.c.insertBefore(next, el);
    else if (prev && y < mid(prev)) this.c.insertBefore(el, prev);
  }

  up() {
    const st = this.st;
    if (!st) return;
    this.st = null;
    st.el.classList.remove('is-dragging');
    st.el.style.transform = '';
    const ids = [...this.c.querySelectorAll(this.o.item)].map((n) => n.dataset.id);
    this.o.onBusy(false);
    this.o.onEnd(ids);
  }
}

export function attachDragSort(container, opts) {
  return new DragSort(container, opts);
}
