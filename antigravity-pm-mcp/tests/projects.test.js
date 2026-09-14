// So dang ky project cua Antigravity: duong dan -> project id.
// new-conversation BAT BUOC co project id, nen module nay sai la ca he thong khong giao duoc viec.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listProjects, resolveProject, requireProjectId, ProjectNotRegistered } from '../src/projects.js';
import { loadConfig } from '../src/config.js';
import { tmpProject, cleanup, writeFile } from './helpers.js';

/** Dung 1 so dang ky gia giong that roi tro ANTIGRAVITY_PM_PROJECTS_DIR vao do. */
function fakeRegistry(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-reg-'));
  for (const e of entries) {
    writeFile(path.join(dir, `${e.id}.json`), JSON.stringify({
      id: e.id,
      name: e.name,
      projectResources: { resources: e.folders.map((f) => ({ gitFolder: { folderUri: `file://${f}`, defaultBranch: 'main' } })) },
      settings: { autoExecutionPolicy: e.auto || 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER', artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO' },
      updatedAt: '2026-08-21T07:23:47.834277Z',
    }));
  }
  process.env.ANTIGRAVITY_PM_PROJECTS_DIR = dir;
  return dir;
}

function clearRegistry(dir) {
  delete process.env.ANTIGRAVITY_PM_PROJECTS_DIR;
  cleanup(dir);
}

test('doc so dang ky: lay id, ten, danh sach thu muc, chinh sach tu chay lenh', () => {
  const proj = tmpProject({});
  const reg = fakeRegistry([{ id: '355fd7f8-3c43-45de-b86a-84b22fbdf41c', name: 'GeelyEx2', folders: [proj] }]);
  const all = listProjects();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'GeelyEx2');
  assert.equal(all[0].folders[0], proj);
  assert.match(all[0].autoExecution, /EAGER/);
  clearRegistry(reg);
  cleanup(proj);
});

test('khop chinh xac duong dan project', () => {
  const proj = tmpProject({});
  const reg = fakeRegistry([
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Khac', folders: ['/khong/lien/quan'] },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Dung', folders: [proj] },
  ]);
  const found = resolveProject(proj);
  assert.equal(found.name, 'Dung');
  assert.equal(found.match, 'exact');
  clearRegistry(reg);
  cleanup(proj);
});

test('khop qua thu muc cha (project dang ky o goc monorepo)', () => {
  const root = tmpProject({});
  const sub = path.join(root, 'apps', 'web');
  fs.mkdirSync(sub, { recursive: true });
  const reg = fakeRegistry([{ id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'Mono', folders: [root] }]);
  const found = resolveProject(sub);
  assert.equal(found.name, 'Mono');
  assert.equal(found.match, 'parent');
  clearRegistry(reg);
  cleanup(root);
});

test('project la cua nguoi khac thi KHONG bi nhan nham', () => {
  const proj = tmpProject({});
  const reg = fakeRegistry([{ id: 'cccccccc-0000-0000-0000-000000000001', name: 'Khac', folders: ['/Users/ai/do/khac'] }]);
  assert.equal(resolveProject(proj), null);
  clearRegistry(reg);
  cleanup(proj);
});

test('chua dang ky thi bao loi noi ro cach xu ly, kem danh sach project dang co', () => {
  const proj = tmpProject({});
  const reg = fakeRegistry([{ id: 'dddddddd-0000-0000-0000-000000000001', name: 'CaiKhac', folders: ['/noi/khac'] }]);
  const cfg = loadConfig(proj);
  try {
    requireProjectId(cfg);
    assert.fail('phai nem loi');
  } catch (e) {
    assert.ok(e instanceof ProjectNotRegistered);
    assert.match(e.message, /chua dang ky/);
    assert.match(e.hint, /CaiKhac/, 'phai liet ke project dang co de nguoi dung biet minh mo sai cai nao');
    assert.match(e.hint, /antigravity\.projectId/, 'phai chi ra duong thoat bang cau hinh');
  }
  clearRegistry(reg);
  cleanup(proj);
});

test('khai thang antigravity.projectId thi khong can so dang ky', () => {
  const proj = tmpProject({ antigravity: { projectId: 'eeeeeeee-0000-0000-0000-000000000001' } });
  const reg = fakeRegistry([]);
  const pid = requireProjectId(loadConfig(proj));
  assert.equal(pid.id, 'eeeeeeee-0000-0000-0000-000000000001');
  assert.equal(pid.match, 'config');
  clearRegistry(reg);
  cleanup(proj);
});

test('file rac trong so dang ky khong lam no', () => {
  const proj = tmpProject({});
  const reg = fakeRegistry([{ id: 'ffffffff-0000-0000-0000-000000000001', name: 'Tot', folders: [proj] }]);
  writeFile(path.join(reg, 'rac.json'), 'day khong phai json');
  writeFile(path.join(reg, 'bo-qua.txt'), '{}');
  const all = listProjects();
  assert.equal(all.length, 1);
  assert.equal(resolveProject(proj).name, 'Tot');
  clearRegistry(reg);
  cleanup(proj);
});

test('so dang ky khong ton tai thi tra ve rong, khong no', () => {
  process.env.ANTIGRAVITY_PM_PROJECTS_DIR = '/khong/he/ton/tai/dau-ca';
  assert.deepEqual(listProjects(), []);
  assert.equal(resolveProject('/bat/ky'), null);
  delete process.env.ANTIGRAVITY_PM_PROJECTS_DIR;
});
