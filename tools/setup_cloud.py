"""
かいものメモ を、Supabase と GitHub Pages に自動で準備・公開するスクリプト（SETUP.md の手順1〜5 の自動版）

使い方（c:\\AI_work\\買い物リスト で、ご本人が実行する）:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe" -I -B -X utf8 tools\\setup_cloud.py
    → 送る物の説明が出るので、よければ y → 合い鍵（アクセストークン）を2つ貼り付ける（画面には表示されない）
  オプション:
    --dry-run   … 送るファイルの一覧を出すだけ（どこにもつながない）
    --name 名前 … Supabase のプロジェクトと GitHub のリポジトリの名前（省略時 kaimono-memo）

入力:
  - Supabase のアクセストークン（https://supabase.com/dashboard/account/tokens で作る）
  - GitHub のアクセストークン（classic。scope は repo と workflow）
  - このフォルダのアプリのファイルと supabase\\schema.sql
出力（このパソコンには何も書かない。最後に、公開した URL をブラウザで開く）:
  - Supabase：プロジェクト（東京・無料プラン）、データの表と権限（schema.sql）、ログインの設定（Site URL など）
  - GitHub：公開のリポジトリ、アプリのファイル、Variables（SUPABASE_URL・SUPABASE_ANON_KEY）、GitHub Pages
送る物と送り先:
  - Supabase へ：schema.sql の中身、ログインの設定
  - GitHub へ：アプリのファイル（config.js・テストの結果・控え・作業の記録は送らない）、Supabase の URL と anon キー（公開してよい鍵）
  - 合い鍵とデータベースのパスワードは、画面・ファイル・ログに出さない
    （データベースのパスワードは自動で作り、どこにも保存しない。要るときは Supabase の画面で作り直せる）
何度実行してもよい（作ってある物は使い回し、ファイルは今の内容にそろえる）
"""
import argparse
import base64
import getpass
import json
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUPABASE_API = 'https://api.supabase.com'
GITHUB_API = 'https://api.github.com'
REGION = 'ap-northeast-1'  # 東京
USER_AGENT = 'kaimono-memo-setup'  # 個人の情報は入れない
GITHUB_HEADERS = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
WORKFLOW_FILE = 'deploy-pages.yml'
SUPABASE_TOKEN_PAGE = 'https://supabase.com/dashboard/account/tokens'
GITHUB_TOKEN_PAGE = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=kaimono-memo-setup'

# GitHub に送らないもの
SKIP_DIRS = {'.git', '__pycache__', 'node_modules'}
SKIP_PATHS = {'config.js', 'tests/_output', '作業状況_買い物リスト.md'}
SKIP_NAME_PARTS = ('_旧',)
SKIP_SUFFIXES = ('.bak', '.pyc')


class ApiError(Exception):
    """サービスから返ったエラー（合い鍵は入れない）"""

    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


def parse_body(raw):
    text = raw.decode('utf-8', errors='replace') if raw else ''
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


def http_transport(method, url, headers, body):
    """本物の通信。戻り値は（状態の番号, 中身）"""
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context()) as res:
            return res.status, parse_body(res.read())
    except urllib.error.HTTPError as e:
        return e.code, parse_body(e.read())
    except urllib.error.URLError as e:
        raise ApiError(f'つながりませんでした（{e.reason}）。ネットの接続を確かめてください') from None


def error_text(data):
    if isinstance(data, dict):
        return str(data.get('message') or data.get('error') or data.get('msg') or json.dumps(data, ensure_ascii=False))[:300]
    return str(data or '')[:300]


class Api:
    """1つのサービスとのやりとり（合い鍵は中にしまい、表示しない）"""

    def __init__(self, base, token, headers=None, transport=http_transport):
        self.base = base
        self._headers = {'Authorization': f'Bearer {token}', 'User-Agent': USER_AGENT, **(headers or {})}
        self.transport = transport

    def request(self, method, path, body=None, ok404=False):
        status, data = self.transport(method, self.base + path, dict(self._headers), body)
        if status == 404 and ok404:
            return None
        if status >= 400:
            raise ApiError(f'{method} {path.split("?")[0]}：{status} {error_text(data)}', status)
        return data


