const logEl = document.getElementById('log');
const CONTROL_LINES = new Set(['DONE_OK', 'DONE_ERROR', 'MULTI_DEVICE', 'RESULT_OK', 'RESULT_ERROR']);

// ---- light/dark/system theme toggle ----

const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_LABEL = { system: '🌓 Hệ thống', light: '☀️ Sáng', dark: '🌙 Tối' };

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  document.getElementById('themeToggle').textContent = THEME_LABEL[theme];
}

function currentTheme() {
  try {
    const t = localStorage.getItem('theme');
    return THEME_CYCLE.includes(t) ? t : 'system';
  } catch (e) {
    return 'system';
  }
}

applyTheme(currentTheme());

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme()) + 1) % THEME_CYCLE.length];
  try {
    localStorage.setItem('theme', next);
  } catch (e) {}
  applyTheme(next);
});

// ---- demo mode: dữ liệu giả để xem giao diện khi chưa có xe/thiết bị thật ----

let demoMode = false;

const DEMO_DEVICE = { serial: '192.168.1.17:5555', abi: 'arm64-v8a,armeabi-v7a', sdk: '30', wifiSSID: 'Geely-EX2-Demo' };

const DEMO_FILES = [
  { name: 'VietMapLive_v4.2.apk', path: '/demo/folder-mau/VietMapLive_v4.2.apk', ext: '.apk', sizeKB: 42000, package: 'vn.vietmap.live', label: 'VietMap Live', installed: true },
  { name: 'Waze_prod.apk', path: '/demo/folder-mau/Waze_prod.apk', ext: '.apk', sizeKB: 68500, package: 'com.waze', label: 'Waze', installed: true },
  { name: 'GoogleMaps.xapk', path: '/demo/folder-mau/GoogleMaps.xapk', ext: '.xapk', sizeKB: 121344, package: 'com.google.android.apps.maps', label: 'Google Maps', installed: false },
  { name: 'SpotifyMusic.apkm', path: '/demo/folder-mau/SpotifyMusic.apkm', ext: '.apkm', sizeKB: 35120, package: 'com.spotify.music', label: 'Spotify', installed: false },
  { name: 'OldNavApp.apk', path: '/demo/folder-mau/OldNavApp.apk', ext: '.apk', sizeKB: 8192, package: '', label: '', installed: false },
];

const DEMO_PACKAGES = [
  { name: 'android', label: 'Android System', enabled: true },
  { name: 'com.android.systemui', label: 'System UI', enabled: true },
  { name: 'com.android.settings', label: 'Cài đặt', enabled: true },
  { name: 'vn.vietmap.live', label: 'VietMap Live', enabled: true },
  { name: 'com.waze', label: 'Waze', enabled: true },
  { name: 'com.spotify.music', label: '', enabled: false },
  { name: 'com.termux', label: '', enabled: true },
];

const DEMO_QUICK_INSTALLS = [
  { name: 'App Demo 1 (đã cài)', url: 'https://example.com/demo1.apk', package: 'vn.vietmap.live' },
  { name: 'App Demo 2', url: 'https://example.com/demo2.apk' },
  { name: 'App Demo 3 (app nặng)', url: 'https://example.com/demo3-big.apk' },
];


// Dung lượng giả cho từng app demo, để thanh % chạy với tốc độ khác nhau
// giống thực tế (app nhẹ xong nhanh, app nặng chạy lâu hơn).
const DEMO_SIZES = {
  'App Demo 1 (đã cài)': 25.0,
  'App Demo 2': 87.5,
  'App Demo 3 (app nặng)': 275.7,
};

