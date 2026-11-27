// 起動の見張り（ふつうの script として、モジュールより先に読み込む）
// 12秒たっても起動が終わらないとき（電波が悪くてファイルを読み込めなかったときなど）、
// 「読み込み直す」ボタンを出す。起動が終われば何もしない。
(function () {
  'use strict';
  var LIMIT_MS = 12000;
  window.setTimeout(function () {
    if (!document.getElementById('boot')) return; // 起動は終わっている
    var box = document.getElementById('fatal');
    if (!box || !box.hidden) return;
    box.querySelector('pre').textContent = 'アプリのファイルを読み込めませんでした。電波のよいところで、読み込み直してください。';
    box.hidden = false;
  }, LIMIT_MS);
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'fatal-reload') window.location.reload();
  });
})();
