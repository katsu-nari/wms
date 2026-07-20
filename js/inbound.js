// =====================================================================
// SUPEREX LogiStation - inbound.js
// 入荷処理: 一覧 / 新規登録 / 詳細 / 検品 / 棚入れ完了
// =====================================================================

RENDER_FNS.inbound = async function renderInbound() {
  const el = document.getElementById('page-inbound');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <div class="tabs" id="ibTabs" style="max-width:400px;">
        <div class="tab active" onclick="setIbTab('all',this)">全て</div>
        <div class="tab" onclick="setIbTab('pending',this)">受付待ち</div>
        <div class="tab" onclick="setIbTab('done',this)">完了</div>
      </div>
      ${isOperator() ? '<button class="btn btn-p" onclick="openInboundModal()">+ 入荷登録</button>' : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:13px;flex-wrap:wrap;">
      <div class="sbar" style="max-width:340px;flex:1;min-width:180px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="ibSearch" value="${esc(_ibSearch)}" placeholder="入荷先コード / 伝票番号 で検索..." oninput="filterInbound()">
      </div>
      <input class="fi" id="ibDateFrom" placeholder="開始日 例:6/5" style="width:108px;font-size:12px;" value="${_ibDateFrom ? _ibDateFrom.replace(/-/g, '/') : ''}" onchange="ibDateRangeChanged()">
      <span style="color:var(--text2);">〜</span>
      <input class="fi" id="ibDateTo" placeholder="終了日 例:6/30" style="width:108px;font-size:12px;" value="${_ibDateTo ? _ibDateTo.replace(/-/g, '/') : ''}" onchange="ibDateRangeChanged()">
      <button class="btn btn-g btn-sm" onclick="clearInboundSearch()">クリア</button>
      <span style="font-size:10px;color:var(--text3);">※過去の伝票は検索または日付指定で表示</span>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>伝票No</th><th class="hm">入荷先</th><th>入荷予定日</th><th class="hm">明細</th><th>予定数</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="ibTb"></tbody>
    </table></div></div>
  `;
  await loadInbound();
};

let _ibOrders = [];
let _ibTabFilter = 'all';
let _ibSearch = '';
let _ibDateFrom = '';   // 検索範囲 開始日 (ISO)
let _ibDateTo = '';     // 検索範囲 終了日 (ISO)
let _ibSuppliers = [];
let _ibProducts = [];

// 「6/5」等の短縮日付をISO(2026-06-05)へ変換。年省略時は今年を補完。
// 対応: 6/5, 06-05, 2026/6/5, 2026-06-05, 20260605, 6月5日, Excelシリアル値
function ibParseShortDate(v) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v)) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  const s = String(v).trim();
  if (!s) return null;
  // Excelシリアル値 (1900年起点)
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  let m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) {
    const mo = parseInt(m[1]), da = parseInt(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const y = new Date().getFullYear();
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
    }
  }
  return null;
}

// 検索用日付入力: 短縮入力を変換して「2026/06/05」形式で表示
function ibApplyShortDate(el) {
  if (!el) return null;
  const raw = el.value.trim();
  if (!raw) return null;
  const iso = ibParseShortDate(raw);
  if (!iso) { toast('日付の形式が不正です: ' + raw + '（例: 6/5）', 'error'); el.value = ''; return null; }
  el.value = iso.replace(/-/g, '/');
  return iso;
}

function ibDateRangeChanged() {
  _ibDateFrom = ibApplyShortDate(document.getElementById('ibDateFrom')) || '';
  _ibDateTo = ibApplyShortDate(document.getElementById('ibDateTo')) || '';
  if (_ibDateFrom && _ibDateTo && _ibDateFrom > _ibDateTo) {
    toast('開始日が終了日より後になっています', 'error');
  }
  renderIbTable();
}

function setIbTab(tab, tabEl) {
  _ibTabFilter = tab;
  document.querySelectorAll('#ibTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderIbTable();
}

function filterInbound() {
  _ibSearch = (document.getElementById('ibSearch')?.value || '').trim();
  renderIbTable();
}

function clearInboundSearch() {
  _ibSearch = '';
  _ibDateFrom = '';
  _ibDateTo = '';
  const el = document.getElementById('ibSearch');
  if (el) el.value = '';
  const f = document.getElementById('ibDateFrom');
  if (f) f.value = '';
  const t = document.getElementById('ibDateTo');
  if (t) t.value = '';
  renderIbTable();
}

async function loadInbound() {
  const { data, error } = await sb.from('inbound_orders')
    .select('*, suppliers(name, code), inbound_items(id, product_id, planned_qty, received_qty, status)')
    .order('created_at', { ascending: false });
  if (error) { toast('入荷一覧の読み込みに失敗しました: ' + error.message, 'error'); }
  _ibOrders = data || [];
  renderIbTable();
}

function renderIbTable() {
  let filtered = _ibOrders;
  if (_ibTabFilter !== 'all') {
    filtered = filtered.filter(o => o.status === _ibTabFilter);
  }
  // 検索: 入荷予定日 / 入荷先コード / 伝票番号 のいずれかに部分一致
  const q = (_ibSearch || '').toLowerCase();
  if (q) {
    filtered = filtered.filter(o => {
      const slip = (o.slip_no || '').toLowerCase();
      const date = (o.planned_date || '').toLowerCase();
      const supCode = (o.suppliers?.code || '').toLowerCase();
      const supName = (o.suppliers?.name || o.supplier || '').toLowerCase();
      return slip.includes(q) || date.includes(q) || supCode.includes(q) || supName.includes(q);
    });
  }
  // 日付範囲検索: 開始日〜終了日（過去から未来まで指定可）
  if (_ibDateFrom) filtered = filtered.filter(o => o.planned_date && o.planned_date.slice(0, 10) >= _ibDateFrom);
  if (_ibDateTo) filtered = filtered.filter(o => o.planned_date && o.planned_date.slice(0, 10) <= _ibDateTo);
  // 検索も日付指定もない通常表示では、入荷予定日が過去の伝票は非表示
  if (!q && !_ibDateFrom && !_ibDateTo) {
    const today = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter(o => !o.planned_date || o.planned_date.slice(0, 10) >= today);
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
            ${o.status === 'pending' && isOperator() ? `<button class="btn btn-g btn-sm" onclick="openInboundModal('${o.id}')">修正</button>` : ''}
            ${o.status !== 'done' && o.status !== 'canceled' && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openIbPutaway('${o.id}')">棚入れ</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" class="empty-state">${(_ibSearch || _ibTabFilter !== 'all') ? '該当する入荷データがありません' : '入荷データがありません'}</td></tr>`;
}

let _ibRowSeq = 0;
let _ibEditOrderId = null;   // 修正入力中の入荷ID（null=新規登録）

async function openInboundModal(orderId) {
  const [supRes, prodRes] = await Promise.all([
    sb.from('suppliers').select('id, code, name').eq('is_active', true).order('code'),
    sb.from('products').select('id, sku, name, jan_code, cost_price, sell_price, pack_size').is('deleted_at', null).order('sku'),
  ]);
  _ibSuppliers = supRes.data || [];
  _ibProducts = prodRes.data || [];
  _ibRowSeq = 0;
  _ibEditOrderId = null;

  // 修正入力: 既存データを取得（棚入れ着手済みは修正不可）
  let editOrder = null;
  if (orderId) {
    const { data: o, error } = await sb.from('inbound_orders')
      .select('*, inbound_items(*)')
      .eq('id', orderId).single();
    if (error || !o) { toast('入荷データの取得に失敗しました', 'error'); return; }
    if (o.status !== 'pending' || (o.inbound_items || []).some(it => (it.received_qty || 0) > 0 || it.status !== 'pending')) {
      toast('棚入れ（入荷計上）済みの明細があるため修正できません', 'error');
      return;
    }
    editOrder = o;
    _ibEditOrderId = orderId;
  }

  const supOpts = _ibSuppliers.map(s => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');

  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">伝票番号</div><input class="fi" id="ib_slip" placeholder="自動採番（空可）" value="${esc(editOrder?.slip_no || '')}"></div>
      <div class="fl"><div class="flbl">仕入先 *</div><select class="fs" id="ib_supplier"><option value="">選択してください</option>${supOpts}</select></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">入荷予定日</div><input class="fi" id="ib_date" type="date" value="${editOrder?.planned_date ? editOrder.planned_date.slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      <div class="fl"><div class="flbl">備考</div><input class="fi" id="ib_note" placeholder="メモ" value="${esc(editOrder?.note || '')}"></div>
    </div>
    <hr style="border-color:var(--border);">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <div class="flbl" style="margin:0;">明細行（1伝票につき最大10行）</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-g btn-sm" onclick="ibDownloadTemplate()">テンプレート</button>
        <label class="btn btn-g btn-sm" style="cursor:pointer;margin:0;">CSV / Excel取込<input type="file" accept=".csv,.xlsx,.xls" onchange="ibHandleImportFile(this)" style="display:none;"></label>
        <button class="btn btn-g btn-sm" onclick="ibAddRow()">＋ 行追加</button>
      </div>
    </div>
    <div class="tw"><table style="min-width:800px;">
      <thead><tr>
        <th style="width:34px;"></th>
        <th style="width:120px;">JANコード</th>
        <th>商品名</th>
        <th style="width:90px;">ロットNo</th>
        <th style="width:80px;">原単価</th>
        <th style="width:80px;">売単価</th>
        <th style="width:60px;">入数</th>
        <th style="width:70px;">ケース数</th>
        <th style="width:70px;">ピース数</th>
        <th style="width:70px;">総ピース</th>
      </tr></thead>
      <tbody id="ibItemsBody"></tbody>
    </table></div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveInbound()">${editOrder ? '修正を保存' : '登録'}</button>
  `;
  openModal(editOrder ? '入荷修正 - ' + (editOrder.slip_no || editOrder.id.slice(0, 8)) : '入荷登録', body, footer, true);

  if (editOrder) {
    // 既存明細をプリフィル
    document.getElementById('ib_supplier').value = editOrder.supplier_id || '';
    const its = editOrder.inbound_items || [];
    its.forEach(it => ibPrefillRow(it));
    if (!its.length) ibAddRow();
  } else {
    // 初期空行を5行表示
    for (let k = 0; k < 5; k++) ibAddRow();
  }
}

// 修正入力: 既存明細を行にプリフィル（上限より多い既存伝票も全行表示）
function ibPrefillRow(it) {
  const i = ibAddRow(true);
  if (i < 0) return;
  const prod = _ibProducts.find(p => p.id === it.product_id);
  const janInput = document.querySelector('#ibRow' + i + ' .ib-jan');
  if (janInput) janInput.value = prod?.jan_code || '';
  const pnameEl = document.getElementById('ibPname' + i);
  pnameEl.textContent = prod ? prod.name : '(商品マスタ未登録)';
  pnameEl.style.color = prod ? 'var(--text)' : 'var(--red)';
  document.getElementById('ibPid' + i).value = it.product_id;
  document.getElementById('ibLot' + i).value = it.lot_no || '';
  if (it.cost_price != null) document.getElementById('ibCost' + i).value = it.cost_price;
  if (it.sell_price != null) document.getElementById('ibSell' + i).value = it.sell_price;
  const pack = it.pack_size || prod?.pack_size || 1;
  let caseQ = it.case_qty || 0;
  let pieceQ = it.piece_qty || 0;
  // 保存値の内訳が総数と合わない場合は総数をピース数として表示
  if (caseQ * pack + pieceQ !== it.planned_qty) { caseQ = 0; pieceQ = it.planned_qty; }
  document.getElementById('ibPack' + i).value = pack;
  document.getElementById('ibCase' + i).value = caseQ || '';
  document.getElementById('ibPiece' + i).value = pieceQ || '';
  ibCalcTotal(i);
}

function ibRowInnerHtml(i) {
  return `
    <td style="padding:4px 6px;text-align:center;"><button class="btn btn-g btn-sm" style="padding:2px 7px;" onclick="ibRemoveRow(${i})" title="行を削除">×</button></td>
    <td style="padding:4px 3px;"><input class="fi ib-jan" style="font-size:11px;padding:5px 6px;width:110px;" placeholder="JAN" data-row="${i}" onchange="ibJanLookup(${i})"></td>
    <td style="padding:4px 3px;"><span class="ib-pname" id="ibPname${i}" style="font-size:11px;color:var(--text2);">—</span><input type="hidden" class="ib-pid" id="ibPid${i}"></td>
    <td style="padding:4px 3px;"><input class="fi ib-lot" id="ibLot${i}" style="font-size:11px;padding:5px 6px;width:84px;" placeholder="ロット"></td>
    <td style="padding:4px 3px;"><input class="fi ib-cost" id="ibCost${i}" style="font-size:11px;padding:5px 6px;width:74px;" type="number" step="0.01"></td>
    <td style="padding:4px 3px;"><input class="fi ib-sell" id="ibSell${i}" style="font-size:11px;padding:5px 6px;width:74px;" type="number" step="0.01"></td>
    <td style="padding:4px 3px;"><input class="fi ib-pack" id="ibPack${i}" style="font-size:11px;padding:5px 6px;width:54px;" type="number" min="1" value="1" oninput="ibCalcTotal(${i})"></td>
    <td style="padding:4px 3px;"><input class="fi ib-case" id="ibCase${i}" style="font-size:11px;padding:5px 6px;width:60px;" type="number" min="0" value="" oninput="ibCalcTotal(${i})"></td>
    <td style="padding:4px 3px;"><input class="fi ib-piece" id="ibPiece${i}" style="font-size:11px;padding:5px 6px;width:60px;" type="number" min="0" value="" oninput="ibCalcTotal(${i})"></td>
    <td style="padding:4px 3px;font-family:var(--mono);font-size:11px;font-weight:700;" id="ibTotal${i}">—</td>`;
}

const IB_MAX_ROWS = 10;   // 1伝票あたりの明細上限

function ibAddRow(force) {
  const tbody = document.getElementById('ibItemsBody');
  if (!tbody) return -1;
  // 上限チェック（既存伝票の修正時プリフィルは force=true で回避）
  if (!force && tbody.querySelectorAll('.ib-row').length >= IB_MAX_ROWS) {
    toast('1伝票につき明細は' + IB_MAX_ROWS + '行までです', 'error');
    return -1;
  }
  const i = _ibRowSeq++;
  const tr = document.createElement('tr');
  tr.id = 'ibRow' + i;
  tr.className = 'ib-row';
  tr.dataset.row = i;
  tr.innerHTML = ibRowInnerHtml(i);
  tbody.appendChild(tr);
  return i;
}

function ibRemoveRow(i) {
  const tr = document.getElementById('ibRow' + i);
  if (tr) tr.remove();
  // 全行が消えたら空行を1行残す
  const tbody = document.getElementById('ibItemsBody');
  if (tbody && tbody.querySelectorAll('.ib-row').length === 0) ibAddRow();
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
    pnameEl.style.color = 'var(--text2)';
    pidEl.value = '';
    costEl.value = '';
    sellEl.value = '';
    packEl.value = 1;
    ibCalcTotal(row);
    return;
  }

  const prod = _ibProducts.find(p => p.jan_code === jan);
  if (prod) {
    pnameEl.textContent = prod.name;
    pnameEl.style.color = 'var(--text)';
    pidEl.value = prod.id;
    if (prod.cost_price != null) costEl.value = prod.cost_price;
    if (prod.sell_price != null) sellEl.value = prod.sell_price;
    // 商品マスタに入数があれば初期値として設定（手動で変更可）
    packEl.value = prod.pack_size || 1;
    ibCalcTotal(row);
  } else {
    // マスタ未登録でも手動で入数を入力できるよう入力欄は維持
    pnameEl.textContent = '該当なし';
    pnameEl.style.color = 'var(--red)';
    pidEl.value = '';
  }
}

function ibCalcTotal(row) {
  const packEl = document.getElementById('ibPack' + row);
  const caseEl = document.getElementById('ibCase' + row);
  const pieceEl = document.getElementById('ibPiece' + row);
  const totalEl = document.getElementById('ibTotal' + row);

  const packSize = parseInt(packEl.value) || 1;
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
  const rowEls = document.querySelectorAll('#ibItemsBody .ib-row');
  rowEls.forEach(function(tr) {
    const i = tr.dataset.row;
    const pid = document.getElementById('ibPid' + i).value;
    const caseQty = parseInt(document.getElementById('ibCase' + i).value) || 0;
    const pieceQty = parseInt(document.getElementById('ibPiece' + i).value) || 0;
    const packSize = parseInt(document.getElementById('ibPack' + i).value) || 1;
    const totalQty = caseQty * packSize + pieceQty;
    if (!pid || totalQty <= 0) return;

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
      lot_no: (document.getElementById('ibLot' + i)?.value || '').trim(),
    });
  });
  if (!items.length) { toast('明細を1行以上入力してください（商品と数量が必要です）', 'error'); return; }
  if (!_ibEditOrderId && items.length > IB_MAX_ROWS) {
    toast('1伝票につき明細は' + IB_MAX_ROWS + '行までです', 'error');
    return;
  }

  const supplierName = supplierId
    ? (_ibSuppliers.find(s => s.id === supplierId)?.name || null)
    : null;

  // ---------- 修正入力（既存入荷の更新） ----------
  if (_ibEditOrderId) {
    // 保存直前に棚入れ未着手を再確認（他端末での更新に備える）
    const { data: cur } = await sb.from('inbound_items')
      .select('id, received_qty, status').eq('order_id', _ibEditOrderId);
    if ((cur || []).some(it => (it.received_qty || 0) > 0 || it.status !== 'pending')) {
      toast('棚入れ（入荷計上）が開始されたため修正できません', 'error');
      return;
    }

    const { error: uErr } = await sb.from('inbound_orders')
      .update({ slip_no: slip, supplier: supplierName, supplier_id: supplierId, planned_date: date, note })
      .eq('id', _ibEditOrderId);
    if (uErr) { toast('更新失敗: ' + uErr.message, 'error'); return; }

    const { error: dErr } = await sb.from('inbound_items').delete().eq('order_id', _ibEditOrderId);
    if (dErr) { toast('明細更新失敗: ' + dErr.message, 'error'); return; }

    const { error: riErr } = await sb.from('inbound_items')
      .insert(items.map(it => ({ order_id: _ibEditOrderId, ...it })));
    if (riErr) { toast('明細登録失敗: ' + riErr.message, 'error'); return; }

    closeModal();
    toast('入荷を修正しました');
    _ibEditOrderId = null;
    await loadInbound();
    return;
  }

  // ---------- 新規登録 ----------
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
  toast('入荷を登録しました');
  await loadInbound();
}

// ---------- CSV / Excel 取込 ----------

// 取込テンプレート（明細列）。数量はケース数×入数＋ピース数で総ピースを算出。
// 入数が空欄の場合は商品マスタの入数を使用。
function ibDownloadTemplate() {
  const header = ['伝票番号', '入荷日', '入荷先コード', 'JANコード', 'ケース数', 'ピース数', '入数', '原単価', '売単価', 'ロットNo'];
  const sample = ['IN-0001', '6/5', 'SUP001', '4901234567890', '5', '3', '24', '', '', 'LOT2026A'];
  const ws = XLSX.utils.aoa_to_sheet([header, sample]);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '入荷明細');
  XLSX.writeFile(wb, '入荷明細テンプレート.xlsx');
  toast('テンプレートをダウンロードしました');
}

async function ibHandleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';
  try {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) { toast('データ行がありません', 'error'); return; }
    const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null));
    if (!dataRows.length) { toast('データ行がありません', 'error'); return; }
    ibImportRows(dataRows);
  } catch (e) {
    toast('ファイルの読み込みに失敗しました: ' + e.message, 'error');
  }
}

function _ibLooksLikeJan(v) {
  v = String(v == null ? '' : v).trim();
  return /^\d{8}$|^\d{13}$/.test(v);
}

function ibImportRows(dataRows) {
  // 列レイアウト判定:
  //   新: 伝票番号 | 入荷日 | 入荷先コード | JAN | ケース | ピース | 入数 | 原単価 | 売単価 | ロットNo
  //   旧: JAN | ケース | ピース | 入数 | 原単価 | 売単価 | ロットNo （互換読み込み）
  const first = dataRows[0] || [];
  const isNewFormat = _ibLooksLikeJan(first[3]) || !_ibLooksLikeJan(first[0]);
  const COL = isNewFormat
    ? { slip: 0, date: 1, sup: 2, jan: 3, cas: 4, pcs: 5, pack: 6, cost: 7, sell: 8, lot: 9 }
    : { slip: -1, date: -1, sup: -1, jan: 0, cas: 1, pcs: 2, pack: 3, cost: 4, sell: 5, lot: 6 };

  // ヘッダ項目（伝票番号・入荷日・入荷先）を先頭行から反映
  let headerSlip = '';
  if (isNewFormat) {
    headerSlip = String(first[COL.slip] == null ? '' : first[COL.slip]).trim();
    const dISO = ibParseShortDate(first[COL.date]);
    const supCode = String(first[COL.sup] == null ? '' : first[COL.sup]).trim();
    if (headerSlip) document.getElementById('ib_slip').value = headerSlip;
    if (dISO) document.getElementById('ib_date').value = dISO;
    if (supCode) {
      const sup = _ibSuppliers.find(s => (s.code || '').toLowerCase() === supCode.toLowerCase());
      if (sup) document.getElementById('ib_supplier').value = sup.id;
      else toast('入荷先コードがマスタに見つかりません: ' + supCode, 'error');
    }
  }

  // 既存の空行（JAN未入力）を除去してから取込結果を追加
  document.querySelectorAll('#ibItemsBody .ib-row').forEach(function(tr) {
    const i = tr.dataset.row;
    const jan = (document.querySelector('#ibRow' + i + ' .ib-jan')?.value || '').trim();
    if (!jan) tr.remove();
  });

  let added = 0;
  let notFound = 0;
  let otherSlip = 0;
  let overflow = 0;
  dataRows.forEach(function(r) {
    const jan = String(r[COL.jan] == null ? '' : r[COL.jan]).trim();
    if (!jan) return;

    // 別伝票番号の行は対象外（1伝票=1取込）
    if (isNewFormat && headerSlip) {
      const rowSlip = String(r[COL.slip] == null ? '' : r[COL.slip]).trim();
      if (rowSlip && rowSlip !== headerSlip) { otherSlip++; return; }
    }

    // 明細上限（1伝票10行）
    if (document.querySelectorAll('#ibItemsBody .ib-row').length >= IB_MAX_ROWS) { overflow++; return; }

    const caseQty = parseInt(r[COL.cas]) || 0;
    const pieceQty = parseInt(r[COL.pcs]) || 0;
    const packOverride = (r[COL.pack] !== '' && r[COL.pack] != null) ? parseInt(r[COL.pack]) : null;
    const cost = (r[COL.cost] !== '' && r[COL.cost] != null) ? parseFloat(r[COL.cost]) : null;
    const sell = (r[COL.sell] !== '' && r[COL.sell] != null) ? parseFloat(r[COL.sell]) : null;
    const lot = String(r[COL.lot] == null ? '' : r[COL.lot]).trim();

    const i = ibAddRow(true);
    if (i < 0) return;
    const janInput = document.querySelector('#ibRow' + i + ' .ib-jan');
    janInput.value = jan;
    ibJanLookup(i); // マスタ照合で商品名・入数・単価を設定

    const prod = _ibProducts.find(p => p.jan_code === jan);
    if (!prod) notFound++;

    // 取込値で上書き（指定がある項目のみ）
    if (packOverride != null && !isNaN(packOverride) && packOverride > 0) {
      document.getElementById('ibPack' + i).value = packOverride;
    }
    if (cost != null && !isNaN(cost)) document.getElementById('ibCost' + i).value = cost;
    if (sell != null && !isNaN(sell)) document.getElementById('ibSell' + i).value = sell;
    if (lot) document.getElementById('ibLot' + i).value = lot;
    document.getElementById('ibCase' + i).value = caseQty || '';
    document.getElementById('ibPiece' + i).value = pieceQty || '';
    ibCalcTotal(i);
    added++;
  });

  if (added === 0) { ibAddRow(); toast('取込対象の行がありませんでした', 'error'); return; }

  let msg = added + '行を取り込みました';
  const warns = [];
  if (notFound > 0) warns.push(notFound + '行は商品マスタ未登録のため登録対象外');
  if (otherSlip > 0) warns.push('別伝票番号の' + otherSlip + '行を除外（伝票 ' + headerSlip + ' のみ取込）');
  if (overflow > 0) warns.push('明細上限' + IB_MAX_ROWS + '行を超える' + overflow + '行を除外');
  if (warns.length) msg += '（' + warns.join(' / ') + '）';
  toast(msg, warns.length ? 'error' : 's');
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
      <thead><tr><th>JAN</th><th>商品名</th><th>ロット</th><th>予定</th><th>実数</th><th>格納先</th><th>状態</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.products?.jan_code || it.products?.sku)}</td>
        <td>${esc(it.products?.name)}</td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.lot_no) || '—'}</td>
        <td style="font-family:var(--mono);">${it.planned_qty}</td>
        <td style="font-family:var(--mono);${it.received_qty > 0 ? 'color:var(--accent);' : ''}">${it.received_qty || '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(it.locations?.code) || '—'}</td>
        <td>${statusBadge(it.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;
  // フッター: 状態に応じた操作・帳票印刷ボタン
  const canEdit = order.status === 'pending' && items.every(it => (it.received_qty || 0) === 0 && it.status === 'pending');
  const hasReceived = items.some(it => (it.received_qty || 0) > 0);
  let footer = '';
  if (isOperator()) {
    if (canEdit) footer += `<button class="btn btn-g" onclick="closeModal();openInboundModal('${order.id}')">修正</button>`;
    footer += `<button class="btn btn-g" onclick="ibPrintInspectionList('${order.id}')">検品リスト印刷</button>`;
    if (hasReceived) {
      footer += `<button class="btn btn-g" onclick="ibPrintReceivingList('${order.id}')">計上リスト印刷</button>`;
      footer += `<button class="btn btn-g" onclick="ibPrintKanban('${order.id}')">商品看板印刷</button>`;
    }
  }
  footer += '<button class="btn btn-g" onclick="closeModal()">閉じる</button>';
  openModal('入荷詳細 ' + (order.slip_no || order.id.slice(0, 8)), body, footer);
}

let _ibPutawayOrderId = null;  // 棚入れ中の入荷ID（完了後の帳票印刷に使用）

async function openIbPutaway(orderId) {
  const { data: order } = await sb.from('inbound_orders')
    .select('*, inbound_items(*, products(sku, name))')
    .eq('id', orderId).single();
  if (!order) return;
  _ibPutawayOrderId = orderId;

  const pending = (order.inbound_items || []).filter(it => it.status !== 'done');
  if (!pending.length) { toast('全明細が完了済みです'); return; }

  const { data: locs } = await sb.from('locations').select('id, code').eq('is_active', true).order('code');
  // 入荷計上の初期ロケーションは入荷仮置き場 N-8888-888
  const IB_DEFAULT_LOC = 'N-8888-888';
  const locOpts = (locs || []).map(l => `<option value="${l.id}"${l.code === IB_DEFAULT_LOC ? ' selected' : ''}>${esc(l.code)}</option>`).join('');

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
    if (error) {
      // 途中失敗でも成功済み行は確定しているため、画面を最新化してから通知
      closeModal();
      await loadInbound();
      toast((ok > 0 ? ok + '行完了後に' : '') + '棚入れ失敗: ' + error.message, 'error');
      return;
    }
    ok++;
  }
  closeModal();
  toast(ok + '行の入荷計上を完了しました');
  await loadInbound();

  // 計上完了後: 帳票印刷の案内モーダル
  const oid = _ibPutawayOrderId;
  if (oid && ok > 0) {
    openModal('入荷計上 完了',
      '<div style="text-align:center;padding:12px 0;">'
        + '<div style="font-size:15px;font-weight:600;margin-bottom:6px;color:var(--green);">✓ ' + ok + '行の入荷計上が完了しました</div>'
        + '<div style="font-size:12px;color:var(--text2);">続けて帳票を印刷できます</div>'
      + '</div>',
      '<button class="btn btn-g" onclick="closeModal()">閉じる</button>'
      + `<button class="btn btn-g" onclick="ibPrintReceivingList('${oid}')">入荷計上リスト</button>`
      + `<button class="btn btn-p" onclick="ibPrintKanban('${oid}')">商品看板</button>`);
  }
}

// =====================================================================
// 帳票印刷 (A4)
//   ・入荷検品リスト  : QR付き。QRスキャンで棚入れ(入荷計上)画面へ
//   ・入荷計上リスト  : 計上実績の一覧
//   ・商品看板        : 商品ごと1枚。商品情報入りQR付き
// =====================================================================

// A4印刷用の共通CSS
const _IB_PRINT_CSS = `
@page { size: 297mm 210mm; margin: 10mm 12mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif; font-size: 12px; color: #111; }
.sheet { page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #111; padding-bottom: 8px; margin-bottom: 8px; }
h1 { font-size: 22px; letter-spacing: .1em; }
.meta { font-size: 12px; line-height: 1.8; }
.meta b { display: inline-block; min-width: 76px; color: #444; font-weight: 500; }
.qr { image-rendering: pixelated; border: 1px solid #999; }
.qr-cap { font-size: 9px; color: #555; text-align: center; margin-top: 3px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #444; padding: 7px 8px; font-size: 11px; text-align: left; }
th { background: #ececec; font-weight: 600; }
td.num, th.num { text-align: right; font-family: "Courier New", monospace; }
.mono { font-family: "Courier New", monospace; }
/* 強調セル: JANコード・商品名・入数・入荷数量・ロットNo */
td.emph { font-size: 15px; font-weight: 700; }
td.emph.num { font-size: 16px; }
.chk { width: 36px; text-align: center; font-size: 15px; }
.fillbox { min-width: 64px; }
.sig { margin-top: 16px; display: flex; gap: 14px; justify-content: flex-end; }
.sigbox { border: 1px solid #444; width: 110px; height: 56px; font-size: 10px; text-align: center; padding-top: 4px; color: #555; }
.foot { margin-top: 10px; font-size: 9.5px; color: #666; display: flex; justify-content: space-between; }
/* 商品看板 (A4横・1商品1枚) */
.kanban { page-break-after: always; border: 4px solid #111; height: 186mm; padding: 10mm 12mm; display: flex; flex-direction: column; }
.kanban:last-child { page-break-after: auto; }
.kb-tag { font-size: 13px; letter-spacing: .3em; border: 1.5px solid #111; display: inline-block; padding: 3px 14px; }
.kb-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6mm; }
.kb-date { font-size: 12px; color: #333; text-align: right; line-height: 1.7; }
.kb-name { font-size: 44px; font-weight: 800; line-height: 1.25; margin-bottom: 4mm; word-break: break-all; }
.kb-code { font-family: "Courier New", monospace; font-size: 22px; font-weight: 700; color: #111; margin-bottom: 5mm; line-height: 1.7; }
.kb-qty { display: flex; align-items: baseline; gap: 16px; border-top: 2.5px solid #111; border-bottom: 2.5px solid #111; padding: 5mm 0; margin-bottom: 5mm; flex-wrap: wrap; }
.kb-qty-num { font-size: 68px; font-weight: 800; font-family: "Courier New", monospace; }
.kb-qty-sub { font-size: 18px; font-weight: 700; color: #111; }
.kb-lot { font-size: 16px; margin-bottom: 3mm; }
.kb-lot b { font-size: 24px; font-family: "Courier New", monospace; margin-left: 10px; }
.kb-loc { font-size: 15px; margin-bottom: 3mm; }
.kb-loc b { font-size: 24px; font-family: "Courier New", monospace; margin-left: 10px; }
.kb-bottom { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; }
.kb-sup { font-size: 13px; color: #333; line-height: 1.8; }
`;

// 印刷ウィンドウを開いて印刷ダイアログを表示
// Blob URL方式: about:blank + document.write では @page(横向き指定) が
// 反映されないブラウザがあるため、正規のHTML文書として読み込ませる。
function _ibOpenPrintWindow(title, bodyHtml) {
  const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>' + esc(title) + '</title>'
    + '<style>' + _IB_PRINT_CSS + '</style></head><body>' + bodyHtml
    + '<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 300); });<\/script>'
    + '</body></html>';
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    toast('ポップアップがブロックされました。ブラウザの設定で許可してください', 'error');
    return;
  }
  setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
}

// 帳票用に入荷データ一式を取得
async function _ibFetchOrderForPrint(orderId) {
  const { data: order, error } = await sb.from('inbound_orders')
    .select('*, suppliers(code, name), inbound_items(*, products(sku, name, jan_code, unit), locations(code))')
    .eq('id', orderId).single();
  if (error || !order) { toast('入荷データの取得に失敗しました', 'error'); return null; }
  return order;
}

// ---------- ② 入荷検品リスト (A4・QR付き) ----------
async function ibPrintInspectionList(orderId) {
  const order = await _ibFetchOrderForPrint(orderId);
  if (!order) return;
  const items = order.inbound_items || [];
  const supplierName = order.suppliers?.name || order.supplier || '—';
  const supplierCode = order.suppliers?.code || '';
  const slip = order.slip_no || order.id.slice(0, 8);

  // このQRをスキャン画面で読むと棚入れ(入荷計上)画面が開く
  const qrContent = JSON.stringify({ type: 'inbound_order', id: order.id, slip_no: order.slip_no || '' });
  const qrImg = _generateQrDataUrl(qrContent, 6);

  const rows = items.map((it, i) => {
    const p = it.products || {};
    return '<tr>'
      + '<td class="num">' + (i + 1) + '</td>'
      + '<td class="mono emph">' + esc(p.jan_code || p.sku || '') + '</td>'
      + '<td class="emph">' + esc(p.name || '') + '</td>'
      + '<td class="mono emph">' + (esc(it.lot_no) || '—') + '</td>'
      + '<td class="num emph">' + (it.pack_size || 1) + '</td>'
      + '<td class="num">' + (it.case_qty || 0) + '</td>'
      + '<td class="num">' + (it.piece_qty || 0) + '</td>'
      + '<td class="num emph">' + it.planned_qty.toLocaleString() + '</td>'
      + '<td class="fillbox">&nbsp;</td>'
      + '<td class="chk">□</td>'
      + '</tr>';
  }).join('');

  const totalQty = items.reduce((s, it) => s + (it.planned_qty || 0), 0);

  const body = '<div class="sheet">'
    + '<div class="hd">'
      + '<div>'
        + '<h1>入荷検品リスト</h1>'
        + '<div class="meta" style="margin-top:8px;">'
          + '<div><b>伝票番号</b> <span class="mono">' + esc(slip) + '</span></div>'
          + '<div><b>入荷先</b> ' + esc(supplierName) + (supplierCode ? ' <span class="mono">(' + esc(supplierCode) + ')</span>' : '') + '</div>'
          + '<div><b>入荷予定日</b> ' + fmtDate(order.planned_date) + '</div>'
          + (order.note ? '<div><b>備考</b> ' + esc(order.note) + '</div>' : '')
        + '</div>'
      + '</div>'
      + '<div style="text-align:center;">'
        + (qrImg ? '<img class="qr" src="' + qrImg + '" style="width:32mm;height:32mm;">' : '')
        + '<div class="qr-cap">スキャンで入荷計上画面へ</div>'
      + '</div>'
    + '</div>'
    + '<table><thead><tr>'
      + '<th class="num" style="width:28px;">No</th><th style="width:150px;">JANコード</th><th>商品名</th>'
      + '<th style="width:110px;">ロットNo</th>'
      + '<th class="num" style="width:58px;">入数</th><th class="num" style="width:52px;">ケース</th><th class="num" style="width:52px;">ピース</th>'
      + '<th class="num" style="width:90px;">入荷数量</th><th style="width:70px;">検品数</th><th class="chk">✓</th>'
    + '</tr></thead><tbody>' + rows + '</tbody>'
    + '<tfoot><tr><th colspan="7" style="text-align:right;">合計</th><th class="num" style="font-size:14px;">' + totalQty.toLocaleString() + '</th><th></th><th></th></tr></tfoot></table>'
    + '<div class="sig">'
      + '<div class="sigbox">検品者</div>'
      + '<div class="sigbox">確認者</div>'
    + '</div>'
    + '<div class="foot"><span>SUPEREX LogiStation</span><span>出力: ' + new Date().toLocaleString('ja-JP') + '</span></div>'
  + '</div>';

  _ibOpenPrintWindow('入荷検品リスト_' + slip, body);
}

// ---------- ③-1 入荷計上リスト (A4) ----------
async function ibPrintReceivingList(orderId) {
  const order = await _ibFetchOrderForPrint(orderId);
  if (!order) return;
  const items = (order.inbound_items || []).filter(it => (it.received_qty || 0) > 0);
  if (!items.length) { toast('計上済みの明細がありません', 'error'); return; }
  const supplierName = order.suppliers?.name || order.supplier || '—';
  const slip = order.slip_no || order.id.slice(0, 8);

  const qrContent = JSON.stringify({ type: 'inbound_order', id: order.id, slip_no: order.slip_no || '' });
  const qrImg = _generateQrDataUrl(qrContent, 6);

  const rows = items.map((it, i) => {
    const p = it.products || {};
    const diff = (it.received_qty || 0) - it.planned_qty;
    return '<tr>'
      + '<td class="num">' + (i + 1) + '</td>'
      + '<td class="mono emph">' + esc(p.jan_code || p.sku || '') + '</td>'
      + '<td class="emph">' + esc(p.name || '') + '</td>'
      + '<td class="mono emph">' + (esc(it.lot_no) || '—') + '</td>'
      + '<td class="num emph">' + (it.pack_size || 1) + '</td>'
      + '<td class="num">' + it.planned_qty.toLocaleString() + '</td>'
      + '<td class="num emph">' + (it.received_qty || 0).toLocaleString() + '</td>'
      + '<td class="num">' + (diff === 0 ? '±0' : (diff > 0 ? '+' + diff : diff)) + '</td>'
      + '<td class="mono">' + esc(it.locations?.code || '—') + '</td>'
      + '</tr>';
  }).join('');

  const totalPlanned = items.reduce((s, it) => s + (it.planned_qty || 0), 0);
  const totalReceived = items.reduce((s, it) => s + (it.received_qty || 0), 0);

  const body = '<div class="sheet">'
    + '<div class="hd">'
      + '<div>'
        + '<h1>入荷計上リスト</h1>'
        + '<div class="meta" style="margin-top:8px;">'
          + '<div><b>伝票番号</b> <span class="mono">' + esc(slip) + '</span></div>'
          + '<div><b>入荷先</b> ' + esc(supplierName) + '</div>'
          + '<div><b>入荷予定日</b> ' + fmtDate(order.planned_date) + '</div>'
          + '<div><b>計上日時</b> ' + new Date().toLocaleString('ja-JP') + '</div>'
        + '</div>'
      + '</div>'
      + '<div style="text-align:center;">'
        + (qrImg ? '<img class="qr" src="' + qrImg + '" style="width:28mm;height:28mm;">' : '')
        + '<div class="qr-cap">入荷伝票QR</div>'
      + '</div>'
    + '</div>'
    + '<table><thead><tr>'
      + '<th class="num" style="width:28px;">No</th><th style="width:150px;">JANコード</th><th>商品名</th>'
      + '<th style="width:110px;">ロットNo</th><th class="num" style="width:58px;">入数</th>'
      + '<th class="num" style="width:70px;">予定数</th><th class="num" style="width:90px;">入荷数量</th>'
      + '<th class="num" style="width:56px;">差異</th><th style="width:96px;">格納ロケ</th>'
    + '</tr></thead><tbody>' + rows + '</tbody>'
    + '<tfoot><tr><th colspan="5" style="text-align:right;">合計</th>'
      + '<th class="num">' + totalPlanned.toLocaleString() + '</th>'
      + '<th class="num" style="font-size:14px;">' + totalReceived.toLocaleString() + '</th>'
      + '<th class="num">' + (totalReceived - totalPlanned === 0 ? '±0' : (totalReceived - totalPlanned > 0 ? '+' : '') + (totalReceived - totalPlanned)) + '</th><th></th></tr></tfoot></table>'
    + '<div class="sig">'
      + '<div class="sigbox">計上者</div>'
      + '<div class="sigbox">承認者</div>'
    + '</div>'
    + '<div class="foot"><span>SUPEREX LogiStation</span><span>出力: ' + new Date().toLocaleString('ja-JP') + '</span></div>'
  + '</div>';

  _ibOpenPrintWindow('入荷計上リスト_' + slip, body);
}

// ---------- ③-2 商品看板 (商品ごと1枚・商品情報QR付き) ----------
async function ibPrintKanban(orderId) {
  const order = await _ibFetchOrderForPrint(orderId);
  if (!order) return;
  // 計上済み明細を優先、なければ全明細（事前貼付け用）
  let items = (order.inbound_items || []).filter(it => (it.received_qty || 0) > 0);
  if (!items.length) items = order.inbound_items || [];
  if (!items.length) { toast('明細がありません', 'error'); return; }
  const supplierName = order.suppliers?.name || order.supplier || '—';
  const slip = order.slip_no || order.id.slice(0, 8);

  const pages = items.map(it => {
    const p = it.products || {};
    const qty = (it.received_qty || 0) > 0 ? it.received_qty : it.planned_qty;
    const pack = it.pack_size || 1;
    const caseQ = pack > 1 ? Math.floor(qty / pack) : 0;
    const pieceQ = pack > 1 ? qty % pack : qty;

    // 商品情報入りQR
    const qrContent = JSON.stringify({
      type: 'product',
      jan_code: p.jan_code || '',
      sku: p.sku || '',
      name: p.name || '',
      lot_no: it.lot_no || '',
      qty: qty,
    });
    const qrImg = _generateQrDataUrl(qrContent, 6);

    return '<div class="kanban">'
      + '<div class="kb-head">'
        + '<span class="kb-tag">商品看板</span>'
        + '<div class="kb-date">入荷日: ' + fmtDate(order.planned_date) + '<br>伝票: <span class="mono">' + esc(slip) + '</span></div>'
      + '</div>'
      + '<div class="kb-name">' + esc(p.name || '(商品名未設定)') + '</div>'
      + '<div class="kb-code">JAN: ' + esc(p.jan_code || '—') + '　SKU: ' + esc(p.sku || '—') + '</div>'
      + '<div class="kb-qty">'
        + '<span class="kb-qty-num">' + qty.toLocaleString() + '</span>'
        + '<span class="kb-qty-sub">' + esc(p.unit || '個')
          + (pack > 1 ? '（入数' + pack + ' × ' + caseQ + 'ケース' + (pieceQ > 0 ? ' ＋ バラ' + pieceQ : '') + '）' : '')
        + '</span>'
      + '</div>'
      + '<div class="kb-lot">ロットNo<b>' + (esc(it.lot_no) || '—') + '</b></div>'
      + '<div class="kb-loc">格納ロケーション<b>' + esc(it.locations?.code || '未定') + '</b></div>'
      + '<div class="kb-bottom">'
        + '<div class="kb-sup">入荷先: ' + esc(supplierName) + '<br><span style="font-size:10px;color:#777;">SUPEREX LogiStation / ' + new Date().toLocaleString('ja-JP') + '</span></div>'
        + '<div style="text-align:center;">'
          + (qrImg ? '<img class="qr" src="' + qrImg + '" style="width:40mm;height:40mm;">' : '')
          + '<div class="qr-cap">商品情報QR</div>'
        + '</div>'
      + '</div>'
    + '</div>';
  }).join('');

  _ibOpenPrintWindow('商品看板_' + slip, pages);
}

// 他端末の作業進捗を自動反映（app.jsの自動リフレッシュに登録）
AUTO_REFRESH_FNS.inbound = loadInbound;
