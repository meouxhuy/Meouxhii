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
      <svg class="scan-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
      </svg>
      <span class="scan-lbl">Ngừng Quét</span>`;
    btn.classList.add('is-scanning');
  } else {
    btn.innerHTML = `
      <span class="scan-pulse" aria-hidden="true"></span>
      <svg class="scan-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" stroke-width="2.5"/>
        <path d="m20 20-3-3" stroke-linecap="round" stroke-width="2.5"/>
      </svg>
      <span class="scan-lbl">Quét Ngay</span>`;
    btn.classList.remove('is-scanning');
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
  // Hiện trạng thái "Đang kết nối..." ngay khi bấm scan
  const container = document.getElementById('scanProgressContainer');
  const fill = document.getElementById('scanProgressFill');
  const text = document.getElementById('scanProgressText');
  const label = document.getElementById('scanProgressLabel');
  container.classList.remove('hidden');
  fill.style.width = '0%';
  fill.style.background = 'linear-gradient(90deg, #38bdf8, #818cf8, #38bdf8)';
  fill.style.backgroundSize = '200% auto';
  fill.style.animation = 'progressPulse 1.6s linear infinite';
  text.textContent = '...';
  if (label) {
    label.textContent = 'Đang kết nối Google Server...';
    label.className = 'shimmer-text';
  }
}

function hideProgressBar() {
  const container = document.getElementById('scanProgressContainer');
  const fill = document.getElementById('scanProgressFill');
  const text = document.getElementById('scanProgressText');
  const label = document.getElementById('scanProgressLabel');
  fill.style.animation = '';
  fill.style.backgroundSize = '';
  fill.style.width = '0%';
  text.textContent = '0%';
  if (label) { label.textContent = 'Tiến Trình'; label.className = 'shimmer-text'; }
  container.classList.add('hidden');
}

function updateProgressBar(done, total) {
  const container = document.getElementById('scanProgressContainer');
  const fill = document.getElementById('scanProgressFill');
  const text = document.getElementById('scanProgressText');
  // total=0 means real data not yet available — keep connecting state, don’t hide
  if (total === 0) return;
  // Reset pulse animation when real progress starts
  fill.style.animation = '';
  fill.style.backgroundSize = '';
  fill.style.background = 'linear-gradient(90deg,#a18cd1,#8ec5fc)';
  container.classList.remove('hidden');
  const percent = Math.round((done / total) * 100);
  fill.style.width = percent + '%';
  text.textContent = percent + '%';
}

// ─── Loading messages (Đã chuyển sang file messages.js) ─────────────────

// ─── Air Datepicker ───────────────────────────────────────────
const viLocale = {
  days: ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'],
  daysShort: ['CN','T2','T3','T4','T5','T6','T7'],
  daysMin: ['CN','T2','T3','T4','T5','T6','T7'],
  months: ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'],
  monthsShort: ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'],
  today: 'Hôm nay', clear: 'Xóa', dateFormat: 'dd/MM/yyyy', timeFormat: 'HH:mm',
  firstDay: 1
};

let startDateVal = '', endDateVal = '';

const startPicker = new AirDatepicker('#startDate', {
  locale: viLocale,
  maxDate: new Date(),
  dateFormat: 'dd/MM/yyyy',
  autoClose: true,
  onSelect({ date }) {
    if (!date) { startDateVal = ''; endPicker.update({ minDate: false }); return; }
    const d = date instanceof Date ? date : date[0];
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    startDateVal = `${y}-${m}-${day}`;
    endPicker.update({ minDate: d });
  }
});

const endPicker = new AirDatepicker('#endDate', {
  locale: viLocale,
  maxDate: new Date(),
  dateFormat: 'dd/MM/yyyy',
  autoClose: true,
  onSelect({ date }) {
    if (!date) { endDateVal = ''; startPicker.update({ maxDate: new Date() }); return; }
    const d = date instanceof Date ? date : date[0];
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    endDateVal = `${y}-${m}-${day}`;
    startPicker.update({ maxDate: d });
  }
});

// Patch để index.js vẫn đọc được value qua #startDate / #endDate
Object.defineProperty(document.getElementById('startDate'), '_airVal', { get: () => startDateVal, configurable: true });
Object.defineProperty(document.getElementById('endDate'),   '_airVal', { get: () => endDateVal,   configurable: true });

// ─── Alert ────────────────────────────────────────────────────
function showMeoUAlert(m) {
  const b = document.getElementById('meouAlert');
  document.getElementById('alertMsg').innerText = m;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 3500);
}

// ─── Excel Export ─────────────────────────────────────────────
function exportToExcelCore(arr, f) {
  const rows = [["Tháng", "Ngày Đăng", "Channel Name", "Link YouTube", "Loại Video", "Có Gắn Giỏ Hàng?", "Tổng SP Shopee", "Tổng SP Lazada", "Link SP", "SP Thuộc", "TỔNG SP Khác"]];
  const st = {
    alignment: { vertical: 'center', horizontal: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  };

  // Helper: "dd/mm/yyyy" → "mm/dd/yyyy" và lấy số tháng
  function reformatDate(ddmmyyyy) {
    const [dd, mm, yyyy] = ddmmyyyy.split('/');
    return { formatted: `${mm}/${dd}/${yyyy}`, month: String(parseInt(mm, 10)) };
  }

  arr.forEach(d => {
    d.results.forEach(v => {
      const { formatted, month } = reformatDate(v.display_date);
      let tl = v.shopping_links.filter(i => i.platform === 'Shopee' || i.platform === 'Lazada');
      if (tl.length > 0) {
        tl.forEach(l => { rows.push([month, formatted, v.channel_name, v.url, v.type, v.has_shopping ? "Có" : "Không", v.shopee_count, v.lazada_count, l.clean_url, l.platform, v.other_count]); });
      } else if (v.other_count > 0) {
        rows.push([month, formatted, v.channel_name, v.url, v.type, "Có", v.shopee_count, v.lazada_count, "", "Sàn Khác", v.other_count]);
      } else {
        rows.push([month, formatted, v.channel_name, v.url, v.type, "Không", v.shopee_count, v.lazada_count, "", "", v.other_count]);
      }
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // col widths: Tháng, Ngày, Channel, Link YT, Loại, Giỏ, Shopee, Lazada, Link SP, SP Thuộc, Khác
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 25 }, { wch: 35 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 60 }, { wch: 12 }, { wch: 18 }];
  for (let c in ws) {
    if (c[0] === '!') continue;
    let r = XLSX.utils.decode_cell(c);
    let v = ws[c].v;
    let s = structuredClone(st);
    if (r.r === 0) {
      s.fill = { fgColor: { rgb: "002060" } };
      s.font = { bold: true, color: { rgb: "FFFFFF" } };
    } else {
      if (r.c === 0) s.font = { bold: true, color: { rgb: "5271C4" } }; // Tháng
      if (r.c === 3 || r.c === 8) s.alignment.horizontal = 'left';  // Link YT / Link SP
      if (r.c === 5) s.font = { bold: true, color: { rgb: v === "Có" ? "00B050" : "FF0000" } }; // Giỏ hàng
      if (r.c === 9) {
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
  // Dùng DocumentFragment thay vì innerHTML += để tránh reflow tích lũy mỗi vòng lặp
  const fragment = document.createDocumentFragment();
  temporaryStorage.forEach((item, i) => {
    let n = item.channel_name.length > 20 ? item.channel_name.substring(0, 18) + '...' : item.channel_name;
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center p-2 hover:bg-indigo-50 rounded-xl mb-1 border border-transparent hover:border-indigo-100 transition-colors';
    li.innerHTML = `<span class="text-sm font-bold text-slate-600 truncate mr-2">${n}</span><div class="flex gap-1">
