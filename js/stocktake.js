// =====================================================================
// SUPEREX LogiStation - stocktake.js
// 棚卸管理 / レポート / ユーザー管理
// =====================================================================

// ========================= 棚卸管理 =========================

var _icList = [];
var _icTabFilter = 'all';
var _icDetailId = null;
var _icScanner = null;
var _icLastScan = 0;
var _icLastCode = '';

RENDER_FNS.stocktake = async function renderStocktake() {
  var el = document.getElementById('page-stocktake');

  var startBtns = '';
  if (isOperator()) {
    startBtns = '<div style="display:flex;gap:6px;">'
      + '<button class="btn btn-p" onclick="icShowStartLocationModal()">ロケーション棚卸</button>'
      + '<button class="btn btn-p" onclick="icShowStartProductModal()">商品棚卸</button>'
    + '</div>';
  }

  el.innerHTML = '<div style="max-width:1000px;margin:0 auto;">'
    + '<div id="icKpi" style="margin-bottom:12px;"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;flex-wrap:wrap;gap:8px;">'
      + '<div class="tabs" style="max-width:300px;">'
        + '<div class="tab active" onclick="icSetTab(\'all\',this)">全て</div>'
        + '<div class="tab" onclick="icSetTab(\'counting\',this)">実施中</div>'
        + '<div class="tab" onclick="icSetTab(\'completed\',this)">完了</div>'
      + '</div>'
      + startBtns
    + '</div>'
    + '<div class="card"><div class="tw"><table>'
      + '<thead><tr><th>棚卸番号</th><th>種別</th><th>開始日時</th><th class="hm">完了日時</th><th>件数</th><th>差異</th><th>状態</th><th>操作</th></tr></thead>'
      + '<tbody id="icTb"></tbody>'
    + '</table></div></div>'
  + '</div>';

  _icTabFilter = 'all';
  await icLoadList();
};

// ---------- KPI ----------

// 差異数量: 確定済みは確定値、実施中はスキャン済み明細のライブ差異
// (count_qty - system_qty)。詳細画面のライブ計算と一致させる。
function icItemVariance(it) {
  if (it.count_qty === null || it.count_qty === undefined) return 0;
  return (it.count_qty || 0) - (it.system_qty || 0);
}

function icRenderKpi() {
  var today = new Date().toISOString().slice(0, 10);
  var active = _icList.filter(function(c) { return c.status === 'counting'; }).length;
  var todayDone = _icList.filter(function(c) {
    return c.status === 'completed' && c.completed_at && c.completed_at.slice(0, 10) === today;
  }).length;

  var varCount = 0;
  var varQty = 0;
  _icList.forEach(function(c) {
    (c.inventory_count_items || []).forEach(function(it) {
      var v = icItemVariance(it);
      if (v !== 0) { varCount++; varQty += Math.abs(v); }
    });
  });

  var kpiEl = document.getElementById('icKpi');
  if (!kpiEl) return;
  kpiEl.innerHTML = '<div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">'
    + '<div class="kpi b"><div class="kpi-lbl">実施中</div><div class="kpi-val">' + active + '</div></div>'
    + '<div class="kpi g"><div class="kpi-lbl">本日完了</div><div class="kpi-val">' + todayDone + '</div></div>'
    + '<div class="kpi y"><div class="kpi-lbl">差異件数</div><div class="kpi-val">' + varCount + '</div></div>'
    + '<div class="kpi ' + (varQty > 0 ? 'r' : 'g') + '"><div class="kpi-lbl">差異数量</div><div class="kpi-val">' + varQty + '</div></div>'
  + '</div>';
}

// ---------- リスト ----------

async function icLoadList() {
  var { data, error } = await sb.from('inventory_counts')
    .select('*, inventory_count_items(id, system_qty, count_qty, variance_qty)')
    .order('created_at', { ascending: false });
  if (error) { toast('棚卸一覧の読み込みに失敗しました: ' + error.message, 'error'); }
  _icList = data || [];
  icRenderList();
  icRenderKpi();
}

