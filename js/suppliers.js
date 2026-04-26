// =====================================================================
// LogiCore WMS - suppliers.js
// 仕入先マスタ: 一覧 / 検索 / 新規 / 編集
// =====================================================================

RENDER_FNS.suppliers = async function renderSuppliers() {
  const el = document.getElementById('page-suppliers');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="sbar" style="max-width:320px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="supSearch" placeholder="コード / 仕入先名で検索..." oninput="filterSuppliers()">
      </div>
      ${isAdmin() ? '<button class="btn btn-p" onclick="openSupplierModal()">+ 仕入先追加</button>' : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>コード</th><th>仕入先名</th><th class="hm">担当者</th><th class="hm">電話</th><th class="hm">メール</th><th>状態</th>${isAdmin() ? '<th>操作</th>' : ''}</tr></thead>
      <tbody id="supTb"></tbody>
    </table></div></div>
  `;
  await loadSuppliers();
};

let _suppliers = [];

async function loadSuppliers() {
  const { data } = await sb.from('suppliers').select('*').order('code');
  _suppliers = data || [];
  filterSuppliers();
}

function filterSuppliers() {
  const q = (document.getElementById('supSearch')?.value || '').toLowerCase();
  const filtered = q
    ? _suppliers.filter(s => (s.code + s.name).toLowerCase().includes(q))
    : _suppliers;
  const tb = document.getElementById('supTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(s => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(s.code)}</td>
        <td>${esc(s.name)}</td>
        <td class="hm">${esc(s.contact) || '—'}</td>
        <td class="hm" style="font-family:var(--mono);font-size:11px;">${esc(s.phone) || '—'}</td>
        <td class="hm" style="font-size:11px;">${esc(s.email) || '—'}</td>
        <td>${s.is_active ? '<span class="badge bg">有効</span>' : '<span class="badge bgr">無効</span>'}</td>
        ${isAdmin() ? `<td><button class="btn btn-g btn-sm" onclick="openSupplierModal('${s.id}')">編集</button></td>` : ''}
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty-state">仕入先が見つかりません</td></tr>';
}

function openSupplierModal(id) {
  const s = id ? _suppliers.find(x => x.id === id) : null;
  const title = s ? '仕入先編集' : '仕入先追加';
  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">仕入先コード *</div><input class="fi" id="sm_code" value="${esc(s?.code || '')}" ${s ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">仕入先名 *</div><input class="fi" id="sm_name" value="${esc(s?.name || '')}"></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">担当者</div><input class="fi" id="sm_contact" value="${esc(s?.contact || '')}"></div>
      <div class="fl"><div class="flbl">電話番号</div><input class="fi" id="sm_phone" value="${esc(s?.phone || '')}"></div>
    </div>
    <div class="fl"><div class="flbl">メールアドレス</div><input class="fi" id="sm_email" type="email" value="${esc(s?.email || '')}"></div>
    <div class="fl">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="sm_active" ${s?.is_active !== false ? 'checked' : ''}>
        <span style="font-size:12px;">有効</span>
      </label>
    </div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveSupplier('${s?.id || ''}')">保存</button>
  `;
  openModal(title, body, footer);
}

async function saveSupplier(id) {
  const d = {
    code: document.getElementById('sm_code').value.trim(),
    name: document.getElementById('sm_name').value.trim(),
    contact: document.getElementById('sm_contact').value.trim() || null,
    phone: document.getElementById('sm_phone').value.trim() || null,
    email: document.getElementById('sm_email').value.trim() || null,
    is_active: document.getElementById('sm_active').checked,
  };
  if (!d.code || !d.name) { toast('コードと仕入先名は必須です', 'error'); return; }

  let err;
  if (id) {
    const res = await sb.from('suppliers').update(d).eq('id', id);
    err = res.error;
  } else {
    const res = await sb.from('suppliers').insert(d);
    err = res.error;
  }
  if (err) { toast('保存失敗: ' + err.message, 'error'); return; }
  closeModal();
  toast(id ? '仕入先を更新しました' : '仕入先を追加しました');
  await loadSuppliers();
}
