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
        <div class="tab" onclick="setObTab('picking',this)">引当済</div>
        <div class="tab" onclick="setObTab('shipped',this)">出荷済</div>
      </div>
      ${isOperator() ? '<button class="btn btn-p" onclick="openOutboundModal()">+ 出庫登録</button>' : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:13px;flex-wrap:wrap;">
      <div class="sbar" style="max-width:340px;flex:1;min-width:180px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="obSearch" value="${esc(_obSearch)}" placeholder="出荷先コード / 伝票番号 で検索..." oninput="filterOutbound()">
      </div>
      <input class="fi" id="obDateFrom" placeholder="開始日 例:6/5" style="width:108px;font-size:12px;" value="${_obDateFrom ? _obDateFrom.replace(/-/g, '/') : ''}" onchange="obDateRangeChanged()">
      <span style="color:var(--text2);">〜</span>
      <input class="fi" id="obDateTo" placeholder="終了日 例:6/30" style="width:108px;font-size:12px;" value="${_obDateTo ? _obDateTo.replace(/-/g, '/') : ''}" onchange="obDateRangeChanged()">
      <button class="btn btn-g btn-sm" onclick="clearOutboundSearch()">クリア</button>
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
let _obSearch = '';
let _obDateFrom = '';   // 検索範囲 開始日 (ISO)
let _obDateTo = '';     // 検索範囲 終了日 (ISO)
let _obProducts = [];
let _obClients = [];

function setObTab(tab, tabEl) {
  _obTabFilter = tab;
  document.querySelectorAll('#obTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderObTable();
}

function filterOutbound() {
  _obSearch = (document.getElementById('obSearch')?.value || '').trim();
  renderObTable();
}

function clearOutboundSearch() {
  _obSearch = '';
  _obDateFrom = '';
  _obDateTo = '';
  ['obSearch', 'obDateFrom', 'obDateTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderObTable();
}

// 短縮日付変換(ibApplyShortDate/ibParseShortDate)は inbound.js の共通関数を利用
function obDateRangeChanged() {
  _obDateFrom = ibApplyShortDate(document.getElementById('obDateFrom')) || '';
  _obDateTo = ibApplyShortDate(document.getElementById('obDateTo')) || '';
  if (_obDateFrom && _obDateTo && _obDateFrom > _obDateTo) {
    toast('開始日が終了日より後になっています', 'error');
  }
  renderObTable();
}

async function loadOutbound() {
  const { data, error } = await sb.from('outbound_orders')
    .select('*, outbound_items(id, product_id, planned_qty, picked_qty, status), clients(name, code)')
    .order('created_at', { ascending: false });
  if (error) { toast('出庫一覧の読み込みに失敗しました: ' + error.message, 'error'); }
  _obOrders = data || [];
  renderObTable();
}

function renderObTable() {
  let filtered = _obOrders;
  if (_obTabFilter !== 'all') filtered = filtered.filter(o => o.status === _obTabFilter);
  // 検索: 出荷予定日 / 出荷先コード / 伝票番号 のいずれかに部分一致
  const q = (_obSearch || '').toLowerCase();
  if (q) {
    filtered = filtered.filter(o => {
      const slip = (o.slip_no || '').toLowerCase();
      const date = (o.planned_date || '').toLowerCase();
      const cliCode = (o.clients?.code || '').toLowerCase();
      const cliName = (o.clients?.name || o.customer || '').toLowerCase();
      return slip.includes(q) || date.includes(q) || cliCode.includes(q) || cliName.includes(q);
    });
  }
  // 日付範囲検索: 開始日〜終了日
  if (_obDateFrom) filtered = filtered.filter(o => o.planned_date && o.planned_date.slice(0, 10) >= _obDateFrom);
  if (_obDateTo) filtered = filtered.filter(o => o.planned_date && o.planned_date.slice(0, 10) <= _obDateTo);
  // 検索も日付指定もない通常表示では、当日以外の出荷済みは非表示
  // (未出荷 pending/picking は日付に関わらず表示)
  if (!q && !_obDateFrom && !_obDateTo) {
    const today = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter(o => o.status !== 'shipped' || (o.planned_date || '').slice(0, 10) === today);
  }
  const tb = document.getElementById('obTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(o => {
        const items = o.outbound_items || [];
        const totalQty = items.reduce((s, it) => s + (it.planned_qty || 0), 0);
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;">${esc(o.slip_no || o.id.slice(0, 8))}</td>
          <td class="hm">${esc(o.clients?.name || o.customer) || '—'}</td>
          <td style="font-family:var(--mono);font-size:11px;">${fmtDate(o.planned_date)}</td>
          <td class="hm" style="font-family:var(--mono);">${items.length}行</td>
          <td style="font-family:var(--mono);">${totalQty.toLocaleString()}</td>
          <td>${statusBadge(o.status)}</td>
          <td>
            <button class="btn btn-g btn-sm" onclick="openObDetail('${o.id}')">詳細</button>
            ${(o.status === 'pending' || (o.status === 'picking' && items.some(it => it.status === 'pending'))) && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openObAllocate('${o.id}')">引当</button>` : ''}
            ${o.status === 'picking' && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openObShipAllocated('${o.id}')">出荷</button><button class="btn btn-g btn-sm" onclick="obPrintPickingList('${o.id}')">ピックリスト</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" class="empty-state">${(_obSearch || _obDateFrom || _obDateTo || _obTabFilter !== 'all') ? '該当する出庫データがありません' : '出庫データがありません'}</td></tr>`;
}

async function openOutboundModal() {
  const [prodRes, cliRes] = await Promise.all([
    sb.from('products').select('id, sku, name, jan_code').is('deleted_at', null).order('sku'),
    sb.from('clients').select('id, code, name').eq('is_active', true).order('code'),
  ]);
  _obProducts = prodRes.data || [];
  _obClients = cliRes.data || [];

  let rowsHtml = '';
  for (let i = 0; i < 10; i++) {
    rowsHtml += `<tr id="obRow${i}">
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 6px;">${i + 1}</td>
      <td style="padding:4px 3px;"><div style="display:flex;gap:2px;align-items:center;"><input class="fi ob-jan" style="font-size:11px;padding:5px 6px;flex:1;" placeholder="JAN" data-row="${i}" onchange="obJanLookup(${i})"><button class="btn-scan" onclick="obScanRow(${i})" style="padding:3px 5px;font-size:0;" title="スキャン"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg></button></div></td>
      <td style="padding:4px 3px;"><span id="obPname${i}" style="font-size:11px;color:var(--text2);">—</span><input type="hidden" id="obPid${i}"></td>
      <td style="padding:4px 3px;"><input class="fi ob-qty" id="obQty${i}" style="font-size:11px;padding:5px 6px;width:70px;" type="number" min="1"></td>
    </tr>`;
  }

  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">伝票番号</div><input class="fi" id="ob_slip" placeholder="自動採番（空可）"></div>
      <div class="fl"><div class="flbl">荷主</div><select class="fs" id="ob_client"><option value="">-- 選択してください --</option>${_obClients.map(c => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">出荷先</div><input class="fi" id="ob_customer" placeholder="出荷先名（荷主未選択時に使用）"></div>
      <div class="fl"><div class="flbl">出荷予定日</div><input class="fi" id="ob_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">備考</div><input class="fi" id="ob_note" placeholder="メモ"></div>
    </div>
    <hr style="border-color:var(--border);">
    <div class="flbl">明細行（最大10行）</div>
    <div class="tw"><table style="min-width:400px;">
      <thead><tr>
        <th style="width:30px;">#</th>
        <th style="width:140px;">JANコード</th>
        <th>商品名</th>
        <th style="width:80px;">数量</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveOutbound()">登録</button>
  `;
  openModal('出庫登録', body, footer, true);
}

function obJanLookup(row) {
  const janInput = document.querySelector(`#obRow${row} .ob-jan`);
  const jan = (janInput?.value || '').trim();
  const pnameEl = document.getElementById('obPname' + row);
  const pidEl = document.getElementById('obPid' + row);

  if (!jan) {
    pnameEl.textContent = '—';
    pidEl.value = '';
    return;
  }
  const prod = _obProducts.find(p => p.jan_code === jan);
  if (prod) {
    pnameEl.textContent = prod.name;
    pnameEl.style.color = 'var(--text)';
    pidEl.value = prod.id;
  } else {
    pnameEl.textContent = '該当なし';
    pnameEl.style.color = 'var(--red)';
    pidEl.value = '';
  }
}

function obScanRow(row) {
  startScan((code) => {
    const janInput = document.querySelector(`#obRow${row} .ob-jan`);
    if (janInput) {
      janInput.value = code;
      obJanLookup(row);
    }
  });
}

async function saveOutbound() {
  const slip = document.getElementById('ob_slip').value.trim() || null;
  const clientId = document.getElementById('ob_client').value || null;
  const customer = document.getElementById('ob_customer').value.trim() || null;
  const date = document.getElementById('ob_date').value || null;
  const note = document.getElementById('ob_note').value.trim() || null;

  if (!clientId && !customer) { toast('荷主または出荷先を入力してください', 'error'); return; }

  const items = [];
  for (let i = 0; i < 10; i++) {
    const pid = document.getElementById('obPid' + i).value;
    const qty = parseInt(document.getElementById('obQty' + i).value) || 0;
    if (!pid || qty <= 0) continue;
    items.push({ product_id: pid, planned_qty: qty });
  }
  if (!items.length) { toast('明細を1行以上入力してください', 'error'); return; }

  const { data: order, error: oErr } = await sb.from('outbound_orders')
    .insert({ slip_no: slip, client_id: clientId, customer, planned_date: date, note, status: 'pending', created_by: App.user?.id })
    .select().single();
  if (oErr) { toast('登録失敗: ' + oErr.message, 'error'); return; }

  const itemRows = items.map(it => ({ order_id: order.id, ...it }));
  const { error: iErr } = await sb.from('outbound_items').insert(itemRows);
  if (iErr) { toast('明細登録失敗: ' + iErr.message, 'error'); return; }

  closeModal();
  toast('出庫を登録しました');
  await loadOutbound();
}

async function openObDetail(orderId) {
  const { data: order } = await sb.from('outbound_orders')
    .select('*, outbound_items(*, products(sku, name, jan_code), locations:from_location_id(code)), clients(name)')
    .eq('id', orderId).single();
  if (!order) return;

  const items = order.outbound_items || [];
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:12px;">
      <div><span class="flbl">伝票No: </span>${esc(order.slip_no || '—')}</div>
      <div><span class="flbl">出荷先: </span>${esc(order.clients?.name || order.customer || '—')}</div>
      <div><span class="flbl">予定日: </span>${fmtDate(order.planned_date)}</div>
      <div><span class="flbl">状態: </span>${statusBadge(order.status)}</div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>JAN</th><th>商品名</th><th>予定</th><th>ピック済</th><th>ロケ</th><th>状態</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.products?.jan_code || it.products?.sku)}</td>
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
    if (error) {
      // 途中失敗でも成功済み行は確定しているため、画面を最新化してから通知
      closeModal();
      await loadOutbound();
      toast((ok > 0 ? ok + '行完了後に' : '') + 'ピッキング失敗: ' + error.message, 'error');
      return;
    }
    ok++;
  }
  closeModal();
  toast(ok + '行のピッキングを完了しました');
  await loadOutbound();
}

// =====================================================================
// 出荷引当 (在庫引当)
//   チェックした明細を対象に、期限の近い在庫から全数を一括引当。
//   引当確定と同時に在庫を控除し(解除なし)、ピッキングリストを自動出力。
//   引当済(picking)の伝票は「出荷」でステータス確定。
// =====================================================================

let _obAllocItems = [];        // 引当対象明細
let _obAllocCandidates = {};   // product_id → 利用可能在庫行[]
let _obAllocPlan = {};         // item_id → [{inventory_id, qty, label}]

async function openObAllocate(orderId) {
  const { data: order, error } = await sb.from('outbound_orders')
    .select('*, outbound_items(*, products(sku, name, jan_code))')
    .eq('id', orderId).single();
  if (error || !order) { toast('出庫データの取得に失敗しました', 'error'); return; }
  if (order.status !== 'pending' && order.status !== 'picking') {
    toast('指示待ちの出庫のみ引当できます', 'error'); return;
  }

  // 未引当(pending)の明細のみ対象
  const items = (order.outbound_items || []).filter(it => it.status === 'pending');
  if (!items.length) { toast('引当対象の明細がありません', 'error'); return; }

  // 対象商品の利用可能在庫を取得（期限昇順→ロケコード順のFIFO）
  const productIds = [...new Set(items.map(it => it.product_id))];
  const { data: invRows } = await sb.from('v_inventory_with_names')
    .select('id, product_id, location_code, lot_no, expiry, qty, locked_qty, available_qty')
    .in('product_id', productIds)
    .gt('available_qty', 0);

  _obAllocCandidates = {};
  (invRows || []).forEach(r => {
    (_obAllocCandidates[r.product_id] = _obAllocCandidates[r.product_id] || []).push(r);
  });
  Object.values(_obAllocCandidates).forEach(list => list.sort((a, b) => {
    const ea = a.expiry || '9999-12-31', eb = b.expiry || '9999-12-31';
    if (ea !== eb) return ea < eb ? -1 : 1;
    return (a.location_code || '').localeCompare(b.location_code || '');
  }));

  _obAllocItems = items;

  const rows = items.map(it => {
    const p = it.products || {};
    return `<tr class="ob-alloc-line" data-item-id="${it.id}" data-product-id="${it.product_id}" data-planned="${it.planned_qty}">
      <td style="text-align:center;"><input type="checkbox" class="oba-check" checked onchange="obRecalcAllocPlan()"></td>
      <td><strong>${esc(p.name || '')}</strong></td>
      <td style="font-family:var(--mono);font-size:11px;">${esc(p.jan_code || p.sku || '')}</td>
      <td style="font-family:var(--mono);text-align:right;font-weight:700;">${it.planned_qty}</td>
      <td class="oba-plan" style="font-size:11px;color:var(--text2);">—</td>
      <td class="oba-status" style="font-size:11px;">—</td>
    </tr>`;
  }).join('');

  const body = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">
      チェックした明細を対象に、期限の近い在庫から<strong>全数を一括引当</strong>します。<br>
      <span style="color:var(--red);">引当確定と同時に在庫が引き落とされ、取消はできません。</span>確定後はピッキングリストが自動で表示されます。
    </div>
    <div class="tw"><table>
      <thead><tr>
        <th style="width:36px;text-align:center;"><input type="checkbox" id="obaCheckAll" checked onchange="obToggleAllAlloc(this)"></th>
        <th>商品名</th><th style="width:120px;">JAN</th><th style="width:70px;text-align:right;">必要数</th>
        <th>引当予定（ロケ / ロット / 数量）</th><th style="width:80px;">状態</th>
      </tr></thead>
      <tbody id="obAllocBody">${rows}</tbody>
    </table></div>
  `;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="execObAllocate('${order.id}')">チェック行を全数引当</button>
  `;
  openModal('出荷引当 - ' + (order.slip_no || order.id.slice(0, 8)), body, footer, true);
  obRecalcAllocPlan();
}

function obToggleAllAlloc(el) {
  document.querySelectorAll('#obAllocBody .oba-check').forEach(c => { if (!c.disabled) c.checked = el.checked; });
  obRecalcAllocPlan();
}

// チェック状態に応じてFIFO引当プランを再計算し、行表示を更新
function obRecalcAllocPlan() {
  _obAllocPlan = {};
  const usedMap = {};   // inventory_id → 使用数
  document.querySelectorAll('#obAllocBody .ob-alloc-line').forEach(tr => {
    const itemId = tr.dataset.itemId;
    const productId = tr.dataset.productId;
    const planned = parseInt(tr.dataset.planned) || 0;
    const checked = tr.querySelector('.oba-check').checked;
    const planEl = tr.querySelector('.oba-plan');
    const stEl = tr.querySelector('.oba-status');

    if (!checked) {
      planEl.textContent = '—';
      stEl.innerHTML = '<span style="color:var(--text3);">対象外</span>';
      return;
    }

    let remaining = planned;
    const plan = [];
    (_obAllocCandidates[productId] || []).forEach(inv => {
      if (remaining <= 0) return;
      const avail = inv.available_qty - (usedMap[inv.id] || 0);
      if (avail <= 0) return;
      const take = Math.min(avail, remaining);
      plan.push({ inventory_id: inv.id, qty: take, label: inv.location_code + ' / ' + (inv.lot_no || 'ロット無') + ' × ' + take });
      usedMap[inv.id] = (usedMap[inv.id] || 0) + take;
      remaining -= take;
    });

    if (remaining > 0) {
      // 全数を賄えない → 引当不可（全数一括のため部分引当はしない）
      plan.forEach(a => { usedMap[a.inventory_id] -= a.qty; });
      planEl.textContent = '—';
      stEl.innerHTML = '<span style="color:var(--red);font-weight:700;">在庫不足 ' + remaining + '</span>';
      _obAllocPlan[itemId] = null;
    } else {
      planEl.textContent = plan.map(a => a.label).join('、');
      stEl.innerHTML = '<span style="color:var(--green);font-weight:700;">OK</span>';
      _obAllocPlan[itemId] = plan;
    }
  });
}

async function execObAllocate(orderId) {
  obRecalcAllocPlan();

  const allocations = [];
  let shortage = 0;
  let checkedCount = 0;
  document.querySelectorAll('#obAllocBody .ob-alloc-line').forEach(tr => {
    if (!tr.querySelector('.oba-check').checked) return;
    checkedCount++;
    const plan = _obAllocPlan[tr.dataset.itemId];
    if (!plan) { shortage++; return; }
    plan.forEach(a => allocations.push({ item_id: tr.dataset.itemId, inventory_id: a.inventory_id, qty: a.qty }));
  });

  if (!checkedCount) { toast('引当する明細にチェックを付けてください', 'error'); return; }
  if (shortage > 0) { toast('在庫不足の明細があります。チェックを外すか在庫を補充してください', 'error'); return; }
  if (!allocations.length) { toast('引当対象がありません', 'error'); return; }

  if (!confirm('チェックした明細を全数引当します。在庫が引き落とされ、取消はできません。よろしいですか？')) return;

  const { error } = await sb.rpc('fn_outbound_allocate', {
    p_order_id: orderId,
    p_allocations: allocations,
  });
  if (error) { toast('引当失敗: ' + error.message, 'error'); return; }

  closeModal();
  toast('引当を確定し在庫を引き落としました');
  await loadOutbound();

  // ④ 引当完了後はピッキングリストを自動出力
  await obPrintPickingList(orderId);
}

// ---------- 在庫ピッキングリスト (A4横・引当内容) ----------
async function obPrintPickingList(orderId) {
  const { data: order } = await sb.from('outbound_orders')
    .select('*, clients(name, code), outbound_items(*, products(sku, name, jan_code), outbound_allocations(qty, inventory(lot_no, expiry, locations(code))))')
    .eq('id', orderId).single();
  if (!order) { toast('出庫データの取得に失敗しました', 'error'); return; }

  // 引当行をフラット化し、ピッキング動線順(ロケコード順)に並べる
  const lines = [];
  (order.outbound_items || []).forEach(it => {
    const p = it.products || {};
    (it.outbound_allocations || []).forEach(a => {
      lines.push({
        loc: a.inventory?.locations?.code || '—',
        lot: a.inventory?.lot_no || '',
        expiry: a.inventory?.expiry ? String(a.inventory.expiry).slice(0, 10) : '',
        jan: p.jan_code || p.sku || '',
        name: p.name || '',
        qty: a.qty,
      });
    });
  });
  if (!lines.length) { toast('引当がありません', 'error'); return; }
  lines.sort((a, b) => a.loc.localeCompare(b.loc));

  const clientName = order.clients?.name || order.customer || '—';
  const slip = order.slip_no || order.id.slice(0, 8);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const rows = lines.map((l, i) => '<tr>'
    + '<td class="num">' + (i + 1) + '</td>'
    + '<td class="mono emph">' + esc(l.loc) + '</td>'
    + '<td class="mono emph">' + esc(l.jan) + '</td>'
    + '<td class="emph">' + esc(l.name) + '</td>'
    + '<td class="mono emph">' + (esc(l.lot) || '—') + '</td>'
    + '<td class="mono">' + (l.expiry || '—') + '</td>'
    + '<td class="num emph">' + l.qty.toLocaleString() + '</td>'
    + '<td class="chk">□</td>'
  + '</tr>').join('');

  const body = '<div class="sheet">'
    + '<div class="hd">'
      + '<div>'
        + '<h1>在庫ピッキングリスト</h1>'
        + '<div class="meta" style="margin-top:8px;">'
          + '<div><b>伝票番号</b> <span class="mono">' + esc(slip) + '</span></div>'
          + '<div><b>出荷先</b> ' + esc(clientName) + '</div>'
          + '<div><b>出荷予定日</b> ' + fmtDate(order.planned_date) + '</div>'
          + '<div><b>引当日時</b> ' + new Date().toLocaleString('ja-JP') + '</div>'
        + '</div>'
      + '</div>'
    + '</div>'
    + '<table><thead><tr>'
      + '<th class="num" style="width:28px;">No</th><th style="width:110px;">ロケーション</th><th style="width:140px;">JANコード</th>'
      + '<th>商品名</th><th style="width:110px;">ロットNo</th><th style="width:90px;">期限</th>'
      + '<th class="num" style="width:80px;">数量</th><th class="chk">✓</th>'
    + '</tr></thead><tbody>' + rows + '</tbody>'
    + '<tfoot><tr><th colspan="6" style="text-align:right;">合計</th><th class="num" style="font-size:14px;">' + totalQty.toLocaleString() + '</th><th></th></tr></tfoot></table>'
    + '<div class="sig">'
      + '<div class="sigbox">ピッキング者</div>'
      + '<div class="sigbox">検品者</div>'
    + '</div>'
    + '<div class="foot"><span>SUPEREX LogiStation</span><span>出力: ' + new Date().toLocaleString('ja-JP') + '</span></div>'
  + '</div>';

  _ibOpenPrintWindow('ピッキングリスト_' + slip, body);
}

// ---------- 出荷確定 (ステータス確定のみ・在庫は引当時に控除済み) ----------
async function openObShipAllocated(orderId) {
  const { data: order } = await sb.from('outbound_orders')
    .select('*, outbound_items(*, products(sku, name), outbound_allocations(qty, inventory(id, lot_no, expiry, locations(code))))')
    .eq('id', orderId).single();
  if (!order) { toast('出庫データの取得に失敗しました', 'error'); return; }

  const rows = (order.outbound_items || []).filter(it => it.status === 'picked').flatMap(it =>
    (it.outbound_allocations || []).map(a => `<tr>
      <td>${esc(it.products?.name || '')}</td>
      <td style="font-family:var(--mono);font-size:11px;">${esc(a.inventory?.locations?.code || '—')}</td>
      <td style="font-family:var(--mono);font-size:11px;">${esc(a.inventory?.lot_no) || '—'}</td>
      <td style="font-family:var(--mono);text-align:right;font-weight:700;">${a.qty}</td>
    </tr>`)
  ).join('');

  if (!rows) { toast('出荷確定できる引当済み明細がありません', 'error'); return; }

  const body = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">以下の内容で出荷済みにします（在庫は引当時に引き落とし済み）。</div>
    <div class="tw"><table>
      <thead><tr><th>商品名</th><th>ロケ</th><th>ロット</th><th style="text-align:right;">数量</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="execObShipAllocated('${order.id}')">出荷確定</button>
  `;
  openModal('出荷確定 - ' + (order.slip_no || order.id.slice(0, 8)), body, footer);
}

async function execObShipAllocated(orderId) {
  const { data, error } = await sb.rpc('fn_outbound_ship_allocated', { p_order_id: orderId });
  if (error) { toast('出荷確定失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast((data?.shipped_items || 0) + '明細を出荷済みにしました');
  await loadOutbound();
}
