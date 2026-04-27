// =====================================================================
// SUPEREX LogiStation - outbound.js
// 出庫処理: 一覧 / 新規登録 / ピッキング / 出荷完了
// =====================================================================

RENDER_FNS.outbound = async function renderOutbound() {
  const el = document.getElementById('page-outbound');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="tabs" id="obTabs" style="max-width:400px;">
        <div class="tab active" onclick="setObTab('all',this)">全て</div>
        <div class="tab" onclick="setObTab('pending',this)">指示待ち</div>
        <div class="tab" onclick="setObTab('picking',this)">ピッキング</div>
        <div class="tab" onclick="setObTab('shipped',this)">出荷済</div>
      </div>
      ${isOperator() ? '<button class="btn btn-p" onclick="openOutboundModal()">+ 出庫登録</button>' : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>伝票No</th><th class="hm">出荷先</th><th>予定日</th><th class="hm">明細</th><th>予定数</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="obTb"></tbody>
    </table></div></div>
  `;
  await loadOutbound();
};

let _obOrders = [];
let _obTabFilter = 'all';

function setObTab(tab, tabEl) {
  _obTabFilter = tab;
  document.querySelectorAll('#obTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderObTable();
}

async function loadOutbound() {
  const { data } = await sb.from('outbound_orders')
    .select('*, outbound_items(id, product_id, planned_qty, picked_qty, status)')
    .order('created_at', { ascending: false });
  _obOrders = data || [];
  renderObTable();
}

function renderObTable() {
  let filtered = _obOrders;
  if (_obTabFilter !== 'all') filtered = filtered.filter(o => o.status === _obTabFilter);
  const tb = document.getElementById('obTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(o => {
        const items = o.outbound_items || [];
        const totalQty = items.reduce((s, it) => s + (it.planned_qty || 0), 0);
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;">${esc(o.slip_no || o.id.slice(0, 8))}</td>
          <td class="hm">${esc(o.customer) || '—'}</td>
          <td style="font-family:var(--mono);font-size:11px;">${fmtDate(o.planned_date)}</td>
          <td class="hm" style="font-family:var(--mono);">${items.length}行</td>
          <td style="font-family:var(--mono);">${totalQty.toLocaleString()}</td>
          <td>${statusBadge(o.status)}</td>
          <td>
            <button class="btn btn-g btn-sm" onclick="openObDetail('${o.id}')">詳細</button>
            ${o.status !== 'shipped' && o.status !== 'canceled' && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openObPick('${o.id}')">ピック</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="empty-state">出庫データがありません</td></tr>';
}

function openOutboundModal() {
  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">伝票番号</div><input class="fi" id="ob_slip" placeholder="自動採番（空可）"></div>
      <div class="fl"><div class="flbl">出荷先</div><input class="fi" id="ob_customer" placeholder="出荷先名"></div>
    </div>
    <div class="fl"><div class="flbl">出荷予定日</div><input class="fi" id="ob_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="fl"><div class="flbl">備考</div><input class="fi" id="ob_note" placeholder="メモ"></div>
    <hr style="border-color:var(--border);">
    <div class="flbl">明細行</div>
    <div id="obItemRows"></div>
    <button class="btn btn-g btn-sm" onclick="addObItemRow()" style="align-self:flex-start;">+ 行追加</button>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveOutbound()">登録</button>
  `;
  openModal('出庫登録', body, footer);
  _obRowIdx = 0;
  addObItemRow();
}

let _obRowIdx = 0;
function addObItemRow() {
  const wrap = document.getElementById('obItemRows');
  if (!wrap) return;
  const idx = _obRowIdx++;
  const div = document.createElement('div');
  div.className = 'fr mb12';
  div.innerHTML = `
    <div class="fl"><div class="flbl">商品SKU</div><input class="fi ob-sku" placeholder="P-00001"></div>
    <div class="fl"><div class="flbl">予定数量</div><input class="fi ob-qty" type="number" min="1" value="1"></div>
  `;
  wrap.appendChild(div);
}

async function saveOutbound() {
  const slip = document.getElementById('ob_slip').value.trim() || null;
  const customer = document.getElementById('ob_customer').value.trim() || null;
  const date = document.getElementById('ob_date').value || null;
  const note = document.getElementById('ob_note').value.trim() || null;

  const skus = document.querySelectorAll('#obItemRows .ob-sku');
  const qtys = document.querySelectorAll('#obItemRows .ob-qty');
  const items = [];
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i].value.trim();
    const qty = parseInt(qtys[i].value) || 0;
    if (!sku || qty <= 0) continue;
    items.push({ sku, qty });
  }
  if (!items.length) { toast('明細を1行以上入力してください', 'error'); return; }

  const { data: prods } = await sb.from('products')
    .select('id, sku').in('sku', items.map(it => it.sku)).is('deleted_at', null);
  const skuMap = {};
  (prods || []).forEach(p => skuMap[p.sku] = p.id);
  for (const it of items) {
    if (!skuMap[it.sku]) { toast('商品が見つかりません: ' + it.sku, 'error'); return; }
  }

  const { data: order, error: oErr } = await sb.from('outbound_orders')
    .insert({ slip_no: slip, customer, planned_date: date, note, status: 'pending', created_by: App.user?.id })
    .select().single();
  if (oErr) { toast('登録失敗: ' + oErr.message, 'error'); return; }

  const itemRows = items.map(it => ({
    order_id: order.id,
    product_id: skuMap[it.sku],
    planned_qty: it.qty,
  }));
  const { error: iErr } = await sb.from('outbound_items').insert(itemRows);
  if (iErr) { toast('明細登録失敗: ' + iErr.message, 'error'); return; }

  closeModal();
  toast('出庫を登録しました');
  await loadOutbound();
}

