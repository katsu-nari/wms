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
  var header = ['入荷予定日', '荷主コード', 'JANコード', '商品コード', '商品名', '予定数量', 'ロットNo', '賞味期限'];
  var sample = ['2026-06-15', 'C001', '4901234567890', 'SKU-001', 'サンプル商品A', '100', 'LOT-2026-01', '2027-03-31'];

  var ws_data = [header, sample];
  var ws = XLSX.utils.aoa_to_sheet(ws_data);

  ws['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 },
    { wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 12 }
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

  var { data: products } = await sb.from('products')
    .select('id, sku, name, jan_code')
    .is('deleted_at', null);
  products = products || [];

  var { data: clients } = await sb.from('clients')
    .select('id, code, name')
    .eq('is_active', true);
  clients = clients || [];

  var plannedDate = null;
  var clientId = null;
  var clientName = '';

  for (var i = 0; i < dataRows.length; i++) {
    var row = dataRows[i];
    var rowNum = i + 2;
    var rowErrors = [];

    var dateVal = row[0];
    var clientCode = String(row[1] || '').trim();
    var janCode = String(row[2] || '').trim();
    var productCode = String(row[3] || '').trim();
    var productName = String(row[4] || '').trim();
    var qty = row[5];
    var lotNo = String(row[6] || '').trim();
    var expiryVal = row[7];

    // Date check
    var parsedDate = ipParseDate(dateVal);
    if (!parsedDate && i === 0) {
      rowErrors.push('入荷予定日が不正です');
    } else if (parsedDate && !plannedDate) {
      plannedDate = parsedDate;
    }

    // Client check (use first row's client)
    if (clientCode && !clientId) {
      var foundClient = clients.find(function(c) { return c.code === clientCode; });
      if (foundClient) {
        clientId = foundClient.id;
        clientName = foundClient.name;
      }
    }

    // Product check
    var product = null;
    if (janCode) {
      product = products.find(function(p) { return p.jan_code === janCode; });
    }
    if (!product && productCode) {
      product = products.find(function(p) { return p.sku === productCode; });
    }
    if (!product) {
      rowErrors.push('商品マスタ未登録 (JAN: ' + (janCode || '—') + ', コード: ' + (productCode || '—') + ')');
    }

    // Quantity check
    var parsedQty = Number(qty);
    if (!qty && qty !== 0) {
      rowErrors.push('数量が未入力です');
    } else if (isNaN(parsedQty) || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
      rowErrors.push('数量が不正です: ' + qty);
    }

    // Expiry parse
    var parsedExpiry = expiryVal ? ipParseDate(expiryVal) : null;

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, messages: rowErrors });
    } else {
      validItems.push({
        product_id: product.id,
        jan_code: product.jan_code || janCode,
        sku: product.sku || productCode,
        product_name: product.name || productName,
        planned_qty: parsedQty,
        lot_no: lotNo || null,
        expiry_date: parsedExpiry || null,
      });
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
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(it.lot_no || '—') + '</td>'
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
      <thead><tr><th>No</th><th>JAN</th><th>商品名</th><th style="text-align:right;">数量</th><th>ロット</th><th>期限</th></tr></thead>
      <tbody>${previewRows}</tbody>
    </table></div>
    ${moreNote}
    ` : '<div class="empty-state">有効な取込データがありません</div>'}
  `;

  var footer = '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>';
  if (validItems.length > 0) {
    footer += '<button class="btn btn-p" id="ipRegBtn" onclick="ipRegister()">登録実行 (' + validItems.length + '件)</button>';
  }

  window._ipPendingImport = { items: validItems, plannedDate: plannedDate, clientId: clientId };
  openModal('Excel取込プレビュー', body, footer, true);
}

// ---------- Plan No Generation ----------

async function ipGeneratePlanNo(plannedDate) {
  var date = plannedDate || new Date().toISOString().slice(0, 10);
  var { data, error } = await sb.rpc('fn_generate_plan_no', {
    p_document_type: 'IP',
    p_date: date,
  });
  if (error) throw error;
  return data;
}

// ---------- Register ----------