// demoPkgNameFor sinh package name giả từ tên app, dùng cho mô phỏng cài xong.
function demoPkgNameFor(name) {
  const slug = (name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return 'com.demo.' + (slug || 'app');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setDemoBadge() {
  const badge = document.getElementById('statusBadge');
  badge.className = 'badge demo';
  badge.querySelector('span:last-child').textContent =
    `🧪 ${DEMO_DEVICE.serial} · SDK ${DEMO_DEVICE.sdk} · ${DEMO_DEVICE.abi}`;
  const wifiWrap = document.getElementById('wifiSSIDWrap');
  wifiWrap.style.display = '';
  document.getElementById('wifiSSIDValue').textContent = '📶 ' + DEMO_DEVICE.wifiSSID + ' (demo)';
}

async function demoConnect() {
  clearLog();
  const ip = document.getElementById('ip').value.trim() || '192.168.1.17';
  const port = document.getElementById('port').value.trim() || '5555';
  appendLog(`🔌 Đang kết nối tới ${ip}:${port} ... (demo)`);
  await sleep(400);
  appendLog('✅ Đã kết nối 1 thiết bị: ' + DEMO_DEVICE.serial);
  appendLog(`   ℹ️  SDK: ${DEMO_DEVICE.sdk}   ABI: ${DEMO_DEVICE.abi}`);
  setDemoBadge();
}

// demoProgress phát ra đúng loại dòng PROGRESS_PCT như server thật, để xem
// trước thanh % chạy y hệt lúc dùng thật.
async function demoProgress(label, totalMB, steps, delayMs) {
  for (let i = 1; i <= steps; i++) {
    const pct = Math.round((i / steps) * 100);
    const doneMB = (totalMB * i) / steps;
    appendLog(`PROGRESS_PCT:${pct}|${label}|${doneMB.toFixed(1)}/${totalMB.toFixed(1)} MB`);
    await sleep(delayMs);
  }
}

// Trả về true/false theo kết quả cài (để nơi gọi biết có nên đánh dấu file là
// "đã cài" hay không) — kịch bản OldNavApp.apk mô phỏng đúng luồng xung đột
// chữ ký thật: báo lỗi + hiện popup hỏi gỡ bản cũ, giống hệt code path thật.
async function demoInstall(name, sizeMB) {
  clearLog();
  appendLog(`📦 ${name} ... (demo)`);
  await sleep(300);
  if (name === 'OldNavApp.apk') {
    appendLog('❌ Cài đặt thất bại: ' + name);
    appendLog('   💡 Đã có app này sẵn trong thiết bị (chữ ký khác — thường do bản cài sẵn từ nhà sản xuất hoặc bản mod). Cần gỡ bản cũ ra trước khi cài bản mới, không cài đè trực tiếp được. (demo)');
    appendLog('   ↳ Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]');
    const retry = window.confirm(
      'Đã có app "com.example.oldnav" cài sẵn trên thiết bị với chữ ký khác nên không cài đè được.\n\n(Demo) Gỡ bản cũ và cài lại bản mới ngay bây giờ?'
    );
    if (!retry) return false;
    appendLog('🗑️  Đang gỡ com.example.oldnav ... (demo)');
    await sleep(300);
    appendLog('   ✅ Đã gỡ. Đang cài lại ... (demo)');
    await demoProgress('install', sizeMB || 8.0, 12, 90);
    appendLog('✅ Cài đặt thành công: ' + name + ' (demo)');
    return true;
  }
  await demoProgress('install', sizeMB || 25.0, 14, 110);
  appendLog('✅ Cài đặt thành công: ' + name + ' (demo)');
  return true;
}

async function demoUninstall(pkg) {
  clearLog();
  appendLog(`🗑️  Đang gỡ ${pkg} ... (demo)`);
  await sleep(500);
  appendLog('✅ Gỡ thành công! (demo)');
}

async function demoUploadFiles(fileList) {
  clearLog();
  appendLog(`⬆️  Đang tải lên ${fileList.length} file ... (demo)`);
  for (const f of fileList) {
    await sleep(300);
    appendLog(`📦 ${f.name} ... (demo)`);
    await sleep(300);
    appendLog(`✅ Cài đặt thành công: ${f.name} (demo)`);
  }
  appendLog('');
  appendLog(`✅ Thành công: ${fileList.length}   ❌ Thất bại: 0 (demo)`);
}

async function demoDevSettings() {
  clearLog();
  appendLog('🖥️  Đang bật 4 tùy chỉnh hệ thống ... (demo)');
  const settings = [
    'development_settings_enabled',
    'enable_freeform_support',
    'force_resizable_activities',
    'enable_non_resizable_multi_window',
  ];
  for (const s of settings) {
    await sleep(220);
    appendLog(`   ⚙️  ${s} ✅`);
  }
  await sleep(300);
  appendLog('🔄 Đang khởi động lại thiết bị để áp dụng ... (demo)');
  await sleep(400);
  appendLog('✅ Đã bật 4 tùy chỉnh (demo). Trên thiết bị thật, thiết bị sẽ khởi động lại.');
}

function enterDemoMode() {
  demoMode = true;
  const toggle = document.getElementById('demoModeToggle');
  toggle.classList.remove('hidden');
  toggle.classList.add('on');
  setDemoBadge();
  document.getElementById('folderPath').value = '/demo/folder-mau';
  currentFolderFiles = DEMO_FILES.map((o) => ({ ...o }));
  renderFolderTable();
  allPackages = DEMO_PACKAGES.map((o) => ({ ...o }));
  favoriteSet = new Set(['vn.vietmap.live', 'com.waze']);
  renderPackages();
  renderFavoritesTab();
  quickInstalls = DEMO_QUICK_INSTALLS.map((o) => ({ ...o }));
  renderQuickList();
  clearLog();
  appendLog('🧪 Đã bật CHẾ ĐỘ DEMO — toàn bộ dữ liệu bên dưới là giả để xem giao diện, KHÔNG thao tác lên thiết bị thật.');
}

function exitDemoMode() {
  demoMode = false;
  const toggle = document.getElementById('demoModeToggle');
  toggle.classList.remove('on');
  toggle.classList.add('hidden');
  currentFolderFiles = [];
  renderFolderTable();
  allPackages = [];
  renderPackages();
  document.getElementById('folderPath').value = '';
  clearLog();
  appendLog('Đã tắt chế độ demo.');
  refreshStatus();
}

// Log giữ theo từng "khối" (1 khối = 1 hành động), khối mới nhất luôn nằm
// TRÊN CÙNG, các khối cũ bị đẩy xuống dưới thay vì bị xoá mất.
let logBlocks = [];
// Dòng tiến trình %/nhịp (PROGRESS_PCT/PROGRESS_TICK) hiện tại — chỉ hiện tạm
// thời ở cuối khối mới nhất, không ghi thành lịch sử cố định.
let pendingProgressLine = null;

function renderProgressBar(pct) {
  const width = 20;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// Trả về text hiển thị cho 1 dòng PROGRESS_PCT:.. / PROGRESS_TICK:.., hoặc
// null nếu dòng không phải dạng tiến trình.
function formatProgressLine(line) {
  let m = line.match(/^PROGRESS_PCT:(-?\d+)\|([^|]*)\|(.*)$/);
  if (m) {
    const pct = Number(m[1]);
    const detail = m[3] ? ' ' + m[3] : '';
    return `   ${renderProgressBar(pct)} ${pct}%${detail}`;
  }
  m = line.match(/^PROGRESS_TICK:([^|]*)\|(.*)$/);
  if (m) {
    return `   ⏳ ${m[2]}`;
  }
  return null;
}

function renderLogBlocks() {
  const top = (logBlocks[0] || '') + (pendingProgressLine ? (logBlocks[0] ? '\n' : '') + pendingProgressLine : '');
  const rest = logBlocks.slice(1);
  logEl.textContent = [top, ...rest].join('\n\n──────────\n\n');
  logEl.scrollTop = 0;
}

// Package name mà lần cài gần nhất báo xung đột chữ ký (nếu có) — dùng để
// hiện popup hỏi "gỡ bản cũ & cài lại?" ngay sau khi 1 lượt cài kết thúc.
let lastConflictPkg = null;

function appendLog(line) {
  if (line.startsWith('CONFLICT_PKG:')) {
    lastConflictPkg = line.slice('CONFLICT_PKG:'.length).trim();
    return;
  }
  const progressText = formatProgressLine(line);
  if (progressText !== null) {
    pendingProgressLine = progressText;
    renderLogBlocks();
    return;
  }
  pendingProgressLine = null;
  if (logBlocks.length === 0) logBlocks.unshift('');
  logBlocks[0] += (logBlocks[0] ? '\n' : '') + line;
  renderLogBlocks();
}

// Sau khi 1 lượt cài kết thúc mà có xung đột chữ ký + auto-gỡ đang tắt, hỏi
// người dùng có muốn gỡ bản cũ rồi cài lại ngay không.
async function maybePromptConflictRetry(retryInstallFn) {
  if (!lastConflictPkg) return;
  const pkg = lastConflictPkg;
  lastConflictPkg = null;
  const ok = window.confirm(
    `Đã có app "${pkg}" cài sẵn trên thiết bị với chữ ký khác nên không cài đè được.\n\nGỡ bản cũ và cài lại bản mới ngay bây giờ?`
  );
  if (!ok) return;
  clearLog();
  await streamRequest('/api/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg }),
  }, appendLog);
  await retryInstallFn();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function appLabelCell(name, label) {
  if (label) {
    return `<div>${escapeHtml(label)}</div><div class="muted" style="font-size:11px">${escapeHtml(name)}</div>`;
  }
  return name ? escapeHtml(name) : '<i>không xác định</i>';
}

// Gọi lúc bắt đầu 1 hành động mới — mở khối log mới lên đầu, không xoá log cũ.
function clearLog() {
  pendingProgressLine = null;
  lastConflictPkg = null;
  logBlocks.unshift('');
  if (logBlocks.length > 50) logBlocks.length = 50; // tránh phình bộ nhớ vô hạn
  renderLogBlocks();
}

// Đọc response dạng streaming (text/plain, flush từng dòng ở server) và gọi
// onLine cho mỗi dòng nhận được, trả về danh sách control-lines (DONE_OK...).
async function streamRequest(url, options, onLine) {
  const res = await fetch(url, options);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    onLine('❌ Lỗi request: ' + (text || res.status));
    return [];
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const controls = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (CONTROL_LINES.has(line)) {
        controls.push(line);
      } else {
        onLine(line);
      }
    }
  }
  if (buf && !CONTROL_LINES.has(buf)) onLine(buf);
  else if (CONTROL_LINES.has(buf)) controls.push(buf);
  return controls;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

// ---- status / config ----

// deviceConnected: có thiết bị đang kết nối hay không. Cần cho việc tự nạp
// danh sách package khi mở tab — chưa kết nối mà vẫn gọi thì chỉ tổ đổ ra một
// dòng lỗi đỏ mỗi lần người dùng bấm sang tab đó.
let deviceConnected = false;

function setStatusBadge(status) {
  deviceConnected = !!status.connected;
  const el = document.getElementById('statusBadge');
  const wifiWrap = document.getElementById('wifiSSIDWrap');
  if (status.connected) {
    el.className = 'badge ok';
    el.querySelector('span:last-child').textContent =
      `${status.device} · SDK ${status.sdk || '?'} · ${status.abi || '?'}`;
    if (status.wifiSSID) {
      wifiWrap.style.display = '';
      document.getElementById('wifiSSIDValue').textContent = '📶 ' + status.wifiSSID;
    } else {
      wifiWrap.style.display = '';
      document.getElementById('wifiSSIDValue').textContent = '⚠️ Không xác định được (thiết bị có thể không dùng dumpsys wifi chuẩn)';
    }
  } else {
    el.className = 'badge off';
    el.querySelector('span:last-child').textContent = 'Chưa kết nối';
    wifiWrap.style.display = 'none';
  }
}

function applyConfigToForm(cfg) {
  document.getElementById('ip').value = cfg.ip || '';
  document.getElementById('port').value = cfg.port || '';
  document.getElementById('folderPath').value = cfg.lastFolder || '';
  const hint = document.getElementById('adbHint');
  hint.textContent = cfg.adbFound
    ? 'adb đã được kèm sẵn trong app, không cần cài đặt.'
    : '⚠️ Không giải nén được adb kèm sẵn — thử khởi động lại app.';
  setStatusBadge(cfg);
  quickInstalls = cfg.quickInstalls || [];
  renderQuickList();
  favoriteSet = new Set(cfg.favoritePackages || []);
  renderFavoritesTab();
  renderPackages();
}

async function refreshStatus() {
  // Ở chế độ demo phải bỏ qua: refreshStatus() được gọi lúc khởi động và không
  // await, nên nếu người dùng mở thẳng bằng ?demo=1 thì enterDemoMode() chạy
  // trước, rồi promise này về sau mới xong và ghi đè danh sách cài nhanh demo
  // bằng dữ liệu thật — demo hiện ra danh sách thật, sai hoàn toàn ý nghĩa.
  if (demoMode) return null;
  const status = await getJSON('/api/status');
  if (demoMode) return null; // demo có thể vừa được bật trong lúc đang chờ mạng
  applyConfigToForm(status);
  return status;
}

function currentConfigBody() {
  return {
    ip: document.getElementById('ip').value.trim(),
    port: document.getElementById('port').value.trim(),
  };
}

document.getElementById('btnSaveConfig').addEventListener('click', async () => {
  if (demoMode) {
    appendLog('🧪 (demo) Demo chỉ mô phỏng giao diện, không lưu vào cấu hình thật.');
    return;
  }
  const cfg = await postJSON('/api/config', currentConfigBody());
  applyConfigToForm(cfg);
  appendLog('💾 Đã lưu cấu hình.');
});

document.getElementById('btnOpenGuide').addEventListener('click', () => {
  window.open('guide.html', '_blank');
});

// ---- 2 mã bấm trên app Điện thoại của xe ----
// Bước 4 (vào menu ẩn): #*(tháng+10)(ngày)(giờ 12h)
// Bước 8 (bật chế độ ADB): #*(tháng+5)(ngày)(giờ 12h)
// Cùng công thức, chỉ khác số cộng vào tháng. Tính sẵn cả hai vì cả hai đều
// đổi theo từng khung giờ và tự nhẩm rất dễ sai.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function computeCarCode(date, monthOffset) {
  const month = date.getMonth() + 1 + monthOffset;
  const day = date.getDate();
  const hour12 = date.getHours() % 12 || 12;
  return `#*${pad2(month)}${pad2(day)}${pad2(hour12)}`;
}

function updateEngineeringCode() {
  const now = new Date();
  document.getElementById('engCode').value = computeCarCode(now, 10);
  document.getElementById('adbCode').value = computeCarCode(now, 5);
}

async function copyCode(inputId) {
  const code = document.getElementById(inputId).value;
  try {
    await navigator.clipboard.writeText(code);
    appendLog('📋 Đã copy mã: ' + code);
  } catch {
    appendLog('⚠️ Không copy được tự động, hãy copy thủ công: ' + code);
  }
}

document.getElementById('btnCopyEngCode').addEventListener('click', () => copyCode('engCode'));
document.getElementById('btnCopyAdbCode').addEventListener('click', () => copyCode('adbCode'));

updateEngineeringCode();
setInterval(updateEngineeringCode, 60 * 1000);

document.getElementById('demoModeToggle').addEventListener('click', () => {
  if (demoMode) exitDemoMode();
  else enterDemoMode();
});

document.getElementById('btnTestAdb').addEventListener('click', async () => {
  const r = await getJSON('/api/adb/test');
  appendLog((r.ok ? '✅ ' : '❌ ') + r.message);
});

// ---- quick install (danh sách nhiều app) ----

let quickInstalls = [];

function renderQuickList() {
  const list = document.getElementById('quickList');
  list.innerHTML = '';
  if (!quickInstalls.some((q) => !q.hidden)) {
    list.innerHTML = '<p class="muted">Chưa có app nào — thêm ở form bên dưới.</p>';
    return;
  }
  quickInstalls.forEach((q) => {
    // Mục bị đánh dấu ẩn (app đã xác nhận không chạy được trên xe) vẫn nằm
    // trong cấu hình nhưng không hiện ra, để không ai tải nhầm vài trăm MB.
    if (q.hidden) return;
    const installedPkg = q.package && allPackages.some((p) => p.name === q.package && p.enabled);
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:10px;margin-bottom:8px;display:flex;align-items:center;gap:8px';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div>${escapeHtml(q.name || '(chưa đặt tên)')}</div>
        <div class="muted" style="font-size:11px;word-break:break-all">${escapeHtml(q.url)}</div>
      </div>
    `;
    const btn = document.createElement('button');
    if (installedPkg) {
      btn.className = 'small danger';
      btn.textContent = '🗑️ Gỡ cài đặt';
      btn.addEventListener('click', () => uninstallOnePkg(q.package));
    } else {
      btn.className = 'small primary';
      btn.textContent = '⚡ Cài đặt';
      btn.addEventListener('click', () => runQuickInstall(q));
    }
    row.appendChild(btn);

    list.appendChild(row);
  });
}

async function persistQuickInstalls() {
  if (demoMode) return;
  await postJSON('/api/config', { quickInstalls });
}

document.getElementById('btnAddQuick').addEventListener('click', () => {
  const name = document.getElementById('newQuickName').value.trim();
  const url = document.getElementById('newQuickUrl').value.trim();
  if (!url) { appendLog('❌ Chưa nhập URL.'); return; }
  quickInstalls.push({ name: name || url.split('/').pop(), url });
  document.getElementById('newQuickName').value = '';
  document.getElementById('newQuickUrl').value = '';
  renderQuickList();
  if (demoMode) {
    appendLog('🧪 (demo) Đã thêm vào danh sách (không lưu thật).');
  } else {
    persistQuickInstalls();
    appendLog('💾 Đã thêm & lưu app cài nhanh.');
  }
});

async function runQuickInstall(q) {
  if (demoMode) {
    // Mô phỏng đầy đủ y như luồng thật: tải (có %) → cài (có %) → mở app,
    // rồi đánh dấu đã cài để nút đổi thành "Gỡ cài đặt".
    const sizeMB = DEMO_SIZES[q.name] || 42.0;
    const fakePkg = q.package || demoPkgNameFor(q.name);
    clearLog();
    appendLog(`⬇️  Đang tải: ${q.url} (demo)`);
    await sleep(300);
    appendLog('   🔗 Link rút gọn/chia sẻ → link tải trực tiếp (demo)');
    await demoProgress('download', sizeMB, 16, 90);
    appendLog(`   ✅ Đã tải xong (${sizeMB.toFixed(1)} MB): ${q.name}.apk (demo)`);

    const ok = await demoInstall(`${q.name}.apk`, sizeMB);
    if (!ok) return;

    appendLog(`🚀 Đang mở app ${fakePkg} ... (demo)`);
    await sleep(300);
    appendLog('   ✅ Đã mở app. (demo)');

    q.package = fakePkg;
    if (!allPackages.some((p) => p.name === fakePkg)) {
      allPackages.push({ name: fakePkg, label: q.name, enabled: true });
    }
    renderPackages();
    renderFavoritesTab();
    renderQuickList();

    return;
  }
  clearLog();
  await streamRequest('/api/quick-install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: q.url }),
  }, appendLog);
  await maybePromptConflictRetry(() => runQuickInstall(q));
}

// ---- connect / device picker ----

document.getElementById('btnConnect').addEventListener('click', async () => {
  if (demoMode) return demoConnect();
  clearLog();
  // Lưu IP/port đang gõ trước khi kết nối — nếu không, server vẫn dùng
  // giá trị đã lưu từ trước và refreshStatus() cuối cùng sẽ "trả" ô IP về giá trị cũ.
  await postJSON('/api/config', currentConfigBody());
  const controls = await streamRequest('/api/connect', { method: 'POST' }, appendLog);
  document.getElementById('deviceSelectWrap').style.display = controls.includes('MULTI_DEVICE') ? 'block' : 'none';
  if (controls.includes('MULTI_DEVICE')) {
    const { devices } = await getJSON('/api/devices');
    const sel = document.getElementById('deviceSelect');
    sel.innerHTML = '';
    (devices || []).forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
  }
  await refreshStatus();
});

document.getElementById('btnPickDevice').addEventListener('click', async () => {
  const serial = document.getElementById('deviceSelect').value;
  if (!serial) return;
  await streamRequest('/api/select-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial }),
  }, appendLog);
  document.getElementById('deviceSelectWrap').style.display = 'none';
  await refreshStatus();
});

// ---- tabs ----

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.tabpane[data-pane="${btn.dataset.tab}"]`).classList.add('active');

    // Mở tab cần danh sách package thì tự nạp luôn, khỏi bắt người dùng bấm
    // thêm một nút nữa. Chỉ nạp khi CHƯA có dữ liệu — liệt kê qua Wi-Fi mất
    // vài giây, nạp lại mỗi lần chuyển tab sẽ giật và mất công vô ích. Muốn
    // làm mới thì vẫn còn nút "Liệt kê package".
    const needsPackages = btn.dataset.tab === 'packages' || btn.dataset.tab === 'favorites';
    if (needsPackages && allPackages.length === 0 && (demoMode || deviceConnected)) {
      loadPackages({ silent: true });
    }
  });
});

