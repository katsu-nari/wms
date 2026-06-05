// =====================================================================
// SUPEREX LogiStation - scan.js
// スキャン専用画面: 在庫確認 / 入庫受付 / ピッキング
// =====================================================================

let _scanner = null;
let _scanMode = 'check';
let _scanHistory = [];
let _lastScanTime = 0;
let _lastScanCode = '';
let _lastQrContent = '';
let _beepAudioCtx = null;

function _playBeep() {
  var audio = new Audio('sounds/beep.mp3');
  audio.volume = 1.0;
  audio.play().catch(function() {
    try {
      if (!_beepAudioCtx) _beepAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = _beepAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 2400;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  });
}

function _flashSuccess(productName) {
  var el = document.getElementById('scan-reader');
  if (!el) return;
  el.style.outline = '3px solid var(--green)';
  el.style.outlineOffset = '0px';

  var overlay = document.getElementById('scan-flash-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'scan-flash-overlay';
    overlay.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(26,133,74,.92);color:#fff;padding:5px 14px;border-radius:16px;font-size:12px;font-weight:600;white-space:nowrap;pointer-events:none;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(0,0,0,.2);';
    el.parentNode.style.position = 'relative';
    el.parentNode.appendChild(overlay);
  }
  overlay.innerHTML = '<span style="font-size:14px;">&#10003;</span> 読み取り成功' + (productName ? ' <span style="font-weight:400;opacity:.9;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;">' + esc(productName) + '</span>' : '');
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';

  setTimeout(function() {
    el.style.outline = '';
    el.style.outlineOffset = '';
    if (overlay) { overlay.style.opacity = '0'; overlay.style.transition = 'opacity .15s'; }
    setTimeout(function() { if (overlay) overlay.style.display = 'none'; }, 150);
  }, 500);
}

RENDER_FNS.scan = async function renderScan() {
  stopLiveScanner();

  const tabs = isOperator()
    ? `<div class="tab active" id="st-check" onclick="setScanMode('check',this)">在庫確認</div>
       <div class="tab" id="st-inbound" onclick="setScanMode('inbound',this)">入庫受付</div>
       <div class="tab" id="st-pick" onclick="setScanMode('pick',this)">ピッキング</div>`
    : `<div class="tab active" id="st-check" onclick="setScanMode('check',this)">在庫確認</div>`;

  const el = document.getElementById('page-scan');
  el.innerHTML = `
    <div style="max-width:560px;margin:0 auto;">
      <div class="tabs" id="scanTabs">${tabs}</div>

      <div class="card mb12">
        <div class="card-body" style="padding:12px;">
          <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
            <span style="font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:.06em;margin-right:2px;">対応:</span>
            <span class="badge bb">JAN</span>
            <span class="badge bb">EAN-8</span>
            <span class="badge bb">CODE128</span>
            <span class="badge bb">QR</span>
          </div>
          <div id="scan-reader" style="width:100%;border-radius:6px;overflow:hidden;background:#000;min-height:200px;display:flex;align-items:center;justify-content:center;">
            <div style="color:#fff;font-size:12px;text-align:center;padding:20px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px;margin:0 auto 8px;display:block;opacity:.5;"><rect x="2" y="3" width="6" height="6"/><rect x="16" y="3" width="6" height="6"/><rect x="2" y="15" width="6" height="6"/><line x1="22" y1="15" x2="22" y2="21"/><line x1="19" y1="18" x2="22" y2="18"/><line x1="11" y1="3" x2="11" y2="6"/><line x1="9" y1="9" x2="11" y2="9"/><line x1="11" y1="11" x2="11" y2="9"/><line x1="9" y1="3" x2="9" y2="3"/></svg>
              カメラを起動中...
            </div>
          </div>
          <div style="text-align:center;padding:6px 0 2px;font-size:11px;color:var(--text3);">カメラをバーコードへ向けてください</div>
          <div id="scan-cam-err" style="display:none;padding:12px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;margin-top:8px;">
            <div style="font-size:12px;color:var(--red);font-weight:500;margin-bottom:6px;">カメラを使用できません</div>
            <div style="font-size:11px;color:var(--text2);margin-bottom:8px;" id="scan-cam-err-msg">カメラへのアクセスが拒否されました。ブラウザの設定でカメラを許可してください。</div>
            <div style="font-size:11px;color:var(--text2);">▼ 下の手動入力でJANコードを直接入力してください</div>
          </div>
          <div style="margin-top:10px;display:flex;gap:6px;">
            <input class="fi" id="scan-manual-input" placeholder="JANコードを手動入力..." inputmode="numeric"
              style="font-size:14px;font-family:var(--mono);"
              onkeydown="if(event.key==='Enter')submitScanManual()">
            <button class="btn btn-p" onclick="submitScanManual()">検索</button>
          </div>
        </div>
      </div>

      <div id="scan-result-area" style="margin-bottom:12px;"></div>

      <div id="scan-history-area"></div>
    </div>
  `;

  _scanMode = 'check';
  _scanHistory = [];
  startLiveScanner();
};

function setScanMode(mode, tabEl) {
  _scanMode = mode;
  document.querySelectorAll('#scanTabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('scan-result-area').innerHTML = '';
}

async function startLiveScanner() {
  stopLiveScanner();

  const readerEl = document.getElementById('scan-reader');
  if (!readerEl) return;

  readerEl.innerHTML = `<div style="color:#fff;font-size:12px;text-align:center;padding:20px;">カメラを起動中...</div>`;

  const errEl = document.getElementById('scan-cam-err');
  if (errEl) errEl.style.display = 'none';

  try {
    _scanner = new Html5Qrcode('scan-reader');

    var cameras = [];
    try { cameras = await Html5Qrcode.getCameras(); } catch (e) {}

    if (cameras.length > 1) {
      var sel = document.createElement('select');
      sel.className = 'fs';
      sel.id = 'scan-cam-select';
      sel.style.cssText = 'font-size:11px;margin-top:6px;';
      cameras.forEach(function(c) { var o = document.createElement('option'); o.value = c.id; o.textContent = c.label || c.id; sel.appendChild(o); });
      var back = cameras.find(function(c) { return /back|rear|environment/i.test(c.label); });
      if (back) sel.value = back.id;
      sel.onchange = function() { _switchCamera(sel.value); };
      var wrap = readerEl.parentNode;
      var existing = document.getElementById('scan-cam-select');
      if (existing) existing.remove();
      wrap.insertBefore(sel, readerEl.nextSibling);
    }

    var formats = [];
    try {
      formats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
      ];
    } catch (e) {}

    var scanConfig = { fps: 20 };
    if (formats.length) scanConfig.formatsToSupport = formats;

    await _scanner.start(
      { facingMode: { exact: 'environment' } },
      scanConfig,
      function onSuccess(decodedText, decodedResult) { onScanResult(decodedText, decodedResult); },
      function onError() {}
    );
  } catch (e) {
    var msg = e.message || String(e);
    if (msg.includes('NotAllowedError') || msg.includes('permission') || msg.includes('denied')) {
      _handleCameraPermissionDenied(msg);
    } else {
      _handleCameraPermissionDenied(msg);
    }
  }
}

async function _switchCamera(cameraId) {
  if (!_scanner) return;
  try {
    await _scanner.stop();
    var formats = [];
    try {
      formats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
      ];
    } catch (e) {}

    var switchConfig = { fps: 20 };
    if (formats.length) switchConfig.formatsToSupport = formats;

    await _scanner.start(
      cameraId,
      switchConfig,
      function onSuccess(decodedText, decodedResult) { onScanResult(decodedText, decodedResult); },
      function onError() {}
    );
  } catch (e) {
    _handleCameraPermissionDenied(e.message || String(e));
  }
}

