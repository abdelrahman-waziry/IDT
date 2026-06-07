
// ═══════════════════════════════════════════
// State
// ═══════════════════════════════════════════
var VIEWS = ${viewsJSON};
var SESSION = '${sessionId}';
var LOCAL_URL = 'http://${localIP}:' + ${port};
var TOTAL = VIEWS.length;
var apiBase = ''; // empty = relative (tunnel), switches to LOCAL_URL on tunnel failure

var currentIndex = 0;
var capturedPhotos = {};
var stream = null;
var isFrozen = false;
var useFallback = false;
var currentValidation = null;

var videoEl = document.getElementById('videoEl');
var captureCanvas = document.getElementById('captureCanvas');
var previewImg = document.getElementById('previewImg');
var vf = document.getElementById('viewfinder');
var btnShutter = document.getElementById('btnShutter');
var btnRetake = document.getElementById('btnRetake');
var btnVerify = document.getElementById('btnVerify');
var qualityBadge = document.getElementById('qualityBadge');
var focusRingCircle = document.getElementById('focusRingCircle');

// ═══════════════════════════════════════════
// Camera Init (fallback chain)
// ═══════════════════════════════════════════
async function initCamera() {
    var attempts = [
        { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: true }
    ];

    for (var i = 0; i < attempts.length; i++) {
        try {
            stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
            videoEl.srcObject = stream;
            await videoEl.play();
            vf.classList.add('vf--live');
            console.log('[Capture] Camera initialized');
            setTimeout(function() {
                focusRingCircle.classList.add('vf__focus-ring--locked');
            }, 1500);
            return true;
        } catch (err) {
            console.warn('[Capture] Camera attempt ' + (i+1) + ' failed:', err.message);
        }
    }

    console.warn('[Capture] All camera attempts failed, using file input fallback');
    useFallback = true;
    setupFallbackUI();
    return false;
}

function setupFallbackUI() {
    var inner = document.createElement('div');
    inner.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:24px;text-align:center;';
    inner.innerHTML = '<span class="material-symbols-outlined" style="font-size:48px;color:rgba(255,255,255,0.25);">photo_camera</span>' +
        '<p style="font-size:14px;color:rgba(255,255,255,0.5);">Camera not available.<br>Tap the capture button to open your camera app.</p>';

    // Keep brackets and badge
    var brackets = vf.querySelectorAll('.vf__bracket');
    var badge = document.getElementById('qualityBadge');
    vf.innerHTML = '';
    vf.appendChild(inner);

    var img = document.createElement('img');
    img.className = 'vf__preview';
    img.id = 'previewImg';
    img.alt = 'Preview';
    img.style.display = 'none';
    vf.appendChild(img);

    brackets.forEach(function(b) { vf.appendChild(b); });
    if (badge) vf.appendChild(badge);
}

// ═══════════════════════════════════════════
// Capture Logic
// ═══════════════════════════════════════════
function doCapture() {
    if (isFrozen) return;

    if (useFallback) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function() {
                var img = document.getElementById('previewImg');
                img.src = reader.result;
                img.style.display = 'block';
                vf.classList.add('vf--fallback-preview');

                var tempImg = new Image();
                tempImg.onload = function() {
                    captureCanvas.width = tempImg.width;
                    captureCanvas.height = tempImg.height;
                    captureCanvas.getContext('2d').drawImage(tempImg, 0, 0);
                    freezeAndValidate();
                };
                tempImg.src = reader.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
        return;
    }

    // getUserMedia: grab frame from video
    var vw = videoEl.videoWidth;
    var vh = videoEl.videoHeight;
    captureCanvas.width = vw;
    captureCanvas.height = vh;
    captureCanvas.getContext('2d').drawImage(videoEl, 0, 0, vw, vh);
    freezeAndValidate();
}

