import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** PNG 1x1 that (de test duong di cua anh nghiem thu). */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

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
