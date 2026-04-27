// =====================================================================
// SUPEREX LogiStation - inbound.js
// 入庫処理: 一覧 / 新規登録 / 詳細 / 検品 / 棚入れ完了
// =====================================================================

RENDER_FNS.inbound = async function renderInbound() {
  const el = document.getElementById('page-inbound');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="tabs" id="ibTabs" style="max-width:400px;">
        <div class="tab active" onclick="setIbTab('all',this)">全て</div>
        <div class="tab" onclick="setIbTab('pending',this)">受付待ち</div>
        <div class="tab" onclick="setIbTab('received',this)">入荷済</div>
        <div class="tab" onclick="setIbTab('done',this)">完了</div>
      </div>
      ${isOperator() ? '<button class="btn btn-p" onclick="openInboundModal()">+ 入庫登録</button>' : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>伝票No</th><th class="hm">仕入先</th><th>予定日</th><th class="hm">明細</th><th>予定数</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="ibTb"></tbody>
    </table></div></div>
  `;
  await loadInbound();
};

let _ibOrders = [];
let _ibTabFilter = 'all';
let _ibSuppliers = [];
let _ibProducts = [];

function setIbTab(tab, tabEl) {
  _ibTabFilter = tab;
  document.querySelectorAll('#ibTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderIbTable();
}

async function loadInbound() {
  const { data } = await sb.from('inbound_orders')
    .select('*, suppliers(name), inbound_items(id, product_id, planned_qty, received_qty, status)')
    .order('created_at', { ascending: false });
  _ibOrders = data || [];
  renderIbTable();
}

function renderIbTable() {
  let filtered = _ibOrders;
  if (_ibTabFilter !== 'all') {
    filtered = filtered.filter(o => o.status === _ibTabFilter);
  }
  const tb = document.getElementById('ibTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(o => {
        const items = o.inbound_items || [];
        const totalQty = items.reduce((s, it) => s + (it.planned_qty || 0), 0);
        const supplierName = o.suppliers?.name || o.supplier || '—';
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;">${esc(o.slip_no || o.id.slice(0, 8))}</td>
          <td class="hm">${esc(supplierName)}</td>
          <td style="font-family:var(--mono);font-size:11px;">${fmtDate(o.planned_date)}</td>
          <td class="hm" style="font-family:var(--mono);">${items.length}行</td>
          <td style="font-family:var(--mono);">${totalQty.toLocaleString()}</td>
          <td>${statusBadge(o.status)}</td>
          <td>
            <button class="btn btn-g btn-sm" onclick="openIbDetail('${o.id}')">詳細</button>
            ${o.status !== 'done' && o.status !== 'canceled' && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openIbPutaway('${o.id}')">棚入れ</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="empty-state">入庫データがありません</td></tr>';
}

async function openInboundModal() {
  const [supRes, prodRes] = await Promise.all([
    sb.from('suppliers').select('id, code, name').eq('is_active', true).order('code'),
    sb.from('products').select('id, sku, name, jan_code, cost_price, sell_price, pack_size').is('deleted_at', null).order('sku'),
  ]);
  _ibSuppliers = supRes.data || [];
  _ibProducts = prodRes.data || [];

  const supOpts = _ibSuppliers.map(s => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');

  let rowsHtml = '';
  for (let i = 0; i < 10; i++) {
    rowsHtml += `<tr id="ibRow${i}">
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 6px;">${i + 1}</td>
      <td style="padding:4px 3px;"><input class="fi ib-jan" style="font-size:11px;padding:5px 6px;" placeholder="JANコード" data-row="${i}" onchange="ibJanLookup(${i})"></td>
      <td style="padding:4px 3px;"><span class="ib-pname" id="ibPname${i}" style="font-size:11px;color:var(--text2);">—</span><input type="hidden" class="ib-pid" id="ibPid${i}"></td>
      <td style="padding:4px 3px;"><input class="fi ib-cost" id="ibCost${i}" style="font-size:11px;padding:5px 6px;width:80px;" type="number" step="0.01"></td>
      <td style="padding:4px 3px;"><input class="fi ib-sell" id="ibSell${i}" style="font-size:11px;padding:5px 6px;width:80px;" type="number" step="0.01"></td>
      <td style="padding:4px 3px;"><span class="ib-pack" id="ibPack${i}" style="font-family:var(--mono);font-size:11px;color:var(--text2);">—</span></td>
      <td style="padding:4px 3px;"><input class="fi ib-case" id="ibCase${i}" style="font-size:11px;padding:5px 6px;width:60px;" type="number" min="0" value="" oninput="ibCalcTotal(${i})"></td>
      <td style="padding:4px 3px;"><input class="fi ib-piece" id="ibPiece${i}" style="font-size:11px;padding:5px 6px;width:60px;" type="number" min="0" value="" oninput="ibCalcTotal(${i})"></td>
      <td style="padding:4px 3px;font-family:var(--mono);font-size:11px;font-weight:700;" id="ibTotal${i}">—</td>
    </tr>`;
  }

  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">伝票番号</div><input class="fi" id="ib_slip" placeholder="自動採番（空可）"></div>
      <div class="fl"><div class="flbl">仕入先 *</div><select class="fs" id="ib_supplier"><option value="">選択してください</option>${supOpts}</select></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">入荷予定日</div><input class="fi" id="ib_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="fl"><div class="flbl">備考</div><input class="fi" id="ib_note" placeholder="メモ"></div>
    </div>
    <hr style="border-color:var(--border);">
    <div class="flbl">明細行（最大10行）</div>
    <div class="tw"><table style="min-width:700px;">
      <thead><tr>
        <th style="width:30px;">#</th>
        <th style="width:120px;">JANコード</th>
        <th>商品名</th>
        <th style="width:90px;">原単価</th>
        <th style="width:90px;">売単価</th>
        <th style="width:50px;">入数</th>
        <th style="width:70px;">ケース数</th>
        <th style="width:70px;">ピース数</th>
        <th style="width:70px;">総ピース</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveInbound()">登録</button>
  `;
  openModal('入庫登録', body, footer, true);
}

function ibJanLookup(row) {
  const janInput = document.querySelector(`#ibRow${row} .ib-jan`);
  const jan = (janInput?.value || '').trim();
  const pnameEl = document.getElementById('ibPname' + row);
  const pidEl = document.getElementById('ibPid' + row);
  const costEl = document.getElementById('ibCost' + row);
  const sellEl = document.getElementById('ibSell' + row);
  const packEl = document.getElementById('ibPack' + row);

  if (!jan) {
    pnameEl.textContent = '—';
    pidEl.value = '';
    costEl.value = '';
    sellEl.value = '';
    packEl.textContent = '—';
    return;
  }

  const prod = _ibProducts.find(p => p.jan_code === jan);
  if (prod) {
    pnameEl.textContent = prod.name;
    pnameEl.style.color = 'var(--text)';
    pidEl.value = prod.id;
    if (prod.cost_price != null) costEl.value = prod.cost_price;
    if (prod.sell_price != null) sellEl.value = prod.sell_price;
    packEl.textContent = prod.pack_size || 1;
    ibCalcTotal(row);
  } else {
    pnameEl.textContent = '該当なし';
    pnameEl.style.color = 'var(--red)';
    pidEl.value = '';
    packEl.textContent = '—';
  }
}

function ibCalcTotal(row) {
  const packEl = document.getElementById('ibPack' + row);
  const caseEl = document.getElementById('ibCase' + row);
  const pieceEl = document.getElementById('ibPiece' + row);
  const totalEl = document.getElementById('ibTotal' + row);

  const packSize = parseInt(packEl.textContent) || 1;
  const caseQty = parseInt(caseEl.value) || 0;
  const pieceQty = parseInt(pieceEl.value) || 0;
  const total = caseQty * packSize + pieceQty;

  totalEl.textContent = total > 0 ? total.toLocaleString() : '—';
}

async function saveInbound() {
  const slip = document.getElementById('ib_slip').value.trim() || null;
  const supplierId = document.getElementById('ib_supplier').value || null;
  const date = document.getElementById('ib_date').value || null;
  const note = document.getElementById('ib_note').value.trim() || null;

  const items = [];
  for (let i = 0; i < 10; i++) {
    const pid = document.getElementById('ibPid' + i).value;
    const packEl = document.getElementById('ibPack' + i);
    const caseQty = parseInt(document.getElementById('ibCase' + i).value) || 0;
    const pieceQty = parseInt(document.getElementById('ibPiece' + i).value) || 0;
    const packSize = parseInt(packEl.textContent) || 1;
    const totalQty = caseQty * packSize + pieceQty;
    if (!pid || totalQty <= 0) continue;

    const costVal = document.getElementById('ibCost' + i).value;
    const sellVal = document.getElementById('ibSell' + i).value;

    items.push({
      product_id: pid,
      planned_qty: totalQty,
      cost_price: costVal !== '' ? parseFloat(costVal) : null,
      sell_price: sellVal !== '' ? parseFloat(sellVal) : null,
      case_qty: caseQty,
      piece_qty: pieceQty,
      pack_size: packSize,
    });
  }
  if (!items.length) { toast('明細を1行以上入力してください', 'error'); return; }

  const supplierName = supplierId
    ? (_ibSuppliers.find(s => s.id === supplierId)?.name || null)
    : null;

  const { data: order, error: oErr } = await sb.from('inbound_orders')
    .insert({
      slip_no: slip,
      supplier: supplierName,
      supplier_id: supplierId,
      planned_date: date,
      note,
      status: 'pending',
      created_by: App.user?.id,
    })
    .select().single();
  if (oErr) { toast('登録失敗: ' + oErr.message, 'error'); return; }

  const itemRows = items.map(it => ({ order_id: order.id, ...it }));
  const { error: iErr } = await sb.from('inbound_items').insert(itemRows);
  if (iErr) { toast('明細登録失敗: ' + iErr.message, 'error'); return; }

  closeModal();
  toast('入庫を登録しました');
  await loadInbound();
}

async function openIbDetail(orderId) {
  const { data: order } = await sb.from('inbound_orders')
    .select('*, suppliers(name), inbound_items(*, products(sku, name, jan_code), locations(code))')
    .eq('id', orderId).single();
  if (!order) { toast('データが見つかりません', 'error'); return; }

  const items = order.inbound_items || [];
  const supplierName = order.suppliers?.name || order.supplier || '—';
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:12px;">
      <div><span class="flbl">伝票No: </span>${esc(order.slip_no || '—')}</div>
      <div><span class="flbl">仕入先: </span>${esc(supplierName)}</div>
      <div><span class="flbl">予定日: </span>${fmtDate(order.planned_date)}</div>
      <div><span class="flbl">状態: </span>${statusBadge(order.status)}</div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>JAN</th><th>商品名</th><th>予定</th><th>実数</th><th>格納先</th><th>状態</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.products?.jan_code || it.products?.sku)}</td>
        <td>${esc(it.products?.name)}</td>
        <td style="font-family:var(--mono);">${it.planned_qty}</td>
        <td style="font-family:var(--mono);${it.received_qty > 0 ? 'color:var(--accent);' : ''}">${it.received_qty || '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.locations?.code) || '—'}</td>
        <td>${statusBadge(it.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;
  openModal('入庫詳細 ' + (order.slip_no || order.id.slice(0, 8)), body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

async function openIbPutaway(orderId) {
  const { data: order } = await sb.from('inbound_orders')
    .select('*, inbound_items(*, products(sku, name))')
    .eq('id', orderId).single();
  if (!order) return;

  const pending = (order.inbound_items || []).filter(it => it.status !== 'done');
  if (!pending.length) { toast('全明細が完了済みです'); return; }

  const { data: locs } = await sb.from('locations').select('id, code').eq('is_active', true).order('code');
  const locOpts = (locs || []).map(l => `<option value="${l.id}">${esc(l.code)}</option>`).join('');

  const rows = pending.map((it, i) => `
    <div class="fr mb12" style="align-items:end;">
      <div class="fl">
        <div class="flbl">${esc(it.products?.sku)} - ${esc(it.products?.name)}</div>
        <div style="font-family:var(--mono);font-size:12px;">予定: ${it.planned_qty}</div>
      </div>
      <div class="fl"><div class="flbl">実数量</div><input class="fi pw-qty" type="number" min="0" value="${it.planned_qty}" data-item-id="${it.id}"></div>
      <div class="fl"><div class="flbl">格納ロケーション</div><select class="fs pw-loc" data-item-id="${it.id}">${locOpts}</select></div>
    </div>
  `).join('');

  const body = `<div class="fg">${rows}</div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="execPutaway()">棚入れ完了</button>
  `;
  openModal('棚入れ - ' + (order.slip_no || order.id.slice(0, 8)), body, footer);
}

async function execPutaway() {
  const qtyEls = document.querySelectorAll('.pw-qty');
  const locEls = document.querySelectorAll('.pw-loc');
  let ok = 0;
  for (let i = 0; i < qtyEls.length; i++) {
    const itemId = qtyEls[i].dataset.itemId;
    const qty = parseInt(qtyEls[i].value) || 0;
    const locId = locEls[i].value;
    if (qty <= 0) continue;

    const { error } = await sb.rpc('fn_inbound_putaway', {
      p_item_id: itemId,
      p_location: locId,
      p_qty: qty,
    });
    if (error) { toast('棚入れ失敗: ' + error.message, 'error'); return; }
    ok++;
  }
  closeModal();
  toast(ok + '行の棚入れを完了しました');
  await loadInbound();
}
