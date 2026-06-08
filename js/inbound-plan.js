// =====================================================================
// SUPEREX LogiStation - inbound-plan.js
// 入荷予定管理: Excel取込 / テンプレート出力 / 検品リストPDF出力
// =====================================================================

let _ipPlans = [];
let _ipTabFilter = 'all';

// ---------- Page Render ----------

RENDER_FNS['inbound-plan'] = async function renderInboundPlan() {
  const el = document.getElementById('page-inbound-plan');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="tabs" id="ipTabs" style="max-width:420px;">
        <div class="tab active" onclick="setIpTab('all',this)">全て</div>
        <div class="tab" onclick="setIpTab('planned',this)">予定</div>
        <div class="tab" onclick="setIpTab('receiving',this)">入荷中</div>
        <div class="tab" onclick="setIpTab('completed',this)">完了</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-g" onclick="ipDownloadTemplate()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          テンプレート
        </button>
        ${isOperator() ? `
        <label class="btn btn-p" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Excel取込
          <input type="file" accept=".xlsx,.xls" onchange="ipHandleFile(this)" style="display:none;">
        </label>
        ` : ''}
      </div>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>予定番号</th><th>入荷予定日</th><th class="hm">荷主</th><th>明細数</th><th>予定数</th><th class="hm">実績数</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="ipTb"></tbody>
    </table></div></div>
  `;
  _ipTabFilter = 'all';
  await loadInboundPlans();
};

function setIpTab(tab, tabEl) {
  _ipTabFilter = tab;
  document.querySelectorAll('#ipTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderIpTable();
}

async function loadInboundPlans() {
  const { data } = await sb.from('inbound_plans')
    .select('*, clients(name), inbound_plan_items(id, planned_qty, received_qty)')
    .order('created_at', { ascending: false });
  _ipPlans = data || [];
  renderIpTable();
}

function renderIpTable() {
  let filtered = _ipPlans;
  if (_ipTabFilter !== 'all') {
    filtered = filtered.filter(p => p.status === _ipTabFilter);
  }
  const tb = document.getElementById('ipTb');
  if (!tb) return;

  const statusLabels = { planned: '予定', receiving: '入荷中', completed: '完了' };
  const statusCls = { planned: 'bb', receiving: 'by', completed: 'bg' };

  tb.innerHTML = filtered.length
    ? filtered.map(p => {
        const items = p.inbound_plan_items || [];
        const totalPlanned = items.reduce((s, it) => s + (it.planned_qty || 0), 0);
        const totalReceived = items.reduce((s, it) => s + (it.received_qty || 0), 0);
        const clientName = p.clients?.name || '—';
        const cls = statusCls[p.status] || 'bgr';
        const lbl = statusLabels[p.status] || p.status;
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;">${esc(p.plan_no)}</td>
          <td style="font-family:var(--mono);font-size:11px;">${fmtDate(p.planned_date)}</td>
          <td class="hm">${esc(clientName)}</td>
          <td style="font-family:var(--mono);text-align:center;">${items.length}</td>
          <td style="font-family:var(--mono);">${totalPlanned.toLocaleString()}</td>
          <td class="hm" style="font-family:var(--mono);">${totalReceived.toLocaleString()}</td>
          <td><span class="badge ${cls}">${lbl}</span></td>
          <td>
            <button class="btn btn-g btn-sm" onclick="ipGoDetail('${p.id}')">詳細</button>
            ${isOperator() ? `<button class="btn btn-p btn-sm" onclick="ipPrintPdf('${p.id}')">PDF</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="empty-state">入荷予定データがありません</td></tr>';
}

// ---------- Detail Navigation ----------

function ipGoDetail(planId) {
  window._ipDetailId = planId;
  go('inbound-plan-detail');
}

function ipGoDetailByPlanNo(planNo) {
  window._ipDetailPlanNo = planNo;
  window._ipDetailId = null;
  go('inbound-plan-detail');
}

