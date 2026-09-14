// Bang chung test phia PM: exit 0 KHONG du. Phai co test that su chay (khong UP-TO-DATE / FROM-CACHE /
// "No tests found"), va neu project khai XML ket qua thi dem tu XML moi hon luc bat dau chay.
// Vi sao (T0001, 12/09/2026): Gradle in "149 actionable tasks: 149 up-to-date", exit 0, khong test nao chay.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseJunitXml, detectNoop, findFiles, collectTestEvidence, globSegmentsState,
} from '../src/evidence.js';
import { cleanup } from './helpers.js';

const XML_OK = `<?xml version="1.0"?>
<testsuite name="a.BTest" tests="2" skipped="1" failures="0" errors="0">
  <testcase name="x" classname="a.BTest"/>
  <testcase name="y" classname="a.BTest"><skipped/></testcase>
</testsuite>`;
const XML_FAIL = `<?xml version="1.0"?>
<testsuite name="a.CTest" tests="3" skipped="0" failures="1" errors="1">
  <testcase name="ok" classname="a.CTest"/>
  <testcase name="vo" classname="a.CTest"><failure message="boom">trace</failure></testcase>
  <testcase name="no" classname="a.CTest"><error message="npe">trace</error></testcase>
</testsuite>`;
// Instrumented: <testsuites> boc <testsuite> — chi dem <testsuite>, khong dem doi.
const XML_WRAPPED = `<testsuites tests="99" failures="99">
<testsuite name="d.ETest" tests="1" failures="0" errors="0"><testcase name="z" classname="d.ETest"/></testsuite>
</testsuites>`;

test('parseJunitXml: dem tu <testsuite>, bo qua <testsuites> boc ngoai, lay ten test do', () => {
  assert.deepEqual(parseJunitXml(XML_OK), { tests: 2, failures: 0, errors: 0, skipped: 1, failedNames: [] });
  const f = parseJunitXml(XML_FAIL);
  assert.equal(f.tests, 3);
  assert.equal(f.failures, 1);
  assert.equal(f.errors, 1);
  assert.deepEqual(f.failedNames, ['a.CTest.vo', 'a.CTest.no']);
  assert.deepEqual(parseJunitXml(XML_WRAPPED), { tests: 1, failures: 0, errors: 0, skipped: 0, failedNames: [] });
});

test('detectNoop: Gradle toan up-to-date / from cache la KHONG CHAY; co "executed" thi da chay', () => {
  assert.equal(detectNoop('BUILD SUCCESSFUL\n149 actionable tasks: 149 up-to-date\n').noop, true);
  assert.equal(detectNoop('3 actionable tasks: 3 from cache').noop, true);
  assert.equal(detectNoop('5 actionable tasks: 2 executed, 3 up-to-date').noop, false);
  assert.equal(detectNoop('1 actionable task: 1 executed').noop, false);
  assert.equal(detectNoop('> Task :app:compileDebugKotlin UP-TO-DATE\n> Task :app:testDebugUnitTest\n7 actionable tasks: 1 executed, 6 up-to-date').noop, false,
    'UP-TO-DATE cua task compile KHONG duoc tinh la noop');
});

test('detectNoop: "No tests found", "No tests ran", node --test "tests 0", pytest "collected 0 items"', () => {
  assert.equal(detectNoop('No tests found for given includes: [Foo]').noop, true);
  assert.equal(detectNoop('No tests ran.').noop, true);
  assert.equal(detectNoop('ℹ tests 0\nℹ pass 0').noop, true);
  assert.equal(detectNoop('ℹ tests 12\nℹ pass 12').noop, false);
  assert.equal(detectNoop('collected 0 items').noop, true);
  assert.equal(detectNoop('ok').noop, false);
  const r = detectNoop('No tests ran.');
  assert.ok(r.rule, 'phai noi ro rule nao bat duoc');
});