function _handleCameraPermissionDenied(msg) {
  stopLiveScanner();
  const readerEl = document.getElementById('scan-reader');
  if (readerEl) {
    readerEl.innerHTML = `
      <div style="color:rgba(255,255,255,.5);font-size:12px;text-align:center;padding:30px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px;margin:0 auto 8px;display:block;opacity:.5;">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        カメラ使用不可
      </div>`;
  }
  const errEl = document.getElementById('scan-cam-err');
  const errMsgEl = document.getElementById('scan-cam-err-msg');
  if (errEl) {
    if (errMsgEl) {
      if (msg && (msg.includes('NotAllowedError') || msg.includes('permission') || msg.includes('denied'))) {
        errMsgEl.textContent = 'カメラへのアクセスが拒否されました。ブラウザのアドレスバー横のアイコンからカメラを許可してください。';
      } else {
        errMsgEl.textContent = 'カメラを起動できませんでした。手動入力をご利用ください。';
      }
    }
    errEl.style.display = 'block';
  }
}

function stopLiveScanner() {
  if (!_scanner) return;
  try {
    var state = _scanner.getState();
    // state 2=SCANNING, 3=PAUSED
    if (state === 2 || state === 3) {
      _scanner.stop().catch(function() {});
    }
  } catch (e) {}
  try { _scanner.clear(); } catch (e) {}
  _scanner = null;
  var camSel = document.getElementById('scan-cam-select');
  if (camSel) camSel.remove();
}