# ---------- 送るファイル ----------
def skipped(rel):
    parts = rel.split('/')
    if any(d in SKIP_DIRS for d in parts[:-1]):
        return True
    if rel in SKIP_PATHS or any(rel.startswith(s + '/') for s in SKIP_PATHS):
        return True
    name = parts[-1]
    return any(s in name for s in SKIP_NAME_PARTS) or name.endswith(SKIP_SUFFIXES)


def select_files(root=ROOT):
    """GitHub に送るファイル（root からの場所。/ 区切り）"""
    rels = [p.relative_to(root).as_posix() for p in sorted(root.rglob('*')) if p.is_file()]
    return [r for r in rels if not skipped(r)]


def pages_url(login, repo):
    return f'https://{login.lower()}.github.io/{repo}/'


# ---------- Supabase ----------
def project_ref(p):
    return p.get('ref') or p.get('id')


def sb_project(sb, name, log):
    found = next((p for p in sb.request('GET', '/v1/projects') or [] if p.get('name') == name), None)
    if found:
        log(f'  プロジェクト「{name}」はもうあるので、それを使います')
        return found
    orgs = sb.request('GET', '/v1/organizations') or []
    if not orgs:
        raise ApiError('Supabase の組織（Organization）がありません。Supabase の画面で組織を1つ作ってから、もう一度実行してください')
    body = {'name': name, 'organization_id': orgs[0]['id'], 'region': REGION, 'db_pass': secrets.token_urlsafe(24)}
    log(f'  プロジェクト「{name}」を作ります（東京）')
    return sb.request('POST', '/v1/projects', body)


def sb_wait_active(sb, ref, log, sleep, tries=60):
    for _ in range(tries):
        status = (sb.request('GET', f'/v1/projects/{ref}') or {}).get('status', '')
        if status == 'ACTIVE_HEALTHY':
            return
        if status in ('INACTIVE', 'PAUSED', 'PAUSING'):
            raise ApiError('プロジェクトが一時停止しています。Supabase の画面で Restore を押してから、もう一度実行してください')
        log(f'  準備中です…（{status or "確認中"}）')
        sleep(10)
    raise ApiError('プロジェクトの準備が10分で終わりませんでした。少し待ってから、もう一度実行してください')


def sb_run_schema(sb, ref, sql, sleep, tries=6):
    """schema.sql を実行する（できたばかりのプロジェクトは少し待つことがあるので、つながらなければやり直す）"""
    for i in range(tries):
        try:
            sb.request('POST', f'/v1/projects/{ref}/database/query', {'query': sql})
            return
        except ApiError as e:
            if i == tries - 1 or 400 <= e.status < 500:
                raise
            sleep(15)


def sb_anon_key(sb, ref):
    keys = sb.request('GET', f'/v1/projects/{ref}/api-keys') or []
    key = next((k for k in keys if k.get('name') == 'anon'), None) \
        or next((k for k in keys if k.get('type') == 'publishable'), None)
    if not key or not key.get('api_key'):
        raise ApiError('anon キーを取り出せませんでした。SETUP.md の手順3で、Supabase の画面から確かめてください')
    return key['api_key']


def sb_auth_config(sb, ref, site):
    body = {
        'site_url': site,
        'uri_allow_list': f'{site},http://localhost:8000/',
        'external_email_enabled': True,
        'mailer_autoconfirm': False,  # メールアドレスの確認はオンのまま（SETUP.md の手順4-1）
    }
    sb.request('PATCH', f'/v1/projects/{ref}/config/auth', body)


# ---------- GitHub ----------
def gh_repo(gh, login, repo, log):
    found = gh.request('GET', f'/repos/{login}/{repo}', ok404=True)
    if found:
        log(f'  リポジトリ「{repo}」はもうあるので、それを使います')
        return found
    log(f'  公開のリポジトリ「{repo}」を作ります')
    body = {'name': repo, 'private': False, 'auto_init': True, 'description': '買い物・欲しいものリスト（かいものメモ）'}
    return gh.request('POST', '/user/repos', body)