function freezeAndValidate() {
    isFrozen = true;
    vf.classList.add('vf--frozen');
    vf.classList.remove('vf--live');

    currentValidation = validateCapture(captureCanvas);

    var badge = document.getElementById('qualityBadge');
    badge.className = 'vf__badge';
    badge.style.display = 'none';
    badge.textContent = '';

    if (!currentValidation.pass && currentValidation.severity === 'fail') {
        badge.className = 'vf__badge vf__badge--fail';
        badge.textContent = currentValidation.message;
        badge.style.display = 'block';
    } else if (!currentValidation.pass && currentValidation.severity === 'warn') {
        badge.className = 'vf__badge vf__badge--warn';
        badge.textContent = currentValidation.message;
        badge.style.display = 'block';
    }

    btnRetake.style.visibility = 'visible';
    btnVerify.style.visibility = 'visible';
    btnShutter.style.display = 'none';
}

function doRetake() {
    isFrozen = false;
    vf.classList.remove('vf--frozen', 'vf--fallback-preview');
    if (!useFallback) vf.classList.add('vf--live');

    var badge = document.getElementById('qualityBadge');
    badge.style.display = 'none';
    badge.className = 'vf__badge';

    btnRetake.style.visibility = 'hidden';
    btnVerify.style.visibility = 'hidden';
    btnShutter.style.display = '';
    currentValidation = null;

    if (!useFallback) {
        focusRingCircle.classList.remove('vf__focus-ring--locked');
        setTimeout(function() {
            focusRingCircle.classList.add('vf__focus-ring--locked');
        }, 1200);
    }
}

async function doVerify() {
    var view = VIEWS[currentIndex];
    if (!view) return;

    btnVerify.style.pointerEvents = 'none';
    btnRetake.style.pointerEvents = 'none';
    btnShutter.classList.add('ctrl__shutter--uploading');

    updateConnStatus('uploading');

    // Make sure we have a working connection first
    var alive = await pingServer();
    if (!alive) {
        console.warn('[Capture] Server not reachable, waiting for reconnection...');
        var reconnected = await waitForConnection(15000);
        if (!reconnected) {
            console.error('[Capture] Could not reconnect to server');
            updateConnStatus('error');
            btnVerify.style.pointerEvents = '';
            btnRetake.style.pointerEvents = '';
            btnShutter.classList.remove('ctrl__shutter--uploading');
            return;
        }
    }

    // Notify desktop of sync start (using the working apiBase)
    fetch(apiBase + '/api/start-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ session: SESSION, view: view.key })
    }).catch(function() {});

    var base64 = canvasToBase64(captureCanvas, 1280, 0.80);
    var success = await uploadWithRetry(view.key, base64, 3);

    if (success) {
        updateConnStatus('connected');
        capturedPhotos[view.key] = true;
        currentIndex++;

        if (currentIndex >= TOTAL) {
            showDone();
        } else {
            resetForNextAngle();
        }
    } else {
        updateConnStatus('error');
        var badge = document.getElementById('qualityBadge');
        badge.className = 'vf__badge vf__badge--fail';
        badge.textContent = 'Upload failed. Tap Retake to try again.';
        badge.style.display = 'block';
    }

    btnVerify.style.pointerEvents = '';
    btnRetake.style.pointerEvents = '';
    btnShutter.classList.remove('ctrl__shutter--uploading');
}

function resetForNextAngle() {
    isFrozen = false;
    vf.classList.remove('vf--frozen', 'vf--fallback-preview');
    if (!useFallback) vf.classList.add('vf--live');

    btnRetake.style.visibility = 'hidden';
    btnVerify.style.visibility = 'hidden';
    btnShutter.style.display = '';
    btnShutter.classList.remove('ctrl__shutter--uploading');
    currentValidation = null;

    var badge = document.getElementById('qualityBadge');
    badge.style.display = 'none';
    badge.className = 'vf__badge';

    if (!useFallback) {
        focusRingCircle.classList.remove('vf__focus-ring--locked');
        setTimeout(function() { focusRingCircle.classList.add('vf__focus-ring--locked'); }, 1200);
    }

    renderAngle();
}

