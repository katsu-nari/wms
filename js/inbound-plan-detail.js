// =====================================================================
// SUPEREX LogiStation - inbound-plan-detail.js
// 入荷予定詳細: 検品・PC検品・入荷計上・キャンセル
// =====================================================================

var _ipdPlan = null;
var _ipdScanMode = 'single';
var _ipdScanner = null;
var _ipdItemState = {};

RENDER_FNS['inbound-plan-detail'] = async function renderInboundPlanDetail() {
  var el = document.getElementById('page-inbound-plan-detail');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:12px;">読み込み中...</div>';

  var plan = null;
  var query = '*, clients(name), profiles!inbound_plans_created_by_fkey(display_name, employee_number), inbound_plan_items(*, products(sku, name, jan_code, case_qty))';

  if (window._ipDetailId) {
    var res = await sb.from('inbound_plans').select(query).eq('id', window._ipDetailId).single();
    plan = res.data;
  } else if (window._ipDetailPlanNo) {
    var res2 = await sb.from('inbound_plans').select(query).eq('plan_no', window._ipDetailPlanNo).single();
    plan = res2.data;
  }

  if (!plan) {
    el.innerHTML = '<div class="empty-state"><div class="icon">&#128270;</div><p>入荷予定が見つかりません</p><button class="btn btn-g" style="margin-top:12px;" onclick="go(\'inbound-plan\')">一覧へ戻る</button></div>';
    return;
  }

  _ipdPlan = plan;
  window._ipDetailId = plan.id;
  window._ipDetailPlanNo = plan.plan_no;

  var items = plan.inbound_plan_items || [];
  var clientName = (plan.clients && plan.clients.name) || '—';
  var creatorName = (plan.profiles && (plan.profiles.display_name || plan.profiles.employee_number)) || '—';
  var totalSku = items.length;
  var totalPlanned = items.reduce(function(s, it) { return s + (it.planned_qty || 0); }, 0);
  var totalReceived = items.reduce(function(s, it) { return s + (it.received_qty || 0); }, 0);
  var progress = totalPlanned > 0 ? Math.round(totalReceived / totalPlanned * 100) : 0;

  var statusLabels = { planned: '予定', receiving: '検品中', completed: '完了', cancelled: '取消' };
  var statusCls = { planned: 'bb', receiving: 'by', completed: 'bg', cancelled: 'bgr' };

  var isReceiving = plan.status === 'receiving' && isOperator();

  if (isReceiving) {
    _ipdItemState = {};
    items.forEach(function(it) {
      var recQty = it.received_qty || 0;
      _ipdItemState[it.id] = {
        checked: it.checked || recQty > 0,
        received_qty: recQty,
      };
    });
  }

  var colSpan = isReceiving ? 7 : 6;
  var rows = items.map(function(it) {
    var p = it.products || {};
    if (isReceiving) {
      var st = _ipdItemState[it.id];
      var variance = st.received_qty - it.planned_qty;
      var varStyle = variance < 0 ? 'color:var(--red);' : variance > 0 ? 'color:var(--yellow);' : 'color:var(--green);';
      return '<tr>'
        + '<td style="text-align:center;width:36px;"><input type="checkbox" ' + (st.checked ? 'checked' : '') + ' data-item-id="' + it.id + '" data-planned="' + it.planned_qty + '" onchange="ipdOnCheckChange(this)"></td>'
        + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.jan_code || '—') + '</td>'
        + '<td style="font-size:11px;">' + esc(p.name || '—') + '</td>'
        + '<td style="font-family:var(--mono);text-align:right;">' + it.planned_qty + '</td>'
        + '<td style="width:80px;"><input type="number" class="fi" min="0" value="' + st.received_qty + '" data-item-id="' + it.id + '" data-planned="' + it.planned_qty + '" oninput="ipdOnQtyInput(this)" style="width:70px;font-family:var(--mono);text-align:right;padding:4px 6px;font-size:12px;"></td>'
        + '<td style="font-family:var(--mono);text-align:right;' + varStyle + '" id="ipdVar_' + it.id + '">' + (variance >= 0 ? '+' : '') + variance + '</td>'
        + '<td style="font-family:var(--mono);font-size:10px;">' + (it.expiry_date ? fmtDate(it.expiry_date) : '—') + '</td>'
        + '</tr>';
    }
    var variance = (it.received_qty || 0) - it.planned_qty;
    var varStyle = variance < 0 ? 'color:var(--red);' : variance > 0 ? 'color:var(--yellow);' : 'color:var(--green);';
    return '<tr>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.jan_code || '—') + '</td>'
      + '<td style="font-size:11px;">' + esc(p.name || '—') + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;">' + it.planned_qty + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;">' + (it.received_qty || 0) + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;' + varStyle + '">' + (variance >= 0 ? '+' : '') + variance + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + (it.expiry_date ? fmtDate(it.expiry_date) : '—') + '</td>'
      + '</tr>';
  }).join('');

  var actionBtns = '';
  if (isOperator()) {
    if (plan.status === 'planned') {
      actionBtns = '<button class="btn btn-p" onclick="ipdStartReceiving()">検品開始</button>';
      if (isAdmin()) {
        actionBtns += ' <button class="btn btn-d" onclick="ipdShowCancelModal()">キャンセル</button>';
      }
    } else if (plan.status === 'receiving') {
      actionBtns = '<button class="btn btn-g" onclick="ipdCheckAll()">全チェック</button>'
        + ' <button class="btn btn-p" onclick="ipdOpenScanModal()">QR検品</button>'
        + ' <button class="btn btn-p" style="background:var(--green);border-color:var(--green);" onclick="ipdShowReceiveModal()">入荷計上</button>';
    }
  }

  var toolBtns = '';
  if (isOperator()) {
    toolBtns = '<button class="btn btn-g btn-sm" onclick="ipPrintPdf(\'' + plan.id + '\')">PDF出力</button>'
      + ' <button class="btn btn-g btn-sm" onclick="ipShowQrModal(\'' + esc(plan.plan_no) + '\')">QR</button>'
      + ' <button class="btn btn-g btn-sm" onclick="ipShowBarcodeModal(\'' + esc(plan.plan_no) + '\')">バーコード</button>';
  }

  var kpiHtml;
  if (isReceiving) {
    var checkedCount = items.filter(function(it) { var st = _ipdItemState[it.id]; return st && st.checked; }).length;
    var varSkuCount = items.filter(function(it) { var st = _ipdItemState[it.id]; return st && st.received_qty !== it.planned_qty; }).length;
    var totalVarQty = items.reduce(function(s, it) { var st = _ipdItemState[it.id]; return s + (st ? Math.abs(st.received_qty - it.planned_qty) : 0); }, 0);
    kpiHtml = '<div class="kpi-grid" id="ipdReceivingKpi" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:12px;">'
      + '<div class="kpi b"><div class="kpi-lbl">予定SKU</div><div class="kpi-val">' + totalSku + '</div></div>'
      + '<div class="kpi g"><div class="kpi-lbl">検品完了</div><div class="kpi-val" id="ipdKpiChecked">' + checkedCount + '</div></div>'
      + '<div class="kpi ' + (varSkuCount > 0 ? 'r' : 'g') + '"><div class="kpi-lbl">差異SKU</div><div class="kpi-val" id="ipdKpiVarSku">' + varSkuCount + '</div></div>'
      + '<div class="kpi ' + (totalVarQty > 0 ? 'y' : 'g') + '"><div class="kpi-lbl">差異数量</div><div class="kpi-val" id="ipdKpiVarQty">' + totalVarQty + '</div></div>'
    + '</div>';
  } else {
    kpiHtml = '<div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:12px;">'
      + '<div class="kpi b"><div class="kpi-lbl">SKU</div><div class="kpi-val">' + totalSku + '</div></div>'
      + '<div class="kpi y"><div class="kpi-lbl">予定数量</div><div class="kpi-val">' + totalPlanned.toLocaleString() + '</div></div>'
      + '<div class="kpi g"><div class="kpi-lbl">実績数量</div><div class="kpi-val">' + totalReceived.toLocaleString() + '</div></div>'
      + '<div class="kpi ' + (progress >= 100 ? 'g' : progress > 0 ? 'y' : 'b') + '"><div class="kpi-lbl">進捗</div><div class="kpi-val">' + progress + '%</div></div>'
    + '</div>';
  }

  var theadHtml = isReceiving
    ? '<thead><tr><th style="width:36px;">✓</th><th>JAN</th><th>商品名</th><th style="text-align:right;">予定数</th><th style="text-align:right;">実績数</th><th style="text-align:right;">差異</th><th>賞味期限</th></tr></thead>'
    : '<thead><tr><th>JAN</th><th>商品名</th><th style="text-align:right;">予定数</th><th style="text-align:right;">実績数</th><th style="text-align:right;">差異</th><th>賞味期限</th></tr></thead>';

  el.innerHTML = '<div style="max-width:800px;margin:0 auto;">'
    + '<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-g btn-sm" onclick="go(\'inbound-plan\')">← 一覧へ戻る</button>'
      + '<div style="flex:1;"></div>'
      + toolBtns
    + '</div>'

    + '<div class="card mb12">'
      + '<div class="card-hd">'
        + '<div><div class="card-title" style="font-size:15px;">' + esc(plan.plan_no) + '</div>'
        + '<div style="font-size:10px;color:var(--text2);margin-top:2px;">入荷予定詳細</div></div>'
        + '<span class="badge ' + (statusCls[plan.status] || 'bgr') + '">' + (statusLabels[plan.status] || plan.status) + '</span>'
      + '</div>'
      + '<div class="card-body">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">'
          + '<div class="fl"><div class="flbl">入荷予定日</div><div style="font-weight:500;">' + fmtDate(plan.planned_date) + '</div></div>'
          + '<div class="fl"><div class="flbl">荷主</div><div style="font-weight:500;">' + esc(clientName) + '</div></div>'
          + '<div class="fl"><div class="flbl">作成者</div><div style="font-weight:500;">' + esc(creatorName) + '</div></div>'
          + '<div class="fl"><div class="flbl">作成日時</div><div style="font-weight:500;font-family:var(--mono);font-size:11px;">' + (plan.created_at ? new Date(plan.created_at).toLocaleString('ja-JP') : '—') + '</div></div>'
        + '</div>'
      + '</div>'
    + '</div>'

    + kpiHtml

    + (actionBtns ? '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">' + actionBtns + '</div>' : '')

    + (plan.status === 'cancelled' && plan.cancel_reason ? '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;font-size:12px;"><strong style="color:var(--red);">キャンセル理由:</strong> ' + esc(plan.cancel_reason) + '</div>' : '')

    + '<div class="card">'
      + '<div class="card-hd"><div class="card-title">明細一覧</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + items.length + ' 件</div></div>'
      + '<div class="card-body" style="padding:0;">'
        + '<div class="tw"><table>'
          + theadHtml
          + '<tbody>' + (rows || '<tr><td colspan="' + colSpan + '" class="empty-state">明細なし</td></tr>') + '</tbody>'
        + '</table></div>'
      + '</div>'
    + '</div>'
  + '</div>';
};