function icSetTab(tab, tabEl) {
  _icTabFilter = tab;
  document.querySelectorAll('#page-stocktake .tab').forEach(function(t) { t.classList.remove('active'); });
  if (tabEl) tabEl.classList.add('active');
  icRenderList();
}

function icRenderList() {
  var filtered = _icList;
  if (_icTabFilter !== 'all') filtered = filtered.filter(function(c) { return c.status === _icTabFilter; });

  var statusLabels = { counting: '実施中', completed: '完了' };
  var statusCls = { counting: 'by', completed: 'bg' };
  var typeLabels = { location: 'ロケーション', product: '商品' };

  var tb = document.getElementById('icTb');
  if (!tb) return;

  tb.innerHTML = filtered.length
    ? filtered.map(function(c) {
        var items = c.inventory_count_items || [];
        var total = items.length;
        var counted = items.filter(function(it) { return it.count_qty !== null; }).length;
        var variances = items.filter(function(it) { return icItemVariance(it) !== 0; }).length;

        return '<tr onclick="icGoDetail(\'' + c.id + '\')" style="cursor:pointer;">'
          + '<td style="font-family:var(--mono);font-size:11px;font-weight:500;">' + esc(c.count_no) + '</td>'
          + '<td><span class="badge ' + (c.count_type === 'location' ? 'bb' : 'by') + '">' + (typeLabels[c.count_type] || c.count_type) + '</span></td>'
          + '<td style="font-family:var(--mono);font-size:11px;">' + (c.started_at ? new Date(c.started_at).toLocaleString('ja-JP') : '—') + '</td>'
          + '<td class="hm" style="font-family:var(--mono);font-size:11px;">' + (c.completed_at ? new Date(c.completed_at).toLocaleString('ja-JP') : '—') + '</td>'
          + '<td style="font-family:var(--mono);">' + counted + '/' + total + '</td>'
          + '<td style="font-family:var(--mono);' + (variances > 0 ? 'color:var(--red);' : '') + '">' + variances + '</td>'
          + '<td><span class="badge ' + (statusCls[c.status] || 'bgr') + '">' + (statusLabels[c.status] || c.status) + '</span></td>'
          + '<td><button class="btn btn-g btn-sm" onclick="event.stopPropagation();icGoDetail(\'' + c.id + '\')">詳細</button></td>'
        + '</tr>';
      }).join('')
    : '<tr><td colspan="8" class="empty-state">棚卸データがありません</td></tr>';
}

// ---------- 棚卸開始モーダル ----------

async function icShowStartLocationModal() {
  var { data: locs } = await sb.from('locations').select('id, code').eq('is_active', true).order('code');
  locs = locs || [];
  var locOpts = locs.map(function(l) { return '<option value="' + l.id + '">' + esc(l.code) + '</option>'; }).join('');

  var body = '<div style="font-size:13px;margin-bottom:12px;">指定ロケーションの在庫を棚卸します。</div>'
    + '<div class="fl"><div class="flbl">対象ロケーション *</div>'
    + '<select class="fs" id="icStartLoc"><option value="">選択してください</option>' + locOpts + '</select></div>';

  openModal('ロケーション棚卸開始', body,
    '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>'
    + '<button class="btn btn-p" onclick="icStartLocationCount()">棚卸開始</button>');
}

async function icShowStartProductModal() {
  var { data: prods } = await sb.from('products').select('id, sku, name').is('deleted_at', null).order('name');
  prods = prods || [];
  var prodOpts = prods.map(function(p) {
    return '<option value="' + p.id + '">' + esc(p.name) + ' (' + esc(p.sku) + ')' + '</option>';
  }).join('');

  var body = '<div style="font-size:13px;margin-bottom:12px;">指定商品の全ロケーション在庫を棚卸します。</div>'
    + '<div class="fl"><div class="flbl">対象商品 *</div>'
    + '<select class="fs" id="icStartProd"><option value="">選択してください</option>' + prodOpts + '</select></div>';

  openModal('商品棚卸開始', body,
    '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>'
    + '<button class="btn btn-p" onclick="icStartProductCount()">棚卸開始</button>');
}

