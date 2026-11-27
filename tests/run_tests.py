"""
かいものメモ の自動テスト（Edge を画面なしで動かして確かめる）

使い方（c:\\AI_work\\買い物リスト で実行）:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe" -I -B -X utf8 tests\\run_tests.py [--icons] [--no-shots]
    --icons    … icons\\icon.svg から PNG のアイコン（192・512・maskable・apple-touch）を書き出す
    --no-shots … 画面の写真を撮らない

入力: このフォルダのアプリ一式
出力: c:\\AI_work\\_テスト出力\\買い物リスト\\ に results.json・summary.txt・画面の写真（shot-*.png）
      （テスト専用の書き出し先。架空のデータだけ。2026-11-26 KM-006 で tests\\_output\\ から移した）

しくみ:
  - 127.0.0.1（このPCの中だけ）で仮のサーバーを動かし、Edge を画面なし（headless）で起動する
  - Edge の名前解決を止めて、外のサイト（CDN・Google Fonts など）にはつながないようにする
    （そのため、写真の文字は M PLUS Rounded 1c ではなく、PC に入っている代わりのフォントになる）
  - Edge とは DevTools のしくみ（CDP）でやりとりする（ページを開く・JS を実行する・画面を撮る）
  - 最後に仮サーバーを止めて、保存したファイルだけで開けるか（オフライン）を確かめる
  - 終わったら Edge と仮サーバーを止め、テスト用の Edge のプロフィールを消す
"""
import base64
import functools
import http.server
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / '_テスト出力' / '買い物リスト'  # テスト専用の書き出し先（c:\AI_work\CLAUDE.md「承認の重さ」。KM-006）
EDGE = Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
MOBILE = {'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True}


# ---------- 仮サーバー ----------
class Handler(http.server.SimpleHTTPRequestHandler):
    """ファイルを返すだけのサーバー。保存（キャッシュ）させない。JS などの種類を正しく返す"""
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.webmanifest': 'application/manifest+json', '.json': 'application/json',
        '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def translate_path(self, path):
        """/__sbtest/ の下は、アプリと同じファイルを返す。ただし config.js だけ、にせの Supabase（tests\\sb-config.js）にする"""
        p = urllib.parse.urlsplit(path).path
        if p.startswith('/__sbtest/'):
            rest = p[len('/__sbtest/'):]
            if rest == 'config.js':
                return str(ROOT / 'tests' / 'sb-config.js')
            path = '/' + rest
        return super().translate_path(path)

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # 標準の 5 だと、ブラウザが一度にたくさん読みに来たときに断ることがある


def start_server():
    handler = functools.partial(Handler, directory=str(ROOT))
    srv = Server(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def stop_server(srv):
    srv.shutdown()
    srv.server_close()


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


# ---------- Edge ----------
def launch_edge(profile, port):
    args = [
        str(EDGE), '--headless=new', f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
        '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--window-size=390,844', 'about:blank',
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def edge_pids(profile):
    """この回のテスト用プロフィールを使っている Edge だけのプロセス番号（ふだんの Edge は含まない）"""
    ps = ('Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\'" | '
          'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }')
    out = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', ps],
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    key = profile.name  # 例：edge-profile-1764141234（毎回ちがう名前）
    return [int(line.split('\t', 1)[0]) for line in out.splitlines() if key in line and line.split('\t', 1)[0].isdigit()]


def kill_edge(proc, profile):
    """テスト用の Edge を止め、全部終わったのを確かめる（プロフィールのフォルダを消せるように）"""
    subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True)
    for _ in range(30):
        pids = edge_pids(profile)
        if not pids:
            return True
        for pid in pids:
            subprocess.run(['taskkill', '/F', '/PID', str(pid)], capture_output=True)
        time.sleep(0.5)
    return False


def devtools_ws_url(port, timeout=30):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # プロキシを使わない
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with opener.open(f'http://127.0.0.1:{port}/json/list', timeout=2) as r:
                pages = [p for p in json.load(r) if p.get('type') == 'page']
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except OSError:
            pass
        time.sleep(0.3)
    raise RuntimeError('Edge の DevTools に接続できませんでした')


class CDP:
    """Edge の DevTools（CDP）と WebSocket でやりとりする最小限のしくみ"""

    def __init__(self, ws_url):
        u = urllib.parse.urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n'
               f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.sock.sendall(req.encode())
        self.buf = bytearray()
        while b'\r\n\r\n' not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError('WebSocket の接続に失敗しました')
            self.buf += chunk
        head, _, rest = bytes(self.buf).partition(b'\r\n\r\n')
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise RuntimeError(head[:200])
        self.buf = bytearray(rest)
        self.next_id = 0
        self.logs = []  # ブラウザのコンソールの内容（失敗したときの手がかり）

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 16)
            if not chunk:
                raise RuntimeError('接続が切れました')
            self.buf += chunk
        data = bytes(self.buf[:n])
        del self.buf[:n]
        return data

    def _send(self, text):
        payload = text.encode('utf-8')
        n = len(payload)
        head = bytearray([0x81])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack('>H', n)
        else:
            head.append(0x80 | 127)
            head += struct.pack('>Q', n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + mask + masked)

    def _recv(self):
        parts = []
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            opcode = b1 & 0x0F
            if opcode == 8:
                raise RuntimeError('Edge が接続を閉じました')
            if opcode in (0, 1, 2):
                parts.append(data)
                if b1 & 0x80:
                    return b''.join(parts).decode('utf-8')

    def call(self, method, params=None, timeout=90):
        self.next_id += 1
        mid = self.next_id
        self._send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self._recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})
            self._keep_log(msg)
        raise TimeoutError(method)

    def _keep_log(self, msg):
        p = msg.get('params', {})
        if msg.get('method') == 'Runtime.consoleAPICalled':
            text = ' '.join(str(a.get('value', a.get('description', ''))) for a in p.get('args', []))
            self.logs.append(f"[{p.get('type')}] {text}"[:300])
        elif msg.get('method') == 'Runtime.exceptionThrown':
            d = p.get('exceptionDetails', {})
            self.logs.append(f"[exception] {d.get('exception', {}).get('description') or d.get('text')}"[:300])
        del self.logs[:-30]

    def eval(self, expr):
        r = self.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']
            raise RuntimeError(d.get('exception', {}).get('description') or d.get('text'))
        return r.get('result', {}).get('value')

    def wait_for(self, expr, timeout=30, label=''):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                v = self.eval(expr)
                if v:
                    return v
            except RuntimeError as e:  # ページの切り替え中などは失敗するので、やり直す
                last = e
            time.sleep(0.2)
        raise TimeoutError(f'待ちきれませんでした：{label or expr}（{last}）')

    def goto(self, url, timeout=30):
        self.call('Page.navigate', {'url': url})
        self.wait_for(f'location.href === {json.dumps(url)} && document.readyState === "complete"', timeout, f'開く {url}')

    def shot(self, path, clip=None):
        params = {'format': 'png'}
        if clip:
            params['clip'] = clip
        r = self.call('Page.captureScreenshot', params)
        path.write_bytes(base64.b64decode(r['data']))