// ---------- 検品開始 ----------

async function ipdStartReceiving() {
  if (!_ipdPlan || _ipdPlan.status !== 'planned') return;
  var ok = confirm('検品を開始しますか？ステータスが「検品中」に変わります。');
  if (!ok) return;

  var { error } = await sb.rpc('fn_ip_start_receiving', { p_plan_id: _ipdPlan.id });
  if (error) { toast('検品開始失敗: ' + error.message, 'error'); return; }
  toast('検品を開始しました');
  window._ipDetailId = _ipdPlan.id;
  await RENDER_FNS['inbound-plan-detail']();
}

// ---------- QR検品モーダル ----------

function ipdOpenScanModal() {
  if (!_ipdPlan || _ipdPlan.status !== 'receiving') return;

  var body = '<div>'
    + '<div style="display:flex;gap:6px;margin-bottom:10px;">'
      + '<button class="btn ' + (_ipdScanMode === 'single' ? 'btn-p' : 'btn-g') + ' btn-sm" id="ipdModeSingle" onclick="ipdSetScanMode(\'single\')">単品 (+1)</button>'
      + '<button class="btn ' + (_ipdScanMode === 'case' ? 'btn-p' : 'btn-g') + ' btn-sm" id="ipdModeCase" onclick="ipdSetScanMode(\'case\')">ケース (+case_qty)</button>'
    + '</div>'
    + '<div id="ipd-scan-reader" style="width:100%;min-height:200px;border-radius:6px;overflow:hidden;background:#000;"></div>'
    + '<div id="ipd-scan-result" style="margin-top:10px;"></div>'
    + '<div style="margin-top:10px;display:flex;gap:6px;">'
      + '<input class="fi" id="ipd-scan-manual" placeholder="JANコードを手動入力..." inputmode="numeric" style="font-size:14px;font-family:var(--mono);" onkeydown="if(event.key===\'Enter\')ipdManualScan()">'
      + '<button class="btn btn-p" onclick="ipdManualScan()">検品</button>'
    + '</div>'
  + '</div>';

  openModal('QR検品: ' + _ipdPlan.plan_no, body, '<button class="btn btn-g" onclick="ipdCloseScanModal()">閉じる</button>', true);
  setTimeout(ipdStartScanner, 300);
}