// ---------- Excel Template Download ----------

function ipDownloadTemplate() {
  var header = ['入荷予定日', '荷主コード', 'JANコード', '商品名', '予定数量', '賞味期限'];
  var sample = ['20260615', 'CLIENT001', '4901234567890', 'ミネラルウォーター500ml', '100', '2027/03/31'];

  var ws_data = [header, sample];
  var ws = XLSX.utils.aoa_to_sheet(ws_data);

  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 16 },
    { wch: 24 }, { wch: 8 }, { wch: 12 }
  ];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '入荷予定');
  XLSX.writeFile(wb, '入荷予定テンプレート.xlsx');
  toast('テンプレートをダウンロードしました');
}

// ---------- Excel Import ----------

async function ipHandleFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  try {
    var ab = await file.arrayBuffer();
    var wb = XLSX.read(ab, { type: 'array', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) {
      toast('データ行がありません', 'error');
      return;
    }

    var dataRows = rows.slice(1).filter(function(r) {
      return r.some(function(c) { return c !== '' && c != null; });
    });

    if (dataRows.length === 0) {
      toast('データ行がありません', 'error');
      return;
    }

    await ipValidateAndPreview(dataRows);
  } catch (e) {
    toast('Excelファイルの読み込みに失敗しました: ' + e.message, 'error');
  }
}

async function ipValidateAndPreview(dataRows) {
  var errors = [];
  var validItems = [];

  var { data: clients } = await sb.from('clients')
    .select('id, code, name')
    .eq('is_active', true);
  clients = clients || [];

  var plannedDate = null;
  var clientId = null;
  var clientName = '';

  var rpcItems = [];
  var rowMeta = [];

  for (var i = 0; i < dataRows.length; i++) {
    var row = dataRows[i];
    var rowNum = i + 2;

    var dateVal = row[0];
    var clientCode = String(row[1] || '').trim();
    var janCode = String(row[2] || '').trim();
    var productName = String(row[3] || '').trim();
    var qty = row[4];
    var expiryVal = row[5];

    var parsedDate = ipParseDate(dateVal);
    if (!parsedDate && i === 0) {
      errors.push({ row: rowNum, messages: ['入荷予定日が不正です'] });
      continue;
    } else if (parsedDate && !plannedDate) {
      plannedDate = parsedDate;
    }

    if (clientCode && !clientId) {
      var foundClient = clients.find(function(c) { return c.code === clientCode; });
      if (foundClient) {
        clientId = foundClient.id;
        clientName = foundClient.name;
      }
    }

    var parsedExpiry = expiryVal ? ipParseDate(expiryVal) : null;

    rpcItems.push({
      jan_code: janCode,
      planned_qty: qty,
      expiry_date: parsedExpiry || null,
    });
    rowMeta.push({ rowNum: rowNum, productName: productName });
  }

  if (rpcItems.length > 0) {
    var { data: validated, error: rpcErr } = await sb.rpc('fn_validate_inbound_items', {
      p_items: rpcItems,
    });

    if (rpcErr) {
      toast('商品照合エラー: ' + rpcErr.message, 'error');
      return;
    }

    for (var j = 0; j < validated.length; j++) {
      var v = validated[j];
      var meta = rowMeta[j];
      var itemErrors = v.errors || [];

      if (itemErrors.length > 0) {
        errors.push({ row: meta.rowNum, messages: itemErrors });
      } else {
        validItems.push({
          product_id: v.product_id,
          jan_code: v.product_jan || rpcItems[j].jan_code,
          product_name: v.product_name || meta.productName,
          planned_qty: v.planned_qty,
          expiry_date: rpcItems[j].expiry_date,
        });
      }
    }
  }

  if (!plannedDate) {
    plannedDate = new Date().toISOString().slice(0, 10);
  }

  ipShowPreviewModal(validItems, errors, plannedDate, clientId, clientName);
}

function ipParseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  var s = String(val).trim();
  var m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    var d8 = new Date(Number(m8[1]), Number(m8[2]) - 1, Number(m8[3]));
    if (!isNaN(d8.getTime())) return d8.toISOString().slice(0, 10);
  }
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) {
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  var d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
  return null;
}

function ipShowPreviewModal(validItems, errors, plannedDate, clientId, clientName) {
  var errHtml = '';
  if (errors.length > 0) {
    errHtml = '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;">'
      + '<div style="font-size:12px;font-weight:500;color:var(--red);margin-bottom:6px;">エラー (' + errors.length + '行)</div>'
      + errors.map(function(e) {
          return '<div style="font-size:11px;color:var(--text2);margin-bottom:4px;"><strong>' + e.row + '行目:</strong> ' + e.messages.map(esc).join(', ') + '</div>';
        }).join('')
      + '</div>';
  }

  var previewRows = validItems.slice(0, 20).map(function(it, i) {
    return '<tr>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + (i + 1) + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(it.jan_code || '—') + '</td>'
      + '<td style="font-size:11px;">' + esc(it.product_name) + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;">' + it.planned_qty + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + (it.expiry_date ? fmtDate(it.expiry_date) : '—') + '</td>'
      + '</tr>';
  }).join('');

  var moreNote = validItems.length > 20 ? '<div style="font-size:11px;color:var(--text2);padding:8px 10px;">他 ' + (validItems.length - 20) + ' 件...</div>' : '';

  var body = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;font-size:12px;">
      <div><span style="color:var(--text2);">入荷予定日:</span><br><strong>${esc(plannedDate)}</strong></div>
      <div><span style="color:var(--text2);">荷主:</span><br><strong>${esc(clientName || '未指定')}</strong></div>
      <div><span style="color:var(--text2);">有効行:</span><br><strong>${validItems.length} 件</strong></div>
    </div>
    ${errHtml}
    ${validItems.length > 0 ? `
    <div class="tw"><table>
      <thead><tr><th>No</th><th>JAN</th><th>商品名</th><th style="text-align:right;">数量</th><th>期限</th></tr></thead>
      <tbody>${previewRows}</tbody>
    </table></div>
    ${moreNote}
    ` : '<div class="empty-state">有効な取込データがありません</div>'}
  `;

  var footer = '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>';
  if (errors.length > 0) {
    footer += '<span style="font-size:11px;color:var(--red);padding:0 8px;">エラーを全て修正してから登録してください</span>';
  } else if (validItems.length > 0) {
    footer += '<button class="btn btn-p" id="ipRegBtn" onclick="ipRegister()">登録実行 (' + validItems.length + '件)</button>';
  }

  window._ipPendingImport = { items: validItems, plannedDate: plannedDate, clientId: clientId };
  openModal('Excel取込プレビュー', body, footer, true);
}

// ---------- Register (Atomic RPC) ----------

async function ipRegister() {
  var pending = window._ipPendingImport;
  if (!pending || !pending.items.length) return;

  var btn = document.getElementById('ipRegBtn');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    var rpcItems = pending.items.map(function(it) {
      return {
        product_id: it.product_id,
        planned_qty: it.planned_qty,
        expiry_date: it.expiry_date || null,
      };
    });

    var { data, error } = await sb.rpc('fn_create_inbound_plan', {
      p_planned_date: pending.plannedDate,
      p_client_id: pending.clientId || null,
      p_items: rpcItems,
    });

    if (error) throw error;

    var planNo = data.plan_no;
    var planId = data.id;

    closeModal();
    toast('入荷予定 ' + planNo + ' を登録しました');
    window._ipPendingImport = null;
    await loadInboundPlans();

    ipShowPrintConfirm(planId, planNo);
  } catch (e) {
    toast('登録失敗: ' + (e.message || JSON.stringify(e)), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '登録実行'; }
  }
}

function ipShowPrintConfirm(planId, planNo) {
  var body = '<div style="text-align:center;padding:10px 0;"><div style="font-size:36px;margin-bottom:10px;">&#9989;</div><div style="font-size:14px;font-weight:500;margin-bottom:6px;">入荷予定を登録しました</div><div style="font-family:var(--mono);font-size:12px;color:var(--text2);margin-bottom:16px;">' + esc(planNo) + '</div><div style="font-size:13px;color:var(--text2);">検品リストを印刷しますか？</div></div>';
  var footer = '<button class="btn btn-g" onclick="closeModal()">出力しない</button><button class="btn btn-p" onclick="closeModal();ipPrintPdf(\'' + planId + '\')">PDF出力</button>';
  openModal('検品リスト出力', body, footer);
}

// ---------- PDF Output ----------

var _isGeneratingPdf = false;

function _generateBarcodeDataUrl(text) {
  var canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, text, {
      format: 'CODE128',
      width: 2,
      height: 50,
      displayValue: true,
      fontSize: 12,
      margin: 4,
    });
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('Barcode generation failed:', e);
    return null;
  }
}

function _generateQrDataUrl(text) {
  try {
    var qr = qrcode(0, 'H');
    qr.addData(text);
    qr.make();
    var size = qr.getModuleCount();
    var cellSize = 8;
    var canvas = document.createElement('canvas');
    canvas.width = size * cellSize;
    canvas.height = size * cellSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('QR generation failed:', e);
    return null;
  }
}

async function ipPrintPdf(planId) {
  if (_isGeneratingPdf) { toast('PDF生成中です', 'error'); return; }
  _isGeneratingPdf = true;

  var pdfBtns = document.querySelectorAll('[onclick*="ipPrintPdf"]');
  pdfBtns.forEach(function(b) { b.disabled = true; b.dataset.origText = b.innerHTML; b.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;"></span> 生成中...'; });

  try {
  var res = await sb.from('inbound_plans')
    .select('*, clients(name), inbound_plan_items(*, products(sku, name, jan_code))')
    .eq('id', planId)
    .single();
  if (!res.data) { toast('データ取得失敗', 'error'); return; }

  var plan = res.data;
  toast('PDF生成中...しばらくお待ちください');

  var items = plan.inbound_plan_items || [];
  var clientName = plan.clients ? plan.clients.name : '—';
  var now = new Date();
  var outputDate = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  var totalSku = items.length;
  var totalQty = items.reduce(function(s, it) { return s + (it.planned_qty || 0); }, 0);

  var barcodeImg = _generateBarcodeDataUrl(plan.plan_no || '');
  var qrContent = JSON.stringify({ type: 'inbound_plan', plan_no: plan.plan_no, version: 1 });
  var qrImg = _generateQrDataUrl(qrContent);

  await document.fonts.ready;

  var doc = new jspdf.jsPDF('p', 'mm', 'a4');
  var rowsPerPage = 25;
  var totalPages = Math.ceil(items.length / rowsPerPage) || 1;

  for (var page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();

    var startIdx = page * rowsPerPage;
    var pageItems = items.slice(startIdx, startIdx + rowsPerPage);

    var rowsHtml = pageItems.map(function(item, idx) {
      var prod = item.products || {};
      var bg = idx % 2 === 1 ? 'background:#f8f9fb;' : '';
      return '<tr style="' + bg + '">'
        + '<td style="width:30px;text-align:center;padding:5px 6px;border-bottom:1px solid #eee;">' + (startIdx + idx + 1) + '</td>'
        + '<td style="width:112px;font-family:monospace;font-size:10px;padding:5px 6px;border-bottom:1px solid #eee;">' + esc(prod.jan_code || '—') + '</td>'
        + '<td style="width:90px;font-family:monospace;font-size:10px;padding:5px 6px;border-bottom:1px solid #eee;">' + esc(prod.sku || '—') + '</td>'
        + '<td style="padding:5px 6px;font-size:11px;border-bottom:1px solid #eee;">' + esc(prod.name || '—') + '</td>'
        + '<td style="width:55px;text-align:right;font-family:monospace;padding:5px 6px;border-bottom:1px solid #eee;">' + (item.planned_qty || 0) + '</td>'
        + '<td style="width:66px;padding:5px 6px;border:1px solid #bbb;">&nbsp;</td>'
        + '<td style="width:36px;text-align:center;padding:5px 6px;border:1px solid #bbb;">&#9744;</td>'
        + '</tr>';
    }).join('');

    var pageHtml = '<div style="width:794px;padding:28px 32px;box-sizing:border-box;font-family:\'Noto Sans JP\',sans-serif;background:#fff;color:#111;">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">'
        + '<div>'
          + '<div style="font-size:17px;font-weight:700;margin-bottom:10px;">検品リスト</div>'
          + '<div style="font-size:12px;margin-bottom:3px;"><strong>予定番号:</strong> ' + esc(plan.plan_no) + '</div>'
          + '<div style="font-size:12px;margin-bottom:3px;"><strong>入荷予定日:</strong> ' + esc(plan.planned_date) + '</div>'
          + '<div style="font-size:12px;margin-bottom:3px;"><strong>荷主:</strong> ' + esc(clientName) + '</div>'
          + '<div style="font-size:10px;color:#666;margin-bottom:8px;">出力日時: ' + outputDate + '</div>'
          + (barcodeImg ? '<img src="' + barcodeImg + '" style="height:38px;">' : '')
        + '</div>'
        + (qrImg ? '<img src="' + qrImg + '" style="width:88px;height:88px;">' : '')
      + '</div>'
      + '<div style="display:flex;gap:18px;margin-bottom:10px;font-size:12px;">'
        + '<span>SKU数: <strong>' + totalSku + '</strong></span>'
        + '<span>予定数量合計: <strong>' + totalQty.toLocaleString() + '</strong></span>'
        + '<span>ページ: <strong>' + (page + 1) + ' / ' + totalPages + '</strong></span>'
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:11px;">'
        + '<thead><tr style="background:#f0f2f5;">'
          + '<th style="width:30px;text-align:center;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">No</th>'
          + '<th style="width:112px;text-align:left;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">JANコード</th>'
          + '<th style="width:90px;text-align:left;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">商品コード</th>'
          + '<th style="text-align:left;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">商品名</th>'
          + '<th style="width:55px;text-align:right;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">予定数</th>'
          + '<th style="width:66px;text-align:center;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">実績数</th>'
          + '<th style="width:36px;text-align:center;padding:6px;border-bottom:2px solid #ccc;font-family:\'Noto Sans JP\',sans-serif;font-weight:700;">✓</th>'
        + '</tr></thead>'
        + '<tbody>' + rowsHtml + '</tbody>'
      + '</table>'
      + '<div style="margin-top:14px;font-size:10px;color:#666;border-top:1px solid #ddd;padding-top:8px;">'
        + 'SKU ' + totalSku + '種 / 予定数量 ' + totalQty.toLocaleString() + '個 | ページ ' + (page + 1) + ' / ' + totalPages
      + '</div>'
    + '</div>';

    var container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;';
    container.innerHTML = pageHtml;
    document.body.appendChild(container);

    var canvas = await html2canvas(container.firstElementChild, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    document.body.removeChild(container);
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  }

  doc.save('inspection_' + (plan.plan_no || 'list') + '.pdf');
  toast('検品リストPDFを出力しました');

  } finally {
    _isGeneratingPdf = false;
    var pdfBtns2 = document.querySelectorAll('[onclick*="ipPrintPdf"]');
    pdfBtns2.forEach(function(b) { b.disabled = false; if (b.dataset.origText) b.innerHTML = b.dataset.origText; });
  }
}
