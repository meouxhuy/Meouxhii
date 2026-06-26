let currentData = { results: [], channel_name: "MeoU" };
let temporaryStorage = [];
let isCurrentSaved = false;
let loadingInterval;
let isScanning = false;
let scanAbortController = null;

// ─── Scan button state management ────────────────────────────
function setScanningState(scanning) {
  isScanning = scanning;
  const btn = document.getElementById('scanBtn');
  if (scanning) {
    btn.innerHTML = `
      <svg class="w-7 h-7 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M6 18L18 6M6 6l12 12"/>
      </svg>
      Ngừng Quét`;
    btn.classList.remove('bg-meou-main');
    btn.classList.add('bg-red-500', 'hover:bg-red-600');
  } else {
    btn.innerHTML = `
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      Quét Ngay`;
    btn.classList.add('bg-meou-main');
    btn.classList.remove('bg-red-500', 'hover:bg-red-600');
  }
}

// ─── Gửi hủy scan lên server ─────────────────────────────────
async function sendCancelToServer() {
  try {
    await fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch (_) {}
}

const loadingMessages = [
  "Một Người Ấn Độ Nổi Tiếng Từng Nói: काम का ना काज का, दुश्मन अनाज का",
  "Họ Im Lặng Vì Tưởng Tôi Hiểu... Tôi Im Lặng Vì Tôi Méo Hiểu Gì...😶‍🌫️",
  "Nếu không có gì thay đổi, hết hôm nay sẽ đến ngày mai.",
  "Muốn có chỗ đứng trong xã hội thì tuyệt đối không được ngồi.",
  "Chơi Gì Cũng Ngu... Chơi Ngu Là Giỏi...😎",
  "Định Buồn Mà Làm Biếng Quá...",
  "Ở Cái Tuổi Người Ta Đau Khổ Vì Tình. Còn Tôi Thì Đau Lưng...😭",
  "Bạn Có Biết Cứ 60s Trôi Qua Ở Việt Nam Thì Ở Nhật Cũng Thế",
  "Bạn Ạ! Nắng Chiếu Tới Ai Thì Người Đó Đen...",
  "Nếu Chưa Biết Tôi Xin Đừng Đánh Giá. Còn Nếu Biết Tôi Rồi Thì Đừng Đánh Tôi...😌",
  "Sao Ai Cũng Ghét Mấy Người Làm Biếng Nhỉ? Họ Có Làm Gì Đâu?",
  "Một Cây Làm Chẳng Nên Non, Ba Cây Chụm Lại Vẫn Là Ba Cây.",
  "Muốn Đi Riêng Thì Đi Một Mình, Muốn Đi Chung Thì Đi Cùng Nhau.",
  "Bạn Có Biết: Không Có Gì Là Nothing.",
  "Má Hay Quá, Đang Vỗ Tay Phải Đứng Dậy Ỉa.",
  "Tự hào vì 20 tuổi em đã có mọi thứ trong tay, từ thứ Hai đến Chủ nhật.",
  "Ngủ sớm đi, ngủ muộn hại lắm. Hại điện thoại.",
  "Trông em vui vẻ thế thôi chứ em chả biết buồn bao giờ.",
  "Nhìn mặt em khó ưa vậy thôi, chứ tính cách em cũng không được dễ chịu cho lắm.",
  "Thời tiết này là gì cũng thích. Thích nhất là không làm gì.",
  "Dịu dàng em không thiếu, chủ yếu là em thích cà chớn!",
  "Đó giờ giận ai ít khi để trong lòng lắm, để trong đầu.",
  "Nhịn chưa chắc đã nhục nhưng nhịn chắc chắn sẽ đói.",
  "Cách duy nhất để thấu hiểu lòng người là… nội soi.",
  "Cái gì của mình thì sẽ là của mình. Cái gì không phải của mình thì là của người ta.",
  "Đời này có hai loại người. Người này và người kia.",
  "Trời ban cho nhan sắc. Những lại lấy đi tất cả những người công nhận nhan sắc này.",
  "Kiếp sau nguyện làm người giàu, quyết không hối tiếc.",
  "Không có thứ gì quá khó, khó quá thì không làm nữa là xong.",
  "Nhìn em ổn áp, nhưng không có app thì không ổn.",
  "Hai mùi dễ chịu nhất trái đất là mùi đồ ăn và mùi tiền.",
  "Tập sống lạnh lùng vì không thể khùng khùng mãi được.",
  "Tự nhiên buồn quá, chắc tại mình đang buồn.",
  "Học cách giữ một cái đầu lạnh. Vì nóng là bị sốt rồi.",
  "Lúc nhỏ thích nghịch đất, nghịch cát. Lớn lên toàn gặp nghịch cảnh.",
  "Con đường làm giàu em đi sắp tới, chỉ còn thiếu chữ 'u' thôi.",
  "Định nghèo chơi chơi thôi, ai ngờ nghèo đậm sâu, nghèo không lối thoát.",
  "Còn bé cứ nghĩ tiền là tất cả. Lớn mới thấy mình khôn từ bé.",
  "20 nồi bánh chưng mà chưa thấy hoa tươi, chỉ thấy hoa mắt, chóng mặt, đau đầu.",
  "Lười không tự sinh ra cũng không tự mất đi. Nó chỉ chuyển từ ngày này sang ngày khác.",
  "Khi bạn cho đi một thứ gì đó, bạn sẽ mất luôn nó.",
  "Nhìn em có vẻ nghèo, thật ra bên trong cũng nghèo thật.",
  "Em đã có chồng… chồng bát chưa rửa trong bếp.",
  "Tại sao chữ 'dài' lại ngắn hơn chữ 'ngắn'?",
  "Đề bài yêu cầu 'chọn câu sai'. Tại sao chọn câu sai vẫn bị trừ điểm?",
  "Mẹ tròn con vuông vậy bố hình gì?",
  "'Đầy chỗ ngồi' là còn nhiều chỗ ngồi hay hết chỗ ngồi?",
  "Bệnh vô sinh có di truyền không?",
  "Chiến thắng bản thân thì mình thắng hay là thua?",
  "'Gây khó dễ' là gây khó hay gây dễ?",
  "Trái cam được đặt tên theo màu cam hay màu cam được đặt tên theo trái cam?"
];

// ─── Flatpickr ───────────────────────────────────────────────
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

// ─── Alert ───────────────────────────────────────────────────
function showMeoUAlert(m) {
  const b = document.getElementById('meouAlert');
  document.getElementById('alertMsg').innerText = m;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 3500);
}

