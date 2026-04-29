// =====================================================================
// SUPEREX LogiStation - app.js
// Supabase 接続 / 認証 / ナビゲーション / 共通ユーティリティ
// =====================================================================

// ---------- Supabase Config ----------
const SB_URL = 'https://fpobnehdqamuqlepfkrf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwb2JuZWhkcWFtdXFsZXBma3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMDIsImV4cCI6MjA5MDc4NzMwMn0._Io2LvqCrqe3ZTmQgNpInu_iNAaCqK8Hn-Xp5Ijsnd8';
const memStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
  removeItem(k) { delete this._d[k]; },
};

let _storage = memStorage;
try { window.sessionStorage.setItem('_t', '1'); window.sessionStorage.removeItem('_t'); _storage = window.sessionStorage; } catch(e) {}

const sb = supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    storage: _storage,
    persistSession: true,
    detectSessionInUrl: false,
  }
});

// ---------- App State ----------
const App = {
  user: null,       // auth.users record
  profile: null,    // profiles row
  role: 'viewer',
  currentPage: 'dashboard',
};

const PAGE_TITLES = {
  dashboard: 'ダッシュボード',
  inventory: '在庫一覧',
  inbound: '入庫処理',
  outbound: '出庫処理',
  move: 'ロケーション移動',
  stocktake: '棚卸',
  products: '商品マスタ',
  locations: 'ロケーション管理',
  suppliers: '仕入先マスタ',
  reports: 'レポート / CSV',
  users: 'ユーザー管理',
};

const RENDER_FNS = {};

// ---------- PIN Input Handler ----------
function initPinInputs() {
  const pins = document.querySelectorAll('.login-pin input');
  pins.forEach((el, i) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0, 1);
      if (el.value && i < pins.length - 1) pins[i + 1].focus();
      if (i === pins.length - 1 && el.value) doLogin();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !el.value && i > 0) {
        pins[i - 1].focus();
        pins[i - 1].value = '';
      }
    });
  });
}

function getPinValue() {
  return Array.from(document.querySelectorAll('.login-pin input'))
    .map(el => el.value).join('');
}

function clearPin() {
  document.querySelectorAll('.login-pin input').forEach(el => el.value = '');
  document.querySelector('.login-pin input').focus();
}

// ---------- Login / Logout ----------
async function doLogin() {
  const empNo = document.getElementById('loginEmp').value.trim().toUpperCase();
  const pin = getPinValue();
  const errEl = document.getElementById('loginErr');
  const btn = document.getElementById('loginBtn');

  errEl.style.display = 'none';

  if (!empNo) { showLoginErr('社員番号を入力してください'); return; }
  if (!/^\d{5}$/.test(pin)) { showLoginErr('パスワードは数字5桁で入力してください'); return; }

  btn.disabled = true;
  btn.textContent = 'ログイン中...';

  try {
    const { data: check } = await sb.rpc('fn_check_login_allowed', { emp: empNo });
    if (check && !check.ok) {
      showLoginErr(check.message);
      btn.disabled = false; btn.textContent = 'ログイン';
      return;
    }

    const email = empNo.toLowerCase() + '@wms.internal';
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pin });

    try { await sb.rpc('fn_record_login_attempt', { emp: empNo, ok: !error }); } catch(e) {}

    if (error) {
      showLoginErr('社員番号またはパスワードが違います');
      clearPin();
      btn.disabled = false; btn.textContent = 'ログイン';
      return;
    }

    App.user = data.user;
    await loadProfile();
    showApp();
  } catch (e) {
    console.error('Login error:', e);
    showLoginErr('接続エラー: ' + (e?.message || JSON.stringify(e)));
    btn.disabled = false; btn.textContent = 'ログイン';
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('loginErr');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doLogout() {
  await sb.auth.signOut();
  App.user = null;
  App.profile = null;
  App.role = 'viewer';
  document.getElementById('appShell').classList.remove('active');
  document.getElementById('loginPage').style.display = '';
  clearPin();
  document.getElementById('loginEmp').value = '';
  document.getElementById('loginErr').style.display = 'none';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = 'ログイン';
}

async function loadProfile() {
  if (!App.user) return;
  const { data } = await sb.from('profiles')
    .select('*')
    .eq('id', App.user.id)
    .single();
  App.profile = data;
  App.role = data?.role || 'viewer';
}

// ---------- App Init ----------
function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').classList.add('active');

  const name = App.profile?.display_name || App.profile?.employee_number || '?';
  const initial = name.slice(0, 1);
  const roleName = { admin: '管理者', operator: 'オペレータ', viewer: '閲覧者' }[App.role] || App.role;

  document.getElementById('sbAvatar').textContent = initial;
  document.getElementById('sbUserName').textContent = name;
  document.getElementById('sbUserRole').textContent = roleName;
  document.getElementById('drAvatar').textContent = initial;
  document.getElementById('drUserName').textContent = name;

  // Show admin-only nav items
  document.querySelectorAll('.nav-item.role-admin').forEach(el => {
    el.style.display = (App.role === 'admin') ? '' : 'none';
  });

  buildDrawerLinks();
  go('dashboard');
}

function buildDrawerLinks() {
  const items = document.querySelectorAll('#sidebarNav .nav-item');
  const container = document.getElementById('drawerLinks');
  container.innerHTML = '';
  items.forEach(el => {
    if (el.style.display === 'none') return;
    const page = el.dataset.page;
    const clone = el.cloneNode(true);
    clone.onclick = () => { go(page); closeDrawer(); };
    container.appendChild(clone);
  });
}

