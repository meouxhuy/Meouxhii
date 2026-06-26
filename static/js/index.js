let currentData = { results: [], channel_name: "MeoU" };
let temporaryStorage = [];
let isCurrentSaved = false;
let loadingInterval;
let isScanning = false;
let scanAbortController = null;

// ─── Scan button state ────────────────────────────────────────
function setScanningState(scanning) {
  isScanning = scanning;
  const btn = document.getElementById('scanBtn');
  if (scanning) {
    btn.innerHTML = `
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
      </svg>
      Ngừng Quét`;
    btn.classList.remove('bg-meou-main');
    btn.classList.add('bg-red-500', 'hover:bg-red-600');
  } else {
    btn.innerHTML = `
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      Quét Ngay`;
    btn.classList.add('bg-meou-main');
    btn.classList.remove('bg-red-500', 'hover:bg-red-600');
  }
}

// ─── Gửi hủy scan lên server ──────────────────────────────────
async function sendCancelToServer() {
  try {
    await fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch (_) {}
}

// ─── Thanh tiến trình ─────────────────────────────────────────
function showProgressBarImmediate() {
  // Hiện ngay lập tức khi bắt đầu scan, trước khi có SSE event
  document.getElementById('scanProgressContainer').classList.remove('hidden');
  const fill = document.getElementById('scanProgressFill');
  fill.style.width = '0%';
  fill.style.background = 'linear-gradient(90deg,#a18cd1,#8ec5fc)';
  document.getElementById('scanProgressText').textContent = '...';
  const label = document.getElementById('scanProgressLabel');
  if (label) {
    label.textContent = 'Tiến Trình';
    label.className = 'shimmer-text';
  }
}

function updateProgressBar(done, total) {
  const container = document.getElementById('scanProgressContainer');
  const fill = document.getElementById('scanProgressFill');
  const text = document.getElementById('scanProgressText');
  if (total === 0) {
    container.classList.add('hidden');
    fill.style.width = '0%';
    text.textContent = '0%';
    return;
  }
  container.classList.remove('hidden');
  const percent = Math.round((done / total) * 100);
  fill.style.width = percent + '%';
  text.textContent = percent + '%';
}

// ─── Loading messages (Đã chuyển sang file messages.js) ─────────────────

// ─── Flatpickr ────────────────────────────────────────────────
const fpkConfig = {
  locale: "vn",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  maxDate: "today",
  disableMobile: "true"
};
const startPicker = flatpickr("#startDate", { ...fpkConfig, onChange: (d, str) => endPicker.set("minDate", str) });
const endPicker = flatpickr("#endDate", fpkConfig);

// ─── Alert ────────────────────────────────────────────────────
function showMeoUAlert(m) {
  const b = document.getElementById('meouAlert');
  document.getElementById('alertMsg').innerText = m;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 3500);
}