// ---- install: upload (drag&drop / picker) ----

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('click', () => fileInput.click());
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
fileInput.addEventListener('change', (e) => uploadFiles(e.target.files));

async function uploadFiles(fileList) {
  if (!fileList || !fileList.length) return;
  if (demoMode) return demoUploadFiles(fileList);
  const form = new FormData();
  for (const f of fileList) form.append('files', f);
  clearLog();
  appendLog(`⬆️  Đang tải lên ${fileList.length} file ...`);
  await streamRequest('/api/install/upload', { method: 'POST', body: form }, appendLog);
  fileInput.value = '';
}

// ---- install: folder scan ----

let currentFolderFiles = [];
let lastScanDeviceChecked = true;
let hiddenFilePaths = new Set();
let visibleFolderFiles = [];

function renderFolderTable() {
  const tbody = document.querySelector('#folderTable tbody');
  tbody.innerHTML = '';
  visibleFolderFiles = currentFolderFiles.filter((f) => !hiddenFilePaths.has(f.path));
  visibleFolderFiles.forEach((f) => {
    const tr = document.createElement('tr');
    const sizeText = f.sizeKB > 1024 ? (f.sizeKB / 1024).toFixed(1) + ' MB' : f.sizeKB + ' KB';
    const notInstalled = lastScanDeviceChecked && !f.installed;
    const struckClass = notInstalled ? 'struck' : '';
    const disabledTag = f.disabledOnDevice ? '<span class="tag">Đã ẩn</span>' : '';
    tr.innerHTML = `
      <td></td>
      <td class="${struckClass}">${escapeHtml(f.name)}${disabledTag}</td>
      <td class="pkg ${struckClass}">${appLabelCell(f.package, f.label)}</td>
      <td>${sizeText}</td>
      <td class="actions"></td>
    `;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rowCheck';
    checkbox.dataset.path = f.path;
    tr.children[0].appendChild(checkbox);

    const actions = tr.querySelector('.actions');

    const btnInstall = document.createElement('button');
    btnInstall.className = 'small primary';
    btnInstall.textContent = 'Cài đặt';
    btnInstall.addEventListener('click', () => installOnePath(f.path));
    actions.appendChild(btnInstall);

    const btnUninstall = document.createElement('button');
    btnUninstall.className = 'small danger';
    btnUninstall.textContent = 'Gỡ cài đặt';
    let disabledReason = '';
    if (!f.package) disabledReason = 'Không xác định được package name';
    else if (!lastScanDeviceChecked) disabledReason = 'Chưa kết nối thiết bị nên không biết app đã cài hay chưa';
    else if (!f.installed) disabledReason = 'App này chưa được cài trên thiết bị';
    btnUninstall.disabled = !!disabledReason;
    btnUninstall.title = disabledReason;
    btnUninstall.addEventListener('click', () => uninstallOnePkg(f.package));
    actions.appendChild(btnUninstall);

    tbody.appendChild(tr);
  });
  const hint = lastScanDeviceChecked ? '' : ' — chưa kết nối thiết bị nên không biết app nào đã cài';
  const hiddenCount = hiddenFilePaths.size;
  document.getElementById('folderSummary').textContent =
    `${visibleFolderFiles.length} file hiển thị${hiddenCount ? ` (đã ẩn ${hiddenCount})` : ''}${hint}`;
  document.getElementById('btnInstallAll').disabled = visibleFolderFiles.length === 0;
  const btnShow = document.getElementById('btnShowHiddenFiles');
  btnShow.style.display = hiddenCount ? '' : 'none';
  btnShow.textContent = `Hiện lại (${hiddenCount})`;
}

