"""
tools\\setup_cloud.py のテスト（にせの Supabase・GitHub の窓口を使う。どこにもつながない。架空のデータだけ）

使い方（c:\\AI_work で）:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe" -I -B -X utf8 -m unittest discover -s 買い物リスト\\tests -p "test_*.py" -v
  （tests\\run_tests.py からも一緒に動く）
"""
import base64
import hashlib
import io
import json
import re
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import setup_cloud as sc  # noqa: E402  （tools のスクリプトを読み込む）

SB_TOKEN = 'sbp_test_token_must_not_leak'
GH_TOKEN = 'ghp_test_token_must_not_leak'
REF = 'abcdefghijklmnop'


class FakeCloud:
    """Supabase の管理の窓口と GitHub の窓口のにせもの（メモリの中だけ）"""

    def __init__(self):
        self.projects, self.sql, self.auth, self.created_body = {}, [], None, None
        self.repos, self.variables, self.pages = {}, {}, None
        self.trees, self.commits, self.head = {}, {'c0': {'tree': 't0', 'parents': []}}, 'c0'
        self.runs, self.calls, self.fail = [], [], {}
        self.status_seq = ['COMING_UP', 'ACTIVE_HEALTHY']
        self.var_patches = self.pages_sets = self.dispatches = 0
        self.run_conclusion = 'success'

    def transport(self, method, url, headers, body):
        assert headers['Authorization'].startswith('Bearer ')
        path = url.replace(sc.SUPABASE_API, '').replace(sc.GITHUB_API, '')
        self.calls.append((method, path))
        # 合い鍵がちがえば、本物と同じように 401 を返す
        is_sb = url.startswith(sc.SUPABASE_API)
        if headers['Authorization'] != f'Bearer {SB_TOKEN if is_sb else GH_TOKEN}':
            return 401, {'message': 'JWT could not be decoded' if is_sb else 'Bad credentials'}
        for (m, pat), res in self.fail.items():
            if m == method and re.search(pat, path):
                return res
        for m, pat, fn in self.routes():
            match = re.fullmatch(pat, path.split('?')[0])
            if m == method and match:
                return fn(body, *match.groups())
        return 404, {'message': 'Not Found'}

    def routes(self):
        keys = [{'name': 'service_role', 'api_key': 'SERVICE-ROLE-NEVER-USE'}, {'name': 'anon', 'api_key': 'anon-key-for-test'}]
        return [
            ('GET', r'/v1/projects', lambda b: (200, list(self.projects.values()))),
            ('GET', r'/v1/organizations', lambda b: (200, [{'id': 'org-1', 'name': 'テスト'}])),
            ('POST', r'/v1/projects', self.create_project),
            ('GET', r'/v1/projects/([^/]+)', self.get_project),
            ('POST', r'/v1/projects/([^/]+)/database/query', self.query),
            ('GET', r'/v1/projects/([^/]+)/api-keys', lambda b, ref: (200, keys)),
            ('PATCH', r'/v1/projects/([^/]+)/config/auth', self.set_auth),
            ('GET', r'/user', lambda b: (200, {'login': 'TestUser'})),
            ('GET', r'/repos/([^/]+)/([^/]+)', self.get_repo),
            ('POST', r'/user/repos', self.create_repo),
            ('GET', r'/repos/[^/]+/[^/]+/actions/variables/([^/]+)', self.get_var),
            ('POST', r'/repos/[^/]+/[^/]+/actions/variables', self.post_var),
            ('PATCH', r'/repos/[^/]+/[^/]+/actions/variables/([^/]+)', self.patch_var),
            ('GET', r'/repos/[^/]+/[^/]+/pages', lambda b: (200, self.pages) if self.pages else (404, {})),
            ('POST', r'/repos/[^/]+/[^/]+/pages', self.set_pages),
            ('PUT', r'/repos/[^/]+/[^/]+/pages', self.set_pages),
            ('GET', r'/repos/[^/]+/[^/]+/git/ref/heads/([^/]+)', lambda b, br: (200, {'object': {'sha': self.head}})),
            ('POST', r'/repos/[^/]+/[^/]+/git/blobs', self.blob),
            ('POST', r'/repos/[^/]+/[^/]+/git/trees', self.tree),
            ('GET', r'/repos/[^/]+/[^/]+/git/commits/([^/]+)', lambda b, sha: (200, {'tree': {'sha': self.commits[sha]['tree']}})),
            ('POST', r'/repos/[^/]+/[^/]+/git/commits', self.commit),
            ('PATCH', r'/repos/[^/]+/[^/]+/git/refs/heads/([^/]+)', self.move_ref),
            ('GET', r'/repos/[^/]+/[^/]+/actions/runs', lambda b: (200, {'workflow_runs': list(reversed(self.runs))})),
            ('POST', r'/repos/[^/]+/[^/]+/actions/workflows/([^/]+)/dispatches', self.dispatch),
        ]

    def create_project(self, body):
        self.created_body = body
        self.projects[REF] = {'id': REF, 'name': body['name'], 'region': body['region'], 'status': 'COMING_UP'}
        return 201, self.projects[REF]

    def get_project(self, body, ref):
        p = self.projects[ref]
        if self.status_seq:
            p['status'] = self.status_seq.pop(0)
        return 200, p

    def query(self, body, ref):
        self.sql.append(body['query'])
        return 201, []

    def set_auth(self, body, ref):
        self.auth = body
        return 200, body

    def get_repo(self, body, owner, name):
        r = self.repos.get(f'{owner}/{name}')
        return (200, r) if r else (404, {'message': 'Not Found'})

    def create_repo(self, body):
        full = f"TestUser/{body['name']}"
        self.repos[full] = {'full_name': full, 'default_branch': 'main', 'private': body['private']}
        return 201, self.repos[full]

    def get_var(self, body, name):
        return (200, {'name': name, 'value': self.variables[name]}) if name in self.variables else (404, {})

    def post_var(self, body):
        self.variables[body['name']] = body['value']
        return 201, {}

    def patch_var(self, body, name):
        self.variables[name] = body['value']
        self.var_patches += 1
        return 204, None

    def set_pages(self, body):
        self.pages = {'build_type': body['build_type']}
        self.pages_sets += 1
        return 201, self.pages

    def blob(self, body):
        return 201, {'sha': hashlib.sha1(base64.b64decode(body['content'])).hexdigest()}

    def tree(self, body):
        sha = 't-' + hashlib.sha1(json.dumps(body['tree'], sort_keys=True).encode()).hexdigest()
        self.trees[sha] = body['tree']
        return 201, {'sha': sha}

    def commit(self, body):
        sha = f'c{len(self.commits)}'
        self.commits[sha] = {'tree': body['tree'], 'parents': body['parents']}
        return 201, {'sha': sha}

    def move_ref(self, body, branch):
        self.head = body['sha']
        self.add_run()
        return 200, {}

    def dispatch(self, body, workflow):
        self.dispatches += 1
        self.add_run()
        return 204, None

    def add_run(self):
        self.runs.append({'head_sha': self.head, 'status': 'completed', 'conclusion': self.run_conclusion,
                          'created_at': sc.utc_now(), 'html_url': 'https://example.invalid/run'})