async function icStartLocationCount() {
  var locId = document.getElementById('icStartLoc').value;
  if (!locId) { toast('ロケーションを選択してください', 'error'); return; }

  var { data, error } = await sb.rpc('fn_start_inventory_count', {
    p_count_type: 'location', p_target_location_id: locId,
  });
  if (error) { toast('棚卸開始失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('棚卸を開始しました: ' + data.count_no + ' (' + data.item_count + '品目)');
  icGoDetail(data.id);
}

async function icStartProductCount() {
  var prodId = document.getElementById('icStartProd').value;
  if (!prodId) { toast('商品を選択してください', 'error'); return; }

  var { data, error } = await sb.rpc('fn_start_inventory_count', {
    p_count_type: 'product', p_target_product_id: prodId,
  });
  if (error) { toast('棚卸開始失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('棚卸を開始しました: ' + data.count_no + ' (' + data.item_count + '品目)');
  icGoDetail(data.id);
}

function icStartFromLocation(locId) {
  if (!confirm('このロケーションの棚卸を開始しますか？')) return;
  (async function() {
    var { data, error } = await sb.rpc('fn_start_inventory_count', {
      p_count_type: 'location', p_target_location_id: locId,
    });
    if (error) { toast('棚卸開始失敗: ' + error.message, 'error'); return; }
    toast('棚卸を開始しました: ' + data.count_no);
    icGoDetail(data.id);
  })();
}

// ---------- 棚卸詳細ページ ----------

function icGoDetail(id) {
  _icDetailId = id;
  go('stocktake-detail');
}

RENDER_FNS['stocktake-detail'] = async function renderStocktakeDetail() {
  var el = document.getElementById('page-stocktake-detail');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:12px;">読み込み中...</div>';

  var { data: count } = await sb.from('inventory_counts')
    .select('*, inventory_count_items(*, products(sku, name, jan_code), locations(code))')
    .eq('id', _icDetailId)
    .single();

  if (!count) {
    el.innerHTML = '<div class="empty-state"><div class="icon">&#128270;</div><p>棚卸データが見つかりません</p>'
      + '<button class="btn btn-g" style="margin-top:12px;" onclick="go(\'stocktake\')">一覧へ戻る</button></div>';
    return;
  }

  var items = count.inventory_count_items || [];
  items.sort(function(a, b) {
    var la = (a.locations && a.locations.code) || '';
    var lb = (b.locations && b.locations.code) || '';
    return la.localeCompare(lb) || ((a.products && a.products.name) || '').localeCompare((b.products && b.products.name) || '');
  });

  var statusLabels = { counting: '実施中', completed: '完了' };
  var statusCls = { counting: 'by', completed: 'bg' };
  var typeLabels = { location: 'ロケーション', product: '商品' };

  var totalItems = items.length;
  var countedItems = items.filter(function(it) { return it.count_qty !== null; }).length;
  var varItems = items.filter(function(it) { return icItemVariance(it) !== 0; }).length;
  var varQty = items.reduce(function(s, it) { return s + Math.abs(icItemVariance(it)); }, 0);

  var isCounting = count.status === 'counting';

  var actionBtns = '';
  if (isCounting && isOperator()) {
    actionBtns += '<button class="btn btn-p" onclick="icOpenScanModal()">JANスキャン</button>';
    actionBtns += ' <button class="btn btn-g" onclick="icSaveCountQty()">数量保存</button>';
  }
  if (isCounting && isAdmin()) {
    actionBtns += ' <button class="btn btn-p" onclick="icConfirm()" style="background:var(--green);">棚卸確定</button>';
  }

  var targetInfo = '';
  if (count.count_type === 'location' && items.length > 0 && items[0].locations) {
    targetInfo = '<div class="fl"><div class="flbl">対象ロケーション</div><div style="font-weight:500;font-family:var(--mono);">' + esc(items[0].locations.code) + '</div></div>';
  } else if (count.count_type === 'product' && items.length > 0 && items[0].products) {
    targetInfo = '<div class="fl"><div class="flbl">対象商品</div><div style="font-weight:500;">' + esc(items[0].products.name) + '</div></div>';
  }

  var rows = items.length
    ? items.map(function(it) {
        var p = it.products || {};
        var loc = it.locations || {};
        var variance = it.count_qty !== null ? (it.count_qty - it.system_qty) : null;
        var varStyle = variance === null ? '' : variance < 0 ? 'color:var(--red);' : variance > 0 ? 'color:var(--yellow);' : 'color:var(--green);';

        return '<tr>'
          + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.jan_code || '—') + '</td>'
          + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.sku || '—') + '</td>'
          + '<td style="font-size:11px;">' + esc(p.name || '—') + '</td>'
          + '<td style="font-family:var(--mono);font-size:11px;">' + esc(loc.code || '—') + '</td>'
          + '<td style="font-family:var(--mono);text-align:right;">' + it.system_qty + '</td>'
          + '<td style="text-align:right;">'
            + (isCounting
              ? '<input class="fi ic-qty" type="number" min="0" value="' + (it.count_qty !== null ? it.count_qty : '') + '" data-item-id="' + it.id + '" style="width:70px;padding:4px 6px;font-family:var(--mono);text-align:right;">'
              : '<span style="font-family:var(--mono);' + (it.count_qty !== null ? 'color:var(--accent);font-weight:500;' : '') + '">' + (it.count_qty !== null ? it.count_qty : '未') + '</span>')
          + '</td>'
          + '<td style="font-family:var(--mono);text-align:right;font-weight:700;' + varStyle + '">'
            + (variance !== null ? (variance >= 0 ? '+' : '') + variance : '—')
          + '</td>'
        + '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="empty-state">品目なし</td></tr>';

  el.innerHTML = '<div style="max-width:900px;margin:0 auto;">'

    + '<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-g btn-sm" onclick="go(\'stocktake\')">← 一覧へ戻る</button>'
      + '<div style="flex:1;"></div>'
      + '<button class="btn btn-g btn-sm" onclick="icExportCSV()">差異CSV</button>'
    + '</div>'

    + '<div class="card mb12">'
      + '<div class="card-hd">'
        + '<div><div class="card-title" style="font-size:15px;">' + esc(count.count_no) + '</div>'
        + '<div style="font-size:10px;color:var(--text2);margin-top:2px;">棚卸詳細</div></div>'
        + '<span class="badge ' + (statusCls[count.status] || 'bgr') + '">' + (statusLabels[count.status] || count.status) + '</span>'
      + '</div>'
      + '<div class="card-body">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px;">'
          + '<div class="fl"><div class="flbl">種別</div><div style="font-weight:500;">' + (typeLabels[count.count_type] || count.count_type) + '</div></div>'
          + targetInfo
          + '<div class="fl"><div class="flbl">開始日時</div><div style="font-weight:500;font-family:var(--mono);font-size:11px;">' + (count.started_at ? new Date(count.started_at).toLocaleString('ja-JP') : '—') + '</div></div>'
          + (count.completed_at ? '<div class="fl"><div class="flbl">完了日時</div><div style="font-weight:500;font-family:var(--mono);font-size:11px;">' + new Date(count.completed_at).toLocaleString('ja-JP') + '</div></div>' : '')
        + '</div>'
      + '</div>'
    + '</div>'

    + '<div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:12px;">'
      + '<div class="kpi b"><div class="kpi-lbl">品目数</div><div class="kpi-val">' + totalItems + '</div></div>'
      + '<div class="kpi g"><div class="kpi-lbl">カウント済</div><div class="kpi-val">' + countedItems + '</div></div>'
      + '<div class="kpi y"><div class="kpi-lbl">差異件数</div><div class="kpi-val">' + varItems + '</div></div>'
      + '<div class="kpi ' + (varQty > 0 ? 'r' : 'g') + '"><div class="kpi-lbl">差異数量</div><div class="kpi-val">' + varQty + '</div></div>'
    + '</div>'

    + (actionBtns ? '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">' + actionBtns + '</div>' : '')

    + '<div class="card">'
      + '<div class="card-hd"><div class="card-title">品目一覧</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + items.length + ' 件</div></div>'
      + '<div class="card-body" style="padding:0;">'
        + '<div class="tw"><table>'
          + '<thead><tr><th>JAN</th><th>SKU</th><th>商品名</th><th>ロケーション</th><th style="text-align:right;">システム</th><th style="text-align:right;">実数</th><th style="text-align:right;">差異</th></tr></thead>'
          + '<tbody>' + rows + '</tbody>'
        + '</table></div>'
      + '</div>'
    + '</div>'
  + '</div>';

  window._icCurrentCount = count;
};

// ---------- JANスキャンモーダル ----------

function icOpenScanModal() {
  if (!window._icCurrentCount || window._icCurrentCount.status !== 'counting') return;

  var body = '<div>'
    + '<div id="ic-scan-reader" style="width:100%;min-height:200px;border-radius:6px;overflow:hidden;background:#000;"></div>'
    + '<div id="ic-scan-result" style="margin-top:10px;"></div>'
    + '<div style="margin-top:10px;display:flex;gap:6px;">'
      + '<input class="fi" id="ic-scan-manual" placeholder="JANコードを手動入力..." inputmode="numeric" style="font-size:14px;font-family:var(--mono);" onkeydown="if(event.key===\'Enter\')icManualScan()">'
      + '<button class="btn btn-p" onclick="icManualScan()">カウント</button>'
    + '</div>'
  + '</div>';

  openModal('JANスキャン棚卸: ' + window._icCurrentCount.count_no, body,
    '<button class="btn btn-g" onclick="icCloseScanModal()">閉じる</button>', true);
  setTimeout(icStartScanner, 300);
}

async function icStartScanner() {
  icStopScanner();
  var readerEl = document.getElementById('ic-scan-reader');
  if (!readerEl) return;
  try {
    _icScanner = new Html5Qrcode('ic-scan-reader');
    await _icScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 450, height: 180 } },
      function(text) { icOnScan(text); },
      function() {}
    );
  } catch (e) {
    if (readerEl) readerEl.innerHTML = '<div style="color:rgba(255,255,255,.5);font-size:12px;text-align:center;padding:30px;">カメラ使用不可 — 手動入力を使用してください</div>';
  }
}

function icStopScanner() {
  if (!_icScanner) return;
  try {
    var state = _icScanner.getState();
    if (state === 2 || state === 3) _icScanner.stop().catch(function() {});
  } catch (e) {}
  try { _icScanner.clear(); } catch (e) {}
  _icScanner = null;
}

function icCloseScanModal() {
  icStopScanner();
  closeModal();
  if (_icDetailId) RENDER_FNS['stocktake-detail']();
}

async function icOnScan(code) {
  var now = Date.now();
  if (code === _icLastCode && now - _icLastScan < 2000) return;
  _icLastCode = code;
  _icLastScan = now;
  await icDoScan(code);
}

function icManualScan() {
  var input = document.getElementById('ic-scan-manual');
  var code = (input && input.value || '').trim();
  if (!code) { toast('JANコードを入力してください', 'error'); return; }
  input.value = '';
  icDoScan(code);
}

async function icDoScan(janCode) {
  var resultEl = document.getElementById('ic-scan-result');
  if (resultEl) resultEl.innerHTML = '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text2);">処理中...</div>';

  var { data, error } = await sb.rpc('fn_scan_inventory_count', {
    p_count_id: _icDetailId, p_jan_code: janCode, p_qty: 1,
  });

  if (error) {
    if (resultEl) resultEl.innerHTML = '<div style="padding:10px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;font-size:12px;color:var(--red);">' + esc(error.message) + '</div>';
    return;
  }

  try { _playBeep(); } catch (e) {}

  var diff = data.count_qty - data.system_qty;
  var diffColor = diff === 0 ? 'var(--green)' : diff > 0 ? 'var(--yellow)' : 'var(--red)';

  if (resultEl) {
    resultEl.innerHTML = '<div style="padding:10px;background:rgba(26,133,74,.06);border:1px solid rgba(26,133,74,.18);border-radius:6px;">'
      + '<div style="font-size:13px;font-weight:500;margin-bottom:4px;">' + esc(data.product_name) + ' <span style="font-size:11px;color:var(--text2);">(+' + data.scan_qty + ')</span></div>'
      + '<div style="font-size:12px;">システム: ' + data.system_qty + ' / 実数: <strong>' + data.count_qty + '</strong>'
      + ' / 差異: <span style="color:' + diffColor + ';font-weight:700;">' + (diff >= 0 ? '+' : '') + diff + '</span></div>'
    + '</div>';
  }
}

// ---------- 数量保存（手動入力）----------

async function icSaveCountQty() {
  var inputs = document.querySelectorAll('.ic-qty');
  var saved = 0;
  var errors = 0;
  for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    var val = inp.value.trim();
    if (val === '') continue;
    var qty = parseInt(val);
    if (isNaN(qty) || qty < 0) continue;
    var { error } = await sb.from('inventory_count_items')
      .update({ count_qty: qty })
      .eq('id', inp.getAttribute('data-item-id'));
    if (error) errors++;
    else saved++;
  }
  if (errors > 0) toast(errors + '件の保存に失敗しました', 'error');
  else if (saved > 0) toast(saved + '件のカウントを保存しました');
  else toast('保存するデータがありません', 'error');
  if (saved > 0) await RENDER_FNS['stocktake-detail']();
}

