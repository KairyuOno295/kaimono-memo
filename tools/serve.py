"""
かいものメモ を、このパソコンだけで試すための仮サーバー

使い方（c:\\AI_work\\買い物リスト で実行）:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe" -I -B -X utf8 tools\\serve.py [ポート番号（省略時 8000）]
  → ブラウザで http://localhost:8000/ を開く。止めるときは Ctrl + C

入力: このフォルダのファイル（読むだけ）
出力: なし（ファイルは作らない・変えない）
注意:
  - 127.0.0.1（このパソコンの中）だけで動く。同じ Wi-Fi のスマホなどからは見えない
  - index.html をダブルクリックで開く（file://）と、モジュールやサービスワーカーが動かないので、これを使う
  - Python の標準のサーバーは、Windows の設定によって .js の種類を正しく返さないことがあるため、種類を指定している
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.webmanifest': 'application/manifest+json', '.json': 'application/json',
        '.png': 'image/png', '.html': 'text/html; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # 標準の 5 だと、ブラウザが一度にたくさん読みに来たときに断ることがある


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=str(ROOT))
    with Server(('127.0.0.1', port), handler) as srv:
        print(f'かいものメモ：http://localhost:{port}/ を開いてください（止めるときは Ctrl + C）')
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print('止めました')


if __name__ == '__main__':
    main()