async function ipRegister() {
  var pending = window._ipPendingImport;
  if (!pending || !pending.items.length) return;

  var btn = document.getElementById('ipRegBtn');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    var planNo = await ipGeneratePlanNo(pending.plannedDate);

    var { data: plan, error: planErr } = await sb.from('inbound_plans').insert({
      plan_no: planNo,
      planned_date: pending.plannedDate,
      client_id: pending.clientId || null,
      status: 'planned',
      created_by: App.user ? App.user.id : null,
    }).select().single();

    if (planErr) throw planErr;

    var itemRows = pending.items.map(function(it) {
      return {
        inbound_plan_id: plan.id,
        product_id: it.product_id,
        planned_qty: it.planned_qty,
        received_qty: 0,
        lot_no: it.lot_no,
        expiry_date: it.expiry_date,
      };
    });

    var { error: itemErr } = await sb.from('inbound_plan_items').insert(itemRows);
    if (itemErr) throw itemErr;

    closeModal();
    toast('入荷予定 ' + planNo + ' を登録しました');
    window._ipPendingImport = null;
    await loadInboundPlans();

    ipShowPrintConfirm(plan.id, planNo);
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
    var qr = qrcode(0, 'M');
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
  var { data: plan } = await sb.from('inbound_plans')
    .select('*, clients(name), inbound_plan_items(*, products(sku, name, jan_code))')
    .eq('id', planId)
    .single();
  if (!plan) { toast('データ取得失敗', 'error'); return; }

  var items = plan.inbound_plan_items || [];
  var clientName = plan.clients?.name || '—';
  var now = new Date();
  var outputDate = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var totalSku = items.length;
  var totalQty = items.reduce(function(s, it) { return s + (it.planned_qty || 0); }, 0);

  // Generate barcode and QR code
  var barcodeImg = _generateBarcodeDataUrl(plan.plan_no || '');
  var qrContent = JSON.stringify({ type: 'inbound_plan', plan_no: plan.plan_no, version: 1 });
  var qrImg = _generateQrDataUrl(qrContent);

  var doc = new jspdf.jsPDF('p', 'mm', 'a4');
  var pageW = 210;
  var marginL = 15;
  var marginR = 15;
  var contentW = pageW - marginL - marginR;
  var rowsPerPage = 28;
  var totalPages = Math.ceil(items.length / rowsPerPage) || 1;

  for (var page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();

    // Header - Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Inspection List', marginL, 15);

    // Header - Left: text + barcode
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Plan No: ' + (plan.plan_no || ''), marginL, 22);
    doc.text('Date: ' + (plan.planned_date || ''), marginL, 27);
    doc.text('Client: ' + clientName, marginL, 32);
    doc.text('Printed: ' + outputDate, marginL, 37);

    // Barcode (left side, below text) ~80mm wide x 15mm tall
    if (barcodeImg) {
      doc.addImage(barcodeImg, 'PNG', marginL, 39, 80, 15);
    }

    // Header - Right: QR code ~28mm square
    if (qrImg) {
      doc.addImage(qrImg, 'PNG', pageW - marginR - 28, 12, 28, 28);
    }

    // Table header
    var startY = 58;
    var colX = [marginL, marginL + 10, marginL + 40, marginL + 66, marginL + 106, marginL + 128, marginL + 150];
    var colLabels = ['No', 'JAN', 'SKU', 'Product', 'Plan Qty', 'Actual', 'Check'];

    doc.setFillColor(240, 242, 245);
    doc.rect(marginL, startY - 4, contentW, 7, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    for (var c = 0; c < colLabels.length; c++) {
      doc.text(colLabels[c], colX[c], startY);
    }

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    var rowH = 6.5;
    var startIdx = page * rowsPerPage;
    var endIdx = Math.min(startIdx + rowsPerPage, items.length);

    for (var r = startIdx; r < endIdx; r++) {
      var item = items[r];
      var prod = item.products || {};
      var y = startY + 7 + (r - startIdx) * rowH;

      if ((r - startIdx) % 2 === 1) {
        doc.setFillColor(248, 249, 251);
        doc.rect(marginL, y - 4, contentW, rowH, 'F');
      }

      doc.text(String(r + 1), colX[0], y);
      doc.text(String(prod.jan_code || '').slice(0, 13), colX[1], y);
      doc.text(String(prod.sku || '').slice(0, 12), colX[2], y);
      doc.text(String(prod.name || '').slice(0, 18), colX[3], y);
      doc.text(String(item.planned_qty || 0), colX[4], y);
      doc.setDrawColor(180, 180, 180);
      doc.rect(colX[5], y - 3.5, 18, 5);
      doc.rect(colX[6], y - 3.5, 5, 5);
    }

    // Footer
    var footY = 285;
    doc.setDrawColor(200, 200, 200);
    doc.line(marginL, footY - 5, pageW - marginR, footY - 5);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Total SKU: ' + totalSku + '  |  Total Qty: ' + totalQty.toLocaleString(), marginL, footY);
    doc.text('Page ' + (page + 1) + ' / ' + totalPages, pageW - marginR - 20, footY);
  }

  doc.save('inspection_' + (plan.plan_no || 'list') + '.pdf');
  toast('検品リストPDFを出力しました');
}
