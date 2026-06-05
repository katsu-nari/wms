// =====================================================================
// SUPEREX LogiStation - clients.js
// 荷主マスタ: 一覧 / 検索 / 新規 / 編集 / 無効化
// =====================================================================

RENDER_FNS.clients = async function renderClients() {
  const el = document.getElementById('page-clients');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;gap:8px;flex-wrap:wrap;">
      <div class="sbar" style="max-width:320px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="cliSearch" placeholder="コード / 荷主名で検索..." oninput="filterClients()">
      </div>
      ${isAdmin() ? '<button class="btn btn-p" onclick="openClientModal()">+ 荷主追加</button>' : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>コード</th><th>荷主名</th><th class="hm">担当者</th><th class="hm">電話</th><th class="hm">メール</th><th class="hm">住所</th><th>状態</th>${isAdmin() ? '<th>操作</th>' : ''}</tr></thead>
      <tbody id="cliTb"></tbody>
    </table></div></div>
  `;
  await loadClients();
};

let _clients = [];

async function loadClients() {
  const { data } = await sb.from('clients').select('*').order('code');
  _clients = data || [];
  filterClients();
}

function filterClients() {
  const q = (document.getElementById('cliSearch')?.value || '').toLowerCase();
  const filtered = q
    ? _clients.filter(c => (c.code + c.name).toLowerCase().includes(q))
    : _clients;
  const tb = document.getElementById('cliTb');
  if (!tb) return;
  tb.innerHTML = filtered.length
    ? filtered.map(c => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(c.code)}</td>
        <td>${esc(c.name)}</td>
        <td class="hm">${esc(c.contact) || '—'}</td>
        <td class="hm" style="font-family:var(--mono);font-size:11px;">${esc(c.phone) || '—'}</td>
        <td class="hm" style="font-size:11px;">${esc(c.email) || '—'}</td>
        <td class="hm" style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.address) || '—'}</td>
        <td>${c.is_active ? '<span class="badge bg">有効</span>' : '<span class="badge bgr">無効</span>'}</td>
        ${isAdmin() ? `<td><button class="btn btn-g btn-sm" onclick="openClientModal('${c.id}')">編集</button></td>` : ''}
      </tr>`).join('')
    : '<tr><td colspan="8" class="empty-state">荷主が見つかりません</td></tr>';
}

function openClientModal(id) {
  const c = id ? _clients.find(x => x.id === id) : null;
  const title = c ? '荷主編集' : '荷主追加';
  const body = `<div class="fg">
    <div class="fr">
      <div class="fl"><div class="flbl">荷主コード *</div><input class="fi" id="cm_code" value="${esc(c?.code || '')}" ${c ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="fl"><div class="flbl">荷主名 *</div><input class="fi" id="cm_name" value="${esc(c?.name || '')}"></div>
    </div>
    <div class="fr">
      <div class="fl"><div class="flbl">担当者名</div><input class="fi" id="cm_contact" value="${esc(c?.contact || '')}"></div>
      <div class="fl"><div class="flbl">電話番号</div><input class="fi" id="cm_phone" value="${esc(c?.phone || '')}"></div>
    </div>
    <div class="fl"><div class="flbl">メールアドレス</div><input class="fi" id="cm_email" type="email" value="${esc(c?.email || '')}"></div>
    <div class="fl"><div class="flbl">住所</div><input class="fi" id="cm_address" value="${esc(c?.address || '')}"></div>
    <div class="fl">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="cm_active" ${c?.is_active !== false ? 'checked' : ''}>
        <span style="font-size:12px;">有効</span>
      </label>
    </div>
  </div>`;
  const footer = `
    <button class="btn btn-g" onclick="closeModal()">キャンセル</button>
    <button class="btn btn-p" onclick="saveClient('${c?.id || ''}')">保存</button>
  `;
  openModal(title, body, footer);
}

async function saveClient(id) {
  const d = {
    code: document.getElementById('cm_code').value.trim(),
    name: document.getElementById('cm_name').value.trim(),
    contact: document.getElementById('cm_contact').value.trim() || null,
    phone: document.getElementById('cm_phone').value.trim() || null,
    email: document.getElementById('cm_email').value.trim() || null,
    address: document.getElementById('cm_address').value.trim() || null,
    is_active: document.getElementById('cm_active').checked,
  };
  if (!d.code || !d.name) { toast('コードと荷主名は必須です', 'error'); return; }

  let err;
  if (id) {
    const res = await sb.from('clients').update(d).eq('id', id);
    err = res.error;
  } else {
    const res = await sb.from('clients').insert(d);
    err = res.error;
  }
  if (err) { toast('保存失敗: ' + err.message, 'error'); return; }
  closeModal();
  toast(id ? '荷主を更新しました' : '荷主を追加しました');
  await loadClients();
}
