// =====================================================================
// LogiCore WMS - move.js
// ロケーション移動: 在庫選択 → 移動先指定 → 実行
// =====================================================================

RENDER_FNS.move = async function renderMove() {
  const el = document.getElementById('page-move');

  if (!isOperator()) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🔒</div><p>この機能はオペレータ以上の権限が必要です</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="g2">
      <div class="card">
        <div class="card-hd"><div class="card-title">移動元</div></div>
        <div class="card-body">
          <div class="fg">
            <div class="fl">
              <div class="flbl">在庫を選択</div>
              <div class="sbar" style="margin-bottom:8px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input id="mvSearch" placeholder="SKU / ロケーションで検索..." oninput="searchMoveInventory()">
              </div>
              <select class="fs" id="mvInvSelect" size="6" style="height:auto;min-height:120px;" onchange="selectMoveSource()">
                <option disabled>在庫を検索してください</option>
              </select>
            </div>
            <div id="mvSourceInfo" style="display:none;background:var(--surface2);border-radius:var(--r);padding:10px;font-size:12px;"></div>
            <div class="fl">
              <div class="flbl">移動数量</div>
              <input class="fi" id="mvQty" type="number" min="1" value="1">
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">移動先</div></div>
        <div class="card-body">
          <div class="fg">
            <div class="fl">
              <div class="flbl">移動先ロケーション</div>
              <select class="fs" id="mvToLoc"></select>
            </div>
            <div id="mvPreview" style="display:none;background:var(--surface2);border-radius:var(--r);padding:12px;"></div>
            <button class="btn btn-p" style="width:100%;justify-content:center;padding:12px;" onclick="execMove()">移動実行</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <div class="card-hd"><div class="card-title">最近の移動履歴</div></div>
      <div class="tw"><table>
        <thead><tr><th>日時</th><th>商品</th><th>ロケーション</th><th>数量</th><th>種別</th></tr></thead>
        <tbody id="mvHistTb"></tbody>
      </table></div>
    </div>
  `;

  await loadMoveLocations();
  await loadMoveHistory();
};

let _mvInventory = [];

async function loadMoveLocations() {
  const { data } = await sb.from('locations').select('id, code').eq('is_active', true).order('code');
  const sel = document.getElementById('mvToLoc');
  if (sel) {
    sel.innerHTML = (data || []).map(l => `<option value="${l.id}">${esc(l.code)}</option>`).join('');
  }
}

async function searchMoveInventory() {
  const q = (document.getElementById('mvSearch')?.value || '').trim().toLowerCase();
  if (q.length < 1) return;

  const { data } = await sb.from('v_inventory_with_names')
    .select('*')
    .gt('available_qty', 0)
    .order('sku');

  _mvInventory = (data || []).filter(i =>
    (i.sku + i.product_name + i.location_code).toLowerCase().includes(q)
  );

  const sel = document.getElementById('mvInvSelect');
  if (!sel) return;
  sel.innerHTML = _mvInventory.length
    ? _mvInventory.map(i =>
        `<option value="${i.id}">${esc(i.location_code)} | ${esc(i.sku)} ${esc(i.product_name)} | 在庫:${i.available_qty}${i.lot_no ? ' | L:' + i.lot_no : ''}</option>`
      ).join('')
    : '<option disabled>該当する在庫がありません</option>';
}

function selectMoveSource() {
  const sel = document.getElementById('mvInvSelect');
  const info = document.getElementById('mvSourceInfo');
  if (!sel || !info) return;

  const inv = _mvInventory.find(i => i.id === sel.value);
  if (!inv) { info.style.display = 'none'; return; }

  info.style.display = 'block';
  info.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div><span class="flbl">SKU:</span> ${esc(inv.sku)}</div>
      <div><span class="flbl">商品:</span> ${esc(inv.product_name)}</div>
      <div><span class="flbl">ロケ:</span> <span style="font-family:var(--mono);">${esc(inv.location_code)}</span></div>
      <div><span class="flbl">ロット:</span> ${esc(inv.lot_no) || '—'}</div>
      <div><span class="flbl">期限:</span> ${fmtDate(inv.expiry)}</div>
      <div><span class="flbl">利用可能:</span> <strong style="color:var(--accent);">${inv.available_qty}</strong></div>
    </div>
  `;
  document.getElementById('mvQty').max = inv.available_qty;
  document.getElementById('mvQty').value = Math.min(parseInt(document.getElementById('mvQty').value) || 1, inv.available_qty);
}

async function execMove() {
  const sel = document.getElementById('mvInvSelect');
  const invId = sel?.value;
  const toLocId = document.getElementById('mvToLoc')?.value;
  const qty = parseInt(document.getElementById('mvQty')?.value) || 0;

  if (!invId) { toast('移動元の在庫を選択してください', 'error'); return; }
  if (!toLocId) { toast('移動先ロケーションを選択してください', 'error'); return; }
  if (qty <= 0) { toast('数量を入力してください', 'error'); return; }

  const inv = _mvInventory.find(i => i.id === invId);
  if (inv && inv.location_id === toLocId) { toast('移動元と移動先が同じです', 'error'); return; }

  const { error } = await sb.rpc('fn_inventory_move', {
    p_inventory_id: invId,
    p_to_location: toLocId,
    p_qty: qty,
  });

  if (error) {
    toast('移動失敗: ' + error.message, 'error');
    return;
  }

  const toLoc = document.getElementById('mvToLoc');
  const toCode = toLoc?.options[toLoc.selectedIndex]?.text || '';
  toast(`移動完了: ${qty}個 → ${toCode}`);
  document.getElementById('mvSearch').value = '';
  document.getElementById('mvInvSelect').innerHTML = '<option disabled>在庫を検索してください</option>';
  document.getElementById('mvSourceInfo').style.display = 'none';
  await loadMoveHistory();
}

async function loadMoveHistory() {
  const { data } = await sb.from('inventory_movements')
    .select('*, products(sku, name), locations(code)')
    .in('type', ['move_in', 'move_out'])
    .order('created_at', { ascending: false })
    .limit(20);

  const tb = document.getElementById('mvHistTb');
  if (!tb) return;
  const rows = data || [];
  tb.innerHTML = rows.length
    ? rows.map(r => `<tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text2);">${fmtTime(r.created_at)}</td>
        <td>${esc(r.products?.sku)} ${esc(r.products?.name)}</td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(r.locations?.code)}</td>
        <td style="font-family:var(--mono);font-weight:700;color:${r.qty_delta > 0 ? 'var(--accent)' : 'var(--red)'};">${r.qty_delta > 0 ? '+' : ''}${r.qty_delta}</td>
        <td><span class="badge ${r.type === 'move_in' ? 'bg' : 'br'}">${r.type === 'move_in' ? '移入' : '移出'}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty-state">移動履歴がありません</td></tr>';
}