# ---------- それぞれの確認 ----------
def make_icons(cdp, base):
    sizes = [('icon-192.png', 192), ('icon-512.png', 512), ('icon-maskable-512.png', 512), ('apple-touch-icon.png', 180)]
    for name, size in sizes:
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': size, 'height': size, 'deviceScaleFactor': 1, 'mobile': False})
        cdp.goto(f'{base}/tests/make-icons.html?size={size}')
        cdp.wait_for('window.__iconReady === true', 10, 'アイコンの読み込み')
        cdp.shot(ROOT / 'icons' / name, {'x': 0, 'y': 0, 'width': size, 'height': size, 'scale': 1})
    return {'title': 'アイコンの書き出し', 'total': len(sizes), 'passed': len(sizes), 'failed': 0,
            'results': [{'name': n, 'ok': True} for n, _ in sizes]}


def run_test_page(cdp, url, timeout):
    cdp.goto(url)
    return cdp.wait_for('window.__testResult || null', timeout, f'テストの終了 {url}')


def take_shots(cdp, base):
    cdp.call('Emulation.setDeviceMetricsOverride', MOBILE)
    shots = []
    home = '!document.querySelector("#view-home").hidden && document.querySelectorAll(".list-card").length > 0'
    lst = '!document.querySelector("#view-list").hidden && document.querySelectorAll(".item-wrap").length > 0'
    for theme in ['light', 'dark']:
        cdp.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-color-scheme', 'value': theme}]})
        cdp.goto(f'{base}/index.html?demo&nosw&test&ns=shot-{theme}')
        cdp.wait_for(home, 15, 'リスト一覧')
        shots.append(snap(cdp, f'shot-home-{theme}.png'))
        cdp.eval('location.hash = "#/list/@1"')
        cdp.wait_for(lst, 10, 'リストの中身')
        shots.append(snap(cdp, f'shot-list-{theme}.png'))
        cdp.eval('document.querySelector(".item-body").click()')
        cdp.wait_for('!!document.querySelector(".sheet-layer.is-open .item-form")', 5, '詳細のシート')
        shots.append(snap(cdp, f'shot-sheet-{theme}.png'))
    cdp.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-color-scheme', 'value': 'light'}]})
    cdp.eval('location.hash = "#/"; const s = window.__kaimono.store; const l = s.addList({name: "100円ショップ", emoji: "🧸", color: "lemon"}); location.hash = "#/list/" + l.id; true')
    cdp.wait_for('!!document.querySelector("#items .empty")', 5, '空のリスト')
    shots.append(snap(cdp, 'shot-empty-light.png'))
    cdp.goto(f'{base}/index.html?test&screen=auth&nosw&ns=shot-auth')
    cdp.wait_for('!document.querySelector("#view-auth").hidden', 10, 'ログイン画面')
    shots.append(snap(cdp, 'shot-auth-light.png'))
    return {'title': '画面の写真', 'total': len(shots), 'passed': len(shots), 'failed': 0,
            'results': [{'name': s, 'ok': True} for s in shots]}


