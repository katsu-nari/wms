// =====================================================================
// LogiCore WMS - products.js
// 商品マスタ: 一覧 / 検索 / 新規 / 編集 / 論理削除
// =====================================================================

RENDER_FNS.products = async function renderProducts() {
  const el = document.getElementById('page-products');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="sbar" style="max-width:320px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="prodSearch" placeholder="SKU / 商品名 / JANで検索..." oninput="filterProducts()">
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-g btn-sm" onclick="exportProductsCSV()">CSV</button>
        ${isAdmin() ? '<button class="btn btn-p" onclick="openProductModal()">+ 商品追加</button>' : ''}
      </div>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>SKU</th><th>商品名</th><th class="hm">JAN</th><th>単位</th><th class="hm">原単価</th><th class="hm">売単価</th><th class="hm">保管条件</th><th class="hm">最低在庫</th><th class="hm">期限管理</th>${isAdmin() ? '<th>操作</th>' : ''}</tr></thead>
      <tbody id="prodTb"></tbody>
    </table></div></div>
  `;
  await loadProducts();
};

let _products = [];

async function loadProducts() {
  const { data } = await sb.from('products').select('*').is('deleted_at', null).order('sku');
  _products = data || [];
  filterProducts();
}

function filterProducts() {
  const q = (document.getElementById('prodSearch')?.value || '').toLowerCase();
  const filtered = q
    ? _products.filter(p => (p.sku + p.name + (p.jan_code || '')).toLowerCase().includes(q))
    : _products;
  const tb = document.getElementById('prodTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(p => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(p.sku)}</td>
        <td>${esc(p.name)}</td>
        <td class="hm" style="font-family:var(--mono);font-size:11px;">${esc(p.jan_code) || '—'}</td>
        <td>${esc(p.unit)}${p.pack_size > 1 ? ' ×' + p.pack_size : ''}</td>
        <td class="hm" style="font-family:var(--mono);">${p.cost_price != null ? Number(p.cost_price).toLocaleString() : '—'}</td>
        <td class="hm" style="font-family:var(--mono);">${p.sell_price != null ? Number(p.sell_price).toLocaleString() : '—'}</td>
        <td class="hm">${conditionLabel(p.storage_condition)}</td>
        <td class="hm" style="font-family:var(--mono);">${p.min_stock}</td>
        <td class="hm">${p.track_expiry ? '<span class="badge bg">有</span>' : '<span class="badge bgr">無</span>'}</td>
        ${isAdmin() ? `<td><button class="btn btn-g btn-sm" onclick="openProductModal('${p.id}')">編集</button></td>` : ''}
      </tr>`).join('')
    : '<tr><td colspan="10" class="empty-state">商品が見つかりません</td></tr>';
}

function openProductModal(id) {
  const p = id ? _products.find(x => x.id === id) : null;
  const title = p ? '商品編集' : '商品追加';
  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">SKU（商品コード）*</div><input class="fi" id="pm_sku" value="${esc(p?.sku || '')}" ${p ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">JANコード</div><input class="fi" id="pm_jan" value="${esc(p?.jan_code || '')}"></div>
    </div>
    <div class="fl"><div class="flbl">商品名 *</div><input class="fi" id="pm_name" value="${esc(p?.name || '')}"></div>
    <div class="fr">
      <div class="fl"><div class="flbl">単位</div><input class="fi" id="pm_unit" value="${esc(p?.unit || '個')}"></div>
      <div class="fl"><div class="flbl">入数</div><input class="fi" id="pm_pack" type="number" min="1" value="${p?.pack_size || 1}"></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">原単価</div><input class="fi" id="pm_cost" type="number" min="0" step="0.01" value="${p?.cost_price ?? ''}"></div>
      <div class="fl"><div class="flbl">売単価</div><input class="fi" id="pm_sell" type="number" min="0" step="0.01" value="${p?.sell_price ?? ''}"></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">保管条件</div><select class="fs" id="pm_cond">
        <option value="ambient" ${p?.storage_condition === 'ambient' ? 'selected' : ''}>常温</option>
        <option value="refrigerated" ${p?.storage_condition === 'refrigerated' ? 'selected' : ''}>冷蔵</option>
        <option value="frozen" ${p?.storage_condition === 'frozen' ? 'selected' : ''}>冷凍</option>
        <option value="hazard" ${p?.storage_condition === 'hazard' ? 'selected' : ''}>危険物</option>
      </select></div>
      <div class="fl"><div class="flbl">最低在庫数</div><input class="fi" id="pm_min" type="number" min="0" value="${p?.min_stock || 0}"></div>
    </div>
    <div class="fl">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="pm_expiry" ${p?.track_expiry ? 'checked' : ''}>
        <span style="font-size:12px;">有効期限管理を行う</span>
      </label>
    </div>
  </div>`;
  const footer = `
    ${p ? `<button class="btn btn-d" onclick="deleteProduct('${p.id}')">削除</button>` : ''}
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveProduct('${p?.id || ''}')">保存</button>
  `;
  openModal(title, body, footer);
}

async function saveProduct(id) {
  const d = {
    sku: document.getElementById('pm_sku').value.trim(),
    name: document.getElementById('pm_name').value.trim(),
    jan_code: document.getElementById('pm_jan').value.trim() || null,
    unit: document.getElementById('pm_unit').value.trim() || '個',
    pack_size: parseInt(document.getElementById('pm_pack').value) || 1,
    cost_price: document.getElementById('pm_cost').value !== '' ? parseFloat(document.getElementById('pm_cost').value) : null,
    sell_price: document.getElementById('pm_sell').value !== '' ? parseFloat(document.getElementById('pm_sell').value) : null,
    storage_condition: document.getElementById('pm_cond').value,
    min_stock: parseInt(document.getElementById('pm_min').value) || 0,
    track_expiry: document.getElementById('pm_expiry').checked,
  };
  if (!d.sku || !d.name) { toast('SKUと商品名は必須です', 'error'); return; }

  let err;
  if (id) {
    const res = await sb.from('products').update(d).eq('id', id);
    err = res.error;
  } else {
    const res = await sb.from('products').insert(d);
    err = res.error;
  }
  if (err) { toast('保存失敗: ' + err.message, 'error'); return; }
  closeModal();
  toast(id ? '商品を更新しました' : '商品を追加しました');
  await loadProducts();
}

async function deleteProduct(id) {
  if (!confirm('この商品を削除しますか？（論理削除）')) return;
  const { error } = await sb.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast('削除失敗', 'error'); return; }
  closeModal();
  toast('商品を削除しました');
  await loadProducts();
}

function exportProductsCSV() {
  const header = ['SKU', '商品名', 'JANコード', '単位', '入数', '原単価', '売単価', '保管条件', '最低在庫', '期限管理'];
  const rows = _products.map(p => [p.sku, p.name, p.jan_code, p.unit, p.pack_size, p.cost_price ?? '', p.sell_price ?? '', conditionLabel(p.storage_condition), p.min_stock, p.track_expiry ? '有' : '無']);
  downloadCSV('wms_products_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('商品マスタCSVをダウンロードしました');
}