def gh_variable(gh, full, name, value):
    path = f'/repos/{full}/actions/variables'
    if gh.request('GET', f'{path}/{name}', ok404=True):
        gh.request('PATCH', f'{path}/{name}', {'name': name, 'value': value})
    else:
        gh.request('POST', path, {'name': name, 'value': value})


def gh_pages(gh, full):
    cur = gh.request('GET', f'/repos/{full}/pages', ok404=True)
    if not cur:
        gh.request('POST', f'/repos/{full}/pages', {'build_type': 'workflow'})
    elif cur.get('build_type') != 'workflow':
        gh.request('PUT', f'/repos/{full}/pages', {'build_type': 'workflow'})


def gh_head(gh, full, branch, sleep, tries=6):
    """ブランチの最新のコミット（できたばかりのリポジトリは少し待つ）"""
    for i in range(tries):
        try:
            return gh.request('GET', f'/repos/{full}/git/ref/heads/{branch}')['object']['sha']
        except ApiError:
            if i == tries - 1:
                raise
            sleep(3)
    return None


def gh_tree(gh, full, root, files):
    entries = []
    for rel in files:
        content = base64.b64encode((root / rel).read_bytes()).decode('ascii')
        blob = gh.request('POST', f'/repos/{full}/git/blobs', {'content': content, 'encoding': 'base64'})
        entries.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    return gh.request('POST', f'/repos/{full}/git/trees', {'tree': entries})['sha']


def gh_push(gh, full, branch, root, files, sleep, log):
    """ファイルを今の内容にそろえる。戻り値は（最新のコミット, 変えたか）"""
    head = gh_head(gh, full, branch, sleep)
    tree = gh_tree(gh, full, root, files)
    if gh.request('GET', f'/repos/{full}/git/commits/{head}')['tree']['sha'] == tree:
        log('  ファイルは前と同じでした')
        return head, False
    commit = gh.request('POST', f'/repos/{full}/git/commits', {'message': 'かいものメモを更新', 'tree': tree, 'parents': [head]})
    gh.request('PATCH', f'/repos/{full}/git/refs/heads/{branch}', {'sha': commit['sha']})
    log(f'  ファイル {len(files)} 個を入れました')
    return commit['sha'], True


def utc_now(offset_sec=0):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + offset_sec))


def gh_find_run(gh, full, sha, since):
    """今回始まった公開（since より後にできた物）を探す。前の回の結果とまちがえないため"""
    runs = (gh.request('GET', f'/repos/{full}/actions/runs?per_page=20') or {}).get('workflow_runs', [])
    return next((r for r in runs if r.get('head_sha') == sha and str(r.get('created_at', '')) >= since), None)


def gh_wait_deploy(gh, full, branch, sha, since, log, sleep, tries=60):
    """公開（GitHub Actions）が終わるのを待つ。始まらなければ、こちらから始める"""
    for i in range(tries):
        run = gh_find_run(gh, full, sha, since)
        if run and run.get('status') == 'completed':
            if run.get('conclusion') == 'success':
                return
            raise ApiError(f'公開に失敗しました。くわしくは {run.get("html_url", "GitHub の Actions のタブ")} で見られます')
        if run is None and i == 6:
            gh.request('POST', f'/repos/{full}/actions/workflows/{WORKFLOW_FILE}/dispatches', {'ref': branch})
        log('  公開しています…' if run else '  公開の準備を待っています…')
        sleep(10)
    raise ApiError('公開が10分で終わりませんでした。GitHub の Actions のタブで様子を見てください')