// ---------- 棚卸確定 ----------

async function icConfirm() {
  if (!confirm('棚卸を確定し、差異分を在庫に反映しますか？この操作は元に戻せません。')) return;
  var { data, error } = await sb.rpc('fn_complete_inventory_count', { p_count_id: _icDetailId });
  if (error) { toast('確定失敗: ' + error.message, 'error'); return; }
  toast('棚卸確定: ' + data.adjusted_items + '件の在庫を調整しました');
  await RENDER_FNS['stocktake-detail']();
}

// ---------- 差異CSV ----------

function icExportCSV() {
  var count = window._icCurrentCount;
  if (!count) return;
  var items = count.inventory_count_items || [];
  var header = ['JAN', 'SKU', '商品名', 'ロケーション', 'システム在庫', '実数', '差異', '理由'];
  var rows = items.map(function(it) {
    var p = it.products || {};
    var loc = it.locations || {};
    var variance = it.count_qty !== null ? it.count_qty - it.system_qty : '';
    return [p.jan_code, p.sku, p.name, loc.code, it.system_qty, it.count_qty !== null ? it.count_qty : '', variance, it.reason || ''];
  });
  downloadCSV('wms_stocktake_' + (count.count_no || 'export') + '.csv', header, rows);
  toast('棚卸差異CSVをダウンロードしました');
}

