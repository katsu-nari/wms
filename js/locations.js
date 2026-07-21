// =====================================================================
// SUPEREX LogiStation - locations.js
// ロケーション管理: 一覧 / マップ / 詳細 / QR / 商品検索
// =====================================================================

var _locTab = 'list';
var _locations = [];
var _locSearchQuery = '';
var _locProductMatchIds = [];
var _locSearchTimer = null;
var _locMapData = [];

// ========================= メインページ =========================

RENDER_FNS.locations = async function renderLocations() {
  var el = document.getElementById('page-locations');
  el.innerHTML = '<div style="max-width:1000px;margin:0 auto;">'
    + '<div id="locKpi" style="margin-bottom:12px;"></div>'
    + '<div class="tabs" id="locTabs" style="max-width:200px;">'
      + '<div class="tab active" onclick="setLocTab(\'list\',this)">一覧</div>'
      + '<div class="tab" onclick="setLocTab(\'map\',this)">マップ</div>'
    + '</div>'
    + '<div id="locListView"></div>'
    + '<div id="locMapView" style="display:none;"></div>'
  + '</div>';
  _locTab = 'list';
  _locSearchQuery = '';
  _locProductMatchIds = [];
  renderLocList();
  await loadLocations();
};

function setLocTab(tab, tabEl) {
  _locTab = tab;
  document.querySelectorAll('#locTabs .tab').forEach(function(t) { t.classList.remove('active'); });
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('locListView').style.display = tab === 'list' ? '' : 'none';
  document.getElementById('locMapView').style.display = tab === 'map' ? '' : 'none';
  if (tab === 'map') loadLocMap();
}

// ========================= KPI =========================

async function renderLocKpi() {
  var { data } = await sb.from('v_location_summary').select('id, is_active, total_qty, product_count');
  var all = data || [];
  var active = all.filter(function(l) { return l.is_active; });
  var used = active.filter(function(l) { return l.total_qty > 0; }).length;
  var empty = active.filter(function(l) { return l.total_qty === 0; }).length;
  var rate = active.length > 0 ? Math.round(used / active.length * 100) : 0;

  var kpiEl = document.getElementById('locKpi');
  if (!kpiEl) return;
  kpiEl.innerHTML = '<div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">'
    + '<div class="kpi b"><div class="kpi-lbl">全ロケーション</div><div class="kpi-val">' + active.length + '</div></div>'
    + '<div class="kpi g"><div class="kpi-lbl">使用中</div><div class="kpi-val">' + used + '</div></div>'
    + '<div class="kpi y"><div class="kpi-lbl">空き</div><div class="kpi-val">' + empty + '</div></div>'
    + '<div class="kpi ' + (rate >= 80 ? 'r' : rate >= 50 ? 'y' : 'g') + '"><div class="kpi-lbl">使用率</div><div class="kpi-val">' + rate + '%</div></div>'
  + '</div>';
}

// ========================= リスト =========================

function renderLocList() {
  var operatorBtns = isOperator()
    ? '<button class="btn btn-p" onclick="openLocationModal()">+ ロケーション追加</button>'
    : '';

  document.getElementById('locListView').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<div class="sbar" style="max-width:300px;">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
        + '<input id="locSearch" placeholder="コード / ゾーン / 商品名 / JANで検索..." oninput="locOnSearch()">'
      + '</div>'
      + '<select class="fs" id="locZoneFilter" style="width:auto;min-width:80px;" onchange="filterLocations()">'
        + '<option value="">全ゾーン</option>'
      + '</select>'
    + '</div>'
    + '<div style="display:flex;gap:6px;">'
      + '<button class="btn btn-g btn-sm" onclick="exportLocationsCSV()">CSV</button>'
      + operatorBtns
    + '</div>'
  + '</div>'
  + '<div class="card"><div class="tw"><table>'
    + '<thead><tr><th>コード</th><th>ゾーン</th><th class="hm">通路</th><th class="hm">棚</th><th class="hm">段</th><th>商品数</th><th>在庫数</th><th>状態</th>'
    + (isAdmin() ? '<th>操作</th>' : '')
    + '</tr></thead>'
    + '<tbody id="locTb"></tbody>'
  + '</table></div></div>';
}

