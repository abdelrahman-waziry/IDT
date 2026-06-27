import os
import sys
import subprocess
import time
import json
import asyncio
from pymobiledevice3.cli.cli_common import Command
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.installation_proxy import InstallationProxyService
from pymobiledevice3.services.dvt.instruments.device_info import DeviceInfo

SIDELOADLY_PATH = os.environ.get("SIDELOADLY_PATH", r"C:\Program Files\Sideloadly\sideloadly.exe")

async def forward_port(udid: str, remote_port: int, local_port: int):
    """
    Tunnels a local port to the device.
    Uses pymobiledevice3 port forwarding.
    """
    print(f"[CompanionDeploy] Forwarding local port {local_port} to device port {remote_port}")
    # Execute the pymobiledevice3 tunnel command in the background
    tunnel_cmd = [
        sys.executable, "-m", "pymobiledevice3", "forward", 
        str(local_port), str(remote_port), "--udid", udid
    ]
    proc = subprocess.Popen(tunnel_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc

def sign_and_install_sideloadly(ipa_path: str, udid: str, apple_id: str, password: str):
    """
    Uses Sideloadly Windows CLI to sign and install the IPA using anisette authentication.
    """
    print("[CompanionDeploy] Initiating Sideloadly CLI for Anisette Code Signing...")
    if not os.path.exists(SIDELOADLY_PATH):
        raise FileNotFoundError(f"Sideloadly CLI not found at {SIDELOADLY_PATH}")
    
    cmd = [
        SIDELOADLY_PATH,
        "--ipa", ipa_path,
        "--udid", udid,
        "--appleid", apple_id,
        "--password", password,
        "--run" # Auto install
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"Sideloadly Failed: {result.stderr}")
    print("[CompanionDeploy] Sideloadly signing and installation successful!")

async def deploy_companion(udid: str, apple_id: str, password: str):
    """
    Main orchestration function:
    1. Signs and installs the Companion App IPA using Sideloadly.
    2. Opens a local port forward to 8080.
    """
    ipa_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "companion_app", "FixtechCompanion.ipa"))
    
    if not os.path.exists(ipa_path):
        print("[CompanionDeploy] Note: FixtechCompanion.ipa not found. Please compile the Swift source or provide a pre-compiled IPA.")
        return False
        
    print(f"[CompanionDeploy] Deploying to device {udid}")
    
    try:
        sign_and_install_sideloadly(ipa_path, udid, apple_id, password)
    except Exception as e:
        print(f"[CompanionDeploy] Error during signing: {e}")
        return False

    # Start Port Forward
    tunnel_proc = await forward_port(udid, 8080, 8080)
    print("[CompanionDeploy] Companion app deployed. Awaiting user to launch app on device...")
    return tunnel_proc

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Deploy iOS Companion App via Free Apple ID")
    parser.add_argument("--udid", required=True)
    parser.add_argument("--appleid", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    
    asyncio.run(deploy_companion(args.udid, args.appleid, args.password))