document.getElementById('btnHideSelectedFiles').addEventListener('click', async () => {
  const checked = Array.from(document.querySelectorAll('#folderTable .rowCheck:checked'));
  if (!checked.length) return;

  // File đã cài + biết package -> ẩn THẬT trên thiết bị (giống tab Danh sách package).
  // File chưa cài / không rõ package -> chỉ ẩn khỏi danh sách xem (không có gì để disable).
  const toDisable = [];
  checked.forEach((c) => {
    const f = currentFolderFiles.find((x) => x.path === c.dataset.path);
    if (f && f.package && f.installed) {
      toDisable.push(f);
    } else {
      hiddenFilePaths.add(c.dataset.path);
    }
  });

  if (toDisable.length) {
    clearLog();
    const pkgs = toDisable.map((f) => f.package);
    if (demoMode) {
      for (const name of pkgs) {
        appendLog(`🙈 Đang ẩn ${name} ... (demo)`);
        await sleep(200);
        appendLog('   ✅ Đã ẩn trên thiết bị (demo)');
      }
    } else {
      await streamRequest('/api/packages/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: pkgs }),
      }, appendLog);
    }
    toDisable.forEach((f) => { f.installed = false; f.disabledOnDevice = true; });
  }
  renderFolderTable();
});

document.getElementById('btnShowHiddenFiles').addEventListener('click', () => {
  hiddenFilePaths.clear();
  renderFolderTable();
});