async function onScanResult(code, scanResult) {
  const now = Date.now();
  if (code === _lastScanCode && now - _lastScanTime < 2000) return;
  _lastScanCode = code;
  _lastScanTime = now;

  _playBeep();

  var fmt = scanResult && scanResult.result && scanResult.result.format;
  var isQR = !!(fmt && (fmt.format === 0 || fmt.formatName === 'QR_CODE'));

  const resultEl = document.getElementById('scan-result-area');
  if (resultEl) {
    resultEl.innerHTML = `<div class="card card-body" style="text-align:center;padding:20px;color:var(--text2);font-size:12px;">
      <div style="display:inline-block;width:16px;height:16px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;margin-right:6px;vertical-align:middle;"></div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      商品検索中…</div>`;
  }

  const product = await lookupProduct(code);
  _flashSuccess(product ? product.name : null);

  if (!product) {
    if (isQR) {
      _showQrModal(code);
      addScanHistory(code, null);
      if (resultEl) resultEl.innerHTML = '';
      return;
    }
    toast('商品マスタに存在しません', 'error');
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="card">
          <div class="card-body" style="text-align:center;padding:20px;">
            <div style="font-size:28px;margin-bottom:8px;">❌</div>
            <div style="font-weight:600;color:var(--red);margin-bottom:4px;">商品未登録</div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--text2);">${esc(code)}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:6px;">このコードは商品マスタに登録されていません</div>
          </div>
        </div>`;
    }
    addScanHistory(code, null);
    return;
  }

  addScanHistory(code, product);

  if (_scanMode === 'check') {
    await showCheckResult(product);
  } else if (_scanMode === 'inbound') {
    await showInboundResult(product);
  } else if (_scanMode === 'pick') {
    await showPickResult(product);
  }
}

function _showQrModal(content) {
  _lastQrContent = content;
  var body = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">内容:</div>
    <div style="background:var(--surface2);border-radius:6px;padding:10px 12px;font-family:var(--mono);font-size:13px;word-break:break-all;max-height:160px;overflow-y:auto;border:1px solid var(--border);">${esc(content)}</div>
  `;
  var footer = `
    <button class="btn btn-g" onclick="closeModal()">閉じる</button>
    <button class="btn btn-p" onclick="_copyLastQr()">コピー</button>
  `;
  openModal('QRコードを検出しました', body, footer);
}

function _copyLastQr() {
  _copyText(_lastQrContent);
  closeModal();
}

function _copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function() { toast('コピーしました'); })
      .catch(function() { toast('コピー失敗', 'error'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('コピーしました'); }
    catch (e) { toast('コピー失敗', 'error'); }
    document.body.removeChild(ta);
  }
}

async function lookupProduct(janCode) {
  const { data, error } = await sb.from('products')
    .select('id,sku,name,jan_code,storage_condition')
    .eq('jan_code', janCode)
    .single();
  if (error || !data) return null;
  return data;
}

