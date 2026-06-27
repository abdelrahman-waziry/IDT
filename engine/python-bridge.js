/**
 * Python Bridge — Manages the pymobiledevice3 sidecar lifecycle.
 *
 * Uses only Node built-in modules: child_process, readline, crypto, path.
 *
 * Exports:
 *   initialize()   → Promise<void>
 *   isReady()       → boolean
 *   send(cmd, args, timeoutMs) → Promise<data>
 *   shutdown()
 *   on(event, fn)   — proxies sidecar process events
 *
 * @module engine/python-bridge
 */

const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const path = require('path');
const { app } = require('electron');

const LOG_PREFIX = '[PythonBridge]';

// ─── State ───────────────────────────────────────────────────────────────────

let sidecar = null;          // ChildProcess
let rl = null;               // readline Interface on stdout
let ready = false;
let pending = new Map();     // Map<id, { resolve, reject, timer }>
let restartAttempted = false;
let eventListeners = [];     // [{event, fn}]

const fs = require('fs');

// ─── Path resolution ─────────────────────────────────────────────────────────

function _pythonExePath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'python', 'python.exe');
    }
    const bundled = path.join(__dirname, '..', 'resources', 'python', 'python.exe');
    if (fs.existsSync(bundled)) {
        return bundled;
    }
    return process.platform === 'win32' ? 'py' : 'python3';
}

function _pythonArgs() {
    if (!app.isPackaged && !fs.existsSync(path.join(__dirname, '..', 'resources', 'python', 'python.exe'))) {
        if (process.platform === 'win32') {
            return ['-3.12', _sidecarScriptPath()];
        }
    }
    return [_sidecarScriptPath()];
}

function _sidecarScriptPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'python', 'sidecar.py');
    }
    return path.join(__dirname, '..', 'resources', 'python', 'sidecar.py');
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let initPromise = null;

function initialize() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
        const pythonExe = _pythonExePath();
        const args = _pythonArgs();

        console.log(`${LOG_PREFIX} Spawning sidecar: ${pythonExe} ${args.join(' ')}`);

        sidecar = spawn(pythonExe, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        sidecar.stderr.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            lines.forEach(l => console.log(`${LOG_PREFIX} ${l}`));
        });

        rl = readline.createInterface({ input: sidecar.stdout });

        const startupTimeout = setTimeout(() => {
            if (!startupHandled) {
                startupHandled = true;
                reject(new Error('Sidecar startup timed out after 60 s'));
                _cleanup();
            }
        }, 60000);

        let startupHandled = false;

        rl.on('line', (line) => {
            let msg;
            try {
                msg = JSON.parse(line);

                // 🛑 DEBUG LOG ADDED HERE: Inspect exactly what Python yielded
                if (msg.id !== 'startup') {
                    console.log(`\n${LOG_PREFIX} Parsed stdout for [${msg.id}]:`, JSON.stringify(msg, null, 2));
                }
            } catch {
                console.warn(`${LOG_PREFIX} Non-JSON stdout line: ${line}`);
                return;
            }

            if (!startupHandled && msg.id === 'startup') {
                startupHandled = true;
                clearTimeout(startupTimeout);

                if (msg.success) {
                    ready = true;
                    restartAttempted = false;
                    console.log(`${LOG_PREFIX} Sidecar ready`);
                    require('fs').appendFileSync('python_bridge_debug.log', `[PythonBridge] Sidecar ready\n`);
                    resolve();
                } else {
                    const errMsg = msg.error || 'Sidecar startup failed';
                    require('fs').appendFileSync('python_bridge_debug.log', `[PythonBridge] Startup failed: ${errMsg}\n`);
                    reject(new Error(errMsg));
                    _cleanup();
                }
                return;
            }

            if (msg.id && pending.has(msg.id)) {
                const { resolve: res, reject: rej, timer } = pending.get(msg.id);
                pending.delete(msg.id);
                clearTimeout(timer);

                if (msg.success) {
                    res(msg.data);
                } else {
                    rej(new Error(msg.error || 'Sidecar command failed'));
                }
            }
        });

        sidecar.on('exit', (code, signal) => {
            console.warn(`${LOG_PREFIX} Sidecar exited (code=${code}, signal=${signal})`);
            require('fs').appendFileSync('python_bridge_debug.log', `[PythonBridge] Sidecar exited code=${code} signal=${signal}\n`);
            _rejectAll('Sidecar process exited');
            ready = false;
            initPromise = null;

            if (!restartAttempted) {
                restartAttempted = true;
                console.log(`${LOG_PREFIX} Scheduling auto-restart in 2 s…`);
                setTimeout(() => {
                    initialize().catch(err => {
                        console.error(`${LOG_PREFIX} Auto-restart failed:`, err.message);
                    });
                }, 2000);
            }
        });

        sidecar.on('error', (err) => {
            console.error(`${LOG_PREFIX} Sidecar spawn error:`, err.message);
            require('fs').appendFileSync('python_bridge_debug.log', `[PythonBridge] Sidecar spawn error: ${err.stack || err.message}\n`);
            if (!startupHandled) {
                clearTimeout(startupTimeout);
                initPromise = null;
                reject(err);
            }
        });

        eventListeners.forEach(({ event, fn }) => {
            sidecar.on(event, fn);
        });
    });

    return initPromise;
}

function isReady() {
    return ready;
}

async function send(command, args = {}, timeoutMs = 120000) {
    if (!ready || !sidecar || !sidecar.stdin.writable) {
        if (initPromise) {
            console.log(`${LOG_PREFIX} Waiting for sidecar to finish initialization...`);
            await initPromise;
        } else {
            console.log(`${LOG_PREFIX} Sidecar not initialized, triggering auto-start...`);
            await initialize();
        }
    }

    return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`Sidecar command "${command}" timed out after ${timeoutMs} ms`));
            }
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });

        const payload = JSON.stringify({ id, command, args }) + '\n';
        sidecar.stdin.write(payload, (err) => {
            if (err) {
                clearTimeout(timer);
                pending.delete(id);
                reject(err);
            }
        });
    });
}

function shutdown() {
    console.log(`${LOG_PREFIX} Shutting down sidecar`);
    _cleanup();
}

function on(event, fn) {
    eventListeners.push({ event, fn });
    if (sidecar) {
        sidecar.on(event, fn);
    }
}

function _rejectAll(reason) {
    for (const [id, { reject, timer }] of pending) {
        clearTimeout(timer);
        reject(new Error(reason));
    }
    pending.clear();
}

function _cleanup() {
    ready = false;
    initPromise = null;
    if (rl) {
        rl.close();
        rl = null;
    }
    if (sidecar) {
        try { sidecar.kill(); } catch { /* ignore */ }
        sidecar = null;
    }
    _rejectAll('Sidecar shut down');
}

module.exports = { initialize, isReady, send, shutdown, on };