async function installOnePath(path) {
  if (demoMode) {
    const f = currentFolderFiles.find((x) => x.path === path);
    const ok = await demoInstall(f ? f.name : path.split('/').pop());
    if (f && ok) { f.installed = true; f.disabledOnDevice = false; renderFolderTable(); }
    return;
  }
  clearLog();
  const controls = await streamRequest('/api/install-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }, appendLog);
  if (controls.includes('RESULT_OK')) {
    currentFolderFiles.forEach((f) => { if (f.path === path) { f.installed = true; f.disabledOnDevice = false; } });
    renderFolderTable();
  }
  await maybePromptConflictRetry(() => installOnePath(path));
}

async function uninstallOnePkg(pkg) {
  if (!pkg) return;
  if (demoMode) {
    await demoUninstall(pkg);
    currentFolderFiles.forEach((f) => { if (f.package === pkg) { f.installed = false; f.disabledOnDevice = false; } });
    renderFolderTable();
    allPackages = allPackages.filter((p) => p.name !== pkg);
    renderPackages();
    renderFavoritesTab();
    return;
  }
  clearLog();
  const controls = await streamRequest('/api/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg }),
  }, appendLog);
  if (controls.includes('RESULT_OK')) {
    currentFolderFiles.forEach((f) => { if (f.package === pkg) { f.installed = false; f.disabledOnDevice = false; } });
    renderFolderTable();
    allPackages = allPackages.filter((p) => p.name !== pkg);
    renderPackages();
    renderFavoritesTab();
  }
}