async function showCheckResult(product) {
  const resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  const { data: inv } = await sb.from('v_inventory_with_names')
    .select('*')
    .eq('product_id', product.id)
    .gt('qty', 0)
    .order('location_code');

  const totalQty = inv ? inv.reduce((s, r) => s + (r.qty || 0), 0) : 0;

  const rows = inv && inv.length
    ? inv.map(r => `<tr>
        <td style="font-family:var(--mono);font-size:11px;">${esc(r.location_code)}</td>
        <td style="text-align:right;font-family:var(--mono);">${r.qty}</td>
        <td style="font-size:11px;">${esc(r.lot_no) || '—'}</td>
        <td style="font-size:11px;">${r.expiry ? fmtDate(r.expiry) : '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="empty-state" style="padding:16px;">在庫なし</td></tr>`;

  resultEl.innerHTML = `
    <div class="card">
      <div class="card-hd">
        <div>
          <div class="card-title">${esc(product.name)}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);">${esc(product.sku)} / JAN:${esc(product.jan_code)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:var(--disp);font-size:22px;font-weight:800;color:var(--accent);">${totalQty}</div>
          <div style="font-size:10px;color:var(--text2);">総在庫</div>
        </div>
      </div>
      <div class="card-body" style="padding:0;">
        <div class="tw">
          <table>
            <thead><tr><th>ロケ</th><th style="text-align:right;">数量</th><th>ロット</th><th>期限</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

async function showInboundResult(product) {
  const resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  const { data: items } = await sb.from('inbound_items')
    .select('id,planned_qty,received_qty,status,lot_no,expiry,inbound_orders!inner(slip_no,planned_date,status),locations(code)')
    .eq('product_id', product.id)
    .in('status', ['pending', 'received'])
    .order('id');

  const { data: locs } = await sb.from('locations')
    .select('id,code')
    .eq('is_active', true)
    .order('code');

  const locOptions = locs ? locs.map(l => `<option value="${esc(l.id)}">${esc(l.code)}</option>`).join('') : '';

  const rows = items && items.length
    ? items.map((it, i) => {
        const ord = it.inbound_orders;
        const remaining = (it.planned_qty || 0) - (it.received_qty || 0);
        return `<div class="card mb12" style="border-left:3px solid var(--accent);">
          <div class="card-body" style="padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-family:var(--mono);font-size:11px;color:var(--text2);">入庫伝票: ${esc(ord?.slip_no)}</div>
                <div style="font-size:11px;color:var(--text2);">予定日: ${fmtDate(ord?.planned_date)}</div>
              </div>
              ${statusBadge(it.status)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;font-size:11px;">
              <div><span style="color:var(--text2);">予定:</span> ${it.planned_qty}</div>
              <div><span style="color:var(--text2);">入庫済:</span> ${it.received_qty || 0}</div>
              <div><span style="color:var(--text2);">残:</span> <strong>${remaining}</strong></div>
            </div>
            ${remaining > 0 ? `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <select class="fs" id="ib-loc-${i}" style="font-size:12px;flex:1;min-width:120px;">
                <option value="">棚入先を選択</option>${locOptions}
              </select>
              <input class="fi" id="ib-qty-${i}" type="number" value="${remaining}" min="1" max="${remaining}"
                style="font-size:12px;width:70px;flex-shrink:0;">
              <button class="btn btn-p btn-sm" onclick="execQuickPutaway('${esc(product.id)}','${esc(it.id)}',${i})">棚入</button>
            </div>` : '<div style="font-size:11px;color:var(--green);">完了</div>'}
          </div>
        </div>`;
      }).join('')
    : `<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px;">未完了の入庫伝票はありません</div>`;

  resultEl.innerHTML = `
    <div class="card mb12">
      <div class="card-hd">
        <div>
          <div class="card-title">${esc(product.name)}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);">${esc(product.sku)} / JAN:${esc(product.jan_code)}</div>
        </div>
      </div>
    </div>
    ${rows}`;
}

async function showPickResult(product) {
  const resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  const { data: outItems } = await sb.from('outbound_items')
    .select('id,planned_qty,status,outbound_orders!inner(slip_no,planned_date,status)')
    .eq('product_id', product.id)
    .in('status', ['pending'])
    .order('id');

  const { data: invRows } = await sb.from('v_inventory_with_names')
    .select('id,location_code,lot_no,expiry,available_qty')
    .eq('product_id', product.id)
    .gt('available_qty', 0)
    .order('expiry', { ascending: true, nullsFirst: false });

  const invOptions = invRows && invRows.length
    ? invRows.map(r => `<option value="${esc(r.id)}">${esc(r.location_code)} / ${r.available_qty}個${r.lot_no ? ' / ' + esc(r.lot_no) : ''}${r.expiry ? ' / ' + fmtDate(r.expiry) : ''}</option>`).join('')
    : '';

  const rows = outItems && outItems.length
    ? outItems.map((it, i) => {
        const ord = it.outbound_orders;
        return `<div class="card mb12" style="border-left:3px solid var(--yellow);">
          <div class="card-body" style="padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-family:var(--mono);font-size:11px;color:var(--text2);">出庫伝票: ${esc(ord?.slip_no)}</div>
                <div style="font-size:11px;color:var(--text2);">予定日: ${fmtDate(ord?.planned_date)}</div>
              </div>
              ${statusBadge(it.status)}
            </div>
            <div style="font-size:11px;margin-bottom:10px;"><span style="color:var(--text2);">ピッキング数:</span> <strong>${it.planned_qty}</strong></div>
            ${invRows && invRows.length ? `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <select class="fs" id="pk-inv-${i}" style="font-size:11px;flex:1;min-width:140px;">
                <option value="">在庫を選択 (FIFO)</option>${invOptions}
              </select>
              <input class="fi" id="pk-qty-${i}" type="number" value="${it.planned_qty}" min="1"
                style="font-size:12px;width:70px;flex-shrink:0;">
              <button class="btn btn-p btn-sm" onclick="execQuickPick('${esc(product.id)}','${esc(it.id)}',${i})">ピック</button>
            </div>` : '<div style="font-size:11px;color:var(--red);">在庫不足</div>'}
          </div>
        </div>`;
      }).join('')
    : `<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px;">未完了の出庫伝票はありません</div>`;

  resultEl.innerHTML = `
    <div class="card mb12">
      <div class="card-hd">
        <div>
          <div class="card-title">${esc(product.name)}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);">${esc(product.sku)} / JAN:${esc(product.jan_code)}</div>
        </div>
      </div>
    </div>
    ${rows}`;
}

async function execQuickPutaway(productId, inboundItemId, idx) {
  const locId = document.getElementById('ib-loc-' + idx)?.value;
  const qty = parseInt(document.getElementById('ib-qty-' + idx)?.value || '0');
  if (!locId) { toast('棚入先を選択してください', 'error'); return; }
  if (!qty || qty <= 0) { toast('数量を入力してください', 'error'); return; }

  const { error } = await sb.rpc('fn_inbound_putaway', {
    p_item_id: inboundItemId,
    p_location: locId,
    p_qty: qty,
  });
  if (error) { toast('棚入失敗: ' + error.message, 'error'); return; }
  toast('棚入しました');
  // re-render result with updated data
  const product = await lookupProduct(_lastScanCode);
  if (product) await showInboundResult(product);
}

async function execQuickPick(productId, outboundItemId, idx) {
  const invId = document.getElementById('pk-inv-' + idx)?.value;
  const qty = parseInt(document.getElementById('pk-qty-' + idx)?.value || '0');
  if (!invId) { toast('在庫を選択してください', 'error'); return; }
  if (!qty || qty <= 0) { toast('数量を入力してください', 'error'); return; }

  const { error } = await sb.rpc('fn_outbound_pick', {
    p_item_id: outboundItemId,
    p_inventory_id: invId,
    p_qty: qty,
  });
  if (error) { toast('ピッキング失敗: ' + error.message, 'error'); return; }
  toast('ピッキングしました');
  const product = await lookupProduct(_lastScanCode);
  if (product) await showPickResult(product);
}

function submitScanManual() {
  const val = (document.getElementById('scan-manual-input')?.value || '').trim();
  if (!val) { toast('JANコードを入力してください', 'error'); return; }
  onScanResult(val);
}

function addScanHistory(jan, product) {
  _scanHistory.unshift({ jan, product, time: new Date() });
  if (_scanHistory.length > 10) _scanHistory.pop();
  renderScanHistory();
}

function renderScanHistory() {
  const el = document.getElementById('scan-history-area');
  if (!el || !_scanHistory.length) return;
  el.innerHTML = `
    <div class="card">
      <div class="card-hd"><div class="card-title">スキャン履歴</div></div>
      <div class="card-body" style="padding:0;">
        ${_scanHistory.map(h => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-size:12px;font-weight:500;">${h.product ? esc(h.product.name) : '<span style="color:var(--red);">商品未登録</span>'}</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--text2);">${esc(h.jan)}</div>
            </div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTime(h.time)}</div>
          </div>`).join('')}
      </div>
    </div>`;
}
