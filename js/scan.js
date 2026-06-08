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
let _scanGuideTimer2 = null;
let _scanGuideTimer5 = null;

function _playBeep() {
  var a = new Audio('sounds/scan-success.mp3');
  a.volume = 1.0;
  console.log('AUDIO SRC', a.src);
  console.log('READY STATE', a.readyState);
  a.play().then(function() {
    console.log('AUDIO PLAYED OK');
  }).catch(function(e) {
    console.error('AUDIO ERROR', e);
    _playBeepFallback();
  });
}

function _playBeepFallback() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 2400;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    console.log('BEEP FALLBACK: Web Audio API 2400Hz square 0.1s');
  } catch (e) {
    console.error('BEEP FALLBACK FAILED', e);
  }
}

function _flashSuccess(productName) {
  var el = document.getElementById('scan-reader');
  if (!el) return;
  el.style.outline = '3px solid var(--green)';
  el.style.outlineOffset = '0px';
  var ov = document.getElementById('scan-flash-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'scan-flash-overlay';
    ov.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(26,133,74,.92);color:#fff;padding:5px 14px;border-radius:16px;font-size:12px;font-weight:600;white-space:nowrap;pointer-events:none;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(0,0,0,.2);';
    el.parentNode.style.position = 'relative';
    el.parentNode.appendChild(ov);
  }
  ov.innerHTML = '<span style="font-size:14px;">&#10003;</span> 読み取り成功' + (productName ? ' <span style="font-weight:400;opacity:.9;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;">' + esc(productName) + '</span>' : '');
  ov.style.display = 'flex';
  ov.style.opacity = '1';
  setTimeout(function() {
    el.style.outline = '';
    el.style.outlineOffset = '';
    if (ov) { ov.style.opacity = '0'; ov.style.transition = 'opacity .15s'; }
    setTimeout(function() { if (ov) ov.style.display = 'none'; }, 150);
  }, 500);
}

// _applyCameraSettings: 一時無効化（デバッグ中）

function _startScanGuide() {
  _clearScanGuide();
  _scanGuideTimer2 = setTimeout(function() {
    var el = document.getElementById('scan-guide-msg');
    if (el) {
      el.textContent = 'バーコードが見つかりません。商品にもう少し近づけてください';
      el.style.display = 'block';
    }
  }, 2000);
  _scanGuideTimer5 = setTimeout(function() {
    var el = document.getElementById('scan-guide-msg');
    if (el) {
      el.innerHTML = '<div style="font-weight:500;margin-bottom:4px;">読み取りのコツ</div>'
        + '<div style="display:flex;flex-direction:column;gap:2px;">'
        + '<span>・15〜20cmまで近づける</span>'
        + '<span>・バーコードを中央に合わせる</span>'
        + '<span>・影がかからないようにする</span>'
        + '</div>';
      el.style.display = 'block';
    }
  }, 5000);
}