document.getElementById('btnScanFolder').addEventListener('click', async () => {
  const path = document.getElementById('folderPath').value.trim();
  if (!path) return;
  if (demoMode) {
    currentFolderFiles = DEMO_FILES.map((o) => ({ ...o }));
    lastScanDeviceChecked = true;
    hiddenFilePaths.clear();
    renderFolderTable();
    appendLog('🧪 (demo) Đã quét folder mẫu: ' + path);
    return;
  }
  const res = await fetch('/api/scan-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  if (!res.ok) {
    appendLog('❌ ' + (data.error || 'Lỗi không xác định'));
    return;
  }
  hiddenFilePaths.clear();
  currentFolderFiles = data.files || [];
  lastScanDeviceChecked = !!data.deviceChecked;
  renderFolderTable();
});

document.getElementById('btnInstallAll').addEventListener('click', async () => {
  clearLog();
  for (const f of visibleFolderFiles) {
    appendLog(`── ${f.name} ──`);
    if (demoMode) {
      const ok = await demoInstall(f.name);
      if (ok) { f.installed = true; f.disabledOnDevice = false; }
      continue;
    }
    await streamRequest('/api/install-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: f.path }),
    }, appendLog);
  }
  if (demoMode) renderFolderTable();
  appendLog('🏁 Đã cài xong tất cả.');
});