class SetupCloudTest(unittest.TestCase):
    def setUp(self):
        self.cloud = FakeCloud()
        self.sb = sc.Api(sc.SUPABASE_API, SB_TOKEN, transport=self.cloud.transport)
        self.gh = sc.Api(sc.GITHUB_API, GH_TOKEN, sc.GITHUB_HEADERS, transport=self.cloud.transport)
        self.files = sc.select_files()

    def run_setup(self):
        return sc.run_all(self.sb, self.gh, 'kaimono-memo', self.files, log=lambda *a: None, sleep=lambda s: None)

    def test_select_files(self):
        """送るファイル：アプリ一式は入り、config.js・控え・テストの結果・作業の記録は入らない"""
        f = set(self.files)
        for must in ['index.html', 'sw.js', 'js/app.js', 'supabase/schema.sql', '.github/workflows/deploy-pages.yml', 'icons/icon-512.png']:
            self.assertIn(must, f)
        self.assertNotIn('config.js', f)
        bad = [x for x in f if '_旧' in x or x.endswith('.bak') or x.startswith('tests/_output/') or x == '作業状況_買い物リスト.md']
        self.assertEqual(bad, [])

    def test_full_run(self):
        """はじめての実行：プロジェクト・SQL・ログインの設定・リポジトリ・キー・Pages・ファイル・公開がそろう"""
        site = self.run_setup()
        c = self.cloud
        self.assertEqual(site, 'https://testuser.github.io/kaimono-memo/')
        self.assertEqual(c.created_body['region'], 'ap-northeast-1')
        self.assertGreaterEqual(len(c.created_body['db_pass']), 20)
        self.assertEqual(c.sql, [(ROOT / 'supabase' / 'schema.sql').read_text(encoding='utf-8')])
        self.assertEqual(c.auth['site_url'], site)
        self.assertIn(site, c.auth['uri_allow_list'])
        self.assertFalse(c.auth['mailer_autoconfirm'], 'メールアドレスの確認はオンのまま')
        self.assertEqual(c.variables, {'SUPABASE_URL': f'https://{REF}.supabase.co', 'SUPABASE_ANON_KEY': 'anon-key-for-test'})
        self.assertEqual(c.pages, {'build_type': 'workflow'})
        self.assertFalse(c.repos['TestUser/kaimono-memo']['private'])
        self.assertEqual([e['path'] for e in c.trees[c.commits[c.head]['tree']]], self.files)
        self.assertEqual(c.commits[c.head]['parents'], ['c0'])

    def test_second_run_reuses(self):
        """2回目の実行：作ってある物を使い回し、ファイルが同じなら公開だけやり直す"""
        self.run_setup()
        site = self.run_setup()
        creates = [x for x in self.cloud.calls if x[0] == 'POST' and x[1] in ('/v1/projects', '/user/repos')]
        self.assertEqual(len(creates), 2, '作るのは1回目だけ')
        self.assertEqual(self.cloud.var_patches, 2)
        self.assertEqual(self.cloud.pages_sets, 1)
        self.assertEqual(self.cloud.dispatches, 1)
        self.assertEqual(site, 'https://testuser.github.io/kaimono-memo/')

    def test_error_does_not_show_token(self):
        """エラーの文に、合い鍵が出ない"""
        self.cloud.fail[('GET', r'^/user$')] = (401, {'message': 'Bad credentials'})
        with self.assertRaises(sc.ApiError) as cm:
            self.run_setup()
        msg = str(cm.exception)
        self.assertIn('Bad credentials', msg)
        self.assertNotIn(GH_TOKEN, msg)
        self.assertNotIn(SB_TOKEN, msg)

    def test_sql_error_stops(self):
        """SQL のエラーでは、やり直さずに止まり、GitHub には進まない"""
        self.cloud.fail[('POST', r'/database/query$')] = (400, {'message': 'syntax error at or near'})
        with self.assertRaises(sc.ApiError) as cm:
            self.run_setup()
        self.assertIn('syntax error', str(cm.exception))
        self.assertEqual(len([x for x in self.cloud.calls if x[1].endswith('/database/query')]), 1)
        self.assertEqual(self.cloud.repos, {})

    def test_paused_project(self):
        """一時停止中のプロジェクトは、Restore するよう知らせる"""
        self.cloud.projects['p1'] = {'id': 'p1', 'name': 'kaimono-memo', 'status': 'INACTIVE'}
        self.cloud.status_seq = []
        with self.assertRaises(sc.ApiError) as cm:
            self.run_setup()
        self.assertIn('Restore', str(cm.exception))

    def test_failed_deploy_is_reported(self):
        """公開（GitHub Actions）が失敗したら、見る場所を知らせる"""
        self.cloud.run_conclusion = 'failure'
        with self.assertRaises(sc.ApiError) as cm:
            self.run_setup()
        self.assertIn('公開に失敗', str(cm.exception))

    def ask(self, spec, inputs):
        """合い鍵の入力を、決まった文字の順でまねる（画面に出た文は self.logs に入る）"""
        it = iter(inputs)
        self.logs = []
        return sc.ask_api(spec, read=lambda prompt: next(it), log=self.logs.append, transport=self.cloud.transport)

    def test_token_retry(self):
        """合い鍵の入れまちがい（空・もう一方の合い鍵・2回貼り）でやめずに入れ直せ、見えない文字と空白は取り除く"""
        api = self.ask(sc.SB_TOKEN_SPEC, ['', GH_TOKEN, SB_TOKEN + SB_TOKEN, '\x16' + SB_TOKEN + ' \r'])
        self.assertEqual(api.request('GET', '/v1/projects'), [])
        text = '\n'.join(self.logs)
        for must in ['空でした', 'もう一方のサービス', '2回貼り付けた', '通りました']:
            self.assertIn(must, text)
        self.assertNotIn(SB_TOKEN, text)
        self.assertNotIn(GH_TOKEN, text)
        self.assertEqual({m for m, _ in self.cloud.calls}, {'GET'}, '確かめは読むだけ')

    def test_token_hints(self):
        """通らなかった理由の案内：始まりがちがう／始まりは合っている（消された・期限切れ）"""
        with self.assertRaises(SystemExit) as cm:
            self.ask(sc.GH_TOKEN_SPEC, ['abc', 'ghp_wrong', 'xghp_test', '', ' '])
        self.assertIn('何も作っていません', str(cm.exception))
        text = '\n'.join(self.logs)
        self.assertIn('ghp_・github_pat_ で始まっていません', text)
        self.assertIn('期限が切れている', text)
        self.assertNotIn('ghp_wrong', text)
        self.assertEqual(len(self.cloud.calls), 3)

    def test_token_other_error_stops(self):
        """401・403 以外のエラー（サービスの不調など）は入れ直しを求めず、そのまま止まる"""
        self.cloud.fail[('GET', r'^/user$')] = (500, {'message': 'Server Error'})
        with self.assertRaises(sc.ApiError) as cm:
            self.ask(sc.GH_TOKEN_SPEC, [GH_TOKEN])
        self.assertIn('500', str(cm.exception))

    def test_token_fullwidth_and_403(self):
        """全角の文字が入っても止まらずに入れ直せる。GitHub の 403（続けてまちがえた）でも入れ直せる"""
        self.cloud.fail[('GET', r'^/user$')] = (403, {'message': 'Maximum number of login attempts exceeded'})
        with self.assertRaises(SystemExit):
            self.ask(sc.GH_TOKEN_SPEC, ['ghp_あいう', GH_TOKEN, '', '', ''])
        text = '\n'.join(self.logs)
        self.assertIn('全角の文字', text)
        self.assertIn('数分待って', text)
        self.assertEqual(len(self.cloud.calls), 1, '全角の合い鍵は送らない')

    def test_main_token_check_error(self):
        """合い鍵を確かめる途中のエラーでは「まだ何も作っていません」と出し、作る処理には進まない"""
        out = io.StringIO()
        boom = mock.Mock(side_effect=sc.ApiError('GET /user：500 Server Error', 500))
        with mock.patch('builtins.input', return_value='y'), mock.patch.object(sc, 'ask_api', boom), \
                mock.patch.object(sc, 'run_all') as run_all, redirect_stdout(out):
            self.assertEqual(sc.main([]), 1)
        self.assertIn('まだ何も作っていません', out.getvalue())
        run_all.assert_not_called()


if __name__ == '__main__':
    unittest.main()
