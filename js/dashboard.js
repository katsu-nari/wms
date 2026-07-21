// =====================================================================
// SUPEREX LogiStation - dashboard.js
// ダッシュボード: KPI / トレンド / アラート / 最近の操作
// =====================================================================

RENDER_FNS.dashboard = async function renderDashboard() {
  const el = document.getElementById('page-dashboard');

  // Initial skeleton
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi g"><div class="kpi-lbl">総在庫数</div><div class="kpi-val" id="kTotalQty">—</div><div class="kpi-sub" id="kTotalSub">読込中...</div></div>
      <div class="kpi b"><div class="kpi-lbl">本日入庫</div><div class="kpi-val" id="kTodayIn">—</div><div class="kpi-sub" id="kTodayInSub">—</div></div>
      <div class="kpi y"><div class="kpi-lbl">本日出庫</div><div class="kpi-val" id="kTodayOut">—</div><div class="kpi-sub" id="kTodayOutSub">—</div></div>
      <div class="kpi r"><div class="kpi-lbl">アラート</div><div class="kpi-val" id="kAlert">—</div><div class="kpi-sub" id="kAlertSub">—</div></div>
    </div>
    <div class="g3 mb12">
      <div class="card">
        <div class="card-hd"><div class="card-title">週次入出庫</div><span style="font-size:10px;color:var(--text2);">過去7日</span></div>
        <div class="card-body">
          <div style="display:flex;gap:12px;margin-bottom:9px;">
            <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);"><div style="width:8px;height:8px;background:var(--accent);border-radius:2px;"></div>入庫</div>
            <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);"><div style="width:8px;height:8px;background:rgba(44,95,158,.45);border-radius:2px;"></div>出庫</div>
          </div>
          <div style="display:flex;gap:3px;align-items:flex-end;height:65px;" id="trendChart"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">アラート</div><span class="badge br" id="alertBadge">0件</span></div>
        <div class="card-body" style="padding:10px;" id="alertList"><div style="text-align:center;color:var(--text3);font-size:12px;padding:16px;">読み込み中...</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-hd"><div class="card-title">最近の操作</div></div>
      <div class="tw"><table><thead><tr><th>種別</th><th>商品名</th><th>数量</th><th>時刻</th><th>状態</th></tr></thead><tbody id="recentTb"></tbody></table></div>
    </div>
  `;

  // ローカル日付(YYYY-MM-DD)。UTC変換による日付ずれを避ける
  const localDate = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const today = localDate(new Date());
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [invRes, ibRes, obRes, mvRes] = await Promise.all([
    sb.from('v_inventory_with_names').select('*'),
    sb.from('inbound_orders').select('*, inbound_items(*)').order('created_at', { ascending: false }).limit(50),
    sb.from('outbound_orders').select('*, outbound_items(*)').order('created_at', { ascending: false }).limit(50),
    // 週次入出庫は実績(在庫移動履歴)から集計: 入荷計上・出荷引当が反映される
    sb.from('inventory_movements').select('type, qty_delta, created_at')
      .gte('created_at', since.toISOString())
      .in('type', ['inbound', 'outbound']),
  ]);

  const inv = invRes.data || [];
  const ibOrders = ibRes.data || [];
  const obOrders = obRes.data || [];
  const movements = mvRes.data || [];

  // 日別実績集計 (入庫=inbound加算合計 / 出庫=outbound控除の絶対値合計)
  const ibD = {}, obD = {};
  const ibCnt = {}, obCnt = {};
  movements.forEach(m => {
    const k = localDate(m.created_at);
    if (m.type === 'inbound') {
      ibD[k] = (ibD[k] || 0) + Math.max(0, m.qty_delta || 0);
      ibCnt[k] = (ibCnt[k] || 0) + 1;
    } else if (m.type === 'outbound') {
      obD[k] = (obD[k] || 0) + Math.abs(Math.min(0, m.qty_delta || 0));
      obCnt[k] = (obCnt[k] || 0) + 1;
    }
  });

  const totalQty = inv.reduce((s, i) => s + (i.qty || 0), 0);
  const low = inv.filter(i => i.qty > 0 && i.low_stock);
  const exp = inv.filter(i => i.expiry && new Date(i.expiry) < new Date(Date.now() + 7 * 864e5));
  const pendingIb = ibOrders.filter(o => o.status === 'pending').length;

  // KPI (本日入庫/出庫は実績ベース)
  document.getElementById('kTotalQty').textContent = totalQty.toLocaleString();
  document.getElementById('kTotalSub').textContent = inv.length + '品種';
  document.getElementById('kTodayIn').textContent = (ibD[today] || 0).toLocaleString();
  document.getElementById('kTodayInSub').textContent = (ibCnt[today] || 0) + '件';
  document.getElementById('kTodayOut').textContent = (obD[today] || 0).toLocaleString();
  document.getElementById('kTodayOutSub').textContent = (obCnt[today] || 0) + '件';

  const alertCount = low.length + exp.length + pendingIb;
  document.getElementById('kAlert').textContent = alertCount;
  document.getElementById('kAlertSub').textContent = alertCount > 0 ? '要対応あり' : '問題なし';

  // Alerts (クリックで該当ページへ遷移: page/q に遷移先と検索語を保持)
  const alerts = [
    ...low.map(i => ({ cls: 'ae', title: '在庫残少', msg: i.product_name + ' / 残' + i.qty + '個', color: 'var(--red)', page: 'inventory', q: i.product_name })),
    ...exp.map(i => ({ cls: 'aw', title: '期限切れ接近', msg: i.product_name + ' / ' + i.expiry, color: 'var(--warn)', page: 'inventory', q: i.product_name })),
    ...ibOrders.filter(o => o.status === 'pending').slice(0, 3).map(o => ({ cls: 'ai', title: '入荷受付待ち', msg: o.slip_no || o.id.slice(0, 8), color: 'var(--blue)', page: 'inbound', q: o.slip_no || '' })),
  ].slice(0, 6);
  window._dashAlerts = alerts;

  document.getElementById('alertBadge').textContent = alertCount + '件';
  document.getElementById('alertList').innerHTML = alerts.length
    ? alerts.map((a, i) => `<div class="al ${a.cls}" style="cursor:pointer;" onclick="dashAlertClick(${i})" title="クリックで該当ページへ"><div class="aldot" style="background:${a.color};"></div><div><div style="font-size:12px;font-weight:500;margin-bottom:1px;">${esc(a.title)}</div><div style="font-size:11px;color:var(--text2);">${esc(a.msg)}</div></div></div>`).join('')
    : '<div style="text-align:center;padding:14px;color:var(--text3);font-size:12px;">アラートなし</div>';

  // Trend chart (7 days) — 実績(在庫移動履歴)ベース。ibD/obD は上で集計済み
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    return localDate(d);
  });
  const maxV = Math.max(...days7.map(d => Math.max(ibD[d] || 0, obD[d] || 0)), 1);
  const dn = ['日', '月', '火', '水', '木', '金', '土'];

  document.getElementById('trendChart').innerHTML = days7.map((d, i) => {
    const hi = Math.max(Math.round(((ibD[d] || 0) / maxV) * 100), 3);
    const ho = Math.max(Math.round(((obD[d] || 0) / maxV) * 100), 3);
    const isT = i === 6;
    return `<div style="flex:1;display:flex;flex-direction:column;gap:2px;align-items:center;">
      <div style="flex:1;display:flex;gap:1px;align-items:flex-end;width:100%;">
        <div style="flex:1;background:${isT ? 'var(--accent)' : 'rgba(44,95,158,.25)'};height:${hi}%;border-radius:2px 2px 0 0;"></div>
        <div style="flex:1;background:${isT ? 'rgba(44,95,158,.7)' : 'rgba(44,95,158,.12)'};height:${ho}%;border-radius:2px 2px 0 0;"></div>
      </div>
      <span style="font-family:var(--mono);font-size:8px;color:${isT ? 'var(--accent)' : 'var(--text3)'};">${isT ? '今日' : dn[new Date(d + 'T12:00:00').getDay()]}</span>
    </div>`;
  }).join('');

  // Recent activity
  const recent = [
    ...ibOrders.slice(0, 5).map(o => ({ tp: '入庫', name: o.slip_no || o.id.slice(0, 8), qty: (o.inbound_items || []).reduce((a, it) => a + (it.planned_qty || 0), 0), t: fmtTime(o.created_at), st: o.status })),
    ...obOrders.slice(0, 5).map(o => ({ tp: '出庫', name: o.slip_no || o.id.slice(0, 8), qty: (o.outbound_items || []).reduce((a, it) => a + (it.planned_qty || 0), 0), t: fmtTime(o.created_at), st: o.status })),
  ].slice(0, 8);

  document.getElementById('recentTb').innerHTML = recent.length
    ? recent.map(r => `<tr>
        <td><span class="badge ${r.tp === '入庫' ? 'bg' : 'bb'}">${r.tp}</span></td>
        <td>${esc(r.name)}</td>
        <td style="font-family:var(--mono);">${r.qty}</td>
        <td style="font-family:var(--mono);color:var(--text2);">${r.t}</td>
        <td>${statusBadge(r.st)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty-state">まだ操作履歴がありません</td></tr>';
};

// アラートをクリックで該当ページへ遷移（検索語を引き継ぐ）
function dashAlertClick(i) {
  const a = (window._dashAlerts || [])[i];
  if (!a) return;
  if (a.page === 'inventory') {
    window._invPendingSearch = a.q || '';
    go('inventory');
  } else if (a.page === 'inbound') {
    if (typeof _ibSearch !== 'undefined') _ibSearch = a.q || '';
    go('inbound');
  }
}

// 他端末の作業進捗を自動反映（app.jsの自動リフレッシュに登録）
AUTO_REFRESH_FNS.dashboard = RENDER_FNS.dashboard;