// ─── Excel Export ────────────────────────────────────────────
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

// ─── Archive / Temporary Storage ─────────────────────────────
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

// ─── Mode Toggle ─────────────────────────────────────────────
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

// ─── Batch Progress ───────────────────────────────────────────
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

// ─── Scan Button ──────────────────────────────────────────────
document.getElementById('scanBtn').addEventListener('click', async () => {
  // Nếu đang scan thì dừng lại
  if (isScanning) {
    if (scanAbortController) scanAbortController.abort();
    await sendCancelToServer();
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

  const lD = document.getElementById('loading');
  const lT = document.getElementById('loadingText');
  lD.classList.remove('hidden');
  let mi = 0;
  lT.innerText = loadingMessages[mi];
  if (loadingInterval) clearInterval(loadingInterval);
  loadingInterval = setInterval(() => { mi = (mi + 1) % loadingMessages.length; lT.innerText = loadingMessages[mi]; }, 3000);

  document.getElementById('resultTableBody').innerHTML = '';
  document.getElementById('exportBtn').classList.add('hidden');
  document.getElementById('saveTempBtn').classList.add('hidden');
  isCurrentSaved = false;

  if (u.length > 1) updateBatchProgress(0, u.length);

  // Chuyển nút sang trạng thái "Ngừng Quét"
  setScanningState(true);
  scanAbortController = new AbortController();

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: u, startDate: s, endDate: e }),
      signal: scanAbortController.signal
    });
    currentData = await res.json();
    const tb = document.getElementById('resultTableBody');

    // Nếu server báo bị hủy
    if (currentData.cancelled) {
      showMeoUAlert('Đã ngừng quét!');
      return;
    }

    if (currentData.results && currentData.results.length > 0) {
      document.getElementById('exportBtn').classList.remove('hidden');
      document.getElementById('saveTempBtn').classList.remove('hidden');
    }

    if (currentData.results && currentData.results.length > 0) {
      currentData.results.forEach(r => {
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
    } else {
      showMeoUAlert('Không tìm thấy video!');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Fetch bị abort bởi AbortController -> đã gửi cancel lên server rồi
      showMeoUAlert('Đã ngừng quét!');
    } else {
      showMeoUAlert('Lỗi kết nối!');
    }
  } finally {
    clearInterval(loadingInterval);
    lD.classList.add('hidden');
    updateBatchProgress(0, 0);
    setScanningState(false);
    scanAbortController = null;
  }
});

// ─── Hủy scan khi F5 / đóng tab ──────────────────────────────
window.addEventListener('beforeunload', () => {
  if (isScanning) {
    // sendBeacon không bị block bởi trình duyệt khi tab đang đóng
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

// ─── Block DevTools ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) || (e.ctrlKey && e.key === 'U')) {
    e.preventDefault();
    return false;
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
setInterval(() => {
  const devtools = window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160;
  if (devtools) {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial;font-size:24px;font-weight:bold;color:#ff0000;">DevTools Detected! Please close it.</div>';
  }
}, 1000);