// ─── Excel Export ─────────────────────────────────────────────
function exportToExcelCore(arr, f) {
  const rows = [["Ngày Đăng", "Channel Name", "Link YouTube", "Loại Video", "Có Gắn Giỏ Hàng?", "Tổng SP Shopee", "Tổng SP Lazada", "Link SP", "SP Thuộc", "TỔNG SP Khác"]];
  const st = {
    alignment: { vertical: 'center', horizontal: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  };
  arr.forEach(d => {
    d.results.forEach(v => {
      let tl = v.shopping_links.filter(i => i.platform === 'Shopee' || i.platform === 'Lazada');
      if (tl.length > 0) {
        tl.forEach(l => { rows.push([v.display_date, v.channel_name, v.url, v.type, v.has_shopping ? "Có" : "Không", v.shopee_count, v.lazada_count, l.clean_url, l.platform, v.other_count]); });
      } else if (v.other_count > 0) {
        rows.push([v.display_date, v.channel_name, v.url, v.type, "Có", v.shopee_count, v.lazada_count, "", "Sàn Khác", v.other_count]);
      } else {
        rows.push([v.display_date, v.channel_name, v.url, v.type, "Không", v.shopee_count, v.lazada_count, "", "", v.other_count]);
      }
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 35 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 60 }, { wch: 12 }, { wch: 18 }];
  for (let c in ws) {
    if (c[0] === '!') continue;
    let r = XLSX.utils.decode_cell(c);
    let v = ws[c].v;
    let s = JSON.parse(JSON.stringify(st));
    if (r.r === 0) {
      s.fill = { fgColor: { rgb: "002060" } };
      s.font = { bold: true, color: { rgb: "FFFFFF" } };
    } else {
      if (r.c === 2 || r.c === 7) s.alignment.horizontal = 'left';
      if (r.c === 4) s.font = { bold: true, color: { rgb: v === "Có" ? "00B050" : "FF0000" } };
      if (r.c === 8) {
        if (v === "Shopee") s.font = { bold: true, color: { rgb: "FF8C00" } };
        else if (v === "Lazada") s.font = { bold: true, color: { rgb: "FF1493" } };
      }
    }
    ws[c].s = s;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "MeoU");
  XLSX.writeFile(wb, f);
}

// ─── Archive / Temporary Storage ──────────────────────────────
function updateArchiveUI() {
  const b = document.getElementById('archiveBadge');
  const l = document.getElementById('archiveList');
  const c = document.getElementById('archiveContainer');
  if (temporaryStorage.length === 0) {
    c.classList.add('hidden');
    document.getElementById('archiveDropdown').classList.add('hidden');
    return;
  }
  c.classList.remove('hidden');
  b.innerText = temporaryStorage.length;
  l.innerHTML = '';
  temporaryStorage.forEach((item, i) => {
    let n = item.channel_name.length > 20 ? item.channel_name.substring(0, 18) + '...' : item.channel_name;
    l.innerHTML += `<li class="flex justify-between items-center p-2 hover:bg-indigo-50 rounded-xl mb-1 border border-transparent hover:border-indigo-100 transition-colors"><span class="text-sm font-bold text-slate-600 truncate mr-2">${n}</span><div class="flex gap-1">
<button onclick="downloadSingleFile(${i})" class="p-1.5 bg-blue-50 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
<button onclick="deleteSingleFile(${i})" class="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
</div></li>`;
  });
}

window.downloadSingleFile = (i) => {
  const d = temporaryStorage[i];
  exportToExcelCore([d], `MeoU_${d.channel_name}.xlsx`);
};
window.deleteSingleFile = (i) => {
  temporaryStorage.splice(i, 1);
  updateArchiveUI();
  if (temporaryStorage.length === 0 && currentData.results.length > 0) {
    document.getElementById('saveTempBtn').classList.remove('hidden');
    isCurrentSaved = false;
  }
};

document.getElementById('saveTempBtn').addEventListener('click', () => {
  if (isCurrentSaved) return;
  temporaryStorage.push(JSON.parse(JSON.stringify(currentData)));
  isCurrentSaved = true;
  document.getElementById('saveTempBtn').classList.add('hidden');
  updateArchiveUI();
  showMeoUAlert('Đã lưu vào bộ nhớ!');
});

document.getElementById('archiveIconBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('archiveDropdown').classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('archiveContainer').contains(e.target)) {
    document.getElementById('archiveDropdown').classList.add('hidden');
  }
});

document.getElementById('exportBtn').addEventListener('click', () => exportToExcelCore([currentData], `MeoU_${currentData.channel_name}.xlsx`));

document.getElementById('deleteAllBtn').addEventListener('click', () => {
  temporaryStorage = [];
  updateArchiveUI();
  if (currentData.results.length > 0) {
    document.getElementById('saveTempBtn').classList.remove('hidden');
    isCurrentSaved = false;
  }
});

document.getElementById('downloadAllBtn').addEventListener('click', () => {
  if (temporaryStorage.length > 0) {
    exportToExcelCore(temporaryStorage, `MeoU_TongHop_${temporaryStorage.length}_Kenh.xlsx`);
  }
});

// ─── Mode Toggle ──────────────────────────────────────────────
let isBatchMode = false;
const modeToggle = document.getElementById('modeToggle');
const modeText = document.getElementById('modeText');
const linksInput = document.getElementById('linksInput');

function autoResizeTextarea() {
  linksInput.style.height = 'auto';
  linksInput.style.height = linksInput.scrollHeight + 'px';
}

linksInput.addEventListener('input', autoResizeTextarea);

linksInput.addEventListener('keydown', (e) => {
  if (!isBatchMode && e.key === 'Enter') {
    e.preventDefault();
    return false;
  }
});

function createStarBurst(x, y) {
  const starCount = 8;
  for (let i = 0; i < starCount; i++) {
    const star = document.createElement('div');
    star.className = 'star-particle';
    const angle = (360 / starCount) * i;
    const distance = 60;
    const endX = x + Math.cos(angle * Math.PI / 180) * distance;
    const endY = y + Math.sin(angle * Math.PI / 180) * distance;
    star.style.left = x + 'px';
    star.style.top = y + 'px';
    star.style.setProperty('--end-x', endX + 'px');
    star.style.setProperty('--end-y', endY + 'px');
    document.body.appendChild(star);
    setTimeout(() => star.remove(), 600);
  }
}

modeToggle.addEventListener('click', (e) => {
  const isAdmin = document.body.getAttribute('data-is-admin') === 'true';
  if (!isAdmin) {
    const deniedOverlay = document.getElementById('permissionDeniedOverlay');
    deniedOverlay.classList.remove('hidden');
    setTimeout(() => {
      deniedOverlay.classList.remove('opacity-0');
      deniedOverlay.firstElementChild.classList.remove('scale-95');
    }, 10);
    setTimeout(() => {
      deniedOverlay.classList.add('opacity-0');
      deniedOverlay.firstElementChild.classList.add('scale-95');
      setTimeout(() => deniedOverlay.classList.add('hidden'), 300);
    }, 3000);
    return;
  }
  
  const overlay = document.getElementById('modeSwitchOverlay');
  overlay.classList.add('active');
  setTimeout(() => {
    const rect = modeToggle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    createStarBurst(x, y);
    isBatchMode = !isBatchMode;
    modeToggle.classList.toggle('batch-mode');
    if (isBatchMode) {
      modeText.textContent = 'SCAN NHIỀU KÊNH';
      linksInput.placeholder = 'Dán link kênh vào đây (tối đa 100 kênh, mỗi kênh 1 dòng)...';
    } else {
      modeText.textContent = 'SCAN TỪNG KÊNH';
      linksInput.placeholder = 'Dán link kênh vào đây...';
      linksInput.value = linksInput.value.split('\n')[0] || '';
    }
    autoResizeTextarea();
    setTimeout(() => { overlay.classList.remove('active'); }, 2000);
  }, 100);
});

autoResizeTextarea();

// ─── Batch Progress (số kênh) ─────────────────────────────────
function updateBatchProgress(current, total) {
  const container = document.getElementById('batchLoadingContainer');
  const percentEl = document.getElementById('batchLoadingPercent');
  const textEl = document.getElementById('batchLoadingText');
  if (total > 1) {
    const percent = Math.round((current / total) * 100);
    container.classList.remove('hidden');
    percentEl.textContent = percent + '%';
    textEl.textContent = `Đang scan kênh ${current}/${total}`;
  } else {
    container.classList.add('hidden');
  }
}

// ─── Hàm render rows kết quả ─────────────────────────────────
function renderResults(results) {
  const tb = document.getElementById('resultTableBody');
  tb.innerHTML = '';
  results.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-indigo-50 hover:bg-indigo-50/20 transition-all";
    let tc = r.type === 'Short' ? 'text-pink-500' : (r.type === 'Stream' ? 'text-purple-600' : 'text-blue-500');
    let sh = r.has_shopping
      ? '<span class="text-emerald-500 font-extrabold text-lg">Có</span>'
      : '<span class="text-slate-300">Không</span>';
    let lh = '';
    if (r.has_shopping) {
      let tl = r.shopping_links.filter(i => i.platform === 'Shopee' || i.platform === 'Lazada');
      if (tl.length > 0) {
        const items = tl.map(i => {
          let bc = i.platform === 'Shopee'
            ? 'text-orange-500 bg-orange-50 border-orange-200'
            : 'text-blue-600 bg-blue-50 border-blue-200';
          return `<li class="mb-2 text-[13px] border-b border-indigo-50 pb-2 flex items-center gap-2"><span class="font-extrabold text-[10px] uppercase px-2 py-1 rounded border ${bc}">${i.platform}</span><a href="${i.clean_url}" target="_blank" class="text-indigo-600 hover:text-indigo-800 truncate block w-full">${i.clean_url}</a></li>`;
        }).join('');
        lh = `<div class="px-6 py-2"><button class="toggle-btn w-full bg-indigo-50 text-indigo-600 font-extrabold py-3 px-4 rounded-2xl border border-indigo-100 text-xs shadow-sm">Giỏ hàng: ${tl.length} SP ▼</button><ul class="link-list hidden mt-3 p-5 bg-white rounded-2xl border border-indigo-100 text-left custom-scrollbar overflow-y-auto max-h-48 shadow-xl">${items}</ul></div>`;
      } else {
        lh = `<span class="text-slate-400 text-sm font-medium">${r.other_count} Sản phẩm khác</span>`;
      }
    } else {
      lh = '<span class="text-slate-300">Trống</span>';
    }
    tr.innerHTML = `<td class="text-center text-sm text-slate-500 border-r border-indigo-50">${r.display_date}</td><td class="text-sm px-8 truncate border-r border-indigo-50 text-slate-400 font-medium"><a href="${r.url}" target="_blank">${r.url}</a></td><td class="text-center border-r border-indigo-50 text-xs uppercase font-black ${tc}">${r.type}</td><td class="text-center text-sm border-r border-indigo-50">${sh}</td><td class="text-center w-full">${lh}</td>`;
    tb.appendChild(tr);
    const btn = tr.querySelector('.toggle-btn');
    if (btn) btn.onclick = () => btn.nextElementSibling.classList.toggle('hidden');
  });
}

