// =====================================================================
// SUPEREX LogiStation - inbound-plan-detail.js
// 入荷予定詳細画面
// =====================================================================

RENDER_FNS['inbound-plan-detail'] = async function renderInboundPlanDetail() {
  var el = document.getElementById('page-inbound-plan-detail');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:12px;">読み込み中...</div>';

  var plan = null;

  if (window._ipDetailId) {
    var res = await sb.from('inbound_plans')
      .select('*, clients(name), profiles!inbound_plans_created_by_fkey(display_name, employee_number), inbound_plan_items(*, products(sku, name, jan_code))')
      .eq('id', window._ipDetailId)
      .single();
    plan = res.data;
  } else if (window._ipDetailPlanNo) {
    var res2 = await sb.from('inbound_plans')
      .select('*, clients(name), profiles!inbound_plans_created_by_fkey(display_name, employee_number), inbound_plan_items(*, products(sku, name, jan_code))')
      .eq('plan_no', window._ipDetailPlanNo)
      .single();
    plan = res2.data;
  }

  if (!plan) {
    el.innerHTML = '<div class="empty-state"><div class="icon">&#128270;</div><p>入荷予定が見つかりません</p><button class="btn btn-g" style="margin-top:12px;" onclick="go(\'inbound-plan\')">一覧へ戻る</button></div>';
    return;
  }

  window._ipDetailId = plan.id;
  window._ipDetailPlanNo = plan.plan_no;

  var items = plan.inbound_plan_items || [];
  var clientName = plan.clients?.name || '—';
  var creatorName = plan.profiles?.display_name || plan.profiles?.employee_number || '—';
  var totalSku = items.length;
  var totalPlanned = items.reduce(function(s, it) { return s + (it.planned_qty || 0); }, 0);
  var totalReceived = items.reduce(function(s, it) { return s + (it.received_qty || 0); }, 0);

  var statusLabels = { planned: '予定', receiving: '入荷中', completed: '完了' };
  var statusCls = { planned: 'bb', receiving: 'by', completed: 'bg' };

  var rows = items.map(function(it, i) {
    var p = it.products || {};
    return '<tr>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.jan_code || '—') + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(p.sku || '—') + '</td>'
      + '<td style="font-size:11px;">' + esc(p.name || '—') + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;">' + it.planned_qty + '</td>'
      + '<td style="font-family:var(--mono);text-align:right;">' + (it.received_qty || 0) + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + esc(it.lot_no || '—') + '</td>'
      + '<td style="font-family:var(--mono);font-size:10px;">' + (it.expiry_date ? fmtDate(it.expiry_date) : '—') + '</td>'
      + '</tr>';
  }).join('');

  el.innerHTML = `
    <div style="max-width:800px;margin:0 auto;">
      <div style="margin-bottom:12px;">
        <button class="btn btn-g btn-sm" onclick="go('inbound-plan')">← 一覧へ戻る</button>
      </div>

      <div class="card mb12">
        <div class="card-hd">
          <div>
            <div class="card-title" style="font-size:15px;">${esc(plan.plan_no)}</div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px;">入荷予定詳細</div>
          </div>
          <span class="badge ${statusCls[plan.status] || 'bgr'}">${statusLabels[plan.status] || plan.status}</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">
            <div class="fl"><div class="flbl">入荷予定日</div><div style="font-weight:500;">${fmtDate(plan.planned_date)}</div></div>
            <div class="fl"><div class="flbl">荷主</div><div style="font-weight:500;">${esc(clientName)}</div></div>
            <div class="fl"><div class="flbl">作成者</div><div style="font-weight:500;">${esc(creatorName)}</div></div>
            <div class="fl"><div class="flbl">作成日時</div><div style="font-weight:500;font-family:var(--mono);font-size:11px;">${plan.created_at ? new Date(plan.created_at).toLocaleString('ja-JP') : '—'}</div></div>
          </div>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px;">
        <div class="kpi b"><div class="kpi-lbl">SKU</div><div class="kpi-val">${totalSku}</div></div>
        <div class="kpi y"><div class="kpi-lbl">予定数量</div><div class="kpi-val">${totalPlanned.toLocaleString()}</div></div>
        <div class="kpi g"><div class="kpi-lbl">実績数量</div><div class="kpi-val">${totalReceived.toLocaleString()}</div></div>
      </div>

      ${isOperator() ? `
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn btn-p" onclick="ipPrintPdf('${plan.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          PDF出力
        </button>
        <button class="btn btn-g" onclick="ipShowQrModal('${esc(plan.plan_no)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><rect x="2" y="2" width="8" height="8"/><rect x="14" y="2" width="8" height="8"/><rect x="2" y="14" width="8" height="8"/><path d="M14 14h2v2h-2z"/><path d="M20 14h2v2h-2z"/><path d="M14 20h2v2h-2z"/><path d="M20 20h2v2h-2z"/></svg>
          QR表示
        </button>
        <button class="btn btn-g" onclick="ipShowBarcodeModal('${esc(plan.plan_no)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M3 5v14"/><path d="M6 5v14"/><path d="M9 5v14"/><path d="M12 5v14"/><path d="M15 5v14"/><path d="M18 5v14"/><path d="M21 5v14"/></svg>
          バーコード表示
        </button>
      </div>
      ` : ''}

      <div class="card">
        <div class="card-hd"><div class="card-title">明細一覧</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">${items.length} 件</div></div>
        <div class="card-body" style="padding:0;">
          <div class="tw"><table>
            <thead><tr><th>JAN</th><th>商品コード</th><th>商品名</th><th style="text-align:right;">予定数</th><th style="text-align:right;">実績数</th><th>ロットNo</th><th>賞味期限</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty-state">明細なし</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  `;
};

// ---------- QR / Barcode Modal ----------

function ipShowQrModal(planNo) {
  var qrContent = JSON.stringify({ type: 'inbound_plan', plan_no: planNo, version: 1 });
  var qrImg = _generateQrDataUrl(qrContent);
  var body = '<div style="text-align:center;padding:10px 0;">'
    + (qrImg ? '<img src="' + qrImg + '" style="width:200px;height:200px;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;">' : '<div style="color:var(--red);">QR生成失敗</div>')
    + '<div style="margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--text2);word-break:break-all;">' + esc(qrContent) + '</div>'
    + '</div>';
  openModal('QRコード: ' + planNo, body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}

function ipShowBarcodeModal(planNo) {
  var canvas = document.createElement('canvas');
  var success = false;
  try {
    JsBarcode(canvas, planNo, {
      format: 'CODE128',
      width: 2,
      height: 80,
      displayValue: true,
      fontSize: 14,
      margin: 10,
    });
    success = true;
  } catch (e) {}

  var body = '<div style="text-align:center;padding:10px 0;">'
    + (success ? '<img src="' + canvas.toDataURL('image/png') + '" style="max-width:100%;border:1px solid var(--border);border-radius:6px;">' : '<div style="color:var(--red);">バーコード生成失敗</div>')
    + '<div style="margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--text2);">' + esc(planNo) + '</div>'
    + '</div>';
  openModal('CODE128: ' + planNo, body, '<button class="btn btn-g" onclick="closeModal()">閉じる</button>');
}