// ---- packages ----

let allPackages = [];

// packagesLoading: chặn nạp chồng khi người dùng bấm qua lại giữa các tab
// trong lúc lần nạp trước còn chạy (liệt kê package qua Wi-Fi mất vài giây).
let packagesLoading = false;

async function loadPackages({ silent = false } = {}) {
  if (packagesLoading) return;
  packagesLoading = true;
  try {
    if (demoMode) {
      allPackages = DEMO_PACKAGES.map((o) => ({ ...o }));
      renderPackages();
      renderFavoritesTab();
      if (!silent) appendLog('🧪 (demo) Danh sách package mẫu.');
      return;
    }
    const r = await getJSON('/api/packages');
    if (r.error) {
      if (!silent) appendLog('❌ ' + r.error);
      return;
    }
    allPackages = r.packages || [];
    renderPackages();
    renderFavoritesTab();
  } finally {
    packagesLoading = false;
  }
}

document.getElementById('btnListPackages').addEventListener('click', () => loadPackages());

document.getElementById('pkgFilter').addEventListener('input', renderPackages);

function renderPackages() {
  const filter = document.getElementById('pkgFilter').value.trim().toLowerCase();
  const tbody = document.querySelector('#pkgTable tbody');
  tbody.innerHTML = '';
  // Danh sách LUÔN hiện đủ (không xoá dòng) — app bị ẩn trên thiết bị vẫn
  // hiển thị, chỉ khác trạng thái + đổi nút Ẩn thành Hiện lại.
  const visible = allPackages.filter(
    (p) => p.name.toLowerCase().includes(filter) || (p.label || '').toLowerCase().includes(filter)
  );
  visible.forEach((p) => {
    const tr = document.createElement('tr');
    const struckClass = p.enabled ? '' : 'struck';
    const tag = p.enabled ? '' : '<span class="tag">Đã ẩn</span>';
    const favTag = favoriteSet.has(p.name) ? '<span class="tag" style="color:var(--accent)">⭐ Yêu thích</span>' : '';
    tr.innerHTML = `<td></td><td class="${struckClass}">${appLabelCell(p.name, p.label)}${tag}${favTag}</td><td class="actions"></td>`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rowCheck';
    checkbox.dataset.pkg = p.name;
    tr.children[0].appendChild(checkbox);

    const actions = tr.querySelector('.actions');

    const btnToggle = document.createElement('button');
    btnToggle.className = 'small';
    btnToggle.textContent = p.enabled ? '🙈 Ẩn' : '👁️ Hiện lại';
    btnToggle.addEventListener('click', () => toggleOnePkgEnabled(p.name, !p.enabled));
    actions.appendChild(btnToggle);

    const btnUninstall = document.createElement('button');
    btnUninstall.className = 'small danger';
    btnUninstall.textContent = 'Gỡ cài đặt';
    btnUninstall.addEventListener('click', () => uninstallOnePkg(p.name));
    actions.appendChild(btnUninstall);

    tbody.appendChild(tr);
  });
  document.getElementById('pkgFilter').title =
    allPackages.length && !allPackages.some((p) => p.label)
      ? 'Chưa có tên app nào được nhận diện — quét 1 folder chứa APK của các app này để app tự học tên hiển thị.'
      : '';
  const hiddenCount = allPackages.filter((p) => !p.enabled).length;
  const btnShowAll = document.getElementById('btnShowAllHiddenPkgs');
  btnShowAll.style.display = hiddenCount ? '' : 'none';
  btnShowAll.textContent = `👁️ Hiện tất cả đã ẩn (${hiddenCount})`;
  // Tab Cài nhanh cần biết app nào đã cài để đổi nút Cài đặt <-> Gỡ cài đặt,
  // nên luôn vẽ lại cùng lúc với danh sách package thay vì rải rác từng nơi gọi.
  renderQuickList();
}

// ---- favorites ----

let favoriteSet = new Set();