<button onclick="downloadSingleFile(${i})" class="p-1.5 bg-blue-50 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
<button onclick="deleteSingleFile(${i})" class="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
</div>`;
    fragment.appendChild(li);
  });
  l.innerHTML = '';
  l.appendChild(fragment);
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

// Debounce để tránh layout reflow (scrollHeight) mỗi keystroke
let _resizeTimer;
linksInput.addEventListener('input', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(autoResizeTextarea, 50);
});

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
    // Dùng delta (--dx, --dy) thay vì vị trí tuyệt đối để CSS animation hoạt động đúng
    star.style.setProperty('--dx', (endX - x) + 'px');
    star.style.setProperty('--dy', (endY - y) + 'px');
    document.body.appendChild(star);
    setTimeout(() => star.remove(), 600);
  }
}

modeToggle.addEventListener('click', (e) => {
  if (isScanning) {
    showMeoUAlert('Không thể chuyển chế độ khi đang quét!');
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
      linksInput.placeholder = 'Dán link kênh vào đây (tối đa 10 kênh, mỗi kênh 1 dòng)...';
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
  const container = document.getElementById('scanProgressContainer');
  const percentEl = document.getElementById('scanProgressText');
  const fillEl = document.getElementById('scanProgressFill');
  const labelEl = document.getElementById('scanProgressLabel');
  // total=0 means real data not yet available — keep connecting state, don’t hide
  if (total === 0) return;
  // Reset pulse animation when real progress starts
  if (fillEl) {
    fillEl.style.animation = '';
    fillEl.style.backgroundSize = '';
    fillEl.style.background = 'linear-gradient(90deg,#a18cd1,#8ec5fc)';
  }
  const percent = Math.round((current / total) * 100);
  container.classList.remove('hidden');
  percentEl.textContent = percent + '%';
  if (fillEl) fillEl.style.width = percent + '%';
  if (labelEl && isBatchMode) labelEl.textContent = `Tiến Trình`;
}

// ─── Helper functions cho renderResults ──────────────────────
function buildTypeClass(type) {
  if (type === 'Short') return 'text-pink-500';
  if (type === 'Stream') return 'text-purple-600';
  return 'text-blue-500';
}

function buildShoppingBadge(has_shopping) {
  return has_shopping
    ? '<span class="text-emerald-500 font-extrabold text-lg">Có</span>'
    : '<span class="text-slate-300">Không</span>';
}

function buildLinkCell(r) {
  if (!r.has_shopping) return '<span class="text-slate-300">Trống</span>';
  const tl = r.shopping_links.filter(i => i.platform === 'Shopee' || i.platform === 'Lazada');
  if (tl.length > 0) {
    const items = tl.map(i => {
      const bc = i.platform === 'Shopee'
        ? 'text-orange-500 bg-orange-50 border-orange-200'
        : 'text-blue-600 bg-blue-50 border-blue-200';
      return `<li class="mb-2 text-[13px] border-b border-indigo-50 pb-2 flex items-center gap-2"><span class="font-extrabold text-[10px] uppercase px-2 py-1 rounded border ${bc}">${i.platform}</span><a href="${i.clean_url}" target="_blank" class="text-indigo-600 hover:text-indigo-800 truncate block w-full">${i.clean_url}</a></li>`;
    }).join('');
    return `<div class="px-6 py-2"><button class="toggle-btn w-full bg-indigo-50 text-indigo-600 font-extrabold py-3 px-4 rounded-2xl border border-indigo-100 text-xs shadow-sm">Giỏ hàng: ${tl.length} SP ▼</button><ul class="link-list hidden mt-3 p-5 bg-white rounded-2xl border border-indigo-100 text-left custom-scrollbar overflow-y-auto max-h-48 shadow-xl">${items}</ul></div>`;
  }
  return `<span class="text-slate-400 text-sm font-medium">${r.other_count} Sản phẩm khác</span>`;
}

// ─── Hàm render rows kết quả ─────────────────────────────────
function renderResults(results) {
  // Ẩn empty state khi có kết quả
  document.getElementById('emptyState')?.classList.add('hidden');
  const tb = document.getElementById('resultTableBody');
  const fragment = document.createDocumentFragment();
  results.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = "res-row";
    tr.innerHTML = `<td class="text-center text-sm text-slate-500 border-r border-indigo-50">${r.display_date}</td><td class="text-sm px-8 truncate border-r border-indigo-50 text-slate-400 font-medium"><a href="${r.url}" target="_blank">${r.url}</a></td><td class="text-center border-r border-indigo-50 text-xs uppercase font-black ${buildTypeClass(r.type)}">${r.type}</td><td class="text-center text-sm border-r border-indigo-50">${buildShoppingBadge(r.has_shopping)}</td><td class="text-center w-full">${buildLinkCell(r)}</td>`;
    const btn = tr.querySelector('.toggle-btn');
    if (btn) btn.onclick = () => btn.nextElementSibling.classList.toggle('hidden');
    fragment.appendChild(tr);
  });
  tb.innerHTML = '';
  tb.appendChild(fragment);
}

// ─── Scan Button ──────────────────────────────────────────────
document.getElementById('scanBtn').addEventListener('click', async () => {
  // Nếu đang scan thì dừng lại
  if (isScanning) {
    if (scanAbortController) scanAbortController.abort();
    return;
  }

  const u = document.getElementById('linksInput').value.split('\n').map(v => v.trim()).filter(v => v !== '');
  const s = startDateVal;
  const e = endDateVal;
  if (!s || !e) return showMeoUAlert('Vui lòng chọn ngày!');
  if (u.length === 0) return showMeoUAlert('Chưa dán link!');
  if (isBatchMode && u.length > 10) {
    return showMeoUAlert(`Cho Mèo thở với, scan 10 kênh một lần thôi. Hiện tại là ${u.length} kênh`);
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
  document.getElementById('emptyState')?.classList.add('hidden');
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
            // Khi có dữ liệu thật (total > 0): reset pulse và chuyển sang thanh tiến trình thật
            if (data.total > 0 && label) {
              if (label.textContent.includes('kết nối') || label.className === 'waiting-text') {
                label.innerHTML = 'Tiến Trình';
                label.className = 'shimmer-text';
              }
              fill.style.background = 'linear-gradient(90deg,#a18cd1,#8ec5fc)';
            }
            if (u.length > 1) {
              updateBatchProgress(data.done, data.total);
            } else {
              updateProgressBar(data.done, data.total);
            }
          } else if (data.type === 'result') {
            currentData = data;
          }
        } catch (_) {}
      }
    }



    // Xử lý kết quả cuối cùng
    if (currentData.cancelled) {
      showMeoUAlert('Đã ngừng quét!');
      document.getElementById('emptyState')?.classList.remove('hidden');
    } else if (currentData.results && currentData.results.length > 0) {
      document.getElementById('exportBtn').classList.remove('hidden');
      document.getElementById('saveTempBtn').classList.remove('hidden');
      renderResults(currentData.results);
    } else {
      showMeoUAlert('Không tìm thấy video!');
      document.getElementById('emptyState')?.classList.remove('hidden');
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
    hideProgressBar();
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