async function loadLocations() {
  var { data } = await sb.from('v_location_summary').select('*').order('code');
  _locations = data || [];

  var zones = [];
  var seen = {};
  _locations.forEach(function(l) {
    if (l.zone && !seen[l.zone]) { zones.push(l.zone); seen[l.zone] = true; }
  });
  zones.sort();

  var sel = document.getElementById('locZoneFilter');
  if (sel) {
    var current = sel.value;
    sel.innerHTML = '<option value="">全ゾーン</option>' + zones.map(function(z) {
      return '<option value="' + esc(z) + '" ' + (z === current ? 'selected' : '') + '>' + esc(z) + '</option>';
    }).join('');
  }

  filterLocations();
  renderLocKpi();
}

// ========================= 検索 =========================

function locOnSearch() {
  var q = (document.getElementById('locSearch').value || '').trim();
  _locSearchQuery = q;
  filterLocations();

  if (_locSearchTimer) clearTimeout(_locSearchTimer);
  if (q.length >= 2) {
    _locSearchTimer = setTimeout(function() { locProductSearch(q); }, 400);
  } else {
    _locProductMatchIds = [];
  }
}

async function locProductSearch(q) {
  var safeQ = q.replace(/[%_.,()'\\]/g, '');
  if (!safeQ) { _locProductMatchIds = []; filterLocations(); return; }

  var like = '%' + safeQ + '%';
  var { data } = await sb.from('v_inventory_by_location')
    .select('location_id')
    .or('product_name.ilike.' + like + ',sku.ilike.' + like + ',jan_code.ilike.' + like);

  var ids = {};
  (data || []).forEach(function(r) { ids[r.location_id] = true; });
  _locProductMatchIds = Object.keys(ids);
  filterLocations();
}

function filterLocations() {
  var q = (_locSearchQuery || '').toLowerCase();
  var zone = (document.getElementById('locZoneFilter') || {}).value || '';
  var filtered = _locations;

  if (zone) filtered = filtered.filter(function(l) { return l.zone === zone; });

  if (q) {
    filtered = filtered.filter(function(l) {
      return (l.code + ' ' + l.zone).toLowerCase().indexOf(q) >= 0
        || _locProductMatchIds.indexOf(l.id) >= 0;
    });
  }

  var tb = document.getElementById('locTb');
  if (!tb) return;

  tb.innerHTML = filtered.length
    ? filtered.map(function(l) {
        return '<tr onclick="locGoDetail(\'' + l.id + '\')" style="cursor:pointer;">'
          + '<td style="font-family:var(--mono);font-size:11px;font-weight:500;">' + esc(l.code) + '</td>'
          + '<td><span class="badge ' + zoneBadge(l.zone) + '">' + esc(l.zone) + '</span></td>'
          + '<td class="hm">' + (esc(l.aisle) || '—') + '</td>'
          + '<td class="hm">' + (esc(l.rack) || '—') + '</td>'
          + '<td class="hm">' + (esc(l.level) || '—') + '</td>'
          + '<td style="font-family:var(--mono);">' + (l.product_count || 0) + '</td>'
          + '<td style="font-family:var(--mono);">' + (l.total_qty || 0).toLocaleString() + '</td>'
          + '<td>' + (l.is_active ? '<span class="badge bg">有効</span>' : '<span class="badge br">無効</span>') + '</td>'
          + (isAdmin() ? '<td><button class="btn btn-g btn-sm" onclick="event.stopPropagation();openLocationModal(\'' + l.id + '\')">編集</button></td>' : '')
        + '</tr>';
      }).join('')
    : '<tr><td colspan="' + (isAdmin() ? '9' : '8') + '" class="empty-state">ロケーションが見つかりません</td></tr>';
}

function zoneBadge(z) {
  var m = { A: 'bg', B: 'bb', C: 'by', D: 'br', E: 'bgr' };
  return m[z] || 'bgr';
}

// ========================= 登録・編集モーダル =========================

async function openLocationModal(id) {
  var l = null;
  if (id) {
    var { data } = await sb.from('locations').select('*').eq('id', id).single();
    l = data;
  }
  var title = l ? 'ロケーション編集' : 'ロケーション追加';
  var body = '<div class="fg">'
    + '<div class="fl"><div class="flbl">ロケーションコード *</div><input class="fi" id="lm_code" value="' + esc(l ? l.code : '') + '" placeholder="A-01-01-1-A" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
    + '<div class="fr">'
      + '<div class="fl"><div class="flbl">ゾーン *</div><input class="fi" id="lm_zone" value="' + esc(l ? l.zone : '') + '" placeholder="A" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
      + '<div class="fl"><div class="flbl">通路</div><input class="fi" id="lm_aisle" value="' + esc(l ? l.aisle || '' : '') + '" placeholder="01" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
    + '</div>'
    + '<div class="fr">'
      + '<div class="fl"><div class="flbl">棚</div><input class="fi" id="lm_rack" value="' + esc(l ? l.rack || '' : '') + '" placeholder="01" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
      + '<div class="fl"><div class="flbl">段</div><input class="fi" id="lm_level" value="' + esc(l ? l.level || '' : '') + '" placeholder="1" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
    + '</div>'
    + '<div class="fr">'
      + '<div class="fl"><div class="flbl">ビン</div><input class="fi" id="lm_bin" value="' + esc(l ? l.bin || '' : '') + '" placeholder="A" ' + (l ? 'readonly style="opacity:.6"' : '') + '></div>'
      + '<div class="fl"><div class="flbl">保管条件</div><select class="fs" id="lm_cond">'
        + '<option value="ambient"' + (l && l.storage_condition === 'ambient' ? ' selected' : '') + '>常温</option>'
        + '<option value="refrigerated"' + (l && l.storage_condition === 'refrigerated' ? ' selected' : '') + '>冷蔵</option>'
        + '<option value="frozen"' + (l && l.storage_condition === 'frozen' ? ' selected' : '') + '>冷凍</option>'
        + '<option value="hazard"' + (l && l.storage_condition === 'hazard' ? ' selected' : '') + '>危険物</option>'
      + '</select></div>'
    + '</div>'
    + '<div class="fr">'
      + '<div class="fl"><div class="flbl">容量</div><input class="fi" id="lm_cap" type="number" min="0" value="' + (l ? l.capacity || '' : '') + '"></div>'
      + '<div class="fl"><div class="flbl">引当優先順位（小さいほど優先）</div><input class="fi" id="lm_pri" type="number" min="1" value="' + (l ? l.pick_priority || 100 : 100) + '"></div>'
    + '</div>'
    + '<div class="fl">'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">'
        + '<input type="checkbox" id="lm_active" ' + ((!l || l.is_active !== false) ? 'checked' : '') + '>'
        + '<span style="font-size:12px;">有効</span>'
      + '</label>'
    + '</div>'
  + '</div>';

  var footer = '';
  if (l && isAdmin()) {
    footer += '<button class="btn btn-d" onclick="deleteLocation(\'' + l.id + '\')">削除</button>';
  }
  footer += '<button class="btn btn-g" onclick="closeModal()">キャンセル</button>'
    + '<button class="btn btn-p" onclick="saveLocation(\'' + (l ? l.id : '') + '\')">保存</button>';

  openModal(title, body, footer);
}

async function saveLocation(id) {
  var d = {
    code: document.getElementById('lm_code').value.trim(),
    zone: document.getElementById('lm_zone').value.trim(),
    aisle: document.getElementById('lm_aisle').value.trim() || null,
    rack: document.getElementById('lm_rack').value.trim() || null,
    level: document.getElementById('lm_level').value.trim() || null,
    bin: document.getElementById('lm_bin').value.trim() || null,
    storage_condition: document.getElementById('lm_cond').value,
    capacity: parseInt(document.getElementById('lm_cap').value) || null,
    pick_priority: parseInt(document.getElementById('lm_pri').value) || 100,
    is_active: document.getElementById('lm_active').checked,
  };
  if (!d.code || !d.zone) { toast('コードとゾーンは必須です', 'error'); return; }

  if (!id) {
    var codeRegex = /^[A-Z]-\d{2}-\d{2}(-\d-[A-Z])?$/;
    if (!codeRegex.test(d.code)) {
      toast('コード形式が不正です（例: A-01-01 または A-01-01-1-A）', 'error');
      return;
    }
    var parts = d.code.split('-');
    d.zone  = parts[0];
    d.aisle = parts[1];
    d.rack  = parts[2];
    if (parts.length >= 5) {
      d.level = parts[3];
      d.bin   = parts[4];
    }
  }

  var err;
  if (id) {
    var res = await sb.from('locations').update(d).eq('id', id);
    err = res.error;
  } else {
    var res2 = await sb.from('locations').insert(d);
    err = res2.error;
  }
  if (err) { toast('保存失敗: ' + err.message, 'error'); return; }
  closeModal();
  toast(id ? 'ロケーションを更新しました' : 'ロケーションを追加しました');
  await loadLocations();
}

async function deleteLocation(id) {
  if (!confirm('このロケーションを無効化しますか？')) return;
  var { error } = await sb.from('locations').update({ is_active: false }).eq('id', id);
  if (error) { toast('無効化失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('ロケーションを無効化しました');
  await loadLocations();
}

// ========================= CSV =========================

function exportLocationsCSV() {
  var header = ['コード', 'ゾーン', '通路', '棚', '段', '商品数', '在庫数', '有効'];
  var rows = _locations.map(function(l) {
    return [l.code, l.zone, l.aisle, l.rack, l.level, l.product_count || 0, l.total_qty || 0, l.is_active ? '有効' : '無効'];
  });
  downloadCSV('wms_locations_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('ロケーションCSVをダウンロードしました');
}

// ========================= ロケーション詳細ページ =========================

function locGoDetail(id) {
  window._locDetailId = id;
  window._locDetailCode = null;
  go('location-detail');
}

function locGoDetailByCode(code) {
  window._locDetailId = null;
  window._locDetailCode = code;
  go('location-detail');
}

RENDER_FNS['location-detail'] = async function renderLocationDetail() {
  var el = document.getElementById('page-location-detail');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:12px;">読み込み中...</div>';

  var loc = null;
  if (window._locDetailId) {
    var res = await sb.from('locations').select('*').eq('id', window._locDetailId).single();
    loc = res.data;
  } else if (window._locDetailCode) {
    var res2 = await sb.from('locations').select('*').eq('code', window._locDetailCode).single();
    loc = res2.data;
  }

  if (!loc) {
    el.innerHTML = '<div class="empty-state"><div class="icon">&#128270;</div><p>ロケーションが見つかりません</p>'
      + '<button class="btn btn-g" style="margin-top:12px;" onclick="go(\'locations\')">一覧へ戻る</button></div>';
    return;
  }

  window._locDetailId = loc.id;

  var { data: invData } = await sb.from('v_inventory_with_names')
    .select('*')
    .eq('location_id', loc.id)
    .gt('qty', 0)
    .order('product_name');
  var inv = invData || [];

  var productIds = {};
  inv.forEach(function(r) { productIds[r.product_id] = true; });
  var productCount = Object.keys(productIds).length;
  var totalQty = inv.reduce(function(s, r) { return s + (r.qty || 0); }, 0);
  var lotCount = inv.length;

  var toolBtns = '<button class="btn btn-g btn-sm" onclick="locShowQrModal(\'' + esc(loc.code) + '\')">QR</button>';
  if (isOperator()) {
    toolBtns += ' <button class="btn btn-g btn-sm" onclick="openLocationModal(\'' + loc.id + '\')">編集</button>';
    toolBtns += ' <button class="btn btn-g btn-sm" onclick="if(typeof icStartFromLocation===\'function\')icStartFromLocation(\'' + loc.id + '\')">棚卸</button>';
  }

  var rows = inv.length
    ? inv.map(function(r) {
        return '<tr>'
          + '<td style="font-family:var(--mono);font-size:11px;">' + esc(r.sku) + '</td>'
          + '<td>' + esc(r.product_name) + '</td>'
          + '<td style="font-family:var(--mono);font-size:11px;">' + (esc(r.lot_no) || '—') + '</td>'
          + '<td style="font-family:var(--mono);font-size:11px;">' + (r.expiry ? fmtDate(r.expiry) : '—') + '</td>'
          + '<td style="font-family:var(--mono);text-align:right;font-weight:700;">' + r.qty.toLocaleString() + '</td>'
          + '<td style="font-family:var(--mono);text-align:right;">' + (r.locked_qty || 0) + '</td>'
        + '</tr>';
      }).join('')
    : '<tr><td colspan="6" class="empty-state">在庫がありません</td></tr>';

  el.innerHTML = '<div style="max-width:800px;margin:0 auto;">'

    + '<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-g btn-sm" onclick="go(\'locations\')">← 一覧へ戻る</button>'
      + '<div style="flex:1;"></div>'
      + toolBtns
    + '</div>'

    + '<div class="card mb12">'
      + '<div class="card-hd">'
        + '<div><div class="card-title" style="font-size:15px;">' + esc(loc.code) + '</div>'
        + '<div style="font-size:10px;color:var(--text2);margin-top:2px;">ロケーション詳細</div></div>'
        + (loc.is_active ? '<span class="badge bg">有効</span>' : '<span class="badge br">無効</span>')
      + '</div>'
      + '<div class="card-body">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px;">'
          + '<div class="fl"><div class="flbl">ゾーン</div><div style="font-weight:500;">' + esc(loc.zone) + '</div></div>'
          + '<div class="fl"><div class="flbl">通路</div><div style="font-weight:500;">' + (esc(loc.aisle) || '—') + '</div></div>'
          + '<div class="fl"><div class="flbl">棚</div><div style="font-weight:500;">' + (esc(loc.rack) || '—') + '</div></div>'
          + '<div class="fl"><div class="flbl">段</div><div style="font-weight:500;">' + (esc(loc.level) || '—') + '</div></div>'
          + '<div class="fl"><div class="flbl">保管条件</div><div style="font-weight:500;">' + conditionLabel(loc.storage_condition) + '</div></div>'
          + '<div class="fl"><div class="flbl">容量</div><div style="font-weight:500;">' + (loc.capacity || '—') + '</div></div>'
        + '</div>'
      + '</div>'
    + '</div>'

    + '<div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px;">'
      + '<div class="kpi b"><div class="kpi-lbl">商品数</div><div class="kpi-val">' + productCount + '</div></div>'
      + '<div class="kpi g"><div class="kpi-lbl">在庫数量</div><div class="kpi-val">' + totalQty.toLocaleString() + '</div></div>'
      + '<div class="kpi y"><div class="kpi-lbl">ロット数</div><div class="kpi-val">' + lotCount + '</div></div>'
    + '</div>'

    + '<div class="card">'
      + '<div class="card-hd"><div class="card-title">保管商品一覧</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + inv.length + ' 件</div></div>'
      + '<div class="card-body" style="padding:0;">'
        + '<div class="tw"><table>'
          + '<thead><tr><th>SKU</th><th>商品名</th><th>ロット</th><th>期限</th><th style="text-align:right;">数量</th><th style="text-align:right;">引当</th></tr></thead>'
          + '<tbody>' + rows + '</tbody>'
        + '</table></div>'
      + '</div>'
    + '</div>'
  + '</div>';
};

// ========================= QR生成 =========================

function locShowQrModal(code) {
  var qrContent = JSON.stringify({ type: 'location', location_code: code });
  var qrImg = typeof _generateQrDataUrl === 'function' ? _generateQrDataUrl(qrContent) : null;
  var body = '<div style="text-align:center;padding:10px 0;">'
    + (qrImg ? '<img src="' + qrImg + '" style="width:200px;height:200px;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;">' : '<div style="color:var(--red);">QR生成失敗</div>')
    + '<div style="margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--text2);">' + esc(code) + '</div>'
    + '<div style="margin-top:4px;font-family:var(--mono);font-size:10px;color:var(--text3);word-break:break-all;">' + esc(qrContent) + '</div>'
  + '</div>';
  openModal('ロケーションQR: ' + code, body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

// ========================= ロケーションマップ =========================

async function loadLocMap() {
  var mapView = document.getElementById('locMapView');
  if (!mapView) return;

  var zones = [];
  var seen = {};
  _locations.forEach(function(l) {
    if (l.zone && !seen[l.zone]) { zones.push(l.zone); seen[l.zone] = true; }
  });
  zones.sort();
  var selectedZone = zones[0] || 'A';

  mapView.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">'
    + '<div class="fl" style="gap:2px;">'
      + '<div class="flbl">ゾーン</div>'
      + '<select class="fs" id="mapZone" style="width:auto;min-width:80px;" onchange="renderLocMapGrid()">'
        + zones.map(function(z) { return '<option value="' + esc(z) + '">' + esc(z) + '</option>'; }).join('')
      + '</select>'
    + '</div>'
    + '<div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text2);margin-top:14px;">'
      + '<span><span class="lm-legend lm-empty"></span> 空き</span>'
      + '<span><span class="lm-legend lm-used"></span> 使用中</span>'
      + '<span><span class="lm-legend lm-inactive"></span> 無効</span>'
    + '</div>'
  + '</div>'
  + '<div id="mapSummary" style="margin-bottom:12px;"></div>'
  + '<div id="mapGrid"></div>';

  var { data } = await sb.from('v_location_summary').select('*').order('code');
  _locMapData = data || [];
  renderLocMapGrid();
}

function renderLocMapGrid() {
  var zone = (document.getElementById('mapZone') || {}).value;
  if (!zone) return;

  var filtered = _locMapData.filter(function(d) { return d.zone === zone; });

  var active = filtered.filter(function(d) { return d.is_active; });
  var used = active.filter(function(d) { return d.total_qty > 0; }).length;
  var empty = active.filter(function(d) { return d.total_qty === 0; }).length;
  var inactive = filtered.filter(function(d) { return !d.is_active; }).length;
  var totalQty = filtered.reduce(function(s, d) { return s + d.total_qty; }, 0);
  var pct = active.length > 0 ? Math.round(used / active.length * 100) : 0;

  document.getElementById('mapSummary').innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;padding:10px 13px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);">'
    + '<div>使用率: <strong>' + pct + '%</strong> (' + used + '/' + active.length + ')</div>'
    + '<div>空き: <strong>' + empty + '</strong></div>'
    + '<div>無効: <strong>' + inactive + '</strong></div>'
    + '<div>合計在庫: <strong>' + totalQty.toLocaleString() + '個</strong></div>'
  + '</div>';

  var aisles = [];
  var racks = [];
  var aSeen = {};
  var rSeen = {};
  filtered.forEach(function(d) {
    var a = d.aisle || '—';
    var r = d.rack || '—';
    if (!aSeen[a]) { aisles.push(a); aSeen[a] = true; }
    if (!rSeen[r]) { racks.push(r); rSeen[r] = true; }
  });
  aisles.sort();
  racks.sort();

  if (!aisles.length || !racks.length) {
    document.getElementById('mapGrid').innerHTML = '<div class="empty-state"><p>このゾーンにロケーションがありません</p></div>';
    return;
  }

  var cellMap = {};
  filtered.forEach(function(d) {
    var key = (d.aisle || '—') + '-' + (d.rack || '—');
    if (!cellMap[key]) cellMap[key] = { total_qty: 0, product_count: 0, is_active: true, ids: [] };
    cellMap[key].total_qty += d.total_qty;
    cellMap[key].product_count += d.product_count;
    if (!d.is_active) cellMap[key].is_active = false;
    cellMap[key].ids.push(d.id);
  });

  var html = '<div class="lm-grid"><div class="lm-grid-inner"><table class="lm-table"><thead><tr><th></th>';
  aisles.forEach(function(a) { html += '<th>' + esc(a) + '</th>'; });
  html += '</tr></thead><tbody>';

  racks.forEach(function(r) {
    html += '<tr><td class="lm-row-hd">' + esc(r) + '</td>';
    aisles.forEach(function(a) {
      var key = a + '-' + r;
      var cell = cellMap[key];
      if (!cell) { html += '<td></td>'; return; }
      var cls = 'lm-cell ';
      var content = '';
      if (!cell.is_active) {
        cls += 'lm-inactive';
        content = '<div class="lm-code">' + esc(a) + '-' + esc(r) + '</div><div class="lm-label">無効</div>';
      } else if (cell.total_qty === 0) {
        cls += 'lm-empty';
        content = '<div class="lm-code">' + esc(a) + '-' + esc(r) + '</div>';
      } else {
        cls += 'lm-used';
        content = '<div class="lm-code">' + esc(a) + '-' + esc(r) + '</div><div class="lm-qty">' + cell.total_qty.toLocaleString() + '個</div><div class="lm-sku">' + cell.product_count + ' SKU</div>';
      }
      var idsAttr = cell.ids.join(',');
      html += '<td><div class="' + cls + '" onclick="openLocCellDetail(\'' + idsAttr + '\',\'' + esc(zone) + '-' + esc(a) + '-' + esc(r) + '\')">' + content + '</div></td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  document.getElementById('mapGrid').innerHTML = html;
}

async function openLocCellDetail(idsStr, label) {
  var ids = idsStr.split(',');
  var { data } = await sb.from('v_inventory_with_names')
    .select('product_name, lot_no, qty, location_id, location_code')
    .in('location_id', ids)
    .gt('qty', 0)
    .order('product_name');

  var rows = data || [];
  var totalQty = rows.reduce(function(s, r) { return s + r.qty; }, 0);

  var detailBtns = '';
  if (ids.length === 1) {
    detailBtns = '<div style="margin-bottom:8px;"><button class="btn btn-p btn-sm" onclick="closeModal();locGoDetail(\'' + ids[0] + '\')">詳細を表示</button>'
      + ' <button class="btn btn-g btn-sm" onclick="closeModal();locShowQrFromId(\'' + ids[0] + '\')">QR</button></div>';
  } else {
    var locLinks = [];
    var locSeen = {};
    rows.forEach(function(r) {
      if (!locSeen[r.location_id]) {
        locLinks.push('<button class="btn btn-g btn-sm" onclick="closeModal();locGoDetail(\'' + r.location_id + '\')" style="margin:2px;">' + esc(r.location_code) + '</button>');
        locSeen[r.location_id] = true;
      }
    });
    if (locLinks.length) {
      detailBtns = '<div style="margin-bottom:8px;font-size:11px;color:var(--text2);">各ロケーション詳細:</div><div style="margin-bottom:8px;">' + locLinks.join('') + '</div>';
    }
  }

  var body = detailBtns + (rows.length
    ? '<div class="tw"><table>'
      + '<thead><tr><th>商品名</th><th>ロット</th><th>数量</th></tr></thead>'
      + '<tbody>' + rows.map(function(r) {
          return '<tr><td>' + esc(r.product_name) + '</td><td style="font-family:var(--mono);font-size:11px;">' + (esc(r.lot_no) || '—') + '</td><td style="font-family:var(--mono);font-weight:700;">' + r.qty.toLocaleString() + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      + '<div style="text-align:right;margin-top:10px;font-size:12px;color:var(--text2);">合計: <strong>' + totalQty.toLocaleString() + '個</strong></div>'
    : '<div class="empty-state"><p>在庫がありません</p></div>');

  openModal(label + ' の在庫', body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

async function locShowQrFromId(id) {
  var loc = _locations.find(function(l) { return l.id === id; });
  if (loc) { locShowQrModal(loc.code); return; }
  var { data } = await sb.from('locations').select('code').eq('id', id).single();
  if (data) locShowQrModal(data.code);
}
