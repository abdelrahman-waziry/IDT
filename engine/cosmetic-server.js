/**
 * Cosmetic Server — Local HTTP server for mobile photo capture
 *
 * Serves a mobile-friendly capture page and receives photo uploads
 * from the technician's phone. Photos are forwarded to the Electron
 * renderer via IPC for live grid updates.
 *
 * @module engine/cosmetic-server
 */

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const localtunnel = require('localtunnel');

// Photo storage dir (temp)
const PHOTO_DIR = path.join(os.tmpdir(), 'fixtech-cosmetic-photos');

// In-memory session state
let currentSession = null;
let server = null;
let tunnel = null;
let onPhotoCallback = null;
let tunnelReconnectTimer = null;
let tunnelSubdomain = null;

// The 6 required photo views with capture guidance
const PHOTO_VIEWS = [
    {
        key: 'front_face', label: 'Front Face', angle: 'Angle 01',
        icon: 'smartphone',
        instruction: 'Align the full screen within the corner guides. Ensure no glare from overhead lighting.',
        focusHint: 'center', captureType: 'wide'
    },
    {
        key: 'back_chassis', label: 'Back Chassis', angle: 'Angle 02',
        icon: 'flip_to_back',
        instruction: 'Capture the full back panel. Include camera module and any visible scratches.',
        focusHint: 'center', captureType: 'wide'
    },
    {
        key: 'left_edge', label: 'Left Edge', angle: 'Angle 03',
        icon: 'phone_android',
        instruction: 'Hold device at a slight angle to expose the left side frame. Check for dents or scratches.',
        focusHint: 'center', captureType: 'macro'
    },
    {
        key: 'right_edge', label: 'Right Edge', angle: 'Angle 04',
        icon: 'phone_android',
        instruction: 'Align the right side of the device within the green corner guides. Ensure no glare on metallic surfaces.',
        focusHint: 'center', captureType: 'macro'
    },
    {
        key: 'top_profile', label: 'Top Profile', angle: 'Angle 05',
        icon: 'straighten',
        instruction: 'Capture the top edge straight-on. Look for chips or antenna band separation.',
        focusHint: 'center', captureType: 'macro'
    },
    {
        key: 'port_detail', label: 'Port Detail', angle: 'Angle 06',
        icon: 'electrical_services',
        instruction: 'Close-up of the charging port. Check for debris, bent pins, or corrosion.',
        focusHint: 'center-bottom', captureType: 'detail'
    }
];

/**
 * Get the machine's local network IP address
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

/**
 * Parse JSON body from an incoming request
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            // Limit to 50MB
            if (body.length > 50 * 1024 * 1024) {
                reject(new Error('Body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Generate the mobile capture HTML page — Sequential Guided Capture
 *
 * Full-screen, one-angle-at-a-time experience with:
 * - Live camera viewfinder (getUserMedia) with rear-camera preference
 * - Corner bracket guides and animated focus ring overlay
 * - Per-angle instruction cards
 * - Client-side blur/brightness validation before upload
 * - Retake / Verify flow with upload retry
 * - Fallback to <input type="file"> if camera API unavailable
 */
