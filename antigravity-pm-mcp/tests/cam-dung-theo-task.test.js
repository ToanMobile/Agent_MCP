// 19/09: cay lam viec dung chung 3 task + auto-commit tu phien khac => file CAM cua task nay
// bi quy cho task khac. Chi CHAN file task nay khai (files_changed) hoac nam trong scopeFiles;
// file cam khac dang thay doi trong cay chi CANH BAO kem ten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileCamDungTheoTask } from '../src/policy.js';

const task = {
  scopeFiles: ['libs/office-reader/src/main/java/com/x/ss/', 'core/common/src/main/res/'],
  forbiddenPaths: ['scripts/qa/', '.claude/', 'feature/reader/src/main/', 'gradle/libs.versions.toml'],
};

test('file cam do task khai trong files_changed => CHAN', () => {
  const r = fileCamDungTheoTask(task, ['feature/reader/src/main/A.kt', 'scripts/qa/x.sh'], ['feature/reader/src/main/A.kt']);
  assert.deepEqual(r.chan, ['feature/reader/src/main/A.kt']);
  assert.deepEqual(r.canhBao, ['scripts/qa/x.sh']);
});

test('file cam nam trong scopeFiles (plan tu mau thuan) => CHAN du khong khai', () => {
  const t = { ...task, forbiddenPaths: ['core/common/src/main/res/values-vi/'] };
  const r = fileCamDungTheoTask(t, ['core/common/src/main/res/values-vi/strings.xml'], []);
  assert.deepEqual(r.chan, ['core/common/src/main/res/values-vi/strings.xml']);
  assert.deepEqual(r.canhBao, []);
});

test('file cam cua phien khac / auto-commit, task khong khai => chi CANH BAO', () => {
  const r = fileCamDungTheoTask(task, ['.claude/commands/pdf.md', 'scripts/qa/lib/a.sh', 'gradle/libs.versions.toml', 'libs/office-reader/src/main/java/com/x/ss/B.java'], ['libs/office-reader/src/main/java/com/x/ss/B.java']);
  assert.deepEqual(r.chan, []);
  assert.deepEqual(r.canhBao, ['.claude/commands/pdf.md', 'scripts/qa/lib/a.sh', 'gradle/libs.versions.toml']);
});

test('chua co result.json (claimed undefined) va chua khai scopeFiles => giu cach cu: CHAN het', () => {
  const r = fileCamDungTheoTask({ forbiddenPaths: ['scripts/qa/'] }, ['scripts/qa/x.sh'], undefined);
  assert.deepEqual(r.chan, ['scripts/qa/x.sh']);
  assert.deepEqual(r.canhBao, []);
});

test('changedFiles khong do duoc => khong chan, khong canh bao', () => {
  const r = fileCamDungTheoTask(task, undefined, []);
  assert.deepEqual(r, { chan: [], canhBao: [] });
});