function ipdSetScanMode(mode) {
  _ipdScanMode = mode;
  var s = document.getElementById('ipdModeSingle');
  var c = document.getElementById('ipdModeCase');
  if (s) { s.className = 'btn ' + (mode === 'single' ? 'btn-p' : 'btn-g') + ' btn-sm'; }
  if (c) { c.className = 'btn ' + (mode === 'case' ? 'btn-p' : 'btn-g') + ' btn-sm'; }
}

async function ipdStartScanner() {
  ipdStopScanner();
  var readerEl = document.getElementById('ipd-scan-reader');
  if (!readerEl) return;
  try {
    _ipdScanner = new Html5Qrcode('ipd-scan-reader');
    await _ipdScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 450, height: 180 } },
      function(text) { ipdOnScan(text); },
      function() {}
    );
  } catch (e) {
    if (readerEl) readerEl.innerHTML = '<div style="color:rgba(255,255,255,.5);font-size:12px;text-align:center;padding:30px;">カメラ使用不可 — 手動入力を使用してください</div>';
  }
}

function ipdStopScanner() {
  if (!_ipdScanner) return;
  try {
    var state = _ipdScanner.getState();
    if (state === 2 || state === 3) _ipdScanner.stop().catch(function() {});
  } catch (e) {}
  try { _ipdScanner.clear(); } catch (e) {}
  _ipdScanner = null;
}

