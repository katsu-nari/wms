// =====================================================================
// LogiCore WMS - inbound.js
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

function setIbTab(tab, tabEl) {
  _ibTabFilter = tab;
  document.querySelectorAll('#ibTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderIbTable();
}

async function loadInbound() {
  const { data } = await sb.from('inbound_orders')
    .select('*, inbound_items(id, product_id, planned_qty, received_qty, status)')
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
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;">${esc(o.slip_no || o.id.slice(0, 8))}</td>
          <td class="hm">${esc(o.supplier) || '—'}</td>
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

function openInboundModal() {
  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">伝票番号</div><input class="fi" id="ib_slip" placeholder="自動採番（空可）"></div>
      <div class="fl"><div class="flbl">仕入先</div><input class="fi" id="ib_supplier" placeholder="仕入先名"></div>
    </div>
    <div class="fl"><div class="flbl">入荷予定日</div><input class="fi" id="ib_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="fl"><div class="flbl">備考</div><input class="fi" id="ib_note" placeholder="メモ"></div>
    <hr style="border-color:var(--border);">
    <div class="flbl">明細行</div>
    <div id="ibItemRows"></div>
    <button class="btn btn-g btn-sm" onclick="addIbItemRow()" style="align-self:flex-start;">+ 行追加</button>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveInbound()">登録</button>
  `;
  openModal('入庫登録', body, footer);
  addIbItemRow();
}

let _ibRowIdx = 0;
function addIbItemRow() {
  const wrap = document.getElementById('ibItemRows');
  if (!wrap) return;
  const idx = _ibRowIdx++;
  const div = document.createElement('div');
  div.className = 'fr mb12';
  div.id = 'ibRow' + idx;
  div.innerHTML = `
    <div class="fl"><div class="flbl">商品SKU</div><input class="fi ib-sku" placeholder="P-00001"></div>
    <div class="fl"><div class="flbl">予定数量</div><input class="fi ib-qty" type="number" min="1" value="1"></div>
  `;
  wrap.appendChild(div);
}

async function saveInbound() {
  const slip = document.getElementById('ib_slip').value.trim() || null;
  const supplier = document.getElementById('ib_supplier').value.trim() || null;
  const date = document.getElementById('ib_date').value || null;
  const note = document.getElementById('ib_note').value.trim() || null;

  // collect item rows
  const skus = document.querySelectorAll('#ibItemRows .ib-sku');
  const qtys = document.querySelectorAll('#ibItemRows .ib-qty');
  const items = [];
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i].value.trim();
    const qty = parseInt(qtys[i].value) || 0;
    if (!sku || qty <= 0) continue;
    items.push({ sku, qty });
  }
  if (!items.length) { toast('明細を1行以上入力してください', 'error'); return; }

  // resolve product IDs
  const { data: prods } = await sb.from('products')
    .select('id, sku')
    .in('sku', items.map(it => it.sku))
    .is('deleted_at', null);
  const skuMap = {};
  (prods || []).forEach(p => skuMap[p.sku] = p.id);

  for (const it of items) {
    if (!skuMap[it.sku]) { toast('商品が見つかりません: ' + it.sku, 'error'); return; }
  }

  // insert order
  const { data: order, error: oErr } = await sb.from('inbound_orders')
    .insert({ slip_no: slip, supplier, planned_date: date, note, status: 'pending', created_by: App.user?.id })
    .select().single();
  if (oErr) { toast('登録失敗: ' + oErr.message, 'error'); return; }

  // insert items
  const itemRows = items.map(it => ({
    order_id: order.id,
    product_id: skuMap[it.sku],
    planned_qty: it.qty,
  }));
  const { error: iErr } = await sb.from('inbound_items').insert(itemRows);
  if (iErr) { toast('明細登録失敗: ' + iErr.message, 'error'); return; }

  closeModal();
  toast('入庫を登録しました');
  _ibRowIdx = 0;
  await loadInbound();
}

async function openIbDetail(orderId) {
  const { data: order } = await sb.from('inbound_orders')
    .select('*, inbound_items(*, products(sku, name), locations(code))')
    .eq('id', orderId).single();
  if (!order) { toast('データが見つかりません', 'error'); return; }

  const items = order.inbound_items || [];
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:12px;">
      <div><span class="flbl">伝票No: </span>${esc(order.slip_no || '—')}</div>
      <div><span class="flbl">仕入先: </span>${esc(order.supplier || '—')}</div>
      <div><span class="flbl">予定日: </span>${fmtDate(order.planned_date)}</div>
      <div><span class="flbl">状態: </span>${statusBadge(order.status)}</div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>SKU</th><th>商品名</th><th>予定</th><th>実数</th><th>格納先</th><th>状態</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.products?.sku)}</td>
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

  // load locations for select
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
