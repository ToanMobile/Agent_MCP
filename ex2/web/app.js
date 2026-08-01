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
  { name: 'com.google.android.gms', label: 'Google Play Services', enabled: true },
  { name: 'com.google.android.apps.maps', label: 'Google Maps', enabled: false },
  { name: 'vn.vietmap.live', label: 'VietMap Live', enabled: true },
  { name: 'com.waze', label: 'Waze', enabled: true },
  { name: 'com.spotify.music', label: '', enabled: false },
  { name: 'com.termux', label: '', enabled: true },
];

const DEMO_QUICK_INSTALLS = [
  { name: 'App Demo 1', url: 'https://example.com/demo1.apk' },
  { name: 'App Demo 2', url: 'https://example.com/demo2.apk' },
];

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

async function demoInstall(name) {
  clearLog();
  appendLog(`📦 ${name} ... (demo)`);
  await sleep(500);
  if (name === 'OldNavApp.apk') {
    appendLog('❌ Cài đặt thất bại: ' + name);
    appendLog('   💡 App đã cài sẵn nhưng khác chữ ký (bản mod vs bản gốc). (demo)');
    appendLog('   ↳ Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]');
    await sleep(400);
    appendLog('   💡 Xung đột cài đặt. Bật "Tự gỡ bản cũ khi xung đột" trong Cài đặt, hoặc vào tab Gỡ cài đặt để gỡ thủ công rồi cài lại. (demo)');
    return;
  }
  appendLog('✅ Cài đặt thành công: ' + name + ' (demo)');
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
  currentFolderFiles = DEMO_FILES.slice();
  renderFolderTable();
  allPackages = DEMO_PACKAGES.slice();
  favoriteSet = new Set(['vn.vietmap.live', 'com.waze']);
  renderPackages();
  renderFavoritesTab();
  quickInstalls = DEMO_QUICK_INSTALLS.slice();
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

function appendLog(line) {
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
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

function clearLog() {
  logEl.textContent = '';
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

function setStatusBadge(status) {
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
  document.getElementById('adbPath').value = cfg.adbPath || '';
  document.getElementById('folderPath').value = cfg.lastFolder || '';
  const toggle = document.getElementById('autoUninstallToggle');
  toggle.classList.toggle('on', !!cfg.autoUninstall);
  const hint = document.getElementById('adbHint');
  hint.textContent = cfg.adbFound ? '' : '⚠️ Chưa tìm thấy adb ở đường dẫn này.';
  setStatusBadge(cfg);
  quickInstalls = cfg.quickInstalls || [];
  renderQuickList();
  favoriteSet = new Set(cfg.favoritePackages || []);
  renderFavoritesTab();
  renderPackages();
}

async function refreshStatus() {
  const status = await getJSON('/api/status');
  applyConfigToForm(status);
  return status;
}

function currentConfigBody() {
  return {
    ip: document.getElementById('ip').value.trim(),
    port: document.getElementById('port').value.trim(),
    adbPath: document.getElementById('adbPath').value.trim(),
    autoUninstall: document.getElementById('autoUninstallToggle').classList.contains('on'),
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

// ---- mã bấm vào menu ẩn (Engineering Mode), công thức #*(tháng+10)(ngày)(giờ 12h) ----

function pad2(n) {
  return String(n).padStart(2, '0');
}

function computeEngineeringCode(date) {
  const month = date.getMonth() + 1 + 10;
  const day = date.getDate();
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  return `#*${pad2(month)}${pad2(day)}${pad2(hour12)}`;
}

function updateEngineeringCode() {
  document.getElementById('engCode').value = computeEngineeringCode(new Date());
}

document.getElementById('btnCopyEngCode').addEventListener('click', async () => {
  const code = document.getElementById('engCode').value;
  try {
    await navigator.clipboard.writeText(code);
    appendLog('📋 Đã copy mã: ' + code);
  } catch {
    appendLog('⚠️ Không copy được tự động, hãy copy thủ công: ' + code);
  }
});

updateEngineeringCode();
setInterval(updateEngineeringCode, 60 * 1000);

document.getElementById('autoUninstallToggle').addEventListener('click', async () => {
  if (demoMode) {
    document.getElementById('autoUninstallToggle').classList.toggle('on');
    appendLog('🧪 (demo) Demo chỉ mô phỏng giao diện, không lưu vào cấu hình thật.');
    return;
  }
  const cfg = await postJSON('/api/toggle-auto-uninstall', {});
  applyConfigToForm(cfg);
});

document.getElementById('demoModeToggle').addEventListener('click', () => {
  if (demoMode) exitDemoMode();
  else enterDemoMode();
});

document.getElementById('btnDetectAdb').addEventListener('click', async () => {
  const r = await getJSON('/api/adb/detect');
  if (r.found) {
    document.getElementById('adbPath').value = r.found;
    appendLog('✅ Tìm thấy adb: ' + r.found);
  } else {
    appendLog('❌ Không tự dò được adb. Đã thử: \n  ' + (r.candidates || []).join('\n  '));
  }
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
  if (!quickInstalls.length) {
    list.innerHTML = '<p class="muted">Chưa có app nào — thêm ở form bên dưới.</p>';
    return;
  }
  quickInstalls.forEach((q, idx) => {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:10px;margin-bottom:8px;display:flex;align-items:center;gap:8px';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div>${escapeHtml(q.name || '(chưa đặt tên)')}</div>
        <div class="muted" style="font-size:11px;word-break:break-all">${escapeHtml(q.url)}</div>
      </div>
    `;
    const btnInstall = document.createElement('button');
    btnInstall.className = 'small primary';
    btnInstall.textContent = '⚡ Cài đặt';
    btnInstall.addEventListener('click', () => runQuickInstall(q));
    row.appendChild(btnInstall);

    const btnRemove = document.createElement('button');
    btnRemove.className = 'small ghost';
    btnRemove.textContent = '🗑️';
    btnRemove.title = 'Xoá khỏi danh sách cài nhanh';
    btnRemove.addEventListener('click', () => removeQuickInstall(idx));
    row.appendChild(btnRemove);

    list.appendChild(row);
  });
}

async function persistQuickInstalls() {
  if (demoMode) return;
  await postJSON('/api/config', { quickInstalls });
}

function removeQuickInstall(idx) {
  quickInstalls.splice(idx, 1);
  renderQuickList();
  persistQuickInstalls();
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
    clearLog();
    appendLog(`⬇️  Đang tải ${q.name} ... (demo)`);
    await sleep(500);
    appendLog('   🔗 Link GitHub → link tải trực tiếp (demo)');
    await sleep(300);
    appendLog('   ✅ Đã tải xong (demo)');
    await demoInstall((q.name || 'app') + '.apk');
    return;
  }
  clearLog();
  await streamRequest('/api/quick-install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: q.url }),
  }, appendLog);
}

// ---- connect / device picker ----

document.getElementById('btnConnect').addEventListener('click', async () => {
  if (demoMode) return demoConnect();
  clearLog();
  // Lưu IP/port/adbPath đang gõ trước khi kết nối — nếu không, server vẫn dùng
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
    await demoInstall(f ? f.name : path.split('/').pop());
    if (f) { f.installed = true; f.disabledOnDevice = false; renderFolderTable(); }
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
    currentFolderFiles = DEMO_FILES.slice();
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
      await demoInstall(f.name);
      continue;
    }
    await streamRequest('/api/install-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: f.path }),
    }, appendLog);
  }
  appendLog('🏁 Đã cài xong tất cả.');
});

// ---- packages ----

let allPackages = [];

document.getElementById('btnListPackages').addEventListener('click', async () => {
  if (demoMode) {
    allPackages = DEMO_PACKAGES.slice();
    renderPackages();
    appendLog('🧪 (demo) Danh sách package mẫu.');
    return;
  }
  const r = await getJSON('/api/packages');
  if (r.error) { appendLog('❌ ' + r.error); return; }
  allPackages = r.packages || [];
  renderPackages();
});

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
