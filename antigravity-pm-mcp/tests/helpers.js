import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Doi dong ho nhich it nhat `ms` mili-giay (moc giao viec va mtime result.json khong trung mili-giay). */
export function tick(ms = 3) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* cho */ }
}

/** PNG 1x1 that (de test duong di cua anh nghiem thu). */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

// Test khong duoc dinh cau hinh chung that cua may dang chay: tro ANTIGRAVITY_PM_GLOBAL_CONFIG
// vao mot duong dan khong ton tai ngay khi nap helpers.
const NO_GLOBAL_CONFIG = path.join(os.tmpdir(), 'agpm-test-khong-co-cau-hinh-chung', '.antigravity-pm.json');
process.env.ANTIGRAVITY_PM_GLOBAL_CONFIG = NO_GLOBAL_CONFIG;
// Trang thai PM (task.json) nam o HOME: test khong duoc ghi vao ~/.antigravity-pm that.
process.env.ANTIGRAVITY_PM_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-state-home-'));
const STATE_HOME = process.env.ANTIGRAVITY_PM_STATE_HOME;
process.once('exit', () => fs.rmSync(STATE_HOME, { recursive: true, force: true }));

/** Tao cau hinh chung gia (dong vai ~/.antigravity-pm.json) cho mot test. */
export function tmpGlobalConfig(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-home-'));
  const file = path.join(dir, '.antigravity-pm.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  process.env.ANTIGRAVITY_PM_GLOBAL_CONFIG = file;
  return {
    dir,
    file,
    restore() {
      process.env.ANTIGRAVITY_PM_GLOBAL_CONFIG = NO_GLOBAL_CONFIG;
      cleanup(dir);
    },
  };
}

export function tmpProject(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-test-'));
  fs.writeFileSync(path.join(dir, '.antigravity-pm.json'), JSON.stringify(config, null, 2));
  return dir;
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* khong sao */ }
}

/** Task mau da co du de test cong chan. */
export function sampleTaskArgs(over = {}) {
  return {
    title: 'Thêm cổng chặn kính xe',
    brief: 'Hiện tại lệnh hạ kính không hỏi xác nhận. Cần thêm bước xác nhận.',
    definitionOfDone: ['Có unit test cho cổng chặn', 'Không đổi hành vi lệnh khác'],
    ...over,
  };
}