// ========================= レポート =========================

RENDER_FNS.reports = function renderReports() {
  const el = document.getElementById('page-reports');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">
      <div class="card">
        <div class="card-hd"><div class="card-title">在庫一覧</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">現在の在庫を全件CSVエクスポート</p>
          <button class="btn btn-p" onclick="go('inventory');setTimeout(()=>exportInventoryCSV(),500)">在庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">入庫履歴</div></div>
        <div class="card-body">
          <div class="fl mb12"><div class="flbl">期間</div>
            <div class="fr"><input class="fi" id="rptIbFrom" type="date"><input class="fi" id="rptIbTo" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <button class="btn btn-p" onclick="exportInboundCSV()">入庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">出庫履歴</div></div>
        <div class="card-body">
          <div class="fl mb12"><div class="flbl">期間</div>
            <div class="fr"><input class="fi" id="rptObFrom" type="date"><input class="fi" id="rptObTo" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <button class="btn btn-p" onclick="exportOutboundCSV()">出庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">商品マスタ</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">全商品のマスタデータ</p>
          <button class="btn btn-p" onclick="go('products');setTimeout(()=>exportProductsCSV(),500)">商品CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">ロケーション</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">全ロケーションのマスタデータ</p>
          <button class="btn btn-p" onclick="go('locations');setTimeout(()=>exportLocationsCSV(),500)">ロケCSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">荷主マスタ</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">全荷主のマスタデータ</p>
          <button class="btn btn-p" onclick="exportClientsCSV()">荷主CSV</button>
        </div>
      </div>
    </div>
  `;
};

async function exportInboundCSV() {
  const from = document.getElementById('rptIbFrom')?.value;
  const to = document.getElementById('rptIbTo')?.value;
  let q = sb.from('inbound_orders').select('*, inbound_items(*, products(sku, name))').order('created_at', { ascending: false });
  if (from) q = q.gte('planned_date', from);
  if (to) q = q.lte('planned_date', to);
  const { data } = await q;
  const header = ['伝票No', '仕入先', '予定日', '状態', 'SKU', '商品名', '予定数', '実数'];
  const rows = [];
  (data || []).forEach(o => {
    (o.inbound_items || []).forEach(it => {
      rows.push([o.slip_no, o.supplier, o.planned_date, o.status, it.products?.sku, it.products?.name, it.planned_qty, it.received_qty]);
    });
  });
  downloadCSV('wms_inbound_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('入庫履歴CSVをダウンロードしました');
}

async function exportOutboundCSV() {
  const from = document.getElementById('rptObFrom')?.value;
  const to = document.getElementById('rptObTo')?.value;
  let q = sb.from('outbound_orders').select('*, outbound_items(*, products(sku, name)), clients(name)').order('created_at', { ascending: false });
  if (from) q = q.gte('planned_date', from);
  if (to) q = q.lte('planned_date', to);
  const { data } = await q;
  const header = ['伝票No', '出荷先', '予定日', '状態', 'SKU', '商品名', '予定数', 'ピック済'];
  const rows = [];
  (data || []).forEach(o => {
    (o.outbound_items || []).forEach(it => {
      rows.push([o.slip_no, o.clients?.name || o.customer, o.planned_date, o.status, it.products?.sku, it.products?.name, it.planned_qty, it.picked_qty]);
    });
  });
  downloadCSV('wms_outbound_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('出庫履歴CSVをダウンロードしました');
}

async function exportClientsCSV() {
  const { data } = await sb.from('clients').select('*').order('code');
  const header = ['コード', '荷主名', '担当者', '電話番号', 'メール', '住所', '有効'];
  const rows = (data || []).map(c => [c.code, c.name, c.contact, c.phone, c.email, c.address, c.is_active ? '有効' : '無効']);
  downloadCSV('wms_clients_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('荷主マスタCSVをダウンロードしました');
}

// ========================= ユーザー管理 =========================

RENDER_FNS.users = async function renderUsers() {
  const el = document.getElementById('page-users');
  if (!isAdmin()) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🔒</div><p>管理者のみアクセスできます</p></div>';
    return;
  }
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:13px;">
      <button class="btn btn-p" onclick="openUserModal()">+ ユーザー追加</button>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>社員番号</th><th>表示名</th><th>ロール</th><th>最終ログイン</th><th>ロック</th><th>操作</th></tr></thead>
      <tbody id="usersTb"></tbody>
    </table></div></div>
  `;
  await loadUsers();
};