function generateCapturePage(sessionId, views) {
    const viewsJSON = JSON.stringify(views);
    const totalViews = views.length;
    const localIP = getLocalIP();
    const port = serverPort();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Fixtech — Cosmetic Capture</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body {
            height: 100%; overflow: hidden;
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0A0E1A; color: #fff;
        }

        /* Layout */
        .app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }

        /* Header */
        .hdr {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; flex-shrink: 0;
            background: rgba(15,30,60,0.85); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            z-index: 20;
        }
        .hdr__close {
            width: 32px; height: 32px; border-radius: 50%;
            background: rgba(255,255,255,0.08); border: none; color: #fff;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
        }
        .hdr__close .material-symbols-outlined { font-size: 20px; }
        .hdr__title { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }
        .hdr__counter {
            font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700;
            color: #01DFE1; background: rgba(1,223,225,0.1);
            padding: 4px 10px; border-radius: 6px;
        }

        /* Instruction Card */
        .instr {
            margin: 12px 16px 0; padding: 14px 16px;
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px; display: flex; gap: 14px; align-items: flex-start;
            flex-shrink: 0; z-index: 10;
        }
        .instr__icon-wrap {
            width: 48px; height: 48px; flex-shrink: 0;
            background: rgba(113,31,255,0.15); border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
        }
        .instr__icon-wrap .material-symbols-outlined { font-size: 26px; color: #A78BFA; }
        .instr__body { flex: 1; min-width: 0; }
        .instr__now {
            font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
            color: #01DFE1; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 2px;
        }
        .instr__label { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 4px; }
        .instr__desc { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.5; }

        /* Viewfinder */
        .vf {
            flex: 1; position: relative; margin: 12px 16px;
            border-radius: 16px; overflow: hidden; background: #000;
        }
        .vf video, .vf canvas, .vf .vf__preview {
            position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
        }
        .vf canvas, .vf .vf__preview { display: none; }
        .vf--frozen video { display: none; }
        .vf--frozen canvas { display: block; }
        .vf--fallback-preview .vf__preview { display: block; }
        .vf--fallback-preview video { display: none; }

        /* Corner brackets */
        .vf__bracket {
            position: absolute; width: 36px; height: 36px;
            border-color: #01DFE1; border-style: solid; border-width: 0; z-index: 5;
            transition: border-color 300ms ease;
        }
        .vf__bracket--tl { top: 16px; left: 16px; border-top-width: 3px; border-left-width: 3px; border-radius: 4px 0 0 0; }
        .vf__bracket--tr { top: 16px; right: 16px; border-top-width: 3px; border-right-width: 3px; border-radius: 0 4px 0 0; }
        .vf__bracket--bl { bottom: 16px; left: 16px; border-bottom-width: 3px; border-left-width: 3px; border-radius: 0 0 0 4px; }
        .vf__bracket--br { bottom: 16px; right: 16px; border-bottom-width: 3px; border-right-width: 3px; border-radius: 0 0 4px 0; }

        /* Focus ring */
        .vf__focus {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 80px; height: 80px; z-index: 6; pointer-events: none;
            opacity: 0; transition: opacity 300ms ease;
        }
        .vf--live .vf__focus { opacity: 1; }
        .vf__focus-ring {
            width: 100%; height: 100%; border-radius: 50%;
            border: 2px solid rgba(1,223,225,0.5);
            animation: focusPulse 2s ease-in-out infinite;
        }
        .vf__focus-ring--locked {
            border-color: #22c55e; animation: none;
            box-shadow: 0 0 20px rgba(34,197,94,0.3);
        }
        .vf__focus-label {
            position: absolute; top: -24px; left: 50%; transform: translateX(-50%);
            font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
            color: #22c55e; background: rgba(0,0,0,0.6); padding: 2px 8px;
            border-radius: 4px; white-space: nowrap; letter-spacing: 0.1em;
            opacity: 0; transition: opacity 300ms ease;
        }
        .vf__focus-ring--locked + .vf__focus-label { opacity: 1; }

        @keyframes focusPulse {
            0%, 100% { transform: scale(1); opacity: 0.6; }
            50% { transform: scale(1.08); opacity: 1; }
        }

        /* Quality badge */
        .vf__badge {
            position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
            padding: 6px 14px; border-radius: 8px; font-size: 11px; font-weight: 700;
            z-index: 10; display: none; text-align: center;
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        }
        .vf__badge--warn {
            background: rgba(245,158,11,0.2); color: #FBBF24;
            border: 1px solid rgba(245,158,11,0.3); display: block;
        }
        .vf__badge--fail {
            background: rgba(239,68,68,0.2); color: #FCA5A5;
            border: 1px solid rgba(239,68,68,0.3); display: block;
        }

        /* Controls */
        .ctrl {
            flex-shrink: 0; padding: 16px 24px 20px;
            display: flex; align-items: center; justify-content: center; gap: 40px;
            background: rgba(10,14,26,0.95); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-top: 1px solid rgba(255,255,255,0.06);
        }
        .ctrl__btn {
            display: flex; flex-direction: column; align-items: center; gap: 6px;
            background: none; border: none; color: rgba(255,255,255,0.5);
            cursor: pointer; transition: color 200ms ease;
        }
        .ctrl__btn:active { transform: scale(0.92); }
        .ctrl__btn--retake .material-symbols-outlined { font-size: 28px; }
        .ctrl__btn--verify .material-symbols-outlined {
            font-size: 28px; color: #01DFE1; font-variation-settings: 'FILL' 1;
        }
        .ctrl__btn-label {
            font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.12em;
        }
        .ctrl__btn--verify .ctrl__btn-label { color: #01DFE1; }

        /* Shutter */
        .ctrl__shutter {
            width: 68px; height: 68px; border-radius: 50%;
            background: none; border: 4px solid rgba(255,255,255,0.3);
            padding: 4px; cursor: pointer; transition: all 200ms ease;
        }
        .ctrl__shutter:active { transform: scale(0.9); }
        .ctrl__shutter-inner {
            width: 100%; height: 100%; border-radius: 50%;
            background: linear-gradient(135deg, #711FFF, #5700d0);
            box-shadow: 0 0 20px rgba(113,31,255,0.4);
            transition: all 200ms ease;
        }
        .ctrl__shutter:active .ctrl__shutter-inner { background: linear-gradient(135deg, #5700d0, #400099); }
        .ctrl__shutter--uploading .ctrl__shutter-inner {
            background: rgba(255,255,255,0.1); animation: shutterPulse 1s ease-in-out infinite;
        }
        @keyframes shutterPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

        /* Dot Progress */
        .dots {
            flex-shrink: 0; display: flex; align-items: center; justify-content: center;
            gap: 8px; padding: 8px 0 20px; background: rgba(10,14,26,0.95);
        }
        .dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: rgba(255,255,255,0.15); transition: all 300ms ease;
        }
        .dot--done { background: #22c55e; }
        .dot--current { background: #01DFE1; width: 20px; border-radius: 4px; }
        .dot--pending { background: rgba(255,255,255,0.12); }

        /* Done Screen */
        .done {
            display: none; flex: 1; flex-direction: column;
            align-items: center; justify-content: center; gap: 20px;
            padding: 40px; text-align: center;
        }
        .done.show { display: flex; }
        .done__icon {
            width: 72px; height: 72px; border-radius: 50%;
            background: rgba(34,197,94,0.15); display: flex;
            align-items: center; justify-content: center;
        }
        .done__icon .material-symbols-outlined {
            font-size: 36px; color: #22c55e; font-variation-settings: 'FILL' 1;
        }
        .done__title { font-size: 22px; font-weight: 800; }
        .done__sub { font-size: 14px; color: rgba(255,255,255,0.5); }

        .app--done .instr, .app--done .vf, .app--done .ctrl, .app--done .dots { display: none; }
        .app--done .done { display: flex; }

        /* Connection status bar */
        .conn {
            position: fixed; bottom: 0; left: 0; right: 0;
            display: flex; align-items: center; justify-content: center;
            gap: 8px; padding: 6px 16px;
            background: rgba(10,14,26,0.95); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-top: 1px solid rgba(255,255,255,0.06);
            z-index: 30; font-size: 11px; font-weight: 600;
            letter-spacing: 0.04em; color: rgba(255,255,255,0.5);
        }
        .conn__dot {
            width: 8px; height: 8px; border-radius: 50%;
            transition: background 300ms ease;
        }
        .conn__dot--connected { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
        .conn__dot--uploading { background: #01DFE1; animation: focusPulse 1s ease-in-out infinite; }
        .conn__dot--reconnecting { background: #f59e0b; animation: focusPulse 0.8s ease-in-out infinite; }
        .conn__dot--error { background: #ef4444; }
    </style>
</head>
<body>
<div class="app" id="app">
    <div class="hdr">
        <button class="hdr__close" onclick="window.close()" aria-label="Close">
            <span class="material-symbols-outlined">close</span>
        </button>
        <span class="hdr__title">Cosmetic Capture</span>
        <span class="hdr__counter" id="hdrCounter">[1/${totalViews}]</span>
    </div>

    <div class="instr" id="instrCard">
        <div class="instr__icon-wrap">
            <span class="material-symbols-outlined" id="instrIcon">smartphone</span>
        </div>
        <div class="instr__body">
            <div class="instr__now">NOW CAPTURING</div>
            <div class="instr__label" id="instrLabel">—</div>
            <div class="instr__desc" id="instrDesc">—</div>
        </div>
    </div>

    <div class="vf" id="viewfinder">
        <video id="videoEl" autoplay playsinline muted></video>
        <canvas id="captureCanvas"></canvas>
        <img class="vf__preview" id="previewImg" alt="Preview" />
        <div class="vf__bracket vf__bracket--tl"></div>
        <div class="vf__bracket vf__bracket--tr"></div>
        <div class="vf__bracket vf__bracket--bl"></div>
        <div class="vf__bracket vf__bracket--br"></div>
        <div class="vf__focus" id="focusRing">
            <div class="vf__focus-ring" id="focusRingCircle"></div>
            <div class="vf__focus-label" id="focusLabel">FOCUS LOCKED</div>
        </div>
        <div class="vf__badge" id="qualityBadge"></div>
    </div>

    <div class="ctrl" id="controls">
        <button class="ctrl__btn ctrl__btn--retake" id="btnRetake" onclick="doRetake()" style="visibility:hidden;">
            <span class="material-symbols-outlined">replay</span>
            <span class="ctrl__btn-label">Retake</span>
        </button>
        <button class="ctrl__shutter" id="btnShutter" onclick="doCapture()">
            <div class="ctrl__shutter-inner"></div>
        </button>
        <button class="ctrl__btn ctrl__btn--verify" id="btnVerify" onclick="doVerify()" style="visibility:hidden;">
            <span class="material-symbols-outlined">check_circle</span>
            <span class="ctrl__btn-label">Verify</span>
        </button>
    </div>

    <div class="dots" id="dotsBar"></div>

    <div class="done" id="doneScreen">
        <div class="done__icon">
            <span class="material-symbols-outlined">check_circle</span>
        </div>
        <h2 class="done__title">All Photos Captured</h2>
        <p class="done__sub">You may close this page and return the device to the operator.</p>
    </div>

    <div class="conn" id="connStatus">
        <div class="conn__dot conn__dot--connected"></div>
        <span class="conn__label">Connected</span>
    </div>
</div>

<script>
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
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 3000);
        var res = await fetch(base + '/api/ping', {
            method: 'GET',
            headers: { 'Bypass-Tunnel-Reminder': 'true' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
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
</script>
</body>
</html>`;
}

/**
 * Start the cosmetic photo server
 * @param {string} sessionId - The device UUID / session identifier
 * @param {function} onPhoto - Callback when a photo is uploaded: ({ view, url, sessionId })
 * @returns {Promise<{ url: string, port: number, qrDataUrl: string }>}
 */
async function startServer(sessionId, onPhoto) {
    if (server) {
        await stopServer();
    }

    // Ensure photo directory exists
    const sessionDir = path.join(PHOTO_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    currentSession = sessionId;
    onPhotoCallback = onPhoto;

    return new Promise((resolve, reject) => {
        server = http.createServer(async (req, res) => {
            // CORS headers (for mobile browser)
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            // GET / → serve capture page
            if (req.method === 'GET' && (req.url === '/' || req.url === '/capture')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(generateCapturePage(sessionId, PHOTO_VIEWS));
                return;
            }

            // GET /photos/:file → serve uploaded photo
            if (req.method === 'GET' && req.url.startsWith('/photos/')) {
                const filename = path.basename(req.url);
                const filePath = path.join(sessionDir, filename);
                if (fs.existsSync(filePath)) {
                    const ext = path.extname(filename).toLowerCase();
                    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
                    res.writeHead(200, { 'Content-Type': mime });
                    fs.createReadStream(filePath).pipe(res);
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
                return;
            }

            // POST /api/start-upload → technician started choosing/uploading
            if (req.method === 'POST' && req.url === '/api/start-upload') {
                try {
                    const body = await parseBody(req);
                    const { view, session } = body;
                    if (session === sessionId && view) {
                        if (onPhotoCallback) {
                            onPhotoCallback({
                                view,
                                status: 'syncing',
                                sessionId
                            });
                        }
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (err) {
                    res.writeHead(500);
                    res.end();
                }
                return;
            }

            // POST /api/upload → receive photo
            if (req.method === 'POST' && req.url === '/api/upload') {
                try {
                    const body = await parseBody(req);
                    const { view, image, session } = body;

                    if (!view || !image || session !== sessionId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
                        return;
                    }

                    // Save the image
                    const buffer = Buffer.from(image, 'base64');
                    const filename = `${view}.jpg`;
                    const filePath = path.join(sessionDir, filename);
                    fs.writeFileSync(filePath, buffer);

                    const localIP = getLocalIP();
                    const port = server.address().port;
                    const imageUrl = `http://${localIP}:${port}/photos/${filename}`;

                    console.log(`[CosmeticServer] Photo saved: ${view} → ${filePath}`);

                    // Notify renderer
                    if (onPhotoCallback) {
                        onPhotoCallback({
                            view,
                            url: imageUrl,
                            localPath: filePath,
                            // file:// URL persists even after HTTP server stops
                            localFileUrl: `file:///${filePath.replace(/\\/g, '/')}`,
                            sessionId
                        });
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, url: imageUrl }));
                } catch (err) {
                    console.error('[CosmeticServer] Upload error:', err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
                return;
            }

            // GET /api/ping → health check for mobile connectivity
            if (req.method === 'GET' && req.url === '/api/ping') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, session: sessionId, ts: Date.now() }));
                return;
            }

            // GET /api/status → session status
            if (req.method === 'GET' && req.url === '/api/status') {
                const photos = {};
                PHOTO_VIEWS.forEach(v => {
                    const filePath = path.join(sessionDir, `${v.key}.jpg`);
                    if (fs.existsSync(filePath)) {
                        const localIP = getLocalIP();
                        const port = server.address().port;
                        photos[v.key] = `http://${localIP}:${port}/photos/${v.key}.jpg`;
                    }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ session: sessionId, photos, count: Object.keys(photos).length, total: PHOTO_VIEWS.length }));
                return;
            }

            // Fallback
            res.writeHead(404);
            res.end('Not found');
        });

        server.listen(0, '0.0.0.0', async () => {
            const port = server.address().port;
            const localIP = getLocalIP();
            let publicUrl = `http://${localIP}:${port}`;

            console.log(`[CosmeticServer] Local server running at ${publicUrl}`);

            // Create tunnel for public access via localtunnel
            tunnelSubdomain = `fixtech-${sessionId.replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 10)}`;
            await establishTunnel(port);
            if (tunnel) {
                publicUrl = tunnel.url;
            }

            const localUrl = `http://${localIP}:${port}`;

            // Generate QR code for the public (or fallback) URL
            let qrDataUrl = '';
            try {
                qrDataUrl = await QRCode.toDataURL(publicUrl, {
                    width: 256,
                    margin: 1,
                    color: { dark: '#000000', light: '#FFFFFF' }
                });
            } catch (e) {
                console.error('[CosmeticServer] QR generation failed:', e);
            }

            resolve({ url: publicUrl, localUrl, port, qrDataUrl, localIP });
        });

        server.on('error', reject);
    });
}