test('globSegmentsState + findFiles: khop **/build/test-results/**/TEST-*.xml, khong lan vao .git/node_modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-ev-'));
  const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), c); };
  w('app/build/test-results/testDebugUnitTest/TEST-a.xml');
  w('libs/x/build/test-results/TEST-b.xml');
  w('app/build/intermediates/TEST-c.xml');
  w('node_modules/y/build/test-results/TEST-d.xml');
  w('.git/build/test-results/TEST-e.xml');
  const got = findFiles(dir, ['**/build/test-results/**/TEST-*.xml']).map((f) => path.relative(dir, f)).sort();
  assert.deepEqual(got, ['app/build/test-results/testDebugUnitTest/TEST-a.xml', 'libs/x/build/test-results/TEST-b.xml']);
  assert.equal(globSegmentsState(['**', 'build', 'test-results', '**', 'TEST-*.xml'], ['app', 'build', 'intermediates']), 'prefix',
    'thu muc chua ket luan duoc thi van la prefix (** dung truoc)');
  assert.equal(globSegmentsState(['build', 'x', '*.xml'], ['build', 'y']), 'none');
  cleanup(dir);
});

test('collectTestEvidence voi XML: file cu hon luc bat dau chay KHONG duoc dem; moi va xanh thi ok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-ev-'));
  const xml = path.join(dir, 'build/test-results/TEST-a.xml');
  fs.mkdirSync(path.dirname(xml), { recursive: true });
  fs.writeFileSync(xml, XML_OK);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(xml, old, old);
  const cfg = { projectRoot: dir, testEvidence: { resultsGlob: ['**/build/test-results/**/TEST-*.xml'] } };
  const stale = collectTestEvidence(cfg, { startedMs: Date.now() - 1000, stdout: 'BUILD SUCCESSFUL\n1 actionable task: 1 executed', stderr: '' });
  assert.equal(stale.source, 'xml');
  assert.equal(stale.ok, false);
  assert.equal(stale.files, 0);
  assert.equal(stale.staleFiles, 1);
  assert.match(stale.reason, /cu hon/i);

  const now = new Date();
  fs.utimesSync(xml, now, now);
  const fresh = collectTestEvidence(cfg, { startedMs: Date.now() - 5000, stdout: '1 actionable task: 1 executed', stderr: '' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.tests, 2);
  assert.equal(fresh.skipped, 1);
  assert.equal(fresh.failures, 0);
  cleanup(dir);
});

test('collectTestEvidence voi XML: co test do => ok=false kem ten; toan up-to-date => noop du XML moi (FROM-CACHE)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-ev-'));
  const xml = path.join(dir, 'build/test-results/TEST-c.xml');
  fs.mkdirSync(path.dirname(xml), { recursive: true });
  fs.writeFileSync(xml, XML_FAIL);
  const cfg = { projectRoot: dir, testEvidence: { resultsGlob: ['**/build/test-results/**/TEST-*.xml'] } };
  const red = collectTestEvidence(cfg, { startedMs: Date.now() - 5000, stdout: '1 actionable task: 1 executed', stderr: '' });
  assert.equal(red.ok, false);
  assert.deepEqual(red.failedNames, ['a.CTest.vo', 'a.CTest.no']);
  fs.writeFileSync(xml, XML_OK);
  const cached = collectTestEvidence(cfg, { startedMs: Date.now() - 5000, stdout: '2 actionable tasks: 2 from cache', stderr: '' });
  assert.equal(cached.noop, true);
  assert.equal(cached.ok, false);
  cleanup(dir);
});

test('collectTestEvidence khong khai XML: dua vao stdout, danh dau weak; noop van bat duoc', () => {
  const cfg = { projectRoot: os.tmpdir(), testEvidence: { resultsGlob: [] } };
  const a = collectTestEvidence(cfg, { startedMs: Date.now(), stdout: 'ok', stderr: '' });
  assert.equal(a.source, 'stdout');
  assert.equal(a.ok, true);
  assert.equal(a.weak, true);
  const b = collectTestEvidence(cfg, { startedMs: Date.now(), stdout: '149 actionable tasks: 149 up-to-date', stderr: '' });
  assert.equal(b.ok, false);
  assert.equal(b.noop, true);
});
