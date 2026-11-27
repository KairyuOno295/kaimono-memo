// テスト用の小さなしくみ
// test(名前, 関数) で登録 → run(題名) で順番に実行 → 結果を画面と window.__testResult に出す
// （tests\run_tests.py が window.__testResult を読み取って、結果のファイルに書く）

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || '条件を満たしていません');
}

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || '値がちがいます'}（期待：${e}／実際：${a}）`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 条件が成り立つまで待つ（成り立ったときの値を返す） */
export async function waitFor(fn, ms = 5000, label = '') {
  const t0 = performance.now();
  let last = null;
  while (performance.now() - t0 < ms) {
    try {
      const v = fn();
      if (v) return v;
    } catch (e) { last = e; }
    await sleep(25);
  }
  throw new Error(`待ちきれませんでした：${label}${last ? `（${last.message}）` : ''}`);
}

function draw(title, results, done) {
  const out = document.getElementById('out');
  if (!out) return;
  const ok = results.filter((r) => r.ok).length;
  const rows = results.map((r) => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✅' : '❌'} ${escape(r.name)}${r.ok ? ` <small>${r.ms}ms</small>` : `<pre>${escape(r.error)}</pre>`}</li>`).join('');
  out.innerHTML = `<h1>${escape(title)}：${ok}/${results.length} 合格${done ? '' : '（実行中…）'}</h1><ul>${rows}</ul>`;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export async function run(title) {
  const results = [];
  for (const c of cases) {
    const t0 = performance.now();
    try {
      await c.fn();
      results.push({ name: c.name, ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: String(e?.stack || e) });
    }
    draw(title, results, false);
  }
  const summary = {
    title, total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  draw(title, results, true);
  window.__testResult = summary;
  return summary;
}
