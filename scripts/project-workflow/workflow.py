#!/usr/bin/env python3
"""Project documentation automation. Standard library only; never stages or commits."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager


def git(root, *args, data=None):
    return subprocess.check_output(['git', '-C', str(root), *args], input=data)


def repo(cwd=None):
    return Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=cwd).decode().strip())


def state_dir(root):
    path = Path(git(root, 'rev-parse', '--git-path', 'project-workflow').decode().strip())
    if not path.is_absolute():
        path = root / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def index_entries(root):
    entries = {}
    for row in git(root, 'ls-files', '--stage', '-z').split(b'\0'):
        if not row:
            continue
        meta, path = row.split(b'\t', 1)
        mode, oid, stage = meta.decode().split()
        if stage != '0':
            raise ValueError('暂存区存在未解决冲突')
        entries[path.decode()] = [mode, oid]
    return entries


def policy_files(root):
    scopes = ['scripts/project-workflow', '.agents/skills', '.githooks', '.codex/config.toml', '.codex/hooks.json']
    files = set()
    for scope in scopes:
        path = root / scope
        files.update(path.rglob('*') if path.is_dir() else [path])
    files.update(root / name.decode() for name in git(root, 'ls-files', '-z', '--', *scopes).split(b'\0') if name)
    return sorted(p for p in files if '__pycache__' not in p.parts and not p.is_dir())


def policy_key(root):
    return digest([(str(p.relative_to(root)), hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else 'missing')
                   for p in policy_files(root)])


def head(root):
    try:
        return git(root, 'rev-parse', '--verify', 'HEAD').decode().strip()
    except subprocess.CalledProcessError:
        return 'unborn'


def token(root, entries):
    return digest([head(root), policy_key(root), entries])


def snapshot(root, entries, dest):
    for name, (mode, oid) in entries.items():
        if mode not in ('100644', '100755'):
            continue  # Do not follow symlinks or initialize submodules.
        path = dest / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(git(root, 'cat-file', 'blob', oid))


def metadata(path):
    return parse_metadata(path.read_text())


def parse_metadata(text):
    if not text.startswith('---\n'):
        return None, text
    end = text.find('\n---', 4)
    if end < 0:
        raise ValueError('frontmatter 未闭合')
    # JSON is a YAML subset: no optional parser dependency in hooks.
    data = json.loads(text[4:end])
    return data, text[end + 4:].lstrip('\n')


def specs(root):
    found = {}
    for p in sorted((root / 'docs/specs').rglob('*.md')):
        if any(part in ('history', 'evidence', 'reviews') for part in p.parts):
            continue
        meta, body = metadata(p)
        if meta is None:
            continue  # Legacy documents may migrate incrementally.
        ident = meta.get('id')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Z][A-Z0-9]*-\d+', ident):
            raise ValueError(f'{p}: invalid spec id')
        if ident in found:
            raise ValueError(f'duplicate spec id: {ident}')
        if meta.get('kind') not in ('feature', 'patch', 'sunset'):
            raise ValueError(f'{ident}: invalid kind')
        if meta.get('maturity') not in ('experimental', 'stable'):
            raise ValueError(f'{ident}: invalid maturity')
        if meta.get('status') not in ('draft', 'accepted', 'implementing', 'implemented', 'effective', 'abandoned'):
            raise ValueError(f'{ident}: invalid status')
        if meta.get('lifecycle') not in ('planned', 'active', 'deprecated', 'retired'):
            raise ValueError(f'{ident}: invalid lifecycle')
        if not isinstance(meta.get('title'), str) or not meta['title'].strip():
            raise ValueError(f'{ident}: title required')
        if not isinstance(meta.get('affects'), list) or not isinstance(meta.get('changes'), list):
            raise ValueError(f'{ident}: affects/changes must be arrays')
        if meta['kind'] in ('patch', 'sunset') and not meta['affects']:
            raise ValueError(f'{ident}: patch/sunset needs affects')
        if meta['status'] == 'effective':
            eff = meta.get('effective')
            if not isinstance(eff, dict) or not all(eff.get(k) for k in ('version', 'date', 'evidence')):
                raise ValueError(f'{ident}: effective requires version/date/evidence')
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', eff['date']):
                raise ValueError(f'{ident}: invalid effective date')
            evidence = (root / eff['evidence']).resolve()
            if not evidence.is_relative_to(root.resolve()) or not evidence.is_file():
                raise ValueError(f'{ident}: missing local release evidence')
        found[ident] = (p, meta, body)
    return found


def spec_map(root, found):
    lines = ['# 规格状态地图', '', '由 `workflow.py specs-sync` 生成。status 表示变更阶段，lifecycle 表示能力状态；没有发布证据不能从 accepted 推断已上线。', '',
             '| ID | 规格 | 类型 | 成熟度 | 阶段 | 能力状态 | 影响 | 后续变更 |', '|---|---|---|---|---|---|---|---|']
    for ident, (path, meta, _) in sorted(found.items()):
        target = path.relative_to(root / 'docs/specs').as_posix()
        lines.append(f"| {ident} | [{meta['title']}]({target}) | {meta['kind']} | {meta['maturity']} | {meta['status']} | {meta['lifecycle']} | {', '.join(a['id'] for a in meta['affects']) or '—'} | {', '.join(meta['changes']) or '—'} |")
    return '\n'.join(lines) + '\n'


def check_specs(root, sync=False):
    found = specs(root)
    expected = {ident: [] for ident in found}
    for ident, (_, meta, _) in found.items():
        for rel in meta['affects']:
            target = rel.get('id') if isinstance(rel, dict) else None
            if target not in found or target == ident:
                raise ValueError(f'{ident}: invalid affects target {target}')
            if not isinstance(rel.get('sections'), list) or not rel['sections'] or not all(isinstance(x, str) and x for x in rel['sections']):
                raise ValueError(f'{ident}: affects needs section IDs')
            expected[target].append(ident)
    for ident, (path, meta, body) in found.items():
        backlinks = sorted(set(expected[ident]))
        if meta['changes'] != backlinks:
            if not sync:
                raise ValueError(f'{ident}: changes 回指不一致；运行 specs-sync')
            meta['changes'] = backlinks
            path.write_text('---\n' + json.dumps(meta, ensure_ascii=False, indent=2) + '\n---\n\n' + body)
    target = root / 'docs/specs/MAP.md'
    content = spec_map(root, found)
    if sync:
        target.write_text(content)
    elif found and (not target.exists() or target.read_text() != content):
        raise ValueError('规格地图过期；运行 specs-sync')


def check_docs(root):
    errors = []
    files = list((root / 'docs').rglob('*.md')) + [root / 'README.md', root / 'AGENTS.md']
    for path in files:
        if not path.exists():
            continue
        text = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
        for link in re.findall(r'\]\(([^)]+)\)', text):
            if re.match(r'[a-zA-Z][\w+.-]*:', link) or link.startswith('/'):
                continue  # External / machine-local source citations aren't portable checks.
            dest, _, anchor = link.partition('#')
            dest = re.sub(r':\d+$', '', dest)
            target = (path.parent / dest).resolve() if dest else path
            if 'node_modules' in target.parts:
                continue  # Historical dependency-source citations aren't in staged snapshots.
            if not target.is_relative_to(root.resolve()) or not target.exists():
                errors.append(f'{path.relative_to(root)}: broken link {link}')
            elif anchor and target.suffix == '.md':
                headings = re.findall(r'^#+\s+(.+)$', target.read_text(), re.M)
                slugs = [re.sub(r'[^\w\-\s]', '', re.sub(r'[`*_]', '', h).lower()).replace(' ', '-') for h in headings]
                if anchor not in slugs:
                    errors.append(f'{path.relative_to(root)}: missing anchor {link}')
    if errors:
        raise ValueError('\n'.join(errors[:20]))
    check_specs(root)


def allowed_doc(name):
    p = PurePosixPath(name)
    return (not p.is_absolute() and '..' not in p.parts and '\\' not in name
            and p.suffix == '.md' and not set(p.parts).intersection({'history', 'evidence', 'archive'})
            and (name in ('README.md', 'docs/README.md') or any(name.startswith(x) for x in ('docs/specs/', 'docs/changelog/', 'docs/architecture/'))))


def review(root, snap, diff, output, *, spec_mode=False):
    skill = 'project-spec-review' if spec_mode else 'project-change-sync'
    policy = (snap / '.agents/skills' / skill / 'SKILL.md').read_text()
    prompt = ('执行 ' + skill + ' 的 pre-commit 只读建议模式。工作目录是暂存树快照，不是用户工作区。'
              '只读文件，不执行仓库脚本或任何 git/网络/子 codex/测试操作。返回 schema 指定 JSON。'
              '每个 edit.content 是完整 UTF-8 新正文；没有必要的改动返回空数组。checks 必须分别解释 spec/changelog/architecture/map 的判断。'
              '不整理 Runbook/Wiki，不编造发布或验证结果。重大不确定项放 blockers。\n\n' + policy + '\n\n暂存差异：\n' + diff)
    if spec_mode:
        prompt = ('执行 project-spec-review。只读暂存快照和 diff，按 schema 核对要求与代码；'
                  '不运行任何仓库脚本、git、测试、网络或子 codex。不要修改要求掩盖差异。'
                  'stage 依据本次交付声明；不明范围须明确 blocker。\n' + policy + '\n暂存差异：\n' + diff)
    schema = snap / 'scripts/project-workflow' / ('spec-review.schema.json' if spec_mode else 'review.schema.json')
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env['PROJECT_CHANGE_SYNC_CHILD'] = '1'
    cmd = ['codex', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
           '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'features.hooks=false',
           '-C', str(snap), '--output-schema', str(schema), '-o', str(output), '-']
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, env=env, start_new_session=True)
    try:
        _, err = proc.communicate(prompt, timeout=180)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
        raise ValueError('codex exec 超时（180 秒）；本次未修改或暂存文件')
    if proc.returncode:
        # Do not expose raw auth/tool output in Git's error message.
        raise ValueError(f'codex exec 失败（{proc.returncode}），请检查 Codex 登录/服务状态；未自动放行')
    return read_json(output)


def spec_review(root, snap, diff, output):
    return review(root, snap, diff, output, spec_mode=True)


def audit_edits(root, snap, audit, stamp, entries):
    """Validate the assessment and render reports ourselves, including failure evidence."""
    if (not isinstance(audit, dict) or audit.get('stage') not in ('incremental', 'completion', 'not_applicable')
            or not isinstance(audit.get('scope_reason'), str) or not audit['scope_reason'].strip()
            or not isinstance(audit.get('specs'), list) or not isinstance(audit.get('blockers'), list)):
        raise ValueError('无效的规格核对结果')
    blockers = list(audit['blockers'])
    if audit['stage'] != 'not_applicable' and not audit['specs']:
        raise ValueError('规格核对没有覆盖任何条款')
    if audit['stage'] == 'not_applicable' and audit['specs']:
        raise ValueError('not_applicable 不能包含规格核对结果')
    edits = []
    seen = set()
    summary = ['# 规格与实现核对', '', f"代码基线：{head(root)}", f'暂存及规则指纹：{stamp}',
               f"阶段：{audit['stage']}", '', audit['scope_reason'], '']
    for item in audit['specs']:
        name = item.get('path')
        if (not isinstance(name, str) or name in seen or not allowed_doc(name)
                or not name.startswith('docs/specs/') or PurePosixPath(name).name not in ('spec.md', 'requirements.md')
                or name not in entries or not (snap / name).is_file()):
            raise ValueError('规格核对引用了不存在或重复的规格')
        seen.add(name)
        findings = item.get('findings')
        if not isinstance(item.get('implementation_ready'), bool):
            raise ValueError('规格核对缺少 implementation_ready 判断')
        if not isinstance(findings, list) or not findings:
            raise ValueError('规格核对缺少条款')
        text = (snap / name).read_text()
        lines = summary + [f'规格：{name}', f'规格 SHA256：{hashlib.sha256(text.encode()).hexdigest()}',
                           f"实现就绪：{item['implementation_ready']}", '',
                           '| 条款 | 结论 | 代码依据 | 验证依据 | 原因及处置 |', '|---|---|---|---|---|']
        for finding in findings:
            if not isinstance(finding, dict) or not all(isinstance(finding.get(k), str) and finding[k].strip()
                                                      for k in ('requirement', 'status', 'code', 'verification', 'verification_scope', 'reason')):
                raise ValueError('条款核对字段不完整')
            if finding['verification_scope'] not in ('local', 'external'):
                raise ValueError('未知验证范围')
            status = finding['status']
            if status not in ('conforms', 'missing', 'deviates', 'unverified', 'not_applicable'):
                raise ValueError('未知核对结论')
            spec_meta, _ = parse_metadata(text)
            external_pending = (finding['verification_scope'] == 'external'
                                and item['implementation_ready'] is True
                                and (spec_meta or {}).get('status') != 'effective')
            if status == 'deviates' or (audit['stage'] == 'completion' and
                    (status == 'missing' or (status == 'unverified' and not external_pending))):
                blockers.append(name + ': ' + finding['requirement'] + ' ' + status)
            def cell(value):
                return value.replace('|', '\\|').replace('\n', '<br>')
            values = [finding['requirement'], finding['status'], finding['code'],
                      finding['verification_scope'] + ': ' + finding['verification'], finding['reason']]
            lines.append('| ' + ' | '.join(cell(value) for value in values) + ' |')
        lines += ['', '这是对应暂存版本的静态核对记录；不等同运行测试或上线验收。', '']
        folder = PurePosixPath(name).parent / 'reviews'
        report = str(folder / (stamp[:16] + '.md'))
        edits.append({'path': report, 'content': '\n'.join(lines)})
        index_name = str(folder / 'README.md')
        old_index = (snap / index_name).read_text() if (snap / index_name).exists() else '# 实现核对记录\n\n历史报告只适用于其记录的版本，不是永久通过凭证。\n'
        edits.append({'path': index_name, 'content': old_index.rstrip() + f'\n\n- [{stamp[:16]}]({stamp[:16]}.md) — {audit["stage"]}\n'})
        marker = '> 实现核对：[版本化核对记录](reviews/README.md)'
        if marker not in text:
            # Keep frontmatter first; only insert a link, never rewrite requirements.
            _, body = metadata(snap / name)
            offset = len(text) - len(body)
            text = text[:offset] + marker + '\n\n' + body
            edits.append({'path': name, 'content': text})
    save(state_dir(root) / 'spec-review.json', {'token': stamp, 'audit': audit, 'blockers': blockers})
    report_text = '\n\n'.join(e['content'] for e in edits if e['path'].endswith(stamp[:16] + '.md'))
    (state_dir(root) / 'spec-review.md').write_text((report_text or '\n'.join(summary)) + '\n\n阻断项：\n' + '\n'.join(map(str, blockers)))
    return edits, blockers


def merge_sync_edits(snap, audit, proposed, generated):
    """Only an audited status promotion may change a frozen spec after review."""
    reviews = {item['path']: item for item in audit['specs']}
    generated_by_path = {edit['path']: dict(edit) for edit in generated}
    output = {}
    promoted = set()
    for edit in proposed:
        name = edit.get('path', '')
        if name in output:
            raise ValueError('重复文档修改')
        if name.startswith('docs/specs/') and PurePosixPath(name).name != 'MAP.md':
            original = snap / name
            before, body = metadata(original) if original.is_file() else (None, '')
            try:
                after, new_body = parse_metadata(edit.get('content', ''))
            except (ValueError, TypeError):
                after, new_body = None, ''
            item = reviews.get(name, {})
            findings = item.get('findings', [])
            if (not before or not after or before.get('status') != 'implementing'
                    or after != {**before, 'status': 'implemented'} or body != new_body
                    or item.get('implementation_ready') is not True
                    or not any(f['status'] == 'conforms' for f in findings)
                    or any(f['status'] in ('missing', 'deviates') or
                           (f['status'] == 'unverified' and f.get('verification_scope') != 'external') for f in findings)):
                raise ValueError('文档同步越界：改写规格仅允许有核对依据的 implementing → implemented；要求正文与其他字段必须不变')
            if name in generated_by_path:
                _, linked_body = parse_metadata(generated_by_path.pop(name)['content'])
                edit = {'path': name, 'content': '---\n' + json.dumps(after, ensure_ascii=False, indent=2) + '\n---\n\n' + linked_body}
            promoted.add(name)
        output[name] = edit
    for name, edit in generated_by_path.items():
        if name in output:
            raise ValueError('不能覆盖前置核对报告')
        output[name] = edit
    if promoted:
        found = specs(snap)
        for path, meta, _ in found.values():
            if path.relative_to(snap).as_posix() in promoted:
                meta['status'] = 'implemented'
        output['docs/specs/MAP.md'] = {'path': 'docs/specs/MAP.md', 'content': spec_map(snap, found)}
    return list(output.values())


def apply_review(root, entries, result, snap, initial_token):
    if not isinstance(result, dict) or not isinstance(result.get('edits'), list) or not isinstance(result.get('blockers'), list):
        raise ValueError('无效的 Codex 输出')
    checks = result.get('checks', {})
    if set(checks) != {'spec', 'changelog', 'architecture', 'map'} or not all(isinstance(x, str) and x.strip() for x in checks.values()):
        raise ValueError('Codex 未完成四项文档检查')
    if result['blockers']:
        raise ValueError('文档同步需要处理：' + '; '.join(str(x) for x in result['blockers']))
    expected = dict(entries)
    writes = []
    seen = set()
    for edit in result['edits']:
        name, content = edit.get('path'), edit.get('content')
        if not isinstance(name, str) or not allowed_doc(name) or name in seen or not isinstance(content, str):
            raise ValueError('Codex 建议包含越界、重复或无效文件')
        seen.add(name)
        if len(content.encode()) > 1_000_000:
            raise ValueError('文档建议过大')
        if name in entries and entries[name][0] not in ('100644', '100755'):
            raise ValueError('不能改写符号链接')
        current = root / name
        if not current.resolve().is_relative_to(root.resolve()) or current.is_symlink():
            raise ValueError('目标路径越界')
        old = (snap / name).read_bytes() if name in entries else None
        live = current.read_bytes() if current.exists() else None
        if live != old:
            raise ValueError(f'{name} 有未暂存修改；请先处理，自动同步未覆盖它')
        data = content.encode()
        if data == old:
            continue
        writes.append((current, data, live))
        expected[name] = [entries.get(name, ['100644'])[0], git(root, 'hash-object', '--stdin', data=data).decode().strip()]
        target = snap / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    check_docs(snap)
    if token(root, index_entries(root)) != initial_token:
        raise ValueError('检查期间 HEAD/暂存内容/规则发生变化，请重新提交')
    # Preflight all worktree files before any mutation. No git add/commit here.
    for path, _, old in writes:
        if (path.read_bytes() if path.exists() else None) != old:
            raise ValueError('检查期间工作区变化，请重新提交')
    for path, data, _ in writes:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    save(state_dir(root) / 'review.json', {'token': token(root, expected), 'checks': checks, 'at': time.time()})
    return [str(path.relative_to(root)) for path, _, _ in writes]


@contextmanager
def lock(root):
    path = state_dir(root) / 'commit.lock'
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError('已有文档检查正在运行；异常退出后的锁请按 runbook 核对')
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)


def pre_commit(root):
    if os.environ.get('PROJECT_CHANGE_SYNC_CHILD'):
        raise ValueError('文档检查子进程禁止递归提交')
    if not git(root, 'diff', '--cached', '--name-only'):
        return
    with lock(root):
        entries = index_entries(root)
        # Installed policy is executable code: refuse unstaged versions before invoking it.
        for path in policy_files(root):
            name = path.relative_to(root).as_posix()
            if not path.exists() and name not in entries:
                continue
            if (not path.is_file() or path.is_symlink() or name not in entries
                    or path.read_bytes() != git(root, 'cat-file', 'blob', entries[name][1])):
                raise ValueError('检查规则有未暂存改动，请先核对并暂存：' + name)
        stamp = token(root, entries)
        cached = read_json(state_dir(root) / 'review.json', {})
        with tempfile.TemporaryDirectory(prefix='project-doc-review-') as folder:
            snap = Path(folder) / 'staged'
            snap.mkdir()
            snapshot(root, entries, snap)
            if cached.get('token') == stamp:
                check_docs(snap)
                print('文档同步：已检查当前暂存版本。')
                return
            diff = git(root, 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.', ':!package-lock.json').decode(errors='replace')
            if len(diff.encode()) > 1_000_000:
                raise ValueError('暂存差异超过 1 MiB，请拆分提交；未截断后放行')
            print('提交前正在用 codex exec 检查文档，最长 180 秒……', flush=True)
            audit = spec_review(root, snap, diff, Path(folder) / 'spec-result.json')
            generated, blockers = audit_edits(root, snap, audit, stamp, entries)
            if blockers:
                raise ValueError('规格核对未通过，未修改规格；报告见 ' + str(state_dir(root) / 'spec-review.md')
                                 + '\n' + '\n'.join(map(str, blockers)))
            print('规格核对完成，开始文档同步（最长 180 秒）……', flush=True)
            result = review(root, snap, diff + '\n\n前置规格核对结果（不可改写）：\n' + json.dumps(audit, ensure_ascii=False), Path(folder) / 'result.json')
            result['edits'] = merge_sync_edits(snap, audit, result.get('edits', []), generated)
            changed = apply_review(root, entries, result, snap, stamp)
            if changed:
                raise ValueError('已更新文档，未暂存；请核对并暂存后重新提交：\n' + '\n'.join(changed))
            print('文档同步检查通过。')


def fingerprint(root):
    paths = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0')
    values = []
    for raw in sorted(set(paths)):
        if not raw:
            continue
        name = raw.decode()
        if name.startswith(('docs/runbook/', 'docs/wiki/')):
            continue  # Learning edits themselves must not trigger another pass.
        p = root / name
        if p.is_symlink():
            value = os.readlink(p)
        else:
            value = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else 'missing'
        values.append([name, value])
    return digest([head(root), values])


def session_file(root, session):
    return state_dir(root) / ('learning-' + digest(session) + '.json')


def hook(payload):
    if os.environ.get('PROJECT_CHANGE_SYNC_CHILD'):
        return {}
    root = repo(payload.get('cwd'))
    session = payload.get('session_id')
    if not session:
        return {}
    path = session_file(root, session)
    data = read_json(path, {})
    event = payload.get('hook_event_name')
    if event == 'UserPromptSubmit':
        # Do not reset dedup state for a Stop-generated continuation.
        prompt = payload.get('prompt', '')
        if 'PROJECT_LEARNING_CONTINUATION' in prompt:
            return {}
        save(path, {'before': fingerprint(root), 'turn': payload.get('turn_id'),
                    'eligible': bool(re.search(r'开发|实现|修复|排查|调试|重构|debug|implement|fix', prompt, re.I))})
        return {}
    if event != 'Stop' or payload.get('stop_hook_active'):
        return {}
    now = fingerprint(root)
    if data.get('ack') == now or data.get('issued') == now:
        return {}
    if not data or (data.get('before') == now and not data.get('eligible')):
        return {}
    data['issued'] = now
    save(path, data)
    ack_command = ('python3 scripts/project-workflow/workflow.py learning-ack --session='
                   + shlex.quote(session))
    return {'decision': 'block', 'reason':
            'PROJECT_LEARNING_CONTINUATION：执行 .agents/skills/project-learning-sync/SKILL.md。'
            '只回顾本次实际开发/排障，有已证实经验才更新 Runbook/Wiki，无需强行写入。'
            '若本次用户要求只读或仍在讨论，保持只读。不要自动 commit/push。'
            '完成后运行 ' + ack_command + '；随后结束，不重复检查。'}


def learning_ack(root, session):
    if not session:
        raise ValueError('需要 CODEX_THREAD_ID 或 --session；只确认本任务')
    path = session_file(root, session)
    data = read_json(path, {})
    data['ack'] = fingerprint(root)
    save(path, data)
    print('已记录本任务的经验检查。')


def install(root):
    existing = subprocess.run(['git', '-C', str(root), 'config', '--get', 'core.hooksPath'], capture_output=True, text=True).stdout.strip()
    native = Path(git(root, 'rev-parse', '--git-path', 'hooks/pre-commit').decode().strip())
    if not native.is_absolute():
        native = root / native
    if existing and existing != '.githooks':
        raise ValueError(f'已配置 hooksPath={existing}，不覆盖；先合并既有 Hook')
    if not existing and native.exists():
        raise ValueError('已有原生 pre-commit，不覆盖；先合并既有 Hook')
    git(root, 'config', '--local', 'core.hooksPath', '.githooks')
    (root / '.githooks/pre-commit').chmod(0o755)
    print('Git pre-commit 已安装。Codex 项目 Hook 首次使用需在 /hooks 信任，未绕过信任检查。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['check', 'specs-sync', 'pre-commit', 'hook', 'learning-ack', 'install'])
    parser.add_argument('--session', default=os.environ.get('CODEX_THREAD_ID'))
    args = parser.parse_args()
    try:
        if args.command == 'hook':
            print(json.dumps(hook(json.load(sys.stdin)), ensure_ascii=False))
            return
        root = repo()
        if args.command == 'check':
            check_docs(root)
            print('文档链接、规格元信息、双向指针和地图检查通过。')
        elif args.command == 'specs-sync':
            check_specs(root, sync=True)
        elif args.command == 'pre-commit':
            pre_commit(root)
        elif args.command == 'learning-ack':
            learning_ack(root, args.session)
        else:
            install(root)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        if args.command == 'hook':
            print(json.dumps({'systemMessage': '项目经验 Hook 未完成：' + str(error)}, ensure_ascii=False))
        else:
            print(str(error), file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
