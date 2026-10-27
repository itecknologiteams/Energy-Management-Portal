#!/usr/bin/env python3
"""Deploy the current production files to the Energy Management Portal server.

Run from this repository folder:
  python deploy_production.py --inventory
  python deploy_production.py --deploy --restart

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
FILES = (
    "project/src/constants/index.js",
    "project/src/controllers/fleetController.js",
    "project/src/repositories/trackingRepository.js",
    "project/src/services/analyticsService.js",
    "frontend/src/components/Dashboard/GeneratorAccordion.jsx",
    "frontend/src/pages/Dashboard.jsx",
    "frontend/src/services/api.js",
)


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


def verify_backend(client: paramiko.SSHClient) -> None:
    files = " ".join(
        f"{posixpath.join(REMOTE_ROOT, relative)!r}"
        for relative in FILES
        if relative.startswith("project/")
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
    parser.add_argument("--deploy", action="store_true", help="Upload and checksum-verify the seven runtime files")
    parser.add_argument("--build", action="store_true", help="Build frontend after --deploy")
    parser.add_argument("--restart", action="store_true", help="Restart energy-backend and energy-frontend after --deploy")
    args = parser.parse_args()
    if not args.inventory and not args.deploy:
        parser.error("choose --inventory or --deploy")
    if (args.build or args.restart) and not args.deploy:
        parser.error("--build and --restart require --deploy")

    password = getpass.getpass(f"Password for {USER}@{HOST}: ")
    client = connect(password)
    try:
        if args.inventory:
            inventory(client)
        if args.deploy:
            deploy(client)
            verify_backend(client)
            if args.build:
                build_frontend(client)
            if args.restart:
                restart_processes(client)
    finally:
        client.close()


if __name__ == "__main__":
    main()
