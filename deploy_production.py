#!/usr/bin/env python3
"""Deploy the current production files to the Energy Management Portal server.

Run from this repository folder:
  python deploy_production.py --inventory
  python deploy_production.py --deploy --install --restart

--install runs "npm install --omit=dev" in project/ (needed once for nodemailer).
config/alerts.json on the server is never overwritten; it is created from
alerts.example.json only when missing (email disabled until you edit it).

The password is requested at runtime and is never saved in this file.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import posixpath
import sys
from pathlib import Path

import paramiko


HOST = "192.168.20.69"
USER = "iteckadmin"
REMOTE_ROOT = "/opt/Energy-Management-Portal"
LOCAL_ROOT = Path(__file__).resolve().parent

# Test files are deliberately excluded: production needs only runtime files.
# config/alerts.json and config/admins.json are NOT listed: they hold the SMTP
# password and admin password hashes and live on the server only. The admin
# portal's data (data/fleet-alerts.json, history, audit) is created there too.
FILES = (
    "project/package.json",
    "project/package-lock.json",
    "project/config/alerts.example.json",
    "project/scripts/manage-admins.js",
    "project/scripts/send-test-alert-email.js",
    "project/src/app.js",
    "project/src/server.js",
    "project/src/config/alertConfig.js",
    "project/src/constants/index.js",
    "project/src/controllers/adminController.js",
    "project/src/controllers/fleetController.js",
    "project/src/middleware/requireAdmin.js",
    "project/src/repositories/trackingRepository.js",
    "project/src/routes/adminRoutes.js",
    "project/src/routes/alertRoutes.js",
    "project/src/services/adminAuth.js",
    "project/src/services/alertHistory.js",
    "project/src/services/alertService.js",
    "project/src/services/analyticsService.js",
    "project/src/services/fleetAlertSettings.js",
    "project/src/services/mailService.js",
    "project/src/services/temperatureMonitor.js",
    "project/src/utils/jsonStore.js",
    "frontend/src/App.css",
    "frontend/src/App.jsx",
    "frontend/src/admin/AdminApp.jsx",
    "frontend/src/admin/AdminViews.jsx",
    "frontend/src/admin/FleetEditor.jsx",
    "frontend/src/admin/admin.css",
    "frontend/src/admin/adminApi.js",
    "frontend/src/admin/ui.jsx",
    "frontend/src/components/common/Header.jsx",
    "frontend/src/components/Dashboard/AlertsCard.jsx",
    "frontend/src/components/Dashboard/GeneratorAccordion.jsx",
    "frontend/src/contexts/AuthContext.js",
    "frontend/src/pages/Analytics.jsx",
    "frontend/src/pages/Dashboard.jsx",
    "frontend/src/pages/Reports.jsx",
    "frontend/src/services/api.js",
)
PROJECT_DIR = posixpath.join(REMOTE_ROOT, "project")


def local_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(client: paramiko.SSHClient, command: str) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(command)
    return stdout.channel.recv_exit_status(), stdout.read().decode(), stderr.read().decode()


def remote_sha256(client: paramiko.SSHClient, path: str) -> str:
    code, output, error = run(client, f"sha256sum {path!r}")
    if code != 0:
        raise RuntimeError(error.strip() or f"Could not checksum {path}")
    return output.split()[0]


def connect(password: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=15, look_for_keys=False, allow_agent=False)
    return client


def inventory(client: paramiko.SSHClient) -> None:
    code, output, error = run(client, f"find {REMOTE_ROOT!r} -maxdepth 2 -type d -o -type f | sort")
    if code != 0:
        raise RuntimeError(error.strip())
    print(output, end="")


def deploy(client: paramiko.SSHClient) -> None:
    sftp = client.open_sftp()
    failures: list[str] = []
    try:
        for relative in FILES:
            source = LOCAL_ROOT / relative
            target = posixpath.join(REMOTE_ROOT, relative.replace("\\", "/"))
            temporary = f"{target}.uploading"
            if not source.is_file():
                failures.append(f"Missing local file: {source}")
                continue

            try:
                code, _, error = run(client, f"mkdir -p {posixpath.dirname(target)!r}")
                if code != 0:
                    raise RuntimeError(error.strip() or "could not create remote folder")
                sftp.put(str(source), temporary)
                code, _, error = run(client, f"mv -f {temporary!r} {target!r}")
                if code != 0:
                    raise RuntimeError(error.strip() or "remote move failed")
                if local_sha256(source) != remote_sha256(client, target):
                    failures.append(f"Checksum mismatch: {relative}")
                else:
                    print(f"UPDATED  {relative}")
            except Exception as error:  # Keep checking remaining files.
                try:
                    sftp.remove(temporary)
                except OSError:
                    pass
                failures.append(f"FAILED   {relative}: {error}")
    finally:
        sftp.close()

    if failures:
        print("\nDeployment incomplete:", *failures, sep="\n", file=sys.stderr)
        raise SystemExit(1)
    print(f"\nSUCCESS: {len(FILES)} files uploaded and checksum-verified.")


def ensure_alert_config(client: paramiko.SSHClient) -> None:
    """Create config/alerts.json from the example if the server has none."""
    config = posixpath.join(PROJECT_DIR, "config", "alerts.json")
    example = posixpath.join(PROJECT_DIR, "config", "alerts.example.json")
    code, _, _ = run(client, f"test -f {config!r}")
    if code == 0:
        print("config/alerts.json exists on the server (left unchanged).")
        return
    code, _, error = run(client, f"cp {example!r} {config!r} && chmod 600 {config!r}")
    if code != 0:
        raise RuntimeError(error.strip() or "could not create alerts.json")
    print("Created config/alerts.json from the example. Email is OFF until you edit it:")
    print(f"  nano {config}")


def install_dependencies(client: paramiko.SSHClient) -> None:
    code, output, error = run(client, f"cd {PROJECT_DIR!r} && npm install --omit=dev --no-audit --no-fund")
    print(output, end="")
    if code:
        raise RuntimeError(error.strip() or "npm install failed")
    print("Backend dependencies installed.")


def check_dependencies(client: paramiko.SSHClient) -> None:
    code, _, _ = run(client, f"cd {PROJECT_DIR!r} && node -e \"require.resolve('nodemailer')\"")
    if code != 0:
        print("WARNING: nodemailer is not installed on the server; alert emails will fail. "
              "Re-run with --install.", file=sys.stderr)


def verify_backend(client: paramiko.SSHClient) -> None:
    files = " ".join(
        f"{posixpath.join(REMOTE_ROOT, relative)!r}"
        for relative in FILES
        if relative.startswith("project/") and relative.endswith(".js")
    )
    code, output, error = run(client, f"node --check {files}")
    if code:
        raise RuntimeError(error.strip() or output.strip())
    print("Backend JavaScript syntax check passed.")


def build_frontend(client: paramiko.SSHClient) -> None:
    code, output, error = run(client, f"cd {posixpath.join(REMOTE_ROOT, 'frontend')!r} && npm run build")
    print(output, end="")
    if code:
        raise RuntimeError(error.strip() or "Frontend build failed")
    print("Frontend production build passed.")


def restart_processes(client: paramiko.SSHClient) -> None:
    code, output, error = run(client, "pm2 restart energy-backend energy-frontend && pm2 status energy-backend energy-frontend")
    print(output, end="")
    if code:
        raise RuntimeError(error.strip() or "PM2 restart failed")
    print("PM2 backend and frontend restarts passed.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", action="store_true", help="List the server directory without changing it")
    parser.add_argument("--deploy", action="store_true", help="Upload and checksum-verify the runtime files")
    parser.add_argument("--install", action="store_true", help="Run npm install --omit=dev in project/ after --deploy")
    parser.add_argument("--build", action="store_true", help="Build frontend after --deploy")
    parser.add_argument("--restart", action="store_true", help="Restart energy-backend and energy-frontend after --deploy")
    args = parser.parse_args()
    if not args.inventory and not args.deploy:
        parser.error("choose --inventory or --deploy")
    if (args.build or args.restart or args.install) and not args.deploy:
        parser.error("--build, --install and --restart require --deploy")

    password = getpass.getpass(f"Password for {USER}@{HOST}: ")
    client = connect(password)
    try:
        if args.inventory:
            inventory(client)
        if args.deploy:
            deploy(client)
            verify_backend(client)
            ensure_alert_config(client)
            if args.install:
                install_dependencies(client)
            check_dependencies(client)
            if args.build:
                build_frontend(client)
            if args.restart:
                restart_processes(client)
    finally:
        client.close()


if __name__ == "__main__":
    main()