function ipdCloseScanModal() {
  ipdStopScanner();
  closeModal();
  window._ipDetailId = _ipdPlan ? _ipdPlan.id : null;
  RENDER_FNS['inbound-plan-detail']();
}

var _ipdLastScan = 0;
var _ipdLastCode = '';

async function ipdOnScan(code) {
  var now = Date.now();
  if (code === _ipdLastCode && now - _ipdLastScan < 2000) return;
  _ipdLastCode = code;
  _ipdLastScan = now;
  await ipdDoScan(code);
}

async function ipdManualScan() {
  var input = document.getElementById('ipd-scan-manual');
  var code = (input && input.value || '').trim();
  if (!code) { toast('JANコードを入力してください', 'error'); return; }
  input.value = '';
  await ipdDoScan(code);
}

async function ipdDoScan(janCode) {
  var resultEl = document.getElementById('ipd-scan-result');
  if (resultEl) resultEl.innerHTML = '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text2);">処理中...</div>';

  var scanType = _ipdScanMode;
  var qty = 1;
  if (scanType === 'case') {
    var items = _ipdPlan.inbound_plan_items || [];
    var matchItem = items.find(function(it) { return it.products && it.products.jan_code === janCode; });
    if (matchItem && matchItem.products && matchItem.products.case_qty > 1) {
      qty = matchItem.products.case_qty;
    }
  }

  var { data, error } = await sb.rpc('fn_ip_scan_item', {
    p_plan_id: _ipdPlan.id,
    p_jan_code: janCode,
    p_qty: qty,
    p_scan_type: scanType,
  });

  if (error) {
    if (resultEl) resultEl.innerHTML = '<div style="padding:10px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;font-size:12px;color:var(--red);">' + esc(error.message) + '</div>';
    return;
  }

  try { _playBeep(); } catch (e) {}

  var pct = data.planned_qty > 0 ? Math.round(data.received_qty / data.planned_qty * 100) : 0;
  var barColor = pct >= 100 ? 'var(--green)' : 'var(--accent)';

  if (resultEl) {
    resultEl.innerHTML = '<div style="padding:10px;background:rgba(26,133,74,.06);border:1px solid rgba(26,133,74,.18);border-radius:6px;">'
      + '<div style="font-size:13px;font-weight:500;margin-bottom:4px;">' + esc(data.product_name) + ' <span style="font-size:11px;color:var(--text2);">(+' + qty + ')</span></div>'
      + '<div style="font-size:12px;margin-bottom:6px;">予定: ' + data.planned_qty + ' / 実績: <strong>' + data.received_qty + '</strong></div>'
      + '<div class="pb"><div class="pf" style="width:' + Math.min(pct, 100) + '%;background:' + barColor + ';"></div></div>'
      + '<div style="text-align:right;font-family:var(--mono);font-size:11px;margin-top:2px;">' + pct + '%</div>'
    + '</div>';
  }
}