def snap(cdp, name):
    time.sleep(0.9)  # アニメーションが落ち着くのを待つ
    cdp.shot(OUT / name)
    return name


def offline_check(cdp, base, srv):
    """サービスワーカーが保存したファイルだけで開けるか（仮サーバーを止めて確かめる）"""
    results = []
    def step(name, fn):
        try:
            fn()
            results.append({'name': name, 'ok': True})
        except Exception as e:  # noqa: BLE001  確認の失敗はすべて記録する
            results.append({'name': name, 'ok': False, 'error': str(e)})
            raise
    url = f'{base}/index.html?demo&test&ns=offline'
    home = '!document.querySelector("#view-home").hidden && document.querySelectorAll(".list-card").length === 3'
    try:
        step('オンラインで開いて、サービスワーカーが動き出す', lambda: (
            cdp.goto(url), cdp.wait_for(home, 15, 'リスト一覧'),
            cdp.wait_for('navigator.serviceWorker.ready.then(() => true)', 30, 'サービスワーカー'),
            cdp.call('Page.reload'), cdp.wait_for('!!navigator.serviceWorker.controller', 15, 'ページがサービスワーカーの管理下になる')))
        stop_server(srv)
        step('仮サーバーを止めても（オフラインでも）開ける', lambda: (
            cdp.call('Page.reload'), cdp.wait_for(home, 20, 'オフラインでのリスト一覧')))
        add = ('location.hash = "#/list/@1"; new Promise((ok) => setTimeout(() => { const i = document.querySelector("#quick-input");'
               ' i.value = "オフライン追加"; document.querySelector("#quick-add").requestSubmit(); ok(true); }, 300))')
        has_item = '[...document.querySelectorAll(".name-text")].some((n) => n.textContent === "オフライン追加")'
        step('オフラインで追加できる', lambda: (cdp.eval(add), cdp.wait_for(has_item, 5, '追加した品目')))
        step('オフラインのまま開き直しても、追加した品目が残る', lambda: (
            time.sleep(0.6), cdp.call('Page.reload'), cdp.wait_for(has_item, 20, '開き直したあとの品目')))
    except Exception:  # noqa: BLE001  途中で失敗しても、ここまでの結果を返す
        pass
    passed = sum(1 for r in results if r['ok'])
    return {'title': 'オフライン', 'total': 4, 'passed': passed, 'failed': 4 - passed, 'results': results}