let _users = [];

async function loadUsers() {
  const { data } = await sb.from('profiles').select('*').order('employee_number');
  _users = data || [];
  const tb = document.getElementById('usersTb');
  if (!tb) return;
  const roleBadge = r => r === 'admin' ? '<span class="badge br">管理者</span>' : r === 'operator' ? '<span class="badge bg">オペレータ</span>' : '<span class="badge bgr">閲覧者</span>';
  tb.innerHTML = _users.length
    ? _users.map(u => `<tr>
        <td style="font-family:var(--mono);">${esc(u.employee_number)}</td>
        <td>${esc(u.display_name) || '—'}</td>
        <td>${roleBadge(u.role)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text2);">${u.last_login_at ? fmtDate(u.last_login_at) + ' ' + fmtTime(u.last_login_at) : '—'}</td>
        <td>${u.is_locked ? '<span class="badge br">ロック中</span>' : u.locked_until && new Date(u.locked_until) > new Date() ? '<span class="badge by">一時ロック</span>' : '<span class="badge bg">正常</span>'}</td>
        <td>
          <button class="btn btn-g btn-sm" onclick="openUserEditModal('${u.id}')">編集</button>
          ${u.is_locked || (u.locked_until && new Date(u.locked_until) > new Date()) ? `<button class="btn btn-p btn-sm" onclick="unlockUser('${u.id}')">解除</button>` : ''}
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty-state">ユーザーがいません</td></tr>';
}

function openUserModal() {
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">社員番号 *</div><input class="fi" id="um_emp" placeholder="E00002"></div>
    <div class="fl"><div class="flbl">表示名</div><input class="fi" id="um_name" placeholder="山田 太郎"></div>
    <div class="fl"><div class="flbl">ロール</div><select class="fs" id="um_role">
      <option value="viewer">閲覧者</option>
      <option value="operator">オペレータ</option>
      <option value="admin">管理者</option>
    </select></div>
    <div class="fl"><div class="flbl">初期パスワード（数字5桁）</div><input class="fi" id="um_pin" placeholder="12345" maxlength="5" inputmode="numeric"></div>
    <p style="font-size:11px;color:var(--text2);">※ Supabase Dashboard の Authentication > Users で手動作成後、ここで社員番号を紐づけてください。自動作成は Edge Function が必要です。</p>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="toast('Edge Function 未実装のため、supabase/README.md の手順で作成してください','error');closeModal();">作成</button>
  `;
  openModal('ユーザー追加', body, footer);
}

function openUserEditModal(id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">社員番号</div><input class="fi" value="${esc(u.employee_number)}" readonly style="opacity:.6;"></div>
    <div class="fl"><div class="flbl">表示名</div><input class="fi" id="ue_name" value="${esc(u.display_name || '')}"></div>
    <div class="fl"><div class="flbl">ロール</div><select class="fs" id="ue_role">
      <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>閲覧者</option>
      <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>オペレータ</option>
      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者</option>
    </select></div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveUserEdit('${u.id}')">保存</button>
  `;
  openModal('ユーザー編集 - ' + esc(u.employee_number), body, footer);
}

async function saveUserEdit(id) {
  const name = document.getElementById('ue_name').value.trim();
  const role = document.getElementById('ue_role').value;
  const { error } = await sb.from('profiles').update({ display_name: name || null, role }).eq('id', id);
  if (error) { toast('保存失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('ユーザーを更新しました');
  await loadUsers();
}

async function unlockUser(id) {
  const { error } = await sb.from('profiles').update({
    is_locked: false, locked_until: null, failed_count: 0,
  }).eq('id', id);
  if (error) { toast('解除失敗: ' + error.message, 'error'); return; }
  toast('ロックを解除しました');
  await loadUsers();
}

// 他端末の作業進捗を自動反映（app.jsの自動リフレッシュに登録）
AUTO_REFRESH_FNS.stocktake = icLoadList;
