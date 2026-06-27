#!/usr/bin/env python3
"""
IMTI Python Sidecar — pymobiledevice3 bridge (v9.30.1 compatible).

Persistent process. Reads newline-delimited JSON from stdin,
writes newline-delimited JSON to stdout. Non-JSON output is
NEVER written to stdout — all logging goes to stderr.
"""

import sys
import json
import traceback
import subprocess
import platform
import asyncio

try:
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.diagnostics import DiagnosticsService
    _HAS_PMD3 = True
    _PMD3_ERROR = None
except Exception as _import_err:
    _HAS_PMD3 = False
    _PMD3_ERROR = str(_import_err)

GESTALT_SERIAL_KEYS = [
    'SerialNumber', 'MLBSerialNumber', 'UniqueChipID', 'BatterySerialNumber',
    'DeviceSupportsBatteryModuleAuthentication', 'PanelSerialNumber',
    'RawPanelSerialNumber', 'ScreenSerialNumber', 'CoverglassSerialNumber',
    'DisplayDriverICChipID', 'FrontFacingCameraModuleSerialNumber',
    'RearFacingCameraModuleSerialNumber', 'RearFacingTelephotoCameraModuleSerialNumber',
    'RearFacingSuperWideCameraModuleSerialNumber', 'FrontFacingIRCameraModuleSerialNumber',
    'FrontFacingIRStructuredLightProjectorModuleSerialNumber', 'MesaSerialNumber',
    'PearlIDCapability', 'PearlCameraCapability', 'NFCUniqueChipID',
    'BasebandSerialNumber', 'BasebandBoardSnum', 'BasebandFirmwareVersion',
    'AmbientLightSensorSerialNumber', 'ArcModuleSerialNumber', 'JasperSerialNumber',
    'LunaFlexSerialNumber', 'LynxSerialNumber', 'SavageSerialNumber',
    'YonkersSerialNumber', 'RosalineSerialNumber',
]

LOCKDOWN_KEYS = [
    'ActivationState', 'ActivationStateAcknowledged', 'IsSupervised',
    'ManagedDeviceInfo', 'IMEI', 'IMEI2', 'MEID', 'SerialNumber',
    'MLBSerialNumber', 'UniqueChipID', 'PhoneNumber', 'ProductType',
    'ProductVersion', 'BasebandVersion', 'BasebandSerialNumber',
    'TapticEngineSerialNumber', 'MainSpeakerSerialNumber',
]

class BytesEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, bytes):
            try:
                decoded = obj.decode('ascii').strip('\x00').strip()
                return decoded if decoded else obj.hex()
            except Exception:
                return obj.hex()
        return super().default(obj)

def _write(obj: dict):
    sys.stdout.write(json.dumps(obj, cls=BytesEncoder) + '\n')
    sys.stdout.flush()

def _log(msg: str):
    sys.stderr.write(f'[sidecar] {msg}\n')
    sys.stderr.flush()

def _serial_from_value(value):
    if value is None: return None
    if isinstance(value, bytes):
        try:
            s = value.decode('ascii').strip('\x00').strip()
            return s if s else value.hex()
        except Exception:
            return value.hex()
    if isinstance(value, str):
        s = value.strip()
        return s if s else None
    return str(value)