class _Collect(unittest.TestResult):
    """Python の単体テストの結果を、ほかのテストと同じ形で集める"""

    def __init__(self):
        super().__init__()
        self.rows = []

    def _name(self, test):
        return test.shortDescription() or test.id()

    def addSuccess(self, test):
        super().addSuccess(test)
        self.rows.append({'name': self._name(test), 'ok': True})

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.rows.append({'name': self._name(test), 'ok': False, 'error': self._exc_info_to_string(err, test)})

    def addError(self, test, err):
        super().addError(test, err)
        self.rows.append({'name': self._name(test), 'ok': False, 'error': self._exc_info_to_string(err, test)})


def run_python_tests():
    """tests\\test_*.py（tools\\setup_cloud.py のテストなど。どこにもつながない）"""
    tests_dir = str(ROOT / 'tests')
    suite = unittest.defaultTestLoader.discover(tests_dir, pattern='test_*.py', top_level_dir=tests_dir)
    res = _Collect()
    suite.run(res)
    ok = sum(1 for r in res.rows if r['ok'])
    return {'title': 'セットアップのスクリプト（Python）', 'total': len(res.rows), 'passed': ok,
            'failed': len(res.rows) - ok, 'results': res.rows}


def check_precache():
    """sw.js の保存リストと、実際のファイルが一致しているか"""
    text = (ROOT / 'sw.js').read_text(encoding='utf-8')
    start = text.index('const APP_FILES')
    block = text[start:text.index('];', start)]
    listed = {p for p in re.findall(r"'\./([^']*)'", block) if p}
    actual = {'index.html', 'config.js', 'manifest.webmanifest'}
    for d in ['js', 'css', 'icons']:  # 「_旧」の付いた控えは、保存（公開）しないので数えない
        actual |= {p.relative_to(ROOT).as_posix() for p in (ROOT / d).rglob('*') if p.is_file() and '_旧' not in p.name}
    missing, extra = sorted(actual - listed), sorted(listed - actual)
    ok = not missing and not extra
    return {'title': '保存リスト（sw.js）', 'total': 1, 'passed': int(ok), 'failed': int(not ok),
            'results': [{'name': 'sw.js の一覧と実際のファイルが一致', 'ok': ok,
                         'error': '' if ok else f'一覧にない：{missing}／ファイルがない：{extra}'}]}


