// =====================================================================
// SUPEREX LogiStation - locations.js
// ロケーション管理: 一覧 / 新規 / 編集 / ビジュアルマップ
// =====================================================================

let _locTab = 'list';

RENDER_FNS.locations = async function renderLocations() {
  const el = document.getElementById('page-locations');
  el.innerHTML = `
    <div class="tabs" id="locTabs" style="max-width:200px;">
      <div class="tab active" onclick="setLocTab('list',this)">一覧</div>
      <div class="tab" onclick="setLocTab('map',this)">マップ</div>
    </div>
    <div id="locListView"></div>
    <div id="locMapView" style="display:none;"></div>
  `;
  _locTab = 'list';
  renderLocList();
  await loadLocations();
};

function setLocTab(tab, tabEl) {
  _locTab = tab;
  document.querySelectorAll('#locTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('locListView').style.display = tab === 'list' ? '' : 'none';
  document.getElementById('locMapView').style.display = tab === 'map' ? '' : 'none';
  if (tab === 'map') loadLocMap();
}

function renderLocList() {
  document.getElementById('locListView').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="sbar" style="max-width:260px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="locSearch" placeholder="コード / ゾーンで検索..." oninput="filterLocations()">
        </div>
        <select class="fs" id="locZoneFilter" style="width:auto;min-width:80px;" onchange="filterLocations()">
          <option value="">全ゾーン</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-g btn-sm" onclick="exportLocationsCSV()">CSV</button>
        ${isAdmin() ? '<button class="btn btn-p" onclick="openLocationModal()">+ ロケーション追加</button>' : ''}
      </div>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>コード</th><th>ゾーン</th><th class="hm">通路</th><th class="hm">棚</th><th class="hm">段</th><th class="hm">ビン</th><th>保管条件</th><th class="hm">優先度</th><th>状態</th>${isAdmin() ? '<th>操作</th>' : ''}</tr></thead>
      <tbody id="locTb"></tbody>
    </table></div></div>
  `;
}

let _locations = [];

async function loadLocations() {
  const { data } = await sb.from('locations').select('*').order('code');
  _locations = data || [];

  const zones = [...new Set(_locations.map(l => l.zone))].sort();
  const sel = document.getElementById('locZoneFilter');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">全ゾーン</option>' + zones.map(z => `<option value="${esc(z)}" ${z === current ? 'selected' : ''}>${esc(z)}</option>`).join('');
  }
  filterLocations();
}

function filterLocations() {
  const q = (document.getElementById('locSearch')?.value || '').toLowerCase();
  const zone = document.getElementById('locZoneFilter')?.value || '';
  let filtered = _locations;
  if (zone) filtered = filtered.filter(l => l.zone === zone);
  if (q) filtered = filtered.filter(l => (l.code + l.zone).toLowerCase().includes(q));

  const tb = document.getElementById('locTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(l => `<tr>
        <td style="font-family:var(--mono);font-size:11px;font-weight:500;">${esc(l.code)}</td>
        <td><span class="badge ${zoneBadge(l.zone)}">${esc(l.zone)}</span></td>
        <td class="hm">${esc(l.aisle) || '—'}</td>
        <td class="hm">${esc(l.rack) || '—'}</td>
        <td class="hm">${esc(l.level) || '—'}</td>
        <td class="hm">${esc(l.bin) || '—'}</td>
        <td>${conditionLabel(l.storage_condition)}</td>
        <td class="hm" style="font-family:var(--mono);">${l.pick_priority}</td>
        <td>${l.is_active ? '<span class="badge bg">有効</span>' : '<span class="badge br">無効</span>'}</td>
        ${isAdmin() ? `<td><button class="btn btn-g btn-sm" onclick="openLocationModal('${l.id}')">編集</button></td>` : ''}
      </tr>`).join('')
    : '<tr><td colspan="10" class="empty-state">ロケーションが見つかりません</td></tr>';
}

function zoneBadge(z) {
  const m = { A: 'bg', B: 'bb', C: 'by', D: 'br', E: 'bgr' };
  return m[z] || 'bgr';
}

function openLocationModal(id) {
  const l = id ? _locations.find(x => x.id === id) : null;
  const title = l ? 'ロケーション編集' : 'ロケーション追加';
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">ロケーションコード *</div><input class="fi" id="lm_code" value="${esc(l?.code || '')}" placeholder="A-01-01-1-A" ${l ? 'readonly style="opacity:.6"' : ''}></div>
    <div class="fr">
      <div class="fl"><div class="flbl">ゾーン *</div><input class="fi" id="lm_zone" value="${esc(l?.zone || '')}" placeholder="A" ${l ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">通路</div><input class="fi" id="lm_aisle" value="${esc(l?.aisle || '')}" placeholder="01" ${l ? 'readonly style="opacity:.6"' : ''}></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">棚</div><input class="fi" id="lm_rack" value="${esc(l?.rack || '')}" placeholder="01" ${l ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">段</div><input class="fi" id="lm_level" value="${esc(l?.level || '')}" placeholder="1" ${l ? 'readonly style="opacity:.6"' : ''}></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">ビン</div><input class="fi" id="lm_bin" value="${esc(l?.bin || '')}" placeholder="A" ${l ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">保管条件</div><select class="fs" id="lm_cond">
        <option value="ambient" ${l?.storage_condition === 'ambient' ? 'selected' : ''}>常温</option>
        <option value="refrigerated" ${l?.storage_condition === 'refrigerated' ? 'selected' : ''}>冷蔵</option>
        <option value="frozen" ${l?.storage_condition === 'frozen' ? 'selected' : ''}>冷凍</option>
        <option value="hazard" ${l?.storage_condition === 'hazard' ? 'selected' : ''}>危険物</option>
      </select></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">容量</div><input class="fi" id="lm_cap" type="number" min="0" value="${l?.capacity || ''}"></div>
      <div class="fl"><div class="flbl">ピッキング優先度</div><input class="fi" id="lm_pri" type="number" min="1" value="${l?.pick_priority || 100}"></div>
    </div>
    <div class="fl">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="lm_active" ${l?.is_active !== false ? 'checked' : ''}>
        <span style="font-size:12px;">有効</span>
      </label>
    </div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveLocation('${l?.id || ''}')">保存</button>
  `;
  openModal(title, body, footer);
}

async function saveLocation(id) {
  const d = {
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
    const codeRegex = /^[A-Z]-\d{2}-\d{2}-\d-[A-Z]$/;
    if (!codeRegex.test(d.code)) {
      toast('コード形式が不正です（例: A-01-01-1-A）', 'error');
      return;
    }
    const parts = d.code.split('-');
    d.zone  = parts[0];
    d.aisle = parts[1];
    d.rack  = parts[2];
    d.level = parts[3];
    d.bin   = parts[4];
  }

  let err;
  if (id) {
    const res = await sb.from('locations').update(d).eq('id', id);
    err = res.error;
  } else {
    const res = await sb.from('locations').insert(d);
    err = res.error;
  }
  if (err) { toast('保存失敗: ' + err.message, 'error'); return; }
  closeModal();
  toast(id ? 'ロケーションを更新しました' : 'ロケーションを追加しました');
  await loadLocations();
}

function exportLocationsCSV() {
  const header = ['コード', 'ゾーン', '通路', '棚', '段', 'ビン', '保管条件', '優先度', '有効'];
  const rows = _locations.map(l => [l.code, l.zone, l.aisle, l.rack, l.level, l.bin, conditionLabel(l.storage_condition), l.pick_priority, l.is_active ? '有効' : '無効']);
  downloadCSV('wms_locations_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('ロケーションCSVをダウンロードしました');
}

// ========================= ロケーションマップ =========================

let _locMapData = [];

async function loadLocMap() {
  const mapView = document.getElementById('locMapView');
  if (!mapView) return;

  const zones = [...new Set(_locations.map(l => l.zone))].sort();
  const selectedZone = zones[0] || 'A';

  mapView.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div class="fl" style="gap:2px;">
        <div class="flbl">ゾーン</div>
        <select class="fs" id="mapZone" style="width:auto;min-width:80px;" onchange="renderLocMapGrid()">
          ${zones.map(z => `<option value="${esc(z)}">${esc(z)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text2);margin-top:14px;">
        <span><span class="lm-legend lm-empty"></span> 空き</span>
        <span><span class="lm-legend lm-used"></span> 使用中</span>
        <span><span class="lm-legend lm-inactive"></span> 無効</span>
      </div>
    </div>
    <div id="mapSummary" style="margin-bottom:12px;"></div>
    <div id="mapGrid"></div>
  `;

  const { data } = await sb.from('v_location_summary').select('*').order('code');
  _locMapData = data || [];
  renderLocMapGrid();
}

function renderLocMapGrid() {
  const zone = document.getElementById('mapZone')?.value;
  if (!zone) return;

  const filtered = _locMapData.filter(d => d.zone === zone);

  const active = filtered.filter(d => d.is_active);
  const used = active.filter(d => d.total_qty > 0).length;
  const empty = active.filter(d => d.total_qty === 0).length;
  const inactive = filtered.filter(d => !d.is_active).length;
  const totalQty = filtered.reduce((s, d) => s + d.total_qty, 0);
  const pct = active.length > 0 ? Math.round(used / active.length * 100) : 0;

  document.getElementById('mapSummary').innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;padding:10px 13px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);">
      <div>使用率: <strong>${pct}%</strong> (${used}/${active.length})</div>
      <div>空き: <strong>${empty}</strong></div>
      <div>無効: <strong>${inactive}</strong></div>
      <div>合計在庫: <strong>${totalQty.toLocaleString()}個</strong></div>
    </div>
  `;

  const aisles = [...new Set(filtered.map(d => d.aisle || '—'))].sort();
  const racks = [...new Set(filtered.map(d => d.rack || '—'))].sort();

  if (!aisles.length || !racks.length) {
    document.getElementById('mapGrid').innerHTML = '<div class="empty-state"><p>このゾーンにロケーションがありません</p></div>';
    return;
  }

  const cellMap = {};
  filtered.forEach(d => {
    const key = (d.aisle || '—') + '-' + (d.rack || '—');
    if (!cellMap[key]) cellMap[key] = { total_qty: 0, product_count: 0, is_active: true, ids: [] };
    cellMap[key].total_qty += d.total_qty;
    cellMap[key].product_count += d.product_count;
    if (!d.is_active) cellMap[key].is_active = false;
    cellMap[key].ids.push(d.id);
  });

  let html = '<div class="lm-grid"><div class="lm-grid-inner"><table class="lm-table"><thead><tr><th></th>';
  aisles.forEach(a => { html += `<th>${esc(a)}</th>`; });
  html += '</tr></thead><tbody>';

  racks.forEach(r => {
    html += `<tr><td class="lm-row-hd">${esc(r)}</td>`;
    aisles.forEach(a => {
      const key = a + '-' + r;
      const cell = cellMap[key];
      if (!cell) {
        html += '<td></td>';
        return;
      }
      let cls = 'lm-cell ';
      let content = '';
      if (!cell.is_active) {
        cls += 'lm-inactive';
        content = `<div class="lm-code">${esc(a)}-${esc(r)}</div><div class="lm-label">無効</div>`;
      } else if (cell.total_qty === 0) {
        cls += 'lm-empty';
        content = `<div class="lm-code">${esc(a)}-${esc(r)}</div>`;
      } else {
        cls += 'lm-used';
        content = `<div class="lm-code">${esc(a)}-${esc(r)}</div><div class="lm-qty">${cell.total_qty.toLocaleString()}個</div><div class="lm-sku">${cell.product_count} SKU</div>`;
      }
      const idsAttr = cell.ids.map(id => id).join(',');
      html += `<td><div class="${cls}" onclick="openLocCellDetail('${idsAttr}','${esc(zone)}-${esc(a)}-${esc(r)}')">${content}</div></td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  document.getElementById('mapGrid').innerHTML = html;
}

async function openLocCellDetail(idsStr, label) {
  const ids = idsStr.split(',');
  const { data } = await sb.from('v_inventory_with_names')
    .select('product_name, lot_no, qty')
    .in('location_id', ids)
    .gt('qty', 0)
    .order('product_name');

  const rows = data || [];
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  const body = rows.length
    ? `<div class="tw"><table>
        <thead><tr><th>商品名</th><th>ロット</th><th>数量</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${esc(r.product_name)}</td>
          <td style="font-family:var(--mono);font-size:11px;">${esc(r.lot_no) || '—'}</td>
          <td style="font-family:var(--mono);font-weight:700;">${r.qty.toLocaleString()}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="text-align:right;margin-top:10px;font-size:12px;color:var(--text2);">合計: <strong>${totalQty.toLocaleString()}個</strong></div>`
    : '<div class="empty-state"><p>在庫がありません</p></div>';

  openModal(label + ' の在庫', body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}