// ---------- Navigation ----------
function go(page, sidebarEl) {
  App.currentPage = page;

  // Pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  if (pg) pg.classList.add('active');

  // Title
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;

  // Sidebar active
  document.querySelectorAll('#sidebarNav .nav-item').forEach(n => n.classList.remove('active'));
  if (sidebarEl) {
    sidebarEl.classList.add('active');
  } else {
    const match = document.querySelector(`#sidebarNav .nav-item[data-page="${page}"]`);
    if (match) match.classList.add('active');
  }

  // Bottom nav active
  document.querySelectorAll('.bnav').forEach(n => n.classList.remove('active'));
  const bn = document.getElementById('bn-' + page);
  if (bn) bn.classList.add('active');

  // Render
  if (RENDER_FNS[page]) RENDER_FNS[page]();
}

// ---------- Drawer ----------
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('dBg').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('dBg').classList.remove('open');
}

// ---------- Modal ----------
function openModal(title, bodyHtml, footerHtml, wide) {
  const m = document.getElementById('modalContent');
  m.classList.toggle('wide', !!wide);
  m.innerHTML = `
    <div class="modal-hd">
      <div class="modal-title">${title}</div>
      <button class="modal-x" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? '<div class="modal-ft">' + footerHtml + '</div>' : ''}
  `;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ---------- Toast ----------
function toast(msg, type) {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'error' ? 'e' : 's');
  t.innerHTML = `<span style="font-size:14px;">${type === 'error' ? '!' : '✓'}</span><span>${msg}</span>`;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ---------- Utility ----------
function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function fmtDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

function fmtTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function statusBadge(status) {
  const map = {
    done: 'bg', shipped: 'bg', putaway: 'bg',
    pending: 'by', draft: 'bgr', counting: 'by', reviewing: 'bb',
    picking: 'by', received: 'bb', inspected: 'bb',
    canceled: 'br',
  };
  const labels = {
    pending: '受付待ち', received: '入荷済', inspected: '検品済',
    putaway: '棚入済', done: '完了', canceled: 'キャンセル',
    picking: 'ピッキング中', shipped: '出荷済',
    draft: '下書き', counting: 'カウント中', reviewing: 'レビュー中',
  };
  const cls = map[status] || 'bgr';
  const lbl = labels[status] || status;
  return `<span class="badge ${cls}">${esc(lbl)}</span>`;
}

function conditionLabel(c) {
  const m = { ambient: '常温', refrigerated: '冷蔵', frozen: '冷凍', hazard: '危険物' };
  return m[c] || c || '—';
}

function downloadCSV(filename, header, rows) {
  const bom = '\uFEFF';
  const csv = bom + header.join(',') + '\n' +
    rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isAdmin() { return App.role === 'admin'; }
function isOperator() { return App.role === 'admin' || App.role === 'operator'; }

// ---------- Barcode Scanner ----------
let _scanner = null;
let _scanCallback = null;

function startScan(callback) {
  _scanCallback = callback;
  const overlay = document.getElementById('scanOverlay');
  const manualInput = document.getElementById('scanManual');
  const statusEl = document.getElementById('scanStatus');
  if (manualInput) manualInput.value = '';
  if (statusEl) statusEl.textContent = 'カメラ起動中...';
  overlay.classList.add('open');

  const readerEl = document.getElementById('scanReader');
  if (readerEl) readerEl.innerHTML = '';

  _scanner = new Html5Qrcode('scanReader');

  const config = {
    fps: 15,
    qrbox: function(vw, vh) {
      return { width: Math.floor(vw * 0.85), height: Math.floor(vh * 0.35) };
    },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.UPC_A,
    ],
  };

  _scanner.start(
    { facingMode: 'environment' },
    config,
    (decodedText) => {
      try { navigator.vibrate([50, 30, 50]); } catch(e) {}
      stopScan();
      if (_scanCallback) _scanCallback(decodedText);
      toast('読み取り: ' + decodedText);
    },
    () => {}
  ).then(() => {
    if (statusEl) statusEl.textContent = 'バーコードを枠内に合わせてください';
  }).catch(err => {
    console.error('Camera error:', err);
    if (statusEl) statusEl.textContent = 'カメラを起動できません。下の入力欄から手動入力してください。';
  });
}

function submitManualScan() {
  const val = (document.getElementById('scanManual')?.value || '').trim();
  if (!val) { toast('コードを入力してください', 'error'); return; }
  stopScan();
  if (_scanCallback) _scanCallback(val);
}

function stopScan() {
  const overlay = document.getElementById('scanOverlay');
  overlay.classList.remove('open');
  if (_scanner) {
    var s = _scanner;
    _scanner = null;
    s.stop().then(() => { try { s.clear(); } catch(e) {} }).catch(() => { try { s.clear(); } catch(e) {} });
  }
}

function scanBtnHtml(onclick) {
  return `<button class="btn-scan" onclick="${onclick}" title="バーコードスキャン"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="16" x2="15" y2="16"/></svg>スキャン</button>`;
}

// ---------- Boot ----------
(async function boot() {
  initPinInputs();

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    App.user = session.user;
    await loadProfile();
    showApp();
  } else {
    document.getElementById('loginPage').style.display = '';
  }
})();