// ---------- PC検品: チェックボックス・数量操作 ----------

function ipdOnCheckChange(cb) {
  var itemId = cb.getAttribute('data-item-id');
  var planned = parseInt(cb.getAttribute('data-planned')) || 0;
  var st = _ipdItemState[itemId];
  if (!st) return;

  st.checked = cb.checked;

  if (cb.checked && st.received_qty === 0) {
    st.received_qty = planned;
    var input = document.querySelector('input[type="number"][data-item-id="' + itemId + '"]');
    if (input) input.value = planned;
    var varEl = document.getElementById('ipdVar_' + itemId);
    if (varEl) { varEl.textContent = '+0'; varEl.style.color = 'var(--green)'; }
  }

  ipdUpdateReceivingKpi();
}

function ipdOnQtyInput(input) {
  var itemId = input.getAttribute('data-item-id');
  var planned = parseInt(input.getAttribute('data-planned')) || 0;
  var qty = parseInt(input.value) || 0;
  if (qty < 0) qty = 0;

  var st = _ipdItemState[itemId];
  if (!st) return;
  st.received_qty = qty;

  if (qty > 0 && !st.checked) {
    st.checked = true;
    var cb = document.querySelector('input[type="checkbox"][data-item-id="' + itemId + '"]');
    if (cb) cb.checked = true;
  }

  var variance = qty - planned;
  var varEl = document.getElementById('ipdVar_' + itemId);
  if (varEl) {
    varEl.textContent = (variance >= 0 ? '+' : '') + variance;
    varEl.style.color = variance < 0 ? 'var(--red)' : variance > 0 ? 'var(--yellow)' : 'var(--green)';
  }

  ipdUpdateReceivingKpi();
}

function ipdCheckAll() {
  var items = (_ipdPlan && _ipdPlan.inbound_plan_items) || [];
  items.forEach(function(it) {
    var st = _ipdItemState[it.id];
    if (!st || st.checked) return;
    st.checked = true;
    if (st.received_qty === 0) st.received_qty = it.planned_qty;
    var cb = document.querySelector('input[type="checkbox"][data-item-id="' + it.id + '"]');
    if (cb) cb.checked = true;
    var input = document.querySelector('input[type="number"][data-item-id="' + it.id + '"]');
    if (input) input.value = st.received_qty;
    var variance = st.received_qty - it.planned_qty;
    var varEl = document.getElementById('ipdVar_' + it.id);
    if (varEl) {
      varEl.textContent = (variance >= 0 ? '+' : '') + variance;
      varEl.style.color = variance < 0 ? 'var(--red)' : variance > 0 ? 'var(--yellow)' : 'var(--green)';
    }
  });
  ipdUpdateReceivingKpi();
  toast('全アイテムをチェックしました');
}