function _clearScanGuide() {
  if (_scanGuideTimer2) { clearTimeout(_scanGuideTimer2); _scanGuideTimer2 = null; }
  if (_scanGuideTimer5) { clearTimeout(_scanGuideTimer5); _scanGuideTimer5 = null; }
  var el = document.getElementById('scan-guide-msg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function _resetScanGuide() {
  _clearScanGuide();
  _startScanGuide();
}

// ---------- Page Render ----------

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
          <div style="display:flex;gap:3px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
            <span style="font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:.06em;margin-right:2px;">対応:</span>
            <span class="badge bb">JAN</span>
            <span class="badge bb">EAN-8</span>
            <span class="badge bb">CODE128</span>
            <span class="badge bb">QR</span>
          </div>
          <div id="scan-reader" style="width:100%;border-radius:6px;overflow:hidden;background:#000;min-height:200px;display:flex;align-items:center;justify-content:center;">
            <div style="color:#fff;font-size:12px;text-align:center;padding:20px;">カメラを起動中...</div>
          </div>
          <div style="text-align:center;padding:6px 0 2px;font-size:11px;color:var(--text3);">カメラをバーコードへ向けてください</div>
          <div id="scan-cam-err" style="display:none;padding:12px;background:rgba(200,40,40,.06);border:1px solid rgba(200,40,40,.18);border-radius:6px;margin-top:8px;">
            <div style="font-size:12px;color:var(--red);font-weight:500;margin-bottom:6px;">カメラを使用できません</div>
            <div style="font-size:11px;color:var(--text2);margin-bottom:8px;" id="scan-cam-err-msg">カメラへのアクセスが拒否されました。</div>
            <div style="font-size:11px;color:var(--text2);">▼ 下の手動入力でコードを直接入力してください</div>
          </div>
          <div id="scan-guide-msg" style="display:none;padding:10px 12px;background:rgba(var(--accent-rgb,59,130,246),.06);border:1px solid rgba(var(--accent-rgb,59,130,246),.18);border-radius:6px;margin-top:8px;font-size:11px;color:var(--text2);line-height:1.6;"></div>
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
      <div id="scan-debug" style="margin-top:8px;padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;font-family:var(--mono);font-size:9px;color:var(--text3);line-height:1.6;"></div>
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

// ---------- Camera ----------

async function startLiveScanner() {
  stopLiveScanner();

  var readerEl = document.getElementById('scan-reader');
  if (!readerEl) return;

  readerEl.innerHTML = '<div style="color:#fff;font-size:12px;text-align:center;padding:20px;">カメラを起動中...</div>';
  var errEl = document.getElementById('scan-cam-err');
  if (errEl) errEl.style.display = 'none';

  var _scanStartMs = 0;
  var onOk = function(text, result) {
    var detectMs = _scanStartMs ? (Date.now() - _scanStartMs) : 0;
    _scanStartMs = Date.now();
    console.log('SCAN SUCCESS', text, 'detectTime=' + detectMs + 'ms');
    try {
      var video = document.querySelector('#scan-reader video');
      if (video && video.srcObject) {
        var track = video.srcObject.getVideoTracks()[0];
        if (track) console.log('SCAN TRACK SETTINGS', JSON.stringify(track.getSettings()));
      }
    } catch (e) {}
    _resetScanGuide();
    onScanResult(text, result);
  };
  var onNg = function() {};
  var cfg = { fps: 15, qrbox: { width: 450, height: 180 } };
  try {
    cfg.formatsToSupport = [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.QR_CODE,
    ];
  } catch (e) {}

  try {
    readerEl.innerHTML = '';
    _scanner = new Html5Qrcode('scan-reader');
    await _scanner.start(
      { facingMode: 'environment' },
      cfg, onOk, onNg
    );
    console.log('CAMERA STARTED');
    _scanStartMs = Date.now();
    _startScanGuide();
    _logCameraInfo();
    _updateScanDebug();
  } catch (err) {
    console.error('CAMERA START FAILED:', err);
    try { if (_scanner) _scanner.clear(); } catch (x) {}
    _scanner = null;
    _showCameraError(err);
  }
}

function _showCameraError(err) {
  var name = (err && err.name) || '?';
  var msg = (err && err.message) || String(err);
  console.error('_showCameraError:', name, msg);
  var readerEl = document.getElementById('scan-reader');
  if (readerEl) {
    readerEl.innerHTML = '<div style="color:rgba(255,255,255,.5);font-size:12px;text-align:center;padding:30px;">カメラ使用不可</div>';
  }
  var errEl = document.getElementById('scan-cam-err');
  var errMsgEl = document.getElementById('scan-cam-err-msg');
  if (errEl) {
    if (errMsgEl) {
      errMsgEl.textContent = name + ': ' + msg;
    }
    errEl.style.display = 'block';
  }
}

function _logCameraInfo() {
  try {
    var video = document.querySelector('#scan-reader video');
    if (!video || !video.srcObject) return;
    var track = video.srcObject.getVideoTracks()[0];
    if (!track) return;
    var settings = track.getSettings();
    console.log('VIDEO TRACK SETTINGS', JSON.stringify(settings));
    if (typeof track.getCapabilities === 'function') {
      var caps = track.getCapabilities();
      if (caps.focusMode) console.log('FOCUS MODES', JSON.stringify(caps.focusMode));
      if (caps.zoom) console.log('ZOOM RANGE', JSON.stringify(caps.zoom));
    }
  } catch (e) {
    console.error('_logCameraInfo error', e);
  }
}

function stopLiveScanner() {
  _clearScanGuide();
  if (!_scanner) return;
  try {
    var state = _scanner.getState();
    if (state === 2 || state === 3) {
      _scanner.stop().catch(function() {});
    }
  } catch (e) {}
  try { _scanner.clear(); } catch (e) {}
  _scanner = null;
}

function _updateScanDebug(lastCode) {
  var el = document.getElementById('scan-debug');
  if (!el) return;
  var res = '—', cam = '—';
  try {
    var video = document.querySelector('#scan-reader video');
    if (video && video.srcObject) {
      var track = video.srcObject.getVideoTracks()[0];
      if (track) {
        var s = track.getSettings();
        res = (s.width || '?') + ' x ' + (s.height || '?');
        cam = track.label || '—';
      }
    }
  } catch (e) {}
  el.innerHTML = 'Camera: ' + esc(cam) + '<br>Resolution: ' + esc(res) + '<br>Last code: ' + esc(lastCode || _lastScanCode || '—');
}

// ---------- Scan Result ----------

async function onScanResult(code, scanResult) {
  var now = Date.now();
  if (code === _lastScanCode && now - _lastScanTime < 2000) return;
  _lastScanCode = code;
  _lastScanTime = now;

  _playBeep();
  _updateScanDebug(code);

  var fmt = scanResult && scanResult.result && scanResult.result.format;
  var isQR = !!(fmt && (fmt.format === 0 || fmt.formatName === 'QR_CODE'));

  var resultEl = document.getElementById('scan-result-area');

  if (isQR) {
    var handled = await _handleStructuredQr(code, resultEl);
    if (handled) {
      _flashSuccess(null);
      addScanHistory(code, null);
      return;
    }
  }

  if (resultEl) {
    resultEl.innerHTML = '<div class="card card-body" style="text-align:center;padding:20px;color:var(--text2);font-size:12px;"><div style="display:inline-block;width:16px;height:16px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;margin-right:6px;vertical-align:middle;"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>商品検索中…</div>';
  }

  var product = await lookupProduct(code);
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
      resultEl.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:20px;"><div style="font-weight:600;color:var(--red);margin-bottom:4px;">商品未登録</div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);">' + esc(code) + '</div></div></div>';
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

// ---------- QR Modal ----------

function _showQrModal(content) {
  _lastQrContent = content;
  var body = '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">内容:</div><div style="background:var(--surface2);border-radius:6px;padding:10px 12px;font-family:var(--mono);font-size:13px;word-break:break-all;max-height:160px;overflow-y:auto;border:1px solid var(--border);">' + esc(content) + '</div>';
  var footer = '<button class="btn btn-g" onclick="closeModal()">閉じる</button><button class="btn btn-p" onclick="_copyLastQr()">コピー</button>';
  openModal('QRコードを検出しました', body, footer);
}

function _copyLastQr() {
  _copyText(_lastQrContent);
  closeModal();
}

function _copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() { toast('コピーしました'); }).catch(function() { toast('コピー失敗', 'error'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('コピー失敗', 'error'); }
    document.body.removeChild(ta);
  }
}

// ---------- Structured QR Handler ----------

async function _handleStructuredQr(content, resultEl) {
  try {
    var obj = JSON.parse(content);
    if (obj && obj.type === 'inbound_plan' && obj.plan_no) {
      var { data: plan } = await sb.from('inbound_plans')
        .select('id, plan_no')
        .eq('plan_no', obj.plan_no)
        .single();

      if (!plan) {
        toast('入荷予定が見つかりません: ' + obj.plan_no, 'error');
        if (resultEl) {
          resultEl.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:20px;"><div style="font-weight:600;color:var(--red);margin-bottom:4px;">入荷予定が見つかりません</div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);">' + esc(obj.plan_no) + '</div></div></div>';
        }
        return true;
      }

      if (typeof ipGoDetailByPlanNo === 'function') {
        ipGoDetailByPlanNo(obj.plan_no);
      }
      return true;
    }
  } catch (e) {}
  return false;
}

// ---------- Product Lookup ----------

async function lookupProduct(janCode) {
  var res = await sb.from('products').select('id,sku,name,jan_code,storage_condition').eq('jan_code', janCode).single();
  return (res.error || !res.data) ? null : res.data;
}

// ---------- Result Views ----------

async function showCheckResult(product) {
  var resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  var res = await sb.from('v_inventory_with_names').select('*').eq('product_id', product.id).gt('qty', 0).order('location_code');
  var inv = res.data || [];
  var totalQty = inv.reduce(function(s, r) { return s + (r.qty || 0); }, 0);

  var rows = inv.length
    ? inv.map(function(r) { return '<tr><td style="font-family:var(--mono);font-size:11px;">' + esc(r.location_code) + '</td><td style="text-align:right;font-family:var(--mono);">' + r.qty + '</td><td style="font-size:11px;">' + (esc(r.lot_no) || '—') + '</td><td style="font-size:11px;">' + (r.expiry ? fmtDate(r.expiry) : '—') + '</td></tr>'; }).join('')
    : '<tr><td colspan="4" class="empty-state" style="padding:16px;">在庫なし</td></tr>';

  resultEl.innerHTML = '<div class="card"><div class="card-hd"><div><div class="card-title">' + esc(product.name) + '</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + esc(product.sku) + ' / JAN:' + esc(product.jan_code) + '</div></div><div style="text-align:right;"><div style="font-family:var(--disp);font-size:22px;font-weight:800;color:var(--accent);">' + totalQty + '</div><div style="font-size:10px;color:var(--text2);">総在庫</div></div></div><div class="card-body" style="padding:0;"><div class="tw"><table><thead><tr><th>ロケ</th><th style="text-align:right;">数量</th><th>ロット</th><th>期限</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
}

async function showInboundResult(product) {
  var resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  var res1 = await sb.from('inbound_items').select('id,planned_qty,received_qty,status,lot_no,expiry,inbound_orders!inner(slip_no,planned_date,status),locations(code)').eq('product_id', product.id).in('status', ['pending', 'received']).order('id');
  var items = res1.data || [];

  var res2 = await sb.from('locations').select('id,code').eq('is_active', true).order('code');
  var locs = res2.data || [];
  var locOpts = locs.map(function(l) { return '<option value="' + esc(l.id) + '">' + esc(l.code) + '</option>'; }).join('');

  var rows = items.length
    ? items.map(function(it, i) {
        var ord = it.inbound_orders;
        var rem = (it.planned_qty || 0) - (it.received_qty || 0);
        return '<div class="card mb12" style="border-left:3px solid var(--accent);"><div class="card-body" style="padding:12px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);">入庫伝票: ' + esc(ord && ord.slip_no) + '</div><div style="font-size:11px;color:var(--text2);">予定日: ' + fmtDate(ord && ord.planned_date) + '</div></div>' + statusBadge(it.status) + '</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;font-size:11px;"><div><span style="color:var(--text2);">予定:</span> ' + it.planned_qty + '</div><div><span style="color:var(--text2);">入庫済:</span> ' + (it.received_qty || 0) + '</div><div><span style="color:var(--text2);">残:</span> <strong>' + rem + '</strong></div></div>' + (rem > 0 ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select class="fs" id="ib-loc-' + i + '" style="font-size:12px;flex:1;min-width:120px;"><option value="">棚入先を選択</option>' + locOpts + '</select><input class="fi" id="ib-qty-' + i + '" type="number" value="' + rem + '" min="1" max="' + rem + '" style="font-size:12px;width:70px;flex-shrink:0;"><button class="btn btn-p btn-sm" onclick="execQuickPutaway(\'' + esc(product.id) + '\',\'' + esc(it.id) + '\',' + i + ')">棚入</button></div>' : '<div style="font-size:11px;color:var(--green);">完了</div>') + '</div></div>';
      }).join('')
    : '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px;">未完了の入庫伝票はありません</div>';

  resultEl.innerHTML = '<div class="card mb12"><div class="card-hd"><div><div class="card-title">' + esc(product.name) + '</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + esc(product.sku) + ' / JAN:' + esc(product.jan_code) + '</div></div></div></div>' + rows;
}

async function showPickResult(product) {
  var resultEl = document.getElementById('scan-result-area');
  if (!resultEl) return;

  var res1 = await sb.from('outbound_items').select('id,planned_qty,status,outbound_orders!inner(slip_no,planned_date,status)').eq('product_id', product.id).in('status', ['pending']).order('id');
  var outItems = res1.data || [];

  var res2 = await sb.from('v_inventory_with_names').select('id,location_code,lot_no,expiry,available_qty').eq('product_id', product.id).gt('available_qty', 0).order('expiry', { ascending: true, nullsFirst: false });
  var invRows = res2.data || [];
  var invOpts = invRows.map(function(r) { return '<option value="' + esc(r.id) + '">' + esc(r.location_code) + ' / ' + r.available_qty + '個' + (r.lot_no ? ' / ' + esc(r.lot_no) : '') + (r.expiry ? ' / ' + fmtDate(r.expiry) : '') + '</option>'; }).join('');

  var rows = outItems.length
    ? outItems.map(function(it, i) {
        var ord = it.outbound_orders;
        return '<div class="card mb12" style="border-left:3px solid var(--yellow);"><div class="card-body" style="padding:12px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);">出庫伝票: ' + esc(ord && ord.slip_no) + '</div><div style="font-size:11px;color:var(--text2);">予定日: ' + fmtDate(ord && ord.planned_date) + '</div></div>' + statusBadge(it.status) + '</div><div style="font-size:11px;margin-bottom:10px;"><span style="color:var(--text2);">ピッキング数:</span> <strong>' + it.planned_qty + '</strong></div>' + (invRows.length ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select class="fs" id="pk-inv-' + i + '" style="font-size:11px;flex:1;min-width:140px;"><option value="">在庫を選択 (FIFO)</option>' + invOpts + '</select><input class="fi" id="pk-qty-' + i + '" type="number" value="' + it.planned_qty + '" min="1" style="font-size:12px;width:70px;flex-shrink:0;"><button class="btn btn-p btn-sm" onclick="execQuickPick(\'' + esc(product.id) + '\',\'' + esc(it.id) + '\',' + i + ')">ピック</button></div>' : '<div style="font-size:11px;color:var(--red);">在庫不足</div>') + '</div></div>';
      }).join('')
    : '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px;">未完了の出庫伝票はありません</div>';

  resultEl.innerHTML = '<div class="card mb12"><div class="card-hd"><div><div class="card-title">' + esc(product.name) + '</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + esc(product.sku) + ' / JAN:' + esc(product.jan_code) + '</div></div></div></div>' + rows;
}

// ---------- Quick Actions ----------

async function execQuickPutaway(productId, inboundItemId, idx) {
  var locId = document.getElementById('ib-loc-' + idx).value;
  var qty = parseInt(document.getElementById('ib-qty-' + idx).value || '0');
  if (!locId) { toast('棚入先を選択してください', 'error'); return; }
  if (!qty || qty <= 0) { toast('数量を入力してください', 'error'); return; }
  var res = await sb.rpc('fn_inbound_putaway', { p_item_id: inboundItemId, p_location: locId, p_qty: qty });
  if (res.error) { toast('棚入失敗: ' + res.error.message, 'error'); return; }
  toast('棚入しました');
  var product = await lookupProduct(_lastScanCode);
  if (product) await showInboundResult(product);
}

async function execQuickPick(productId, outboundItemId, idx) {
  var invId = document.getElementById('pk-inv-' + idx).value;
  var qty = parseInt(document.getElementById('pk-qty-' + idx).value || '0');
  if (!invId) { toast('在庫を選択してください', 'error'); return; }
  if (!qty || qty <= 0) { toast('数量を入力してください', 'error'); return; }
  var res = await sb.rpc('fn_outbound_pick', { p_item_id: outboundItemId, p_inventory_id: invId, p_qty: qty });
  if (res.error) { toast('ピッキング失敗: ' + res.error.message, 'error'); return; }
  toast('ピッキングしました');
  var product = await lookupProduct(_lastScanCode);
  if (product) await showPickResult(product);
}

// ---------- Manual Input / History ----------

function submitScanManual() {
  var val = (document.getElementById('scan-manual-input').value || '').trim();
  if (!val) { toast('JANコードを入力してください', 'error'); return; }
  onScanResult(val);
}

function addScanHistory(jan, product) {
  _scanHistory.unshift({ jan: jan, product: product, time: new Date() });
  if (_scanHistory.length > 10) _scanHistory.pop();
  renderScanHistory();
}

function renderScanHistory() {
  var el = document.getElementById('scan-history-area');
  if (!el || !_scanHistory.length) return;
  el.innerHTML = '<div class="card"><div class="card-hd"><div class="card-title">スキャン履歴</div></div><div class="card-body" style="padding:0;">' +
    _scanHistory.map(function(h) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);"><div><div style="font-size:12px;font-weight:500;">' + (h.product ? esc(h.product.name) : '<span style="color:var(--red);">商品未登録</span>') + '</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);">' + esc(h.jan) + '</div></div><div style="font-family:var(--mono);font-size:10px;color:var(--text3);">' + fmtTime(h.time) + '</div></div>';
    }).join('') +
    '</div></div>';
}
