// =====================================================================
// LogiCore WMS - stocktake.js
// 棚卸: 指示 / カウント / レビュー / 確定
// レポート / ユーザー管理
// =====================================================================

// ========================= 棚卸 =========================

RENDER_FNS.stocktake = async function renderStocktake() {
  const el = document.getElementById('page-stocktake');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;">
      <div class="tabs" style="max-width:360px;">
        <div class="tab active" onclick="setStTab('all',this)">全て</div>
        <div class="tab" onclick="setStTab('counting',this)">カウント中</div>
        <div class="tab" onclick="setStTab('done',this)">完了</div>
      </div>
      ${isAdmin() ? '<button class="btn btn-p" onclick="openStocktakeModal()">+ 棚卸指示</button>' : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>名称</th><th>対象ゾーン</th><th>予定日</th><th>進捗</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="stTb"></tbody>
    </table></div></div>
  `;
  await loadStocktakes();
};

let _stocktakes = [];
let _stTabFilter = 'all';

function setStTab(tab, tabEl) {
  _stTabFilter = tab;
  document.querySelectorAll('#page-stocktake .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderStTable();
}

async function loadStocktakes() {
  const { data } = await sb.from('stocktakes')
    .select('*, stocktake_items(id, counted_qty)')
    .order('created_at', { ascending: false });
  _stocktakes = data || [];
  renderStTable();
}

function renderStTable() {
  let filtered = _stocktakes;
  if (_stTabFilter !== 'all') filtered = filtered.filter(s => s.status === _stTabFilter);
  const tb = document.getElementById('stTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(s => {
        const items = s.stocktake_items || [];
        const total = items.length;
        const counted = items.filter(i => i.counted_qty !== null).length;
        const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
        return `<tr>
          <td style="font-weight:500;">${esc(s.name)}</td>
          <td><span class="badge bgr">${esc(s.scope_zone) || '全ゾーン'}</span></td>
          <td style="font-family:var(--mono);font-size:11px;">${fmtDate(s.planned_date)}</td>
          <td style="width:120px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="pb" style="flex:1;"><div class="pf" style="width:${pct}%;background:var(--accent);"></div></div>
              <span style="font-family:var(--mono);font-size:10px;color:var(--text2);">${counted}/${total}</span>
            </div>
          </td>
          <td>${statusBadge(s.status)}</td>
          <td>
            ${s.status === 'counting' && isOperator() ? `<button class="btn btn-p btn-sm" onclick="openStCount('${s.id}')">カウント</button>` : ''}
            ${(s.status === 'counting' || s.status === 'reviewing') && isAdmin() ? `<button class="btn btn-g btn-sm" onclick="openStReview('${s.id}')">レビュー</button>` : ''}
            ${s.status === 'draft' && isAdmin() ? `<button class="btn btn-p btn-sm" onclick="startStocktake('${s.id}')">開始</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty-state">棚卸データがありません</td></tr>';
}

function openStocktakeModal() {
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">棚卸名 *</div><input class="fi" id="st_name" placeholder="2026年4月A棚"></div>
    <div class="fr">
      <div class="fl"><div class="flbl">対象ゾーン（空=全ゾーン）</div><input class="fi" id="st_zone" placeholder="A"></div>
      <div class="fl"><div class="flbl">予定日</div><input class="fi" id="st_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveStocktake()">作成</button>
  `;
  openModal('棚卸指示作成', body, footer);
}

async function saveStocktake() {
  const name = document.getElementById('st_name').value.trim();
  const zone = document.getElementById('st_zone').value.trim() || null;
  const date = document.getElementById('st_date').value || null;
  if (!name) { toast('名称は必須です', 'error'); return; }

  const { error } = await sb.from('stocktakes').insert({
    name, scope_zone: zone, planned_date: date, status: 'draft', created_by: App.user?.id,
  });
  if (error) { toast('作成失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('棚卸指示を作成しました');
  await loadStocktakes();
}

async function startStocktake(id) {
  if (!confirm('棚卸を開始します。在庫のスナップショットを生成しますか？')) return;
  const { data, error } = await sb.rpc('fn_stocktake_snapshot', { p_stocktake: id });
  if (error) { toast('開始失敗: ' + error.message, 'error'); return; }
  toast(`棚卸開始: ${data}行のスナップショットを生成しました`);
  await loadStocktakes();
}

async function openStCount(id) {
  const { data: items } = await sb.from('stocktake_items')
    .select('*, products(sku, name), locations(code)')
    .eq('stocktake_id', id)
    .order('locations(code)');

  if (!items || !items.length) { toast('カウント対象がありません', 'error'); return; }

  const rows = items.map((it, i) => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px;">${esc(it.locations?.code)}</td>
      <td style="font-size:11px;">${esc(it.products?.sku)}</td>
      <td style="font-size:11px;">${esc(it.products?.name)}</td>
      <td style="font-family:var(--mono);">${it.system_qty}</td>
      <td><input class="fi stc-qty" type="number" min="0" value="${it.counted_qty ?? ''}" data-item-id="${it.id}" style="width:70px;padding:5px;"></td>
    </tr>
  `).join('');

  const body = `
    <p style="font-size:11px;color:var(--text2);margin-bottom:10px;">各ロケーションの実数を入力してください。</p>
    <div class="tw"><table>
      <thead><tr><th>ロケーション</th><th>SKU</th><th>商品名</th><th>システム在庫</th><th>実数</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">閉じる</button>
    <button class="btn btn-p" onclick="saveStCount('${id}')">カウント保存</button>
  `;
  openModal('棚卸カウント', body, footer);
}

async function saveStCount(stocktakeId) {
  const inputs = document.querySelectorAll('.stc-qty');
  let saved = 0;
  for (const inp of inputs) {
    const val = inp.value.trim();
    if (val === '') continue;
    const qty = parseInt(val);
    if (isNaN(qty) || qty < 0) continue;
    const { error } = await sb.from('stocktake_items').update({
      counted_qty: qty,
      counted_by: App.user?.id,
      counted_at: new Date().toISOString(),
    }).eq('id', inp.dataset.itemId);
    if (!error) saved++;
  }
  closeModal();
  toast(`${saved}行のカウントを保存しました`);
  await loadStocktakes();
}

async function openStReview(id) {
  const st = _stocktakes.find(s => s.id === id);
  const { data: items } = await sb.from('stocktake_items')
    .select('*, products(sku, name), locations(code)')
    .eq('stocktake_id', id)
    .order('locations(code)');

  if (!items) return;
  const diffs = items.filter(i => i.counted_qty !== null && i.diff !== 0);
  const total = items.length;
  const counted = items.filter(i => i.counted_qty !== null).length;

  const rows = (diffs.length ? diffs : items).map(it => {
    const hasDiff = it.counted_qty !== null && it.diff !== 0;
    return `<tr style="${hasDiff ? 'background:rgba(255,211,42,.05);' : ''}">
      <td style="font-family:var(--mono);font-size:11px;">${esc(it.locations?.code)}</td>
      <td style="font-size:11px;">${esc(it.products?.sku)}</td>
      <td>${esc(it.products?.name)}</td>
      <td style="font-family:var(--mono);">${it.system_qty}</td>
      <td style="font-family:var(--mono);${it.counted_qty !== null ? 'color:var(--accent);' : ''}">${it.counted_qty ?? '未カウント'}</td>
      <td style="font-family:var(--mono);font-weight:700;color:${it.diff > 0 ? 'var(--accent)' : it.diff < 0 ? 'var(--red)' : 'var(--text2)'};">${it.diff !== 0 ? (it.diff > 0 ? '+' : '') + it.diff : '—'}</td>
    </tr>`;
  }).join('');

  const body = `
    <div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;">
      <div>カウント進捗: <strong>${counted}/${total}</strong></div>
      <div>差異あり: <strong style="color:var(--yellow);">${diffs.length}行</strong></div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>ロケーション</th><th>SKU</th><th>商品名</th><th>システム</th><th>実数</th><th>差異</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
  const footer = `
    <button class="btn btn-g btn-sm" onclick="exportStocktakeCSV('${id}')">差異CSV</button>
    <button class="btn btn-g" onclick="closeModal()">閉じる</button>
    ${isAdmin() ? `<button class="btn btn-p" onclick="confirmStocktake('${id}')">棚卸確定</button>` : ''}
  `;
  openModal('棚卸レビュー - ' + esc(st?.name || ''), body, footer);
}

async function confirmStocktake(id) {
  if (!confirm('棚卸を確定し、差異分を在庫に反映しますか？この操作は元に戻せません。')) return;
  const { data, error } = await sb.rpc('fn_stocktake_confirm', { p_stocktake: id });
  if (error) { toast('確定失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast(`棚卸確定: ${data}行の在庫を調整しました`);
  await loadStocktakes();
}

async function exportStocktakeCSV(id) {
  const { data: items } = await sb.from('stocktake_items')
    .select('*, products(sku, name), locations(code)')
    .eq('stocktake_id', id);
  if (!items) return;
  const header = ['ロケーション', 'SKU', '商品名', 'ロット', '期限', 'システム在庫', '実数', '差異'];
  const rows = items.map(it => [
    it.locations?.code, it.products?.sku, it.products?.name,
    it.lot_no, it.expiry || '', it.system_qty, it.counted_qty ?? '', it.diff || 0,
  ]);
  downloadCSV('wms_stocktake_' + id.slice(0, 8) + '.csv', header, rows);
  toast('棚卸差異CSVをダウンロードしました');
}

// ========================= レポート =========================

RENDER_FNS.reports = function renderReports() {
  const el = document.getElementById('page-reports');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">
      <div class="card">
        <div class="card-hd"><div class="card-title">在庫一覧</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">現在の在庫を全件CSVエクスポート</p>
          <button class="btn btn-p" onclick="go('inventory');setTimeout(()=>exportInventoryCSV(),500)">在庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">入庫履歴</div></div>
        <div class="card-body">
          <div class="fl mb12"><div class="flbl">期間</div>
            <div class="fr"><input class="fi" id="rptIbFrom" type="date"><input class="fi" id="rptIbTo" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <button class="btn btn-p" onclick="exportInboundCSV()">入庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">出庫履歴</div></div>
        <div class="card-body">
          <div class="fl mb12"><div class="flbl">期間</div>
            <div class="fr"><input class="fi" id="rptObFrom" type="date"><input class="fi" id="rptObTo" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <button class="btn btn-p" onclick="exportOutboundCSV()">出庫CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">商品マスタ</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">全商品のマスタデータ</p>
          <button class="btn btn-p" onclick="go('products');setTimeout(()=>exportProductsCSV(),500)">商品CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">ロケーション</div></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">全ロケーションのマスタデータ</p>
          <button class="btn btn-p" onclick="go('locations');setTimeout(()=>exportLocationsCSV(),500)">ロケCSV</button>
        </div>
      </div>
    </div>
  `;
};

async function exportInboundCSV() {
  const from = document.getElementById('rptIbFrom')?.value;
  const to = document.getElementById('rptIbTo')?.value;
  let q = sb.from('inbound_orders').select('*, inbound_items(*, products(sku, name))').order('created_at', { ascending: false });
  if (from) q = q.gte('planned_date', from);
  if (to) q = q.lte('planned_date', to);
  const { data } = await q;
  const header = ['伝票No', '仕入先', '予定日', '状態', 'SKU', '商品名', '予定数', '実数'];
  const rows = [];
  (data || []).forEach(o => {
    (o.inbound_items || []).forEach(it => {
      rows.push([o.slip_no, o.supplier, o.planned_date, o.status, it.products?.sku, it.products?.name, it.planned_qty, it.received_qty]);
    });
  });
  downloadCSV('wms_inbound_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('入庫履歴CSVをダウンロードしました');
}

async function exportOutboundCSV() {
  const from = document.getElementById('rptObFrom')?.value;
  const to = document.getElementById('rptObTo')?.value;
  let q = sb.from('outbound_orders').select('*, outbound_items(*, products(sku, name))').order('created_at', { ascending: false });
  if (from) q = q.gte('planned_date', from);
  if (to) q = q.lte('planned_date', to);
  const { data } = await q;
  const header = ['伝票No', '出荷先', '予定日', '状態', 'SKU', '商品名', '予定数', 'ピック済'];
  const rows = [];
  (data || []).forEach(o => {
    (o.outbound_items || []).forEach(it => {
      rows.push([o.slip_no, o.customer, o.planned_date, o.status, it.products?.sku, it.products?.name, it.planned_qty, it.picked_qty]);
    });
  });
  downloadCSV('wms_outbound_' + new Date().toISOString().slice(0, 10) + '.csv', header, rows);
  toast('出庫履歴CSVをダウンロードしました');
}

// ========================= ユーザー管理 =========================

RENDER_FNS.users = async function renderUsers() {
  const el = document.getElementById('page-users');
  if (!isAdmin()) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🔒</div><p>管理者のみアクセスできます</p></div>';
    return;
  }
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:13px;">
      <button class="btn btn-p" onclick="openUserModal()">+ ユーザー追加</button>
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>社員番号</th><th>表示名</th><th>ロール</th><th>最終ログイン</th><th>ロック</th><th>操作</th></tr></thead>
      <tbody id="usersTb"></tbody>
    </table></div></div>
  `;
  await loadUsers();
};

let _users = [];

async function loadUsers() {
  const { data } = await sb.from('profiles').select('*').order('employee_number');
  _users = data || [];
  const tb = document.getElementById('usersTb');
  if (!tb) return;
  const roleBadge = r => r === 'admin' ? '<span class="badge br">管理者</span>' : r === 'operator' ? '<span class="badge bg">オペレータ</span>' : '<span class="badge bgr">閲覧者</span>';
  tb.innerHTML = _users.length
    ? _users.map(u => `<tr>
        <td style="font-family:var(--mono);">${esc(u.employee_number)}</td>
        <td>${esc(u.display_name) || '—'}</td>
        <td>${roleBadge(u.role)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text2);">${u.last_login_at ? fmtDate(u.last_login_at) + ' ' + fmtTime(u.last_login_at) : '—'}</td>
        <td>${u.is_locked ? '<span class="badge br">ロック中</span>' : u.locked_until && new Date(u.locked_until) > new Date() ? '<span class="badge by">一時ロック</span>' : '<span class="badge bg">正常</span>'}</td>
        <td>
          <button class="btn btn-g btn-sm" onclick="openUserEditModal('${u.id}')">編集</button>
          ${u.is_locked || (u.locked_until && new Date(u.locked_until) > new Date()) ? `<button class="btn btn-p btn-sm" onclick="unlockUser('${u.id}')">解除</button>` : ''}
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty-state">ユーザーがいません</td></tr>';
}

function openUserModal() {
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">社員番号 *</div><input class="fi" id="um_emp" placeholder="E00002"></div>
    <div class="fl"><div class="flbl">表示名</div><input class="fi" id="um_name" placeholder="山田 太郎"></div>
    <div class="fl"><div class="flbl">ロール</div><select class="fs" id="um_role">
      <option value="viewer">閲覧者</option>
      <option value="operator">オペレータ</option>
      <option value="admin">管理者</option>
    </select></div>
    <div class="fl"><div class="flbl">初期パスワード（数字5桁）</div><input class="fi" id="um_pin" placeholder="12345" maxlength="5" inputmode="numeric"></div>
    <p style="font-size:11px;color:var(--text2);">※ Supabase Dashboard の Authentication > Users で手動作成後、ここで社員番号を紐づけてください。自動作成は Edge Function が必要です。</p>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="toast('Edge Function 未実装のため、supabase/README.md の手順で作成してください','error');closeModal();">作成</button>
  `;
  openModal('ユーザー追加', body, footer);
}

function openUserEditModal(id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  const body = `<div class="fg">
    <div class="fl"><div class="flbl">社員番号</div><input class="fi" value="${esc(u.employee_number)}" readonly style="opacity:.6;"></div>
    <div class="fl"><div class="flbl">表示名</div><input class="fi" id="ue_name" value="${esc(u.display_name || '')}"></div>
    <div class="fl"><div class="flbl">ロール</div><select class="fs" id="ue_role">
      <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>閲覧者</option>
      <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>オペレータ</option>
      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者</option>
    </select></div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveUserEdit('${u.id}')">保存</button>
  `;
  openModal('ユーザー編集 - ' + esc(u.employee_number), body, footer);
}

async function saveUserEdit(id) {
  const name = document.getElementById('ue_name').value.trim();
  const role = document.getElementById('ue_role').value;
  const { error } = await sb.from('profiles').update({ display_name: name || null, role }).eq('id', id);
  if (error) { toast('保存失敗: ' + error.message, 'error'); return; }
  closeModal();
  toast('ユーザーを更新しました');
  await loadUsers();
}

async function unlockUser(id) {
  const { error } = await sb.from('profiles').update({
    is_locked: false, locked_until: null, failed_count: 0,
  }).eq('id', id);
  if (error) { toast('解除失敗: ' + error.message, 'error'); return; }
  toast('ロックを解除しました');
  await loadUsers();
}
