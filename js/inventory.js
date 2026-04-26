// =====================================================================
// LogiCore WMS - inventory.js
// 在庫一覧: 検索 / フィルタ / CSVエクスポート
// =====================================================================

RENDER_FNS.inventory = async function renderInventory() {
  const el = document.getElementById('page-inventory');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="sbar" style="max-width:260px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="invSearch" placeholder="SKU / 商品名 / ロケーション..." oninput="filterInventory()">
        </div>
        <select class="fs" id="invZone" style="width:auto;min-width:80px;" onchange="filterInventory()">
          <option value="">全ゾーン</option>
        </select>
        <select class="fs" id="invCond" style="width:auto;min-width:80px;" onchange="filterInventory()">
          <option value="">全条件</option>
          <option value="ambient">常温</option>
          <option value="refrigerated">冷蔵</option>
          <option value="frozen">冷凍</option>
          <option value="hazard">危険物</option>
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap;">
          <input type="checkbox" id="invLow" onchange="filterInventory()"> 残少のみ
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap;">
          <input type="checkbox" id="invExp" onchange="filterInventory()"> 期限30日以内
        </label>
      </div>
      <button class="btn btn-g btn-sm" onclick="exportInventoryCSV()">CSV エクスポート</button>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>SKU</th><th>商品名</th><th>ロケーション</th><th class="hm">ロット</th><th class="hm">期限</th><th>在庫</th><th class="hm">ロック</th><th class="hm">利用可</th><th>状態</th></tr></thead>
      <tbody id="invTb"></tbody>
    </table></div></div>
    <div style="margin-top:8px;font-family:var(--mono);font-size:10px;color:var(--text3);" id="invCount"></div>
  `;
  await loadInventory();
};

let _inventory = [];

async function loadInventory() {
  const { data } = await sb.from('v_inventory_with_names').select('*').order('sku');
  const today = new Date().toISOString().slice(0, 10);
  // 在庫0で前日以前に更新された行は非表示
  _inventory = (data || []).filter(i =>
    i.qty > 0 || (i.updated_at && i.updated_at.slice(0, 10) >= today)
  );

  // zone filter
  const zones = [...new Set(_inventory.map(i => i.zone))].sort();
  const sel = document.getElementById('invZone');
  if (sel) {
    sel.innerHTML = '<option value="">全ゾーン</option>' + zones.map(z => `<option value="${esc(z)}">${esc(z)}</option>`).join('');
  }
  filterInventory();
}

function filterInventory() {
  const q = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const zone = document.getElementById('invZone')?.value || '';
  const cond = document.getElementById('invCond')?.value || '';
  const lowOnly = document.getElementById('invLow')?.checked || false;
  const expOnly = document.getElementById('invExp')?.checked || false;
  const now = Date.now();
  const in30 = now + 30 * 864e5;

  let filtered = _inventory;
  if (q) filtered = filtered.filter(i => (i.sku + i.product_name + i.location_code).toLowerCase().includes(q));
  if (zone) filtered = filtered.filter(i => i.zone === zone);
  if (cond) filtered = filtered.filter(i => i.storage_condition === cond);
  if (lowOnly) filtered = filtered.filter(i => i.low_stock);
  if (expOnly) filtered = filtered.filter(i => i.expiry && new Date(i.expiry).getTime() < in30);

  const tb = document.getElementById('invTb');
  if (!tb) return;

  tb.innerHTML = filtered.length
    ? filtered.map(i => {
        const isLow = i.low_stock;
        const isExp = i.expiry && new Date(i.expiry).getTime() < in30;
        const rowStyle = isLow ? 'border-left:3px solid var(--red);' : isExp ? 'border-left:3px solid var(--yellow);' : '';
        return `<tr style="${rowStyle}">
          <td style="font-family:var(--mono);font-size:11px;">${esc(i.sku)}</td>
          <td>${esc(i.product_name)}</td>
          <td style="font-family:var(--mono);font-size:11px;">${esc(i.location_code)}</td>
          <td class="hm" style="font-family:var(--mono);font-size:11px;">${esc(i.lot_no) || '—'}</td>
          <td class="hm" style="font-family:var(--mono);font-size:11px;${isExp ? 'color:var(--yellow);' : ''}">${fmtDate(i.expiry)}</td>
          <td style="font-family:var(--mono);font-weight:700;${isLow ? 'color:var(--red);' : ''}">${i.qty}</td>
          <td class="hm" style="font-family:var(--mono);color:var(--text2);">${i.locked_qty || 0}</td>
          <td class="hm" style="font-family:var(--mono);">${i.available_qty}</td>
          <td>${isLow ? '<span class="badge br">残少</span>' : isExp ? '<span class="badge by">期限注意</span>' : '<span class="badge bg">正常</span>'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="9" class="empty-state">在庫データがありません</td></tr>';

  const countEl = document.getElementById('invCount');
  if (countEl) {
    const totalQty = filtered.reduce((s, i) => s + i.qty, 0);
    countEl.textContent = `${filtered.length} 行 / 合計 ${totalQty.toLocaleString()} 個`;
  }
}

function exportInventoryCSV() {
  const header = ['SKU', '商品名', 'ロケーション', 'ゾーン', '保管条件', 'ロット', '期限', '在庫数', 'ロック数', '利用可能数', '最低在庫', '残少'];
  const rows = _inventory.map(i => [
    i.sku, i.product_name, i.location_code, i.zone, conditionLabel(i.storage_condition),
    i.lot_no, i.expiry || '', i.qty, i.locked_qty, i.available_qty, i.min_stock, i.low_stock ? '残少' : '',
  ]);
  downloadCSV('wms_inventory_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('在庫一覧CSVをダウンロードしました');
}