/**
 * Establish (or re-establish) the localtunnel connection
 */
async function establishTunnel(port) {
    // Clean up old tunnel if exists
    if (tunnel) {
        try { tunnel.close(); } catch (e) { /* ignore */ }
        tunnel = null;
    }

    try {
        const tunnelPromise = localtunnel({
            port: port,
            subdomain: tunnelSubdomain,
            local_host: '127.0.0.1'
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Tunnel connection timed out after 15s')), 15000)
        );

        tunnel = await Promise.race([tunnelPromise, timeoutPromise]);
        console.log(`[CosmeticServer] Public tunnel established at: ${tunnel.url}`);

        tunnel.on('close', () => {
            console.log('[CosmeticServer] Public tunnel closed, attempting reconnect...');
            scheduleTunnelReconnect(port);
        });

        tunnel.on('error', (err) => {
            console.error('[CosmeticServer] Tunnel error:', err.message);
            scheduleTunnelReconnect(port);
        });

        return tunnel;
    } catch (err) {
        console.warn('[CosmeticServer] Failed to establish tunnel:', err.message);
        if (tunnel) {
            try { tunnel.close(); } catch (e) { /* ignore */ }
            tunnel = null;
        }
        scheduleTunnelReconnect(port);
        return null;
    }
}

/**
 * Schedule a tunnel reconnection attempt with backoff
 */
let reconnectAttempt = 0;
function scheduleTunnelReconnect(port) {
    // Don't reconnect if server has been stopped
    if (!server || !currentSession) return;

    if (tunnelReconnectTimer) {
        clearTimeout(tunnelReconnectTimer);
    }

    const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempt), 30000);
    reconnectAttempt++;

    console.log(`[CosmeticServer] Scheduling tunnel reconnect in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt})`);

    tunnelReconnectTimer = setTimeout(async () => {
        if (!server || !currentSession) return;
        console.log(`[CosmeticServer] Attempting tunnel reconnect (attempt ${reconnectAttempt})...`);
        const result = await establishTunnel(port);
        if (result) {
            reconnectAttempt = 0; // Reset on success
        }
    }, delay);
}

