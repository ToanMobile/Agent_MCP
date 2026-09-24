import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbDevices, planCaptureTarget, nextEmulatorPort, adbReadinessLines } from '../src/proof-target.js';

const IP = '192.168.1.20:5555';

test('parse adb devices: bo dong tieu de, giu state', () => {
  const list = parseAdbDevices([
    'List of devices attached',
    'RFCWA1KQT1Y            device usb:1 product:m33x',
    `${IP}       offline`,
    'emulator-5554 device',
    '',
  ].join('\n'));
  assert.deepEqual(list, [
    { serial: 'RFCWA1KQT1Y', state: 'device' },
    { serial: IP, state: 'offline' },
    { serial: 'emulator-5554', state: 'device' },
  ]);
});

test('serial online thi chup dung serial do', () => {
  const plan = planCaptureTarget({
    configured: IP,
    devices: [{ serial: IP, state: 'device' }, { serial: 'RFCWA1KQT1Y', state: 'device' }],
    denied: new Set(),
    provider: { type: 'adb', serial: IP },
    providers: {},
    connectTried: true,
  });
  assert.equal(plan.action, 'screencap');
  assert.equal(plan.serial, IP);
});

test('serial offline khong lay may khac dang cam, ke ca khi may kia online', () => {
  const plan = planCaptureTarget({
    configured: IP,
    devices: [{ serial: 'RFCWA1KQT1Y', state: 'device' }],
    denied: new Set(['RFCWA1KQT1Y']),
    provider: { type: 'adb', serial: IP },
    providers: {},
    connectTried: true,
  });
  assert.equal(plan.action, 'fail');
  assert.match(plan.message, /khong online/);
  assert.match(plan.message, /denylist/);
  assert.equal(plan.serial, undefined);
});

test('ip:port chua thu connect thi connect ngan, khong screencap ngay', () => {
  const plan = planCaptureTarget({
    configured: IP,
    devices: [],
    denied: new Set(),
    provider: { type: 'adb', serial: IP, avd: 'PhoneConnect' },
    providers: {},
    connectTried: false,
  });
  assert.equal(plan.action, 'connect');
  assert.equal(plan.serial, IP);
});

test('sau connect van offline thi mo AVD da khai, khong chup IP chet', () => {
  const plan = planCaptureTarget({
    configured: IP,
    devices: [{ serial: 'RFCWA1KQT1Y', state: 'device' }],
    denied: new Set(['RFCWA1KQT1Y']),
    provider: { type: 'adb', serial: IP, avd: 'PhoneConnect' },
    providers: {},
    connectTried: true,
  });
  assert.equal(plan.action, 'boot-avd');
  assert.equal(plan.avd, 'PhoneConnect');
});

test('khong co avd thi chuyen sang provider web', () => {
  const plan = planCaptureTarget({
    configured: IP,
    devices: [],
    denied: new Set(),
    provider: { type: 'adb', serial: IP },
    providers: { trang: { type: 'browser', url: 'http://localhost:5173' } },
    connectTried: true,
  });
  assert.equal(plan.action, 'switch');
  assert.equal(plan.providerName, 'trang');
});

test('khong khai serial: dung dung 1 may online, bo qua denylist', () => {
  const only = planCaptureTarget({
    configured: null,
    devices: [{ serial: 'emulator-5554', state: 'device' }],
    denied: new Set(),
    provider: { type: 'adb' },
    providers: {},
    connectTried: true,
  });
  assert.equal(only.action, 'screencap');
  assert.equal(only.serial, 'emulator-5554');
  const deniedOnly = planCaptureTarget({
    configured: null,
    devices: [{ serial: 'RFCWA1KQT1Y', state: 'device' }],
    denied: new Set(['RFCWA1KQT1Y']),
    provider: { type: 'adb' },
    providers: {},
    connectTried: true,
  });
  assert.equal(deniedOnly.action, 'fail');
});

test('cong emulator tranh cong da co may', () => {
  assert.equal(nextEmulatorPort([{ serial: 'emulator-5554', state: 'device' }], 5554), 5556);
  assert.equal(nextEmulatorPort([], 5554), 5554);
});

test('adbReadinessLines: serial khai bao offline thi noi se mo AVD, khong goi la dang online', async () => {
  const lines = await adbReadinessLines({
    projectRoot: '/tmp/khong-co-denylist-agpm',
    proof: { providers: { device: { type: 'adb', serial: IP, avd: 'PhoneConnect', adb: 'adb' } } },
  }, async () => ({
    code: 0,
    stdout: `List of devices attached\nRFCWA1KQT1Y device usb:1\n`,
    stderr: '',
    spawnFailed: false,
  }));
  assert.match(lines.join('\n'), /192\.168\.1\.20:5555 KHONG online — se mo AVD PhoneConnect/);
});