// ═══════════════════════════════════════════
// Connection Health Check & Upload with Retry
// ═══════════════════════════════════════════
async function pingUrl(base) {
    try {
        var res = await fetch(base + '/api/ping', {
            method: 'GET',
            headers: { 'Bypass-Tunnel-Reminder': 'true' },
            signal: AbortSignal.timeout(3000)
        });
        return res.ok;
    } catch (err) {
        return false;
    }
}

async function pingServer() {
    // Try current base first (tunnel or already-local)
    var ok = await pingUrl(apiBase);
    if (ok) return true;

    // If current base failed and we're on tunnel, try local fallback
    if (apiBase === '' && LOCAL_URL) {
        console.log('[Capture] Tunnel unreachable, trying local URL: ' + LOCAL_URL);
        var localOk = await pingUrl(LOCAL_URL);
        if (localOk) {
            console.log('[Capture] Switched to local URL: ' + LOCAL_URL);
            apiBase = LOCAL_URL;
            updateConnStatus('connected');
            return true;
        }
    }
    return false;
}

async function waitForConnection(maxWaitMs) {
    var start = Date.now();
    var delay = 500;
    while (Date.now() - start < maxWaitMs) {
        updateConnStatus('reconnecting');

        // Try both tunnel (relative) and local
        var tunnelOk = await pingUrl('');
        if (tunnelOk) {
            apiBase = '';
            updateConnStatus('connected');
            return true;
        }
        if (LOCAL_URL) {
            var localOk = await pingUrl(LOCAL_URL);
            if (localOk) {
                apiBase = LOCAL_URL;
                console.log('[Capture] Reconnected via local URL: ' + LOCAL_URL);
                updateConnStatus('connected');
                return true;
            }
        }

        await new Promise(function(r) { setTimeout(r, delay); });
        delay = Math.min(delay * 1.5, 4000);
    }
    updateConnStatus('error');
    return false;
}

function updateConnStatus(status) {
    var el = document.getElementById('connStatus');
    if (!el) return;
    var dot = el.querySelector('.conn__dot');
    var label = el.querySelector('.conn__label');
    if (!dot || !label) return;

    dot.className = 'conn__dot conn__dot--' + status;
    var labels = {
        connected: 'Connected',
        uploading: 'Uploading...',
        reconnecting: 'Reconnecting...',
        error: 'Connection Lost'
    };
    label.textContent = labels[status] || 'Connected';
}

async function uploadWithRetry(viewKey, base64, maxRetries) {
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Ping first to ensure server is reachable
            var alive = await pingServer();
            if (!alive) {
                console.warn('[Capture] Server not reachable, waiting for reconnection...');
                var reconnected = await waitForConnection(15000);
                if (!reconnected) {
                    console.error('[Capture] Could not reconnect to server');
                    return false;
                }
            }

            console.log('[Capture] Upload attempt ' + attempt + '/' + maxRetries + ' for ' + viewKey + ' via ' + (apiBase || 'tunnel'));
            var res = await fetch(apiBase + '/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
                body: JSON.stringify({ session: SESSION, view: viewKey, image: base64, filename: viewKey + '.jpg' })
            });
            var data = await res.json();
            if (data.success) {
                console.log('[Capture] Upload success for ' + viewKey);
                return true;
            }
            console.warn('[Capture] Upload returned failure:', data.error);
        } catch (err) {
            console.error('[Capture] Upload error (attempt ' + attempt + '):', err.message);
            // If tunnel failed, try switching to local before next retry
            if (apiBase === '' && LOCAL_URL) {
                var localOk = await pingUrl(LOCAL_URL);
                if (localOk) {
                    apiBase = LOCAL_URL;
                    console.log('[Capture] Switched to local URL for retry');
                }
            }
        }
        if (attempt < maxRetries) {
            await new Promise(function(r) { setTimeout(r, 1000); });
        }
    }
    return false;
}