# ---------- まとめ ----------
def write_summary(suites):
    (OUT / 'results.json').write_text(json.dumps(suites, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = [f'かいものメモ テスト結果（{time.strftime("%Y-%m-%d %H:%M:%S")}）', '']
    for s in suites:
        lines.append(f"■ {s['title']}：{s['passed']}/{s['total']} 合格")
        for r in s['results']:
            mark = '○' if r['ok'] else '×'
            lines.append(f"  {mark} {r['name']}")
            if not r['ok']:
                lines.append('     ' + str(r.get('error', '')).splitlines()[0][:300])
    text = '\n'.join(lines)
    (OUT / 'summary.txt').write_text(text, encoding='utf-8')
    return text


DIAG = ('JSON.stringify({href: location.href, ready: document.readyState, booting: !!document.getElementById("boot"),'
        ' app: typeof window.__kaimono, home: document.querySelector("#view-home")?.hidden,'
        ' list: document.querySelector("#view-list")?.hidden, sheets: document.querySelectorAll(".sheet-layer").length,'
        ' items: (document.querySelector("#items")?.innerHTML || "").slice(0, 160),'
        ' fatal: document.querySelector("#fatal")?.hidden === false ? document.querySelector("#fatal pre").textContent : ""})')


def guard(cdp, title, fn):
    """1つの確認を実行する。失敗しても止めずに、そのときの画面の状態を記録する"""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001  失敗はすべて結果に書く
        try:
            state = cdp.eval(DIAG)
        except Exception as e2:  # noqa: BLE001
            state = f'（状態を読めませんでした：{e2}）'
        logs = ' | '.join(cdp.logs[-8:])
        return {'title': title, 'total': 1, 'passed': 0, 'failed': 1,
                'results': [{'name': f'{title}の実行', 'ok': False, 'error': f'{e} ／ 画面の状態：{state} ／ コンソール：{logs}'}]}


def run_all(cdp, base, srv, args):
    cdp.call('Runtime.enable')
    if '--only-shots' in args:  # 画面の写真だけを撮る（調べるとき用）
        return [guard(cdp, '画面の写真', lambda: take_shots(cdp, base))]
    if '--only-sb' in args:  # Supabase の流れのテストだけ（調べるとき用）
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 900, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
        return [guard(cdp, 'Supabase の流れのテスト', lambda: run_test_page(cdp, f'{base}/tests/e2e-sb.html', 180))]
    suites = []
    if '--icons' in args or not (ROOT / 'icons' / 'icon-512.png').exists():
        suites.append(guard(cdp, 'アイコンの書き出し', lambda: make_icons(cdp, base)))
    suites.append(check_precache())
    suites.append(run_python_tests())
    cdp.call('Emulation.setDeviceMetricsOverride', MOBILE)
    cdp.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
    suites.append(guard(cdp, '単体テスト', lambda: run_test_page(cdp, f'{base}/tests/unit.html', 120)))
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 900, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
    suites.append(guard(cdp, '画面の操作テスト', lambda: run_test_page(cdp, f'{base}/tests/e2e.html', 240)))
    suites.append(guard(cdp, 'Supabase の流れのテスト', lambda: run_test_page(cdp, f'{base}/tests/e2e-sb.html', 180)))
    suites.append(guard(cdp, 'サービスワーカー', lambda: run_test_page(cdp, f'{base}/tests/sw-test.html', 60)))
    if '--no-shots' not in args:
        suites.append(guard(cdp, '画面の写真', lambda: take_shots(cdp, base)))
    suites.append(offline_check(cdp, base, srv))  # 最後に仮サーバーを止めるので、いちばん後ろ
    return suites


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('edge-profile*'):  # 前の回の残り（自分が作ったテスト用のフォルダだけ）
        shutil.rmtree(old, ignore_errors=True)
    profile = OUT / f'edge-profile-{int(time.time())}'
    srv = start_server()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    port = free_port()
    edge = launch_edge(profile, port)
    try:
        cdp = CDP(devtools_ws_url(port))
        suites = run_all(cdp, base, srv, args)
    finally:
        stopped = kill_edge(edge, profile)
        try:
            stop_server(srv)
        except Exception:  # noqa: BLE001  もう止まっていてもよい
            pass
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)
        if not stopped or profile.exists():
            print(f'注意：テスト用の Edge またはフォルダが残っています（{profile.name}）。次の実行で消します')
    print(write_summary(suites))
    return 0 if all(s['failed'] == 0 for s in suites) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
