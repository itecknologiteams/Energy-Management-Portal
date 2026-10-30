# Energy Management Portal handover

## Authoritative local checkout

Use this folder for future work and deployment:

```text
C:\Users\atif.khatri\Downloads\Energy-Management-Portal-publish
```

It is a Git checkout of GitHub `main` and contains the commits already pushed to production. Do not use the older `Energy-Management-Portal-push` folder; its earlier push was rejected.

## Current Git commits on `main`

| Commit | Purpose |
|---|---|
| `7ff8642` | Adds last-known vehicle readings and temperature support. |
| `d6e5392` | Keeps the 11 V battery threshold and the fuel spike safeguards; adds tests. |
| `c66aa51` | Removes vehicle `375957` from the no-fuel-sensor exclusion list. |

## Changed runtime files

### Backend: `project/`

| Local file | Production path | Change |
|---|---|---|
| `project/src/constants/index.js` | `/opt/Energy-Management-Portal/project/src/constants/index.js` | Adds `io72` temperature constants. `NO_FUEL_SENSOR_VEHICLE_IDS` is currently empty, so vehicle `375957` is included in fuel analytics. |
| `project/src/controllers/fleetController.js` | `/opt/Energy-Management-Portal/project/src/controllers/fleetController.js` | Supports `includeLastKnown=true` on fleet analytics. A silent vehicle can receive its latest earlier reading. |
| `project/src/repositories/trackingRepository.js` | `/opt/Energy-Management-Portal/project/src/repositories/trackingRepository.js` | Searches up to 30 earlier daily tracking tables for a vehicle's latest recorded data. |
| `project/src/services/analyticsService.js` | `/opt/Energy-Management-Portal/project/src/services/analyticsService.js` | Calculates temperature from `io72`; treats IO9 as millivolts; excludes IO9 where IO66 is `0`; filters confirmed short-lived upward and downward fuel spikes; accepts supply voltage from 11–30 V. |

### Frontend: `frontend/`

| Local file | Production path | Change |
|---|---|---|
| `frontend/src/components/Dashboard/GeneratorAccordion.jsx` | `/opt/Energy-Management-Portal/frontend/src/components/Dashboard/GeneratorAccordion.jsx` | Shows temperature and a `Last data` warning for silent vehicles. |
| `frontend/src/pages/Dashboard.jsx` | `/opt/Energy-Management-Portal/frontend/src/pages/Dashboard.jsx` | Adds temperature to the dashboard CSV export. |
| `frontend/src/services/api.js` | `/opt/Energy-Management-Portal/frontend/src/services/api.js` | Requests and applies last-known readings; carries temperature and last-update fields to the UI. |

### Test-only file

| Local file | Purpose |
|---|---|
| `project/test/fuel-transients.test.js` | Node tests for short-lived upward and downward fuel glitches. It is committed to Git but is not required on production. |

## Temperature alerts (added 27 October 2026, not yet deployed)

Configurable temperature limits (a global default plus per-vehicle overrides) raise alerts in the portal's notification bell and Alerts card. A background monitor emails recipients over SMTP. All settings are in `project/config/alerts.json` (git-ignored; template `alerts.example.json`). Full guide: [project/ALERTS.md](project/ALERTS.md).

New dependency: `nodemailer` 7.x, so the first deploy needs `--install`:

```powershell
python deploy_production.py --deploy --install --restart
```

Then on the server, edit `/opt/Energy-Management-Portal/project/config/alerts.json`, set `email.enabled` to `true`, and run `npm run alerts:test-email` in `project/`.

## Alert email admin portal (30 October 2026)

An iTecknologi-only portal at `/admin` manages each fleet's alert emails: To/CC/BCC recipients, on/off, fleet and per-generator temperature limits, test emails, email history and an activity log. Customers never see it. Each fleet's alerts go only to its own recipients. Adding an address that already receives another fleet's alerts requires explicit confirmation, which is logged.

After deploying, on the server:

```bash
cd /opt/Energy-Management-Portal/project
npm run admin -- add <username>          # create the first admin
npm run alerts:test-email -- --verify    # check the SMTP login
```

SMTP stays in `config/alerts.json`. Admin accounts are in `config/admins.json`, and portal data is in `data/`; all of these are git-ignored. Full guide: [project/ALERTS.md](project/ALERTS.md).

## Real-time and fuel-source fixes (30 October 2026)

- Tracking timestamps are PKT wall-clock time read back as UTC. The backend used to compare them with UTC "now" and drop every row from the last 5 hours as "future". It now uses the PKT clock (`dbClockNow`, timezone from `config/alerts.json`, default Asia/Karachi), with 5 minutes of tolerance for device clock drift.
- A `FuelLevel` column value of `0` is treated as "not provided", so the calibrated sensor from `VehicleSensors` is used instead. Vehicle 413532 (GENSET-TCM) sends `FuelLevel = 0` with its real fuel reading in `io270`, and showed Fuel Level "—" before this fix.
- `fuel-debug` now uses the same conversion as the dashboard.
- The frontend uses the local date for "today" and prints PKT times as stored (no +5 h shift on "Last data" or Today's start/stop).
- Regression tests with 413532's real rows: `project/test/vehicle-413532.test.js`.

## Fuel filtering behavior

The service does not use vehicle-specific IDs for fuel spike filtering. It uses general rules:

- IO9 is converted from mV to V when the sensor configuration uses a voltage calibration curve.
- IO9 is ignored when IO66 equals `0`, which signals sensor power loss.
- A rise or dip is removed only when the reading returns near the preceding baseline within 60 seconds.
- Long-lasting changes remain visible and can still become real refill, theft, or running-drop events.

The only previously hardcoded vehicle ID was `375957`. It has been removed from the exclusion list by commit `c66aa51`.

## Production server

```text
Host: 192.168.20.69
Portal root: /opt/Energy-Management-Portal
Backend working directory: /opt/Energy-Management-Portal/project
Frontend working directory: /opt/Energy-Management-Portal/frontend
```

PM2 processes:

```text
energy-backend   -> npm start in project/
energy-frontend  -> npm start in frontend/
```

## Deployment script

The local script [deploy_production.py](deploy_production.py) uploads only the runtime files listed in its `FILES` list (never `config/alerts.json`). It prompts for the password at runtime and does not save credentials.

Inventory only:

```powershell
cd C:\Users\atif.khatri\Downloads\Energy-Management-Portal-publish
python deploy_production.py --inventory
```

Deploy, checksum-verify, validate backend JavaScript, and restart both PM2 processes:

```powershell
python deploy_production.py --deploy --restart
```

For an explicit production frontend build as well:

```powershell
python deploy_production.py --deploy --build --restart
```

`energy-frontend` runs `npm start`, so a PM2 restart is sufficient for source changes. A build is still useful when the server's `frontend/build/` output is used by another web server.

## Most recent production deployment

Date: 27 October 2026.

Completed actions:

1. Uploaded and SHA-256 verified all seven runtime files.
2. Ran `node --check` on all four backend files.
3. Ran `npm run build` in `/opt/Energy-Management-Portal/frontend`; it completed with pre-existing ESLint warnings only.
4. Ran `pm2 restart energy-backend energy-frontend`.
5. Verified both processes are online and `http://127.0.0.1:3010/health` returned `{"status":"ok"}`.
6. Later deployed the `constants/index.js` correction for vehicle `375957` and restarted `energy-backend`.

## Local validation

Run these from the authoritative local checkout:

```powershell
node --check project/src/constants/index.js
node --check project/src/repositories/trackingRepository.js
node --check project/src/controllers/fleetController.js
node --check project/src/services/analyticsService.js
node --test project/test/fuel-transients.test.js
```

The frontend build could not run on the original Windows source folder because `react-scripts` was not installed there. The production server has dependencies installed and its frontend build completed successfully.