async function openObDetail(orderId) {
  const { data: order } = await sb.from('outbound_orders')
    .select('*, outbound_items(*, products(sku, name), locations:from_location_id(code))')
    .eq('id', orderId).single();
  if (!order) return;

  const items = order.outbound_items || [];
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:12px;">
      <div><span class="flbl">伝票No: </span>${esc(order.slip_no || '—')}</div>
      <div><span class="flbl">出荷先: </span>${esc(order.customer || '—')}</div>
      <div><span class="flbl">予定日: </span>${fmtDate(order.planned_date)}</div>
      <div><span class="flbl">状態: </span>${statusBadge(order.status)}</div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>SKU</th><th>商品名</th><th>予定</th><th>ピック済</th><th>ロケ</th><th>状態</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.products?.sku)}</td>
        <td>${esc(it.products?.name)}</td>
        <td style="font-family:var(--mono);">${it.planned_qty}</td>
        <td style="font-family:var(--mono);${it.picked_qty > 0 ? 'color:var(--accent);' : ''}">${it.picked_qty || '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.locations?.code) || '—'}</td>
        <td>${statusBadge(it.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;
  openModal('出庫詳細 ' + (order.slip_no || order.id.slice(0, 8)), body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

async function openObPick(orderId) {
  const { data: order } = await sb.from('outbound_orders')
    .select('*, outbound_items(*, products(sku, name))')
    .eq('id', orderId).single();
  if (!order) return;

  const pending = (order.outbound_items || []).filter(it => it.status !== 'shipped');
  if (!pending.length) { toast('全明細が出荷済みです'); return; }

  // Load inventory for FIFO selection
  const productIds = [...new Set(pending.map(it => it.product_id))];
  const { data: invRows } = await sb.from('v_inventory_with_names')
    .select('*')
    .in('product_id', productIds)
    .gt('available_qty', 0)
    .order('expiry', { ascending: true, nullsFirst: false });

  const invByProduct = {};
  (invRows || []).forEach(i => {
    if (!invByProduct[i.product_id]) invByProduct[i.product_id] = [];
    invByProduct[i.product_id].push(i);
  });

  const rows = pending.map(it => {
    const candidates = invByProduct[it.product_id] || [];
    const opts = candidates.map(c =>
      `<option value="${c.id}">${esc(c.location_code)} / ${esc(c.lot_no || '—')} / 期限:${fmtDate(c.expiry)} / 在庫:${c.available_qty}</option>`
    ).join('');
    return `
      <div class="fr mb12" style="align-items:end;">
        <div class="fl">
          <div class="flbl">${esc(it.products?.sku)} - ${esc(it.products?.name)}</div>
          <div style="font-family:var(--mono);font-size:12px;">予定: ${it.planned_qty}</div>
        </div>
        <div class="fl"><div class="flbl">ピック数</div><input class="fi pk-qty" type="number" min="0" value="${it.planned_qty}" data-item-id="${it.id}"></div>
        <div class="fl"><div class="flbl">引当在庫 (FIFO推奨)</div><select class="fs pk-inv" data-item-id="${it.id}">${opts || '<option value="">在庫なし</option>'}</select></div>
      </div>
    `;
  }).join('');

  const body = `<div class="fg"><p style="font-size:11px;color:var(--text2);margin-bottom:8px;">引当在庫は入庫日/期限が古い順（FIFO）で表示されています。</p>${rows}</div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="execPick()">ピッキング完了</button>
  `;
  openModal('ピッキング - ' + (order.slip_no || order.id.slice(0, 8)), body, footer);
}

async function execPick() {
  const qtyEls = document.querySelectorAll('.pk-qty');
  const invEls = document.querySelectorAll('.pk-inv');
  let ok = 0;
  for (let i = 0; i < qtyEls.length; i++) {
    const itemId = qtyEls[i].dataset.itemId;
    const qty = parseInt(qtyEls[i].value) || 0;
    const invId = invEls[i].value;
    if (qty <= 0 || !invId) continue;

    const { error } = await sb.rpc('fn_outbound_pick', {
      p_item_id: itemId,
      p_inventory_id: invId,
      p_qty: qty,
    });
    if (error) { toast('ピッキング失敗: ' + error.message, 'error'); return; }
    ok++;
  }
  closeModal();
  toast(ok + '行のピッキングを完了しました');
  await loadOutbound();
}