# ---------- 全体の流れ ----------
def run_all(sb, gh, name, files, log=print, sleep=time.sleep, root=ROOT):
    """全部を順に行い、公開した URL を返す"""
    login = gh.request('GET', '/user')['login']
    site = pages_url(login, name)
    log('[1/7] Supabase のプロジェクト')
    ref = project_ref(sb_project(sb, name, log))
    log('[2/7] プロジェクトの準備を待つ')
    sb_wait_active(sb, ref, log, sleep)
    log('[3/7] データの表と権限を作る（schema.sql）')
    sb_run_schema(sb, ref, (root / 'supabase' / 'schema.sql').read_text(encoding='utf-8'), sleep)
    log('[4/7] ログインの設定')
    sb_auth_config(sb, ref, site)
    anon = sb_anon_key(sb, ref)
    log('[5/7] GitHub のリポジトリ')
    repo = gh_repo(gh, login, name, log)
    full, branch = repo['full_name'], repo.get('default_branch') or 'main'
    log('[6/7] キーの登録（Variables）と GitHub Pages')
    gh_variable(gh, full, 'SUPABASE_URL', f'https://{ref}.supabase.co')
    gh_variable(gh, full, 'SUPABASE_ANON_KEY', anon)
    gh_pages(gh, full)
    log('[7/7] ファイルを入れて公開する（数分かかります）')
    since = utc_now(-60)  # 時計のずれを見込んで、1分前から
    sha, changed = gh_push(gh, full, branch, root, files, sleep, log)
    if not changed:
        gh.request('POST', f'/repos/{full}/actions/workflows/{WORKFLOW_FILE}/dispatches', {'ref': branch})
    gh_wait_deploy(gh, full, branch, sha, since, log, sleep)
    return site


def explain(name, files):
    print('かいものメモ：Supabase と GitHub の準備・公開を、自動で行います\n')
    print('作る物')
    print(f'  ・Supabase：プロジェクト「{name}」（東京・無料プラン）、データの表と権限、ログインの設定')
    print(f'  ・GitHub：公開のリポジトリ「{name}」と GitHub Pages（だれでも見られるホームページ）')
    print('送る物')
    print('  ・Supabase へ：supabase\\schema.sql の中身、ログインの設定')
    print(f'  ・GitHub へ：アプリのファイル {len(files)} 個（config.js・テストの結果・控え・作業の記録は送りません）')
    print('              Supabase の URL と anon キー（公開してよい鍵）')
    print('合い鍵とデータベースのパスワードは、画面にもファイルにも出しません。\n')


def ask_token(label, page):
    print(f'\n{label}を貼り付けて Enter を押してください（貼り付けても画面には表示されません）')
    print(f'  合い鍵を作る画面：{page}')
    for _ in range(3):
        token = getpass.getpass('  > ').strip()
        if token:
            return token
        print('  空でした。もう一度どうぞ')
    raise SystemExit('合い鍵が入力されなかったので、やめました')


def finish(site):
    print(f'\n完了しました 🎉\n\nスマホで開く URL：{site}')
    print('  ・このパソコンのブラウザでも開きます。Edge なら、アドレスバーを押すと出る「QR コード」のボタンで、')
    print('    スマホのカメラから開けます（自分あてのメールや LINE で URL を送ってもよい）')
    print('  ・スマホで開いたら「新規登録」→ 届いたメールのリンク → ログイン → ホーム画面に追加（SETUP.md の手順6）')
    print('\n後かたづけ（大事）：合い鍵は、もう要らないので消してください')
    print(f'  ・Supabase：{SUPABASE_TOKEN_PAGE}')
    print('  ・GitHub：https://github.com/settings/tokens')
    webbrowser.open(site)


def main(argv):
    ap = argparse.ArgumentParser(description='かいものメモを Supabase と GitHub Pages に準備・公開する')
    ap.add_argument('--dry-run', action='store_true', help='送るファイルの一覧を出すだけ（どこにもつながない）')
    ap.add_argument('--name', default='kaimono-memo', help='プロジェクトとリポジトリの名前')
    args = ap.parse_args(argv)
    files = select_files()
    if args.dry_run:
        print('\n'.join(files) + f'\n\n送るファイル：{len(files)} 個（どこにもつないでいません）')
        return 0
    explain(args.name, files)
    if input('続けますか？（y＝はい／n＝やめる）：').strip().lower() not in ('y', 'yes', 'はい'):
        print('やめました（何も送っていません）')
        return 0
    sb = Api(SUPABASE_API, ask_token('Supabase の合い鍵', SUPABASE_TOKEN_PAGE))
    gh = Api(GITHUB_API, ask_token('GitHub の合い鍵', GITHUB_TOKEN_PAGE), GITHUB_HEADERS)
    print()
    try:
        finish(run_all(sb, gh, args.name, files))
    except ApiError as e:
        print(f'\n止まりました：{e}')
        print('直してから、もう一度実行すれば、続きから進みます（作った物は使い回します）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