def _pick_serial(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if v is not None:
            s = _serial_from_value(v)
            if s: return s
    return None

async def cmd_ping(_args):
    return {'pong': True}

async def cmd_inspect_api(_args):
    import inspect
    methods = {}
    for m in dir(DiagnosticsService):
        if not m.startswith('_'):
            try:
                methods[m] = str(inspect.signature(getattr(DiagnosticsService, m)))
            except Exception:
                methods[m] = 'no signature'
    return methods

async def cmd_get_activation_details(args):
    udid = args.get('udid')
    if not udid: raise ValueError('udid is required')

    async with await create_using_usbmux(serial=udid) as lockdown:
        all_vals = await lockdown.get_value()
        if not isinstance(all_vals, dict): all_vals = {}
        result = {}
        for key in LOCKDOWN_KEYS:
            val = all_vals.get(key)
            result[key] = _serial_from_value(val) if isinstance(val, (bytes, str)) else val
        return result

async def cmd_get_component_serials(args):
    udid = args.get('udid')
    if not udid: raise ValueError('udid is required')

    # DDI Auto-mount logic for deeper hardware queries
    try:
        from pymobiledevice3.services.mobile_image_mounter import auto_mount
        _log("Attempting to auto-mount DDI...")
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            async with await create_using_usbmux(serial=udid) as lockdown_mount:
                await auto_mount(lockdown_mount)
            _log("DDI mounted successfully.")
        finally:
            sys.stdout = old_stdout
            
        if platform.system() == "Windows":
            await asyncio.sleep(2)
    except ImportError:
        pass
    except Exception as e:
        _log(f"DDI auto_mount failed or USB reset (expected on Windows): {e}")

    # Re-establish connection after potential USB reset
    lockdown = None
    for attempt in range(5):
        try:
            lockdown = await create_using_usbmux(serial=udid)
            break
        except Exception as e:
            _log(f"usbmux reconnect attempt {attempt+1} failed: {e}")
            await asyncio.sleep(2)
            
    if not lockdown:
        raise ValueError("Could not connect to device after DDI mount attempt.")

    async with lockdown:
        # Try to read from Instruments relay first for deep DeviceInfo
        instruments_data = {}
        try:
            from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
            from pymobiledevice3.services.dvt.instruments.device_info import DeviceInfo
            async with DvtSecureSocketProxyService(lockdown=lockdown) as dvt:
                device_info = DeviceInfo(dvt)
                for method_name in ['probedictionary', 'system_information', 'hardware_information']:
                    if hasattr(device_info, method_name):
                        method = getattr(device_info, method_name)
                        try:
                            res = method()
                            if asyncio.iscoroutine(res):
                                res = await res
                            if isinstance(res, dict):
                                instruments_data.update(res)
                        except Exception as e:
                            _log(f"DeviceInfo.{method_name} failed: {e}")
        except Exception as e:
            _log(f"Instruments relay DeviceInfo failed: {e}")

        async with DiagnosticsService(lockdown) as diag:
            gestalt = {}
            gestalt_available = False
            try:
                gestalt = await diag.mobilegestalt(keys=GESTALT_SERIAL_KEYS)
                gestalt_available = True
                _log(f'MobileGestalt returned {len(gestalt)} keys')
            except Exception as e:
                _log(f'MobileGestalt failed (likely iOS 17.4+): {e}')

            lockdown_vals = {}
            try:
                lockdown_vals = await lockdown.get_value() or {}
            except Exception as e:
                _log(f'lockdown get_value failed: {e}')

            def _find_in_dict(d, keys):
                if not isinstance(d, dict): return None
                for k in keys:
                    if k in d: return d[k]
                for v in d.values():
                    if isinstance(v, dict):
                        res = _find_in_dict(v, keys)
                        if res is not None: return res
                    elif isinstance(v, list):
                        for item in v:
                            if isinstance(item, dict):
                                res = _find_in_dict(item, keys)
                                if res is not None: return res
                return None

            def _g(*keys):
                for k in keys:
                    v = gestalt.get(k) or lockdown_vals.get(k)
                    if v is not None:
                        s = _serial_from_value(v)
                        if s: return s
                if instruments_data:
                    v = _find_in_dict(instruments_data, keys)
                    if v is not None:
                        s = _serial_from_value(v)
                        if s: return s
                return None

            result = {}

            # ── Battery ───────────────────────────────────────────────────────
            battery = {
                'detected': True,
                'serial': _g('BatterySerialNumber'),
                'supports_authentication': gestalt.get('DeviceSupportsBatteryModuleAuthentication'),
            }
            try:
                batt_reg = await diag.ioregistry(name='AppleSmartBattery')
                if isinstance(batt_reg, dict):
                    battery['CycleCount'] = batt_reg.get('CycleCount')
                    # If MobileGestalt didn't give us a serial, try IORegistry
                    if not battery['serial']:
                        battery['serial'] = _pick_serial(batt_reg, 'Serial', 'BatterySerialNumber', 'SerialNumber')
            except Exception: pass
            
            # Authenticated check via BatteryCenter
            battery_authenticated = None
            try:
                async with await create_using_usbmux(serial=udid) as bc_lockdown:
                    bc_svc = await bc_lockdown.start_lockdown_service('com.apple.BatteryCenter')
                    async with bc_svc as bc:
                        bc_data = await bc.recv_plist()
                        if isinstance(bc_data, dict):
                            battery_authenticated = bc_data.get('AuthenticationStatus', bc_data.get('BatteryAuthenticated'))
            except Exception: pass
            battery['battery_authenticated'] = battery_authenticated
            result['battery'] = battery

            # ── Display ───────────────────────────────────────────────────────
            display = {
                'detected': True,
                'panel_serial': _g('PanelSerialNumber', 'RawPanelSerialNumber', 'ScreenSerialNumber'),
                'coverglass_serial': _g('CoverglassSerialNumber'),
                'driver_chip_id': _g('DisplayDriverICChipID'),
                'module_serial': None,
            }

            # IORegistry Expanded Fallback for Display
            for disp_name in ['disp0', 'AppleCLCD2', 'AppleCLCD']:
                try:
                    disp_reg = await diag.ioregistry(name=disp_name)
                    if isinstance(disp_reg, dict):
                        if not display['panel_serial']:
                            display['panel_serial'] = _pick_serial(disp_reg, 'serial-number', 'SerialNumber', 'DisplaySerialNumber', 'PanelSerialNumber')
                            if display['panel_serial']: break
                except Exception: continue

            try:
                fb = await diag.ioregistry(ioclass='IOMobileFramebuffer')
                if isinstance(fb, dict):
                    display['module_serial'] = _pick_serial(fb, 'DisplayModuleSerial', 'ModuleSerialNumber', 'PanelSerialNumber')
            except Exception: pass
            result['display'] = display

            # ── Face ID ───────────────────────────────────────────────────────
            has_face_id = bool(gestalt.get('PearlIDCapability') or gestalt.get('PearlCameraCapability'))
            face_id = {'detected': False, 'has_face_id': has_face_id}
            
            for pearl_name in ['AppleH13PearlCam', 'AppleH14PearlCam', 'AppleH15PearlCam', 'AppleH16PearlCam', 'ApplePearlCam']:
                try:
                    data = await diag.ioregistry(name=pearl_name)
                    if isinstance(data, dict):
                        face_id['detected'] = True
                        face_id['PairingState'] = data.get('PairingState')
                        face_id['serial'] = _pick_serial(data, 'PearlCameraSerialNumber', 'SerialNumber', 'ModuleSerial', 'CameraSerial')
                        break
                except Exception: continue
            result['face_id'] = face_id

            # ── Cameras (Aggressive IORegistry Fallbacks) ─────────────────────
            front_cam = {
                'detected': bool(_g('FrontFacingCameraModuleSerialNumber')),
                'serial': _g('FrontFacingCameraModuleSerialNumber'),
            }
            rear_cam = {
                'detected': bool(_g('RearFacingCameraModuleSerialNumber')),
                'serial': _g('RearFacingCameraModuleSerialNumber'),
            }

            # If MobileGestalt failed, scrape the Image Signal Processor & Camera Interfaces
            if not front_cam['serial'] or not rear_cam['serial']:
                cam_nodes = ['isp', 'AppleCameraInterface', 'AppleH13CamIn', 'AppleH14CamIn', 'AppleH15CamIn', 'AppleH16CamIn']
                for node in cam_nodes:
                    try:
                        data = await diag.ioregistry(name=node)
                        if isinstance(data, dict):
                            if not rear_cam['serial']:
                                rear_cam['serial'] = _pick_serial(data, 'RearCameraSerialNumber', 'ModuleSerialNumber', 'serial-number')
                            if not front_cam['serial']:
                                front_cam['serial'] = _pick_serial(data, 'FrontCameraSerialNumber', 'FrontFacingCameraModuleSerialNumber')
                    except Exception: continue

            # ── Log-Scraping Fallback via com.apple.crashreportcopymobile ────────
            if not display['panel_serial'] or not front_cam['serial'] or not rear_cam['serial']:
                _log("Serials missing. Attempting log-scraping fallback via com.apple.crashreportcopymobile...")
                try:
                    import re
                    from pymobiledevice3.services.afc import AfcService
                    
                    scraped_display = None
                    scraped_front = None
                    scraped_rear = None

                    display_re = re.compile(r'(?:Panel|Display|Screen).*?([A-Za-z0-9]{15,22})|([Ff]7[Cc][A-Za-z0-9]{14,19}|[Gg]9[NnPp][A-Za-z0-9]{14,19}|[Cc]0[Nn][A-Za-z0-9]{14,19})')
                    front_cam_re = re.compile(r'(?:Front(?:Facing)?Camera(?:Module)?SerialNumber|FrontCamera).*?([A-Za-z0-9]{15,22})', re.IGNORECASE)
                    rear_cam_re = re.compile(r'(?:Rear(?:Facing)?Camera(?:Module)?SerialNumber|RearCamera).*?([A-Za-z0-9]{15,22})', re.IGNORECASE)

                    import time
                    start_time = time.time()
                    timeout = 10.0

                    async with AfcService(lockdown=lockdown, service_name='com.apple.crashreportcopymobile') as afc:
                        files_to_scrape = []
                        
                        def gather_files(dir_path):
                            if time.time() - start_time > timeout: return
                            try:
                                entries = afc.listdir(dir_path)
                                for entry in entries:
                                    if time.time() - start_time > timeout: break
                                    if entry in ['.', '..']: continue
                                    full_path = f"{dir_path}/{entry}" if dir_path != '/' else f"/{entry}"
                                    try:
                                        if afc.isdir(full_path):
                                            gather_files(full_path)
                                        else:
                                            if entry.endswith('.ips') or entry.endswith('.log') or entry.endswith('.synced'):
                                                files_to_scrape.append(full_path)
                                    except Exception: pass
                            except Exception: pass

                        for target_dir in ['/Analytics', '/ProxAnalytics', '/DiagnosticLogs', '/CrashReporter/Panics', '/Panics']:
                            if time.time() - start_time > timeout: break
                            gather_files(target_dir)
                            
                        files_to_scrape.sort(reverse=True)
                        
                        for f in files_to_scrape[:50]:
                            if time.time() - start_time > timeout:
                                _log("Log scraping timeout reached (10s max).")
                                break
                            if (display['panel_serial'] or scraped_display) and (front_cam['serial'] or scraped_front) and (rear_cam['serial'] or scraped_rear):
                                break
                            
                            try:
                                content_bytes = afc.get_file_contents(f)
                                if not content_bytes: continue
                                text = content_bytes.decode('utf-8', errors='ignore')
                                
                                if not display['panel_serial'] and not scraped_display:
                                    m = display_re.search(text)
                                    if m: scraped_display = m.group(1) or m.group(2)
                                
                                if not front_cam['serial'] and not scraped_front:
                                    m = front_cam_re.search(text)
                                    if m: scraped_front = m.group(1)
                                    
                                if not rear_cam['serial'] and not scraped_rear:
                                    m = rear_cam_re.search(text)
                                    if m: scraped_rear = m.group(1)
                            except Exception: pass

                    if scraped_display and not display['panel_serial']:
                        display['panel_serial'] = scraped_display
                        _log(f"Scraped display panel serial: {scraped_display}")
                    if scraped_front and not front_cam['serial']:
                        front_cam['serial'] = scraped_front
                        front_cam['detected'] = True
                        _log(f"Scraped front camera serial: {scraped_front}")
                    if scraped_rear and not rear_cam['serial']:
                        rear_cam['serial'] = scraped_rear
                        rear_cam['detected'] = True
                        _log(f"Scraped rear camera serial: {scraped_rear}")

                except Exception as e:
                    _log(f"CrashReport log scraping failed: {e}")

            result['front_camera'] = front_cam
            result['rear_camera'] = rear_cam

            # ── Baseband & Secure Enclave ─────────────────────────────────────
            result['baseband'] = {
                'detected': True,
                'serial': _g('BasebandSerialNumber', 'BasebandBoardSnum'),
                'firmware_version': _g('BasebandFirmwareVersion'),
            }
            result['secure_enclave'] = {
                'detected': bool(_g('MesaSerialNumber')),
                'serial': _g('MesaSerialNumber'),
            }

            result['raw_instruments_data'] = instruments_data
            result['raw_gestalt'] = gestalt
            result['raw_lockdown'] = lockdown_vals
            result['gestalt_available'] = gestalt_available
            return result

async def cmd_get_service_history(args):
    udid = args.get('udid')
    if not udid: raise ValueError('udid is required')
    async with await create_using_usbmux(serial=udid) as lockdown:
        itunes_values = await lockdown.get_value(domain='com.apple.mobile.itunes')
        if not isinstance(itunes_values, dict): itunes_values = {}
        service_history_raw = itunes_values.get('ServiceHistory', {})
        service_history = service_history_raw.get('History', []) if isinstance(service_history_raw, dict) else []
        
        return {
            'service_history': service_history,
            'non_genuine_parts': itunes_values.get('NonGenuineParts', []),
        }

async def cmd_fetch_companion_manifest(args):
    """
    Connects to the locally tunneled port 8080 (forwarded by deploy_companion.py)
    and fetches the MobileGestalt JSON from the running iOS Companion App.
    """
    import urllib.request
    import json
    
    try:
        req = urllib.request.Request("http://127.0.0.1:8080/manifest")
        with urllib.request.urlopen(req, timeout=5.0) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data
    except Exception as e:
        _log(f"Failed to connect to Companion App on device: {e}")
        return None

COMMANDS = {
    'ping': cmd_ping,
    'inspect_api': cmd_inspect_api,
    'get_activation_details': cmd_get_activation_details,
    'get_component_serials': cmd_get_component_serials,
    'get_service_history': cmd_get_service_history,
    'fetch_companion_manifest': cmd_fetch_companion_manifest,
}

def main():
    if not _HAS_PMD3:
        _write({'id': 'startup', 'success': False, 'error': f'pymobiledevice3 not installed: {_PMD3_ERROR}'})
        sys.exit(1)

    _write({'id': 'startup', 'success': True, 'data': {'ready': True}})

    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        msg_id = None
        try:
            msg = json.loads(line)
            msg_id = msg.get('id', 'unknown')
            command = msg.get('command', '')
            args = msg.get('args', {})

            handler = COMMANDS.get(command)
            if not handler:
                _write({'id': msg_id, 'success': False, 'error': f'Unknown command: {command}'})
                continue

            data = asyncio.run(handler(args))
            _write({'id': msg_id, 'success': True, 'data': data})

        except Exception as e:
            _log(traceback.format_exc())
            _write({'id': msg_id or 'unknown', 'success': False, 'error': str(e)})

if __name__ == '__main__':
    main()