// ─── Scan Button ──────────────────────────────────────────────
document.getElementById('scanBtn').addEventListener('click', async () => {
  // Nếu đang scan thì dừng lại
  if (isScanning) {
    if (scanAbortController) scanAbortController.abort();
    return;
  }

  const u = document.getElementById('linksInput').value.split('\n').map(v => v.trim()).filter(v => v !== '');
  const s = document.getElementById('startDate').value;
  const e = document.getElementById('endDate').value;
  if (!s || !e) return showMeoUAlert('Vui lòng chọn ngày!');
  if (u.length === 0) return showMeoUAlert('Chưa dán link!');
  if (isBatchMode && u.length > 100) {
    return showMeoUAlert(`Cho Mèo thở với, scan 100 kênh một lần thôi. Hiện tại là ${u.length} kênh`);
  }
  if (!isBatchMode && u.length > 1) {
    return showMeoUAlert('Chế độ Scan Từng Kênh chỉ cho phép 1 link!');
  }

  // Reset UI
  const lD = document.getElementById('loading');
  const lT = document.getElementById('loadingText');
  lD.classList.remove('hidden');
  let mi = Math.floor(Math.random() * loadingMessages.length);
  lT.innerText = loadingMessages[mi];
  if (loadingInterval) clearInterval(loadingInterval);
  loadingInterval = setInterval(() => { 
    let newMi;
    do { newMi = Math.floor(Math.random() * loadingMessages.length); } while (newMi === mi);
    mi = newMi;
    lT.innerText = loadingMessages[mi]; 
  }, 5000);

  document.getElementById('resultTableBody').innerHTML = '';
  document.getElementById('exportBtn').classList.add('hidden');
  document.getElementById('saveTempBtn').classList.add('hidden');
  isCurrentSaved = false;

  if (u.length > 1) updateBatchProgress(0, u.length);

  setScanningState(true);
  showProgressBarImmediate(); // Hiện thanh ngay lập tức khi bấm quét
  scanAbortController = new AbortController();

  try {
    // ── SSE streaming fetch ──
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: u, startDate: s, endDate: e }),
      signal: scanAbortController.signal
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE events được phân cách bởi "\n\n"
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'waiting') {
            document.getElementById('scanProgressContainer').classList.remove('hidden');
            const fill = document.getElementById('scanProgressFill');
            fill.style.width = '100%';
            fill.style.background = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
            document.getElementById('scanProgressText').textContent = 'Xếp hàng...';
            const label = document.getElementById('scanProgressLabel');
            if (label) {
              label.innerHTML = `Đang chờ <span style="color:#fbbf24">${data.waiting_for}</span> hoàn tất...`;
              label.className = 'waiting-text';
            }
          } else if (data.type === 'progress') {
            const fill = document.getElementById('scanProgressFill');
            const label = document.getElementById('scanProgressLabel');
            if (label && label.className === 'waiting-text') {
               fill.style.background = 'linear-gradient(90deg,#a18cd1,#8ec5fc)';
               label.innerHTML = 'Tiến Trình';
               label.className = 'shimmer-text';
            }
            updateProgressBar(data.done, data.total);
          } else if (data.type === 'result') {
            currentData = data;
          }
        } catch (_) {}
      }
    }

    // Xử lý kết quả cuối cùng
    if (currentData.cancelled) {
      showMeoUAlert('Đã ngừng quét!');
    } else if (currentData.results && currentData.results.length > 0) {
      document.getElementById('exportBtn').classList.remove('hidden');
      document.getElementById('saveTempBtn').classList.remove('hidden');
      renderResults(currentData.results);
    } else {
      showMeoUAlert('Không tìm thấy video!');
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      await sendCancelToServer();
      showMeoUAlert('Đã ngừng quét!');
    } else {
      showMeoUAlert('Lỗi kết nối!');
    }
  } finally {
    clearInterval(loadingInterval);
    lD.classList.add('hidden');
    updateBatchProgress(0, 0);
    updateProgressBar(0, 0);
    setScanningState(false);
    scanAbortController = null;
  }
});

// ─── Hủy scan khi F5 / đóng tab ──────────────────────────────
window.addEventListener('beforeunload', () => {
  if (isScanning) {
    navigator.sendBeacon('/api/cancel');
  }
});

// ─── Theme Toggle ─────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggleTop');
const sunIcon = document.getElementById('sunIconTop');
const moonIcon = document.getElementById('moonIconTop');
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
  document.body.classList.add('dark-mode');
  sunIcon.classList.add('hidden');
  moonIcon.classList.remove('hidden');
}
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  if (isDark) {
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
    localStorage.setItem('theme', 'dark');
  } else {
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
    localStorage.setItem('theme', 'light');
  }
});