function ipdUpdateReceivingKpi() {
  var items = (_ipdPlan && _ipdPlan.inbound_plan_items) || [];
  var checkedCount = 0, varSkuCount = 0, totalVarQty = 0;
  items.forEach(function(it) {
    var st = _ipdItemState[it.id];
    if (!st) return;
    if (st.checked) checkedCount++;
    if (st.received_qty !== it.planned_qty) {
      varSkuCount++;
      totalVarQty += Math.abs(st.received_qty - it.planned_qty);
    }
  });
  var el1 = document.getElementById('ipdKpiChecked');
  var el2 = document.getElementById('ipdKpiVarSku');
  var el3 = document.getElementById('ipdKpiVarQty');
  if (el1) el1.textContent = checkedCount;
  if (el2) el2.textContent = varSkuCount;
  if (el3) el3.textContent = totalVarQty;
}

// ---------- 入荷計上モーダル ----------

async function ipdShowReceiveModal() {
  if (!_ipdPlan || _ipdPlan.status !== 'receiving') return;

  var items = _ipdPlan.inbound_plan_items || [];
  var checkedItems = items.filter(function(it) { var st = _ipdItemState[it.id]; return st && st.checked; });

  if (checkedItems.length === 0) {
    toast('検品済みのアイテムがありません', 'error');
    return;
  }

  var { data: locs } = await sb.from('locations').select('id, code').eq('is_active', true).order('code');
  locs = locs || [];
  var locOpts = locs.map(function(l) { return '<option value="' + l.id + '">' + esc(l.code) + '</option>'; }).join('');

  var hasVariance = checkedItems.some(function(it) {
    var st = _ipdItemState[it.id];
    return st && st.received_qty !== it.planned_qty;
  });

  var varianceHtml = '';
  if (hasVariance) {
    varianceHtml = '<div style="margin-top:12px;"><div style="font-size:12px;font-weight:500;margin-bottom:6px;">差異がある明細</div>';
    checkedItems.forEach(function(it) {
      var st = _ipdItemState[it.id];
      if (!st) return;
      var diff = st.received_qty - it.planned_qty;
      if (diff === 0) return;
      var p = it.products || {};
      varianceHtml += '<div style="padding:8px;background:var(--surface2);border-radius:6px;margin-bottom:6px;font-size:12px;">'
        + '<div style="font-weight:500;margin-bottom:4px;">' + esc(p.name || '—') + ' <span style="font-family:var(--mono);color:' + (diff < 0 ? 'var(--red)' : 'var(--yellow)') + ';">' + (diff >= 0 ? '+' : '') + diff + '</span></div>'
        + '<select class="fs" data-receive-item-id="' + it.id + '" style="font-size:12px;">'
          + '<option value="">差異理由を選択</option>'
          + '<option value="不足">不足</option>'
          + '<option value="過剰">過剰</option>'
          + '<option value="破損">破損</option>'
          + '<option value="期限不良">期限不良</option>'
          + '<option value="その他">その他</option>'
        + '</select>'
      + '</div>';
    });
    varianceHtml += '</div>';
  }

  var summaryHtml = '<div style="font-size:12px;margin-bottom:8px;color:var(--text2);">検品済み: <strong>' + checkedItems.length + '</strong> / ' + items.length + ' SKU</div>';

  var body = '<div style="font-size:13px;margin-bottom:12px;">検品済みアイテムを在庫に計上します。</div>'
    + summaryHtml
    + '<div class="fl" style="margin-bottom:10px;">'
      + '<div class="flbl">入庫先ロケーション</div>'
      + '<select class="fs" id="ipdReceiveLoc"><option value="">選択してください</option>' + locOpts + '</select>'
    + '</div>'
    + varianceHtml;

  var footer = '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>'
    + '<button class="btn btn-p" id="ipdReceiveBtn" onclick="ipdDoReceive()">入荷計上</button>';

  openModal('入荷計上', body, footer);
}

