"""Run with python3 -m unittest discover -s test/project-workflow -v."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / 'scripts/project-workflow/workflow.py'
spec = importlib.util.spec_from_file_location('workflow', SOURCE)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
        self.write('src/a.txt', 'before\n')
        self.write('docs/README.md', '# Docs\n')
        self.write('.agents/skills/project-change-sync/SKILL.md', '# test policy\n')
        self.write('scripts/project-workflow/workflow.py', '# policy\n')
        self.git('add', '.')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'baseline')
        self.audit_patch = patch.object(w, 'spec_review', return_value={
            'stage': 'not_applicable', 'scope_reason': 'fixture-only change', 'specs': [], 'blockers': []})
        self.audit_mock = self.audit_patch.start()

    def tearDown(self):
        self.audit_patch.stop()
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def result(self, edits=None):
        return {'checks': {k: 'checked' for k in ['spec', 'changelog', 'architecture', 'map']},
                'edits': edits or [], 'blockers': []}

    def stage_change(self):
        self.write('src/a.txt', 'after\n')
        self.git('add', 'src/a.txt')

    def test_snapshot_uses_index_not_worktree(self):
        self.stage_change()
        self.write('src/a.txt', 'unrelated unstaged\n')
        snap = self.root / 'snapshot'
        w.snapshot(self.root, w.index_entries(self.root), snap)
        self.assertEqual((snap / 'src/a.txt').read_text(), 'after\n')

    def test_doc_update_stops_without_staging_then_cached_retry(self):
        self.stage_change()
        before = self.git('ls-files', '--stage')
        result = self.result([{'path': 'docs/README.md', 'content': '# Docs\nUpdated\n'}])
        with patch.object(w, 'review', return_value=result) as review:
            with self.assertRaisesRegex(ValueError, '已更新文档'):
                w.pre_commit(self.root)
            self.assertEqual(before, self.git('ls-files', '--stage'))
            self.git('add', 'docs/README.md')
            w.pre_commit(self.root)
            self.assertEqual(review.call_count, 1)
            self.stage_change()
            self.write('src/a.txt', 'new change\n')
            self.git('add', 'src/a.txt')
            with patch.object(w, 'review', return_value=self.result()) as next_review:
                w.pre_commit(self.root)
                next_review.assert_called_once()

    def test_unstaged_doc_is_not_overwritten(self):
        self.stage_change()
        self.write('docs/README.md', 'private work in progress\n')
        with patch.object(w, 'review', return_value=self.result([{'path': 'docs/README.md', 'content': '# new\n'}])):
            with self.assertRaisesRegex(ValueError, '未暂存'):
                w.pre_commit(self.root)
        self.assertEqual((self.root / 'docs/README.md').read_text(), 'private work in progress\n')

    def test_disallowed_edits_rejected(self):
        self.stage_change()
        for path in ['src/a.txt', '../escape.md', 'docs/wiki/new.md', 'docs/specs/x/history/a.md', '/tmp/bad.md']:
            with self.subTest(path=path), patch.object(w, 'review', return_value=self.result([{'path': path, 'content': 'bad'}])):
                with self.assertRaisesRegex(ValueError, '越界'):
                    w.pre_commit(self.root)
        self.assertEqual((self.root / 'src/a.txt').read_text(), 'after\n')

    def test_symlink_parent_rejected(self):
        self.stage_change()
        with tempfile.TemporaryDirectory() as outside:
            (self.root / 'docs/specs').symlink_to(outside, target_is_directory=True)
            with patch.object(w, 'review', return_value=self.result([{'path': 'docs/specs/bad.md', 'content': 'bad'}])):
                with self.assertRaisesRegex(ValueError, '越界'):
                    w.pre_commit(self.root)
            self.assertFalse((Path(outside) / 'bad.md').exists())

    def test_staged_race_invalidates_review(self):
        self.stage_change()
        def race(*args):
            self.write('src/a.txt', 'racing change\n')
            self.git('add', 'src/a.txt')
            return self.result([{'path': 'docs/README.md', 'content': '# reviewed\n'}])
        with patch.object(w, 'review', side_effect=race):
            with self.assertRaisesRegex(ValueError, '发生变化'):
                w.pre_commit(self.root)
        self.assertEqual((self.root / 'docs/README.md').read_text(), '# Docs\n')

    def test_broken_link_blocks_before_any_doc_write(self):
        self.stage_change()
        result = self.result([{'path': 'docs/README.md', 'content': '[bad](missing.md)\n'}])
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, 'broken link'):
                w.pre_commit(self.root)
        self.assertEqual((self.root / 'docs/README.md').read_text(), '# Docs\n')

    def test_codex_failure_unlocks_and_does_not_cache(self):
        self.stage_change()
        with patch.object(w, 'review', side_effect=ValueError('timeout')):
            with self.assertRaisesRegex(ValueError, 'timeout'):
                w.pre_commit(self.root)
        self.assertFalse((w.state_dir(self.root) / 'commit.lock').exists())
        self.assertFalse((w.state_dir(self.root) / 'review.json').exists())

    def test_recursive_commit_denied(self):
        with patch.dict(os.environ, {'PROJECT_CHANGE_SYNC_CHILD': '1'}):
            with self.assertRaisesRegex(ValueError, '递归'):
                w.pre_commit(self.root)

    def test_review_timeout_terminates_child_process_group(self):
        class TimedOut:
            pid = 123456
            calls = 0
            def communicate(self, *args, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise subprocess.TimeoutExpired('codex', 180)
                return '', ''
        with patch.object(w.subprocess, 'Popen', return_value=TimedOut()), patch.object(w.os, 'killpg') as kill:
            with self.assertRaisesRegex(ValueError, '180 秒'):
                w.review(self.root, self.root, 'diff', self.root / 'output.json')
            kill.assert_called_once_with(123456, w.signal.SIGTERM)

    def test_concurrent_commit_check_is_not_started(self):
        self.stage_change()
        with w.lock(self.root), patch.object(w, 'review') as review:
            with self.assertRaisesRegex(ValueError, '正在运行'):
                w.pre_commit(self.root)
            review.assert_not_called()

    def test_review_requires_all_checks(self):
        self.stage_change()
        result = self.result()
        del result['checks']['architecture']
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, '四项'):
                w.pre_commit(self.root)

    def make_spec(self, ident, affects=None, status='draft'):
        meta = {'id': ident, 'title': ident, 'kind': 'patch' if affects else 'feature',
                'maturity': 'stable', 'status': status, 'lifecycle': 'planned',
                'affects': affects or [], 'changes': [], 'effective': None}
        self.write('docs/specs/' + ident + '/spec.md', '---\n' + json.dumps(meta) + '\n---\n\n# ' + ident + '\n')

    def test_specs_backlinks_and_map_are_idempotent(self):
        self.make_spec('F-001')
        self.make_spec('F-002', [{'id': 'F-001', 'sections': ['F-001-1']}])
        with self.assertRaisesRegex(ValueError, '回指'):
            w.check_specs(self.root)
        w.check_specs(self.root, sync=True)
        original = (self.root / 'docs/specs/MAP.md').read_bytes()
        w.check_specs(self.root, sync=True)
        self.assertEqual(original, (self.root / 'docs/specs/MAP.md').read_bytes())
        w.check_specs(self.root)
        meta, _ = w.metadata(self.root / 'docs/specs/F-001/spec.md')
        self.assertEqual(meta['changes'], ['F-002'])

    def test_missing_target_and_release_evidence_block(self):
        self.make_spec('F-002', [{'id': 'F-001', 'sections': ['F-001-1']}])
        with self.assertRaisesRegex(ValueError, 'target'):
            w.check_specs(self.root, sync=True)
        self.make_spec('F-001', status='effective')
        with self.assertRaisesRegex(ValueError, 'evidence'):
            w.check_specs(self.root)

    def test_stop_skips_discussion_and_continues_development_once(self):
        base = {'cwd': str(self.root), 'session_id': 'isolated', 'turn_id': 'one'}
        w.hook({**base, 'hook_event_name': 'UserPromptSubmit', 'prompt': '解释概念'})
        self.assertEqual(w.hook({**base, 'hook_event_name': 'Stop'}), {})
        w.hook({**base, 'hook_event_name': 'UserPromptSubmit', 'prompt': '修复这个问题'})
        self.assertEqual(w.hook({**base, 'hook_event_name': 'Stop'})['decision'], 'block')
        self.assertEqual(w.hook({**base, 'hook_event_name': 'Stop'}), {})
        self.assertEqual(w.hook({**base, 'hook_event_name': 'Stop', 'stop_hook_active': True}), {})

    def test_learning_ack_prevents_fallback(self):
        base = {'cwd': str(self.root), 'session_id': 'isolated'}
        w.hook({**base, 'hook_event_name': 'UserPromptSubmit', 'prompt': '实现功能'})
        self.write('src/a.txt', 'done\n')
        w.learning_ack(self.root, 'isolated')
        self.assertEqual(w.hook({**base, 'hook_event_name': 'Stop'}), {})

    def test_install_preserves_existing_hook(self):
        self.write('.git/hooks/pre-commit', '# existing\n')
        with self.assertRaisesRegex(ValueError, '已有原生'):
            w.install(self.root)
        self.assertEqual((self.root / '.git/hooks/pre-commit').read_text(), '# existing\n')

    def audit(self, stage='completion', status='conforms'):
        self.make_spec('F-001')
        w.check_specs(self.root, sync=True)
        self.git('add', 'docs/specs')
        return {'stage': stage, 'scope_reason': 'F-001-1 only', 'blockers': [], 'specs': [{
            'path': 'docs/specs/F-001/spec.md', 'implementation_ready': False, 'findings': [{'requirement': 'F-001-1',
            'status': status, 'code': 'src/a.txt', 'verification': 'not executed; static review', 'verification_scope': 'local', 'reason': 'fixture evidence'}]}]}

    def test_completion_gap_blocks_before_sync_and_keeps_failure_report(self):
        self.audit_mock.return_value = self.audit(status='missing')
        before = (self.root / 'docs/specs/F-001/spec.md').read_text()
        with patch.object(w, 'review') as sync:
            with self.assertRaisesRegex(ValueError, '规格核对未通过'):
                w.pre_commit(self.root)
            sync.assert_not_called()
        self.assertEqual(before, (self.root / 'docs/specs/F-001/spec.md').read_text())
        self.assertIn('missing', (w.state_dir(self.root) / 'spec-review.md').read_text())
        self.assertFalse((w.state_dir(self.root) / 'review.json').exists())

    def test_incremental_gap_recorded_and_report_staging_is_cached(self):
        self.audit_mock.return_value = self.audit(stage='incremental', status='missing')
        initial_index = self.git('ls-files', '--stage')
        with patch.object(w, 'review', return_value=self.result()) as sync:
            with self.assertRaisesRegex(ValueError, '已更新文档'):
                w.pre_commit(self.root)
            self.assertEqual(initial_index, self.git('ls-files', '--stage'))
            reports = list((self.root / 'docs/specs/F-001/reviews').glob('*.md'))
            self.assertEqual(len(reports), 2)
            self.assertIn('版本化核对记录', (self.root / 'docs/specs/F-001/spec.md').read_text())
            self.git('add', 'docs/specs')
            w.pre_commit(self.root)
            self.assertEqual(self.audit_mock.call_count, 1)
            sync.assert_called_once()

    def test_sync_cannot_rewrite_spec_after_audit(self):
        self.audit_mock.return_value = self.audit()
        before = (self.root / 'docs/specs/F-001/spec.md').read_text()
        result = self.result([{'path': 'docs/specs/F-001/spec.md', 'content': 'weakened requirements'}])
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, '改写规格'):
                w.pre_commit(self.root)
        self.assertEqual(before, (self.root / 'docs/specs/F-001/spec.md').read_text())

    def test_incremental_deviation_cannot_bypass_gate(self):
        self.audit_mock.return_value = self.audit(stage='incremental', status='deviates')
        with patch.object(w, 'review') as sync:
            with self.assertRaisesRegex(ValueError, '规格核对未通过'):
                w.pre_commit(self.root)
            sync.assert_not_called()

    def test_unstaged_policy_blocks_before_model_call(self):
        self.stage_change()
        self.write('.agents/skills/project-change-sync/SKILL.md', 'unstaged policy')
        with self.assertRaisesRegex(ValueError, '规则有未暂存'):
            w.pre_commit(self.root)
        self.audit_mock.assert_not_called()

    def promotion(self):
        audit = self.audit()
        self.make_spec('F-001', status='implementing')
        w.check_specs(self.root, sync=True)
        self.git('add', 'docs/specs')
        audit['specs'][0]['implementation_ready'] = True
        self.audit_mock.return_value = audit
        path = self.root / 'docs/specs/F-001/spec.md'
        return self.result([{'path': 'docs/specs/F-001/spec.md',
                             'content': path.read_text().replace('"implementing"', '"implemented"')}])

    def test_audited_promotion_updates_map_and_preserves_report_link(self):
        result = self.promotion()
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, '已更新文档'):
                w.pre_commit(self.root)
            meta, body = w.metadata(self.root / 'docs/specs/F-001/spec.md')
            self.assertEqual(meta['status'], 'implemented')
            self.assertIn('版本化核对记录', body)
            self.assertIn('implemented', (self.root / 'docs/specs/MAP.md').read_text())
            self.git('add', 'docs/specs')
            w.pre_commit(self.root)
            self.assertEqual(self.audit_mock.call_count, 1)

    def test_promotion_cannot_change_requirements_or_skip_readiness(self):
        result = self.promotion()
        original = result['edits'][0]['content']
        for ready, content in [(False, original), (True, original + '\nweakened requirement\n')]:
            self.audit_mock.return_value['specs'][0]['implementation_ready'] = ready
            result['edits'][0]['content'] = content
            with patch.object(w, 'review', return_value=result):
                with self.assertRaisesRegex(ValueError, '改写规格'):
                    w.pre_commit(self.root)
            self.assertEqual(w.metadata(self.root / 'docs/specs/F-001/spec.md')[0]['status'], 'implementing')

    def test_local_unverified_cannot_promote_even_if_ready_true(self):
        result = self.promotion()
        self.audit_mock.return_value['stage'] = 'incremental'
        self.audit_mock.return_value['specs'][0]['findings'].append({
            'requirement': 'F-001-2', 'status': 'unverified', 'code': 'src/a.txt',
            'verification': 'local tests absent', 'verification_scope': 'local', 'reason': 'not validated'})
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, '改写规格'):
                w.pre_commit(self.root)
        self.assertEqual(w.metadata(self.root / 'docs/specs/F-001/spec.md')[0]['status'], 'implementing')

    def test_external_acceptance_can_remain_pending_at_implemented(self):
        result = self.promotion()
        self.audit_mock.return_value['specs'][0]['findings'].append({
            'requirement': 'F-001-2', 'status': 'unverified', 'code': 'src/a.txt',
            'verification': 'production not deployed', 'verification_scope': 'external', 'reason': 'external acceptance pending'})
        with patch.object(w, 'review', return_value=result):
            with self.assertRaisesRegex(ValueError, '已更新文档'):
                w.pre_commit(self.root)
        self.assertEqual(w.metadata(self.root / 'docs/specs/F-001/spec.md')[0]['status'], 'implemented')

    def test_implemented_does_not_require_or_imply_release(self):
        self.make_spec('F-001', status='implemented')
        w.check_specs(self.root, sync=True)
        self.assertIsNone(w.metadata(self.root / 'docs/specs/F-001/spec.md')[0]['effective'])

    def test_effective_cannot_ignore_external_verification(self):
        self.promotion()
        path = self.root / 'docs/specs/F-001/spec.md'
        meta, body = w.metadata(path)
        meta.update(status='effective', effective={'version': 'v1', 'date': '2026-09-10', 'evidence': 'docs/README.md'})
        path.write_text('---\n' + json.dumps(meta) + '\n---\n\n' + body)
        w.check_specs(self.root, sync=True)
        self.git('add', 'docs')
        finding = self.audit_mock.return_value['specs'][0]['findings'][0]
        finding.update(status='unverified', verification_scope='external')
        with patch.object(w, 'review') as sync:
            with self.assertRaisesRegex(ValueError, '规格核对未通过'):
                w.pre_commit(self.root)
            sync.assert_not_called()

    def test_all_skill_and_hook_policies_are_guarded(self):
        for name in ['.agents/skills/project-spec/SKILL.md', '.agents/skills/project-learning-sync/SKILL.md',
                     '.agents/skills/project-spec/agents/openai.yaml', '.codex/config.toml', '.codex/hooks.json', '.githooks/pre-commit']:
            with self.subTest(name=name):
                self.write(name, 'staged policy')
                self.git('add', name)
                previous = w.policy_key(self.root)
                self.write(name, 'unstaged policy')
                self.assertNotEqual(previous, w.policy_key(self.root))
                with self.assertRaisesRegex(ValueError, '规则有未暂存'):
                    w.pre_commit(self.root)
                self.write(name, 'staged policy')
        self.audit_mock.assert_not_called()

    def test_spec_change_invalidates_previous_success(self):
        self.audit_mock.return_value = self.audit()
        with patch.object(w, 'review', return_value=self.result()):
            with self.assertRaisesRegex(ValueError, '已更新文档'):
                w.pre_commit(self.root)
            self.git('add', 'docs/specs')
            w.pre_commit(self.root)
            p = self.root / 'docs/specs/F-001/spec.md'
            p.write_text(p.read_text() + '\nnew required behavior\n')
            self.git('add', 'docs/specs')
            self.audit_mock.return_value['specs'][0]['findings'][0]['status'] = 'deviates'
            with self.assertRaisesRegex(ValueError, '规格核对未通过'):
                w.pre_commit(self.root)
            self.assertEqual(self.audit_mock.call_count, 2)


if __name__ == '__main__':
    unittest.main()