// ═══════════════════════════════════════════
// Image Compression
// ═══════════════════════════════════════════
function canvasToBase64(canvas, maxDim, quality) {
    var w = canvas.width, h = canvas.height;
    if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
        else { w = Math.round(w * (maxDim / h)); h = maxDim; }
    }
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, 0, 0, w, h);
    var dataUrl = out.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1];
}

// ═══════════════════════════════════════════
// Client-Side Validation
// ═══════════════════════════════════════════
function validateCapture(canvas) {
    var checks = [ checkBlur(canvas), checkBrightness(canvas) ];
    var fail = checks.find(function(c) { return c.severity === 'fail'; });
    if (fail) return fail;
    var warn = checks.find(function(c) { return !c.pass; });
    if (warn) return warn;
    return { pass: true, message: '', severity: 'warn' };
}

function checkBlur(canvas) {
    var w = Math.min(canvas.width, 320);
    var h = Math.round(canvas.height * (w / canvas.width));
    var small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d').drawImage(canvas, 0, 0, w, h);
    var data = small.getContext('2d').getImageData(0, 0, w, h).data;

    var gray = new Float32Array(w * h);
    for (var i = 0; i < gray.length; i++) {
        gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
    }

    var sum = 0, sumSq = 0, count = 0;
    for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
            var lap = gray[(y-1)*w+x] + gray[(y+1)*w+x] + gray[y*w+(x-1)] + gray[y*w+(x+1)] - 4*gray[y*w+x];
            sum += lap; sumSq += lap * lap; count++;
        }
    }
    var variance = (sumSq / count) - Math.pow(sum / count, 2);
    console.log('[Validate] Blur variance:', variance.toFixed(1));

    if (variance < 50) {
        return { pass: false, message: 'Image appears blurry. Hold steady and retake.', severity: 'warn' };
    }
    return { pass: true, message: '', severity: 'warn' };
}

function checkBrightness(canvas) {
    var w = Math.min(canvas.width, 160);
    var h = Math.round(canvas.height * (w / canvas.width));
    var small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d').drawImage(canvas, 0, 0, w, h);
    var data = small.getContext('2d').getImageData(0, 0, w, h).data;

    var totalLum = 0, pixelCount = w * h;
    for (var i = 0; i < pixelCount; i++) {
        totalLum += 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
    }
    var avgLum = totalLum / pixelCount;
    console.log('[Validate] Avg luminance:', avgLum.toFixed(1));

    if (avgLum < 30) return { pass: false, message: 'Image too dark. Improve lighting.', severity: 'warn' };
    if (avgLum > 230) return { pass: false, message: 'Overexposed / glare detected.', severity: 'warn' };
    return { pass: true, message: '', severity: 'warn' };
}

// ═══════════════════════════════════════════
// UI Rendering
// ═══════════════════════════════════════════
function renderAngle() {
    var view = VIEWS[currentIndex];
    if (!view) return;
    document.getElementById('hdrCounter').textContent = '[' + (currentIndex + 1) + '/' + TOTAL + ']';
    document.getElementById('instrIcon').textContent = view.icon || 'photo_camera';
    document.getElementById('instrLabel').textContent = view.label;
    document.getElementById('instrDesc').textContent = view.instruction || '';
    renderDots();
}

function renderDots() {
    var bar = document.getElementById('dotsBar');
    bar.innerHTML = '';
    VIEWS.forEach(function(v, i) {
        var d = document.createElement('div');
        d.className = 'dot';
        if (i < currentIndex) d.classList.add('dot--done');
        else if (i === currentIndex) d.classList.add('dot--current');
        else d.classList.add('dot--pending');
        bar.appendChild(d);
    });
}

function showDone() {
    document.getElementById('app').classList.add('app--done');
    if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); stream = null; }
}

// ═══════════════════════════════════════════
// Init
// ═══════════════════════════════════════════
(async function init() {
    renderAngle();
    await initCamera();
})();
