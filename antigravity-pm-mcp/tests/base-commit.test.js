// Thay doi cua task = cay lam viec + da commit ke tu commit goc (13/09/2026).
// Vi sao: code + test cua T0008 da vao commit truoc khi accept => `git status` sach => cong
// "phai kem file test" bao 0 file du test co that.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hopNhatFileThayDoi, headCommitOf, createTask } from '../src/tasks.js';
import { checkTestChange } from '../src/policy.js';
import { loadConfig } from '../src/config.js';

const CFG = { mustHave: { testChange: true, proofFrom: [] } };

test('hopNhatFileThayDoi: cay lam viec chua do duoc => undefined (khong coi la dat)', () => {
  assert.equal(hopNhatFileThayDoi(undefined, ['src/test/java/XTest.kt']), undefined);
});

test('hopNhatFileThayDoi: gom ca file da commit, khong trung', () => {
  const r = hopNhatFileThayDoi(['a.kt', 'src/test/java/XTest.kt'], ['src/test/java/XTest.kt', 'b.kt']);
  assert.deepEqual(r, ['a.kt', 'src/test/java/XTest.kt', 'b.kt']);
});

test('ca T0008: cay lam viec SACH nhung test da commit => cong "kem file test" phai DAT', () => {
  const cu = checkTestChange(CFG, hopNhatFileThayDoi([], []));
  assert.equal(cu.ok, false, 'khong co gi thay doi thi van chua dat');
  const moi = checkTestChange(CFG, hopNhatFileThayDoi([], ['scripts/x.sh', 'tests/scripts/test-x.sh']));
  assert.equal(moi.ok, true);
  assert.deepEqual(moi.testFiles, ['tests/scripts/test-x.sh']);
});

test('headCommitOf: repo git tra SHA, thu muc thuong tra null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-base-'));
  assert.equal(headCommitOf(dir), null);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir });
  const sha = headCommitOf(dir);
  assert.match(sha, /^[0-9a-f]{40}$/);
  // createTask ghi baseCommit = HEAD luc tao
  fs.writeFileSync(path.join(dir, '.antigravity-pm.json'), JSON.stringify({ projectName: 't' }));
  const cfg = loadConfig(dir);
  const task = createTask(cfg, { title: 'x', brief: 'y', definitionOfDone: ['z'] });
  assert.equal(task.baseCommit, sha);
  fs.rmSync(dir, { recursive: true, force: true });
});
