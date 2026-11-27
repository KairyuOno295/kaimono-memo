"""
JS の関数の長さ・ネスト（入れ子）の深さを数える（CLAUDE.md「コードの書き方」の確認用。ファイルは読むだけ）

使い方（c:\\AI_work\\買い物リスト で実行）:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe" -I -B -X utf8 tests\\check_style.py
入力: js\\ の下の .js と sw.js
出力: 画面に、50行を超える関数・ネストが3段を超える関数の一覧（なければ「問題なし」）。終了コード 0＝問題なし／1＝あり

数え方（目安。文法を完全には解析しない）:
  - 関数の始まり：「function 名前(」、class のメソッド「名前(…) {」、「const 名前 = (…) => {」の行
  - 行数：コメントだけの行・空行を除いて数える（中に書いたコールバック関数の行も含む）
  - ネスト：if・for・while・try・switch・do・else・catch・finally の { の重なり
    （{ のない1行の if は数えない。else if は同じ段とみなす）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_LINES = 50
MAX_NEST = 3
START_RE = re.compile(
    r'^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\('
    r'|^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^;]*\)\s*\{\s*$'
    r'|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{\s*$'
)
NOT_FUNC = {'if', 'for', 'while', 'switch', 'catch', 'return', 'function'}
CONTROL_RE = re.compile(r'\b(if|for|while|switch|do|else|try|catch|finally)\b')
STRING_RE = re.compile(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"")


def clean(line):
    """文字列とコメントを取り除いて、{ } を数えやすくする"""
    s = STRING_RE.sub("''", line)
    return re.sub(r'//.*$', '', s)


def is_code(line):
    s = line.strip()
    return bool(s) and not s.startswith(('//', '/*', '*'))


def measure(lines, start):
    """start 行目から始まる関数の、行数と最大のネストを返す"""
    depth, stack, count, nest = 0, [], 0, 0
    for i in range(start, len(lines)):
        code = clean(lines[i])
        if is_code(lines[i]):
            count += 1
        before = ''
        for ch in code:
            if ch == '{':
                depth += 1
                is_ctrl = depth > 1 and bool(CONTROL_RE.search(before))
                stack.append(is_ctrl)
                nest = max(nest, sum(stack))
                before = ''
            elif ch == '}':
                depth -= 1
                if stack:
                    stack.pop()
                before = ''
                if depth == 0:
                    return count, nest
            else:
                before += ch
    return count, nest


def check_file(path):
    lines = path.read_text(encoding='utf-8').splitlines()
    found = []
    for i, line in enumerate(lines):
        m = START_RE.match(clean(line))
        if not m:
            continue
        name = next(g for g in m.groups() if g)
        if name in NOT_FUNC:
            continue
        count, nest = measure(lines, i)
        if count > MAX_LINES or nest > MAX_NEST:
            found.append(f'{path.relative_to(ROOT)}:{i + 1} {name}：{count}行・ネスト{nest}段')
    return found


def main():
    files = sorted(p for p in (ROOT / 'js').rglob('*.js') if '_旧' not in p.name) + [ROOT / 'sw.js']  # 控えは数えない
    found = [f for p in files for f in check_file(p)]
    print(f'対象：{len(files)} ファイル（関数 {MAX_LINES} 行以内・ネスト {MAX_NEST} 段まで）')
    print('\n'.join(found) if found else '問題なし')
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