function renderFavoritesTab() {
  const tbody = document.querySelector('#favoritesTable tbody');
  tbody.innerHTML = '';
  const names = Array.from(favoriteSet);
  names.forEach((name) => {
    const p = allPackages.find((x) => x.name === name) || { name, label: '', enabled: true };
    const tr = document.createElement('tr');
    const struckClass = p.enabled ? '' : 'struck';
    const tag = p.enabled ? '' : '<span class="tag">Đã ẩn</span>';
    tr.innerHTML = `<td class="${struckClass}">${appLabelCell(p.name, p.label)}${tag}</td><td class="actions"></td>`;
    const actions = tr.querySelector('.actions');

    const btnToggle = document.createElement('button');
    btnToggle.className = 'small';
    btnToggle.textContent = p.enabled ? '🙈 Ẩn' : '👁️ Hiện lại';
    btnToggle.addEventListener('click', () => toggleOnePkgEnabled(p.name, !p.enabled));
    actions.appendChild(btnToggle);

    const btnUninstall = document.createElement('button');
    btnUninstall.className = 'small danger';
    btnUninstall.textContent = 'Gỡ cài đặt';
    btnUninstall.addEventListener('click', () => uninstallOnePkg(p.name));
    actions.appendChild(btnUninstall);

    const btnRemove = document.createElement('button');
    btnRemove.className = 'small ghost';
    btnRemove.textContent = '➖ Bỏ khỏi Yêu thích';
    btnRemove.addEventListener('click', () => removeFromFavorites(p.name));
    actions.appendChild(btnRemove);

    tbody.appendChild(tr);
  });
  document.getElementById('favoritesTabBtn').textContent = `⭐ Yêu thích (${names.length})`;
}

async function persistFavoriteSet() {
  if (demoMode) return;
  await postJSON('/api/config', { favoritePackages: Array.from(favoriteSet) });
}

function removeFromFavorites(name) {
  favoriteSet.delete(name);
  renderFavoritesTab();
  renderPackages();
  persistFavoriteSet();
}

document.getElementById('btnAddSelectedToFavorites').addEventListener('click', () => {
  const checked = Array.from(document.querySelectorAll('#pkgTable .rowCheck:checked'));
  if (!checked.length) return;
  checked.forEach((c) => favoriteSet.add(c.dataset.pkg));
  renderPackages();
  renderFavoritesTab();
  persistFavoriteSet();
  appendLog(demoMode ? '🧪 (demo) Đã thêm vào Yêu thích (không lưu thật).' : '⭐ Đã thêm vào danh sách Yêu thích.');
});

async function toggleOnePkgEnabled(pkg, enable) {
  if (demoMode) {
    clearLog();
    appendLog(`${enable ? '👁️  Đang hiện lại' : '🙈 Đang ẩn'} ${pkg} ... (demo)`);
    await sleep(300);
    appendLog('   ✅ ' + (enable ? 'Đã bật lại' : 'Đã ẩn trên thiết bị') + ' (demo)');
    const p = allPackages.find((x) => x.name === pkg);
    if (p) p.enabled = enable;
    renderPackages();
    renderFavoritesTab();
    return;
  }
  clearLog();
  const url = enable ? '/api/packages/enable' : '/api/packages/disable';
  await streamRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packages: [pkg] }),
  }, appendLog);
  const p = allPackages.find((x) => x.name === pkg);
  if (p) p.enabled = enable;
  renderPackages();
  renderFavoritesTab();
}

document.getElementById('btnHideSelectedPkgs').addEventListener('click', async () => {
  const checked = Array.from(document.querySelectorAll('#pkgTable .rowCheck:checked'));
  const pkgs = checked.map((c) => c.dataset.pkg).filter((name) => {
    const p = allPackages.find((x) => x.name === name);
    return p && p.enabled;
  });
  if (!pkgs.length) return;
  if (demoMode) {
    clearLog();
    for (const name of pkgs) {
      appendLog(`🙈 Đang ẩn ${name} ... (demo)`);
      await sleep(200);
      appendLog('   ✅ Đã ẩn trên thiết bị (demo)');
    }
  } else {
    clearLog();
    await streamRequest('/api/packages/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: pkgs }),
    }, appendLog);
  }
  pkgs.forEach((name) => {
    const p = allPackages.find((x) => x.name === name);
    if (p) p.enabled = false;
  });
  renderPackages();
  renderFavoritesTab();
});

document.getElementById('btnShowAllHiddenPkgs').addEventListener('click', async () => {
  const pkgs = allPackages.filter((p) => !p.enabled).map((p) => p.name);
  if (!pkgs.length) return;
  if (demoMode) {
    clearLog();
    for (const name of pkgs) {
      appendLog(`👁️  Đang hiện lại ${name} ... (demo)`);
      await sleep(200);
      appendLog('   ✅ Đã bật lại (demo)');
    }
  } else {
    clearLog();
    await streamRequest('/api/packages/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: pkgs }),
    }, appendLog);
  }
  pkgs.forEach((name) => {
    const p = allPackages.find((x) => x.name === name);
    if (p) p.enabled = true;
  });
  renderPackages();
  renderFavoritesTab();
});

// ---- device tools ----

document.getElementById('btnDevSettings').addEventListener('click', async () => {
  if (demoMode) return demoDevSettings();
  clearLog();
  await streamRequest('/api/dev-settings', { method: 'POST' }, appendLog);
  await refreshStatus();
});

document.getElementById('btnRunShell').addEventListener('click', async () => {
  const cmd = document.getElementById('shellCmd').value.trim();
  if (!cmd) return;
  clearLog();
  if (demoMode) {
    appendLog('$ adb shell ' + cmd + ' (demo)');
    await sleep(300);
    appendLog('✅ Đã chạy xong (demo).');
    return;
  }
  await streamRequest('/api/adb/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd }),
  }, appendLog);
});


// ---- init ----

refreshStatus();

if (new URLSearchParams(window.location.search).get('demo') === '1') {
  enterDemoMode();
}