/**
 * Stop the cosmetic server
 */
async function stopServer() {
    // Cancel any pending tunnel reconnect
    if (tunnelReconnectTimer) {
        clearTimeout(tunnelReconnectTimer);
        tunnelReconnectTimer = null;
    }
    reconnectAttempt = 0;
    tunnelSubdomain = null;

    if (tunnel) {
        try { tunnel.close(); } catch (e) { /* ignore */ }
        tunnel = null;
    }
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                console.log('[CosmeticServer] Server stopped');
                server = null;
                currentSession = null;
                onPhotoCallback = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Get all photos for a session
 */
function getSessionPhotos(sessionId) {
    const sessionDir = path.join(PHOTO_DIR, sessionId);
    const photos = {};

    if (!fs.existsSync(sessionDir)) return photos;

    PHOTO_VIEWS.forEach(v => {
        const filePath = path.join(sessionDir, `${v.key}.jpg`);
        if (fs.existsSync(filePath)) {
            photos[v.key] = filePath;
        }
    });

    return photos;
}

function serverPort() {
    return server ? server.address().port : 0;
}

/**
 * Clean up photos for a completed session
 * Should only be called when the session is fully submitted/completed.
 */
function cleanupSessionPhotos(sessionId) {
    const sessionDir = path.join(PHOTO_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`[CosmeticServer] Cleaned up photos for session: ${sessionId}`);
        } catch (err) {
            console.warn(`[CosmeticServer] Failed to clean up photos: ${err.message}`);
        }
    }
}

/**
 * Check if a cosmetic session is currently active
 * @returns {boolean}
 */
function isSessionActive() {
    return !!(server && currentSession);
}

function getActiveSessionId() {
    return currentSession;
}

module.exports = {
    startServer,
    stopServer,
    getSessionPhotos,
    cleanupSessionPhotos,
    isSessionActive,
    getActiveSessionId,
    PHOTO_VIEWS,
    serverPort,
    localIP: getLocalIP
};