async function ipdDoReceive() {
  var locId = document.getElementById('ipdReceiveLoc').value;
  if (!locId) { toast('入庫先ロケーションを選択してください', 'error'); return; }

  var btn = document.getElementById('ipdReceiveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '処理中...'; }

  var items = (_ipdPlan && _ipdPlan.inbound_plan_items) || [];
  var rpcItems = [];

  items.forEach(function(it) {
    var st = _ipdItemState[it.id];
    if (!st || !st.checked) return;
    var reason = '';
    var sel = document.querySelector('[data-receive-item-id="' + it.id + '"]');
    if (sel) reason = sel.value;
    rpcItems.push({
      item_id: it.id,
      received_qty: st.received_qty,
      checked: true,
      variance_reason: reason || null,
    });
  });

  if (rpcItems.length === 0) {
    toast('計上対象のアイテムがありません', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '入荷計上'; }
    return;
  }

  var { data, error } = await sb.rpc('fn_receive_inbound_plan', {
    p_plan_id: _ipdPlan.id,
    p_location_id: locId,
    p_items: rpcItems,
  });

  if (error) {
    toast('入荷計上失敗: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '入荷計上'; }
    return;
  }

  closeModal();
  toast('入荷計上が完了しました。在庫に反映されました。');
  window._ipDetailId = _ipdPlan.id;
  await RENDER_FNS['inbound-plan-detail']();
}

// ---------- キャンセル ----------

function ipdShowCancelModal() {
  if (!_ipdPlan || _ipdPlan.status !== 'planned') return;

  var body = '<div style="font-size:13px;margin-bottom:12px;">この入荷予定をキャンセルします。</div>'
    + '<div class="fl"><div class="flbl">キャンセル理由（必須）</div>'
    + '<textarea class="fi" id="ipdCancelReason" rows="3" style="resize:vertical;" placeholder="理由を入力してください"></textarea></div>';

  var footer = '<button class="btn btn-g" onclick="closeModal()">戻る</button>'
    + '<button class="btn btn-d" id="ipdCancelBtn" onclick="ipdDoCancel()">キャンセル実行</button>';

  openModal('入荷予定キャンセル', body, footer);
}

async function ipdDoCancel() {
  var reason = (document.getElementById('ipdCancelReason').value || '').trim();
  if (!reason) { toast('キャンセル理由を入力してください', 'error'); return; }

  var btn = document.getElementById('ipdCancelBtn');
  if (btn) { btn.disabled = true; btn.textContent = '処理中...'; }

  var { error } = await sb.rpc('fn_ip_cancel', {
    p_plan_id: _ipdPlan.id,
    p_reason: reason,
  });

  if (error) {
    toast('キャンセル失敗: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'キャンセル実行'; }
    return;
  }

  closeModal();
  toast('入荷予定をキャンセルしました');
  window._ipDetailId = _ipdPlan.id;
  await RENDER_FNS['inbound-plan-detail']();
}

// ---------- QR / Barcode Modal ----------

function ipShowQrModal(planNo) {
  var qrContent = JSON.stringify({ type: 'inbound_plan', plan_no: planNo, version: 1 });
  var qrImg = _generateQrDataUrl(qrContent);
  var body = '<div style="text-align:center;padding:10px 0;">'
    + (qrImg ? '<img src="' + qrImg + '" style="width:200px;height:200px;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;">' : '<div style="color:var(--red);">QR生成失敗</div>')
    + '<div style="margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--text2);word-break:break-all;">' + esc(qrContent) + '</div>'
    + '</div>';
  openModal('QRコード: ' + planNo, body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

function ipShowBarcodeModal(planNo) {
  var canvas = document.createElement('canvas');
  var success = false;
  try {
    JsBarcode(canvas, planNo, { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 14, margin: 10 });
    success = true;
  } catch (e) {}

  var body = '<div style="text-align:center;padding:10px 0;">'
    + (success ? '<img src="' + canvas.toDataURL('image/png') + '" style="max-width:100%;border:1px solid var(--border);border-radius:6px;">' : '<div style="color:var(--red);">バーコード生成失敗</div>')
    + '<div style="margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--text2);">' + esc(planNo) + '</div>'
    + '</div>';
  openModal('CODE128: ' + planNo, body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}
