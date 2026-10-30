# Temperature alerts

A generator raises an alert when its latest temperature reading (Teltonika `io72`) is **above** its limit.

- **Portal**: the alert appears in the notification bell and the Generator Alerts card. The generator's row is marked **Alert**, with a red Temp chip and a Temperature Alert card when expanded.
- **Email**: a background monitor in the backend checks every few minutes and emails the configured recipients. This works even when nobody has the portal open.

All settings are in one file: `project/config/alerts.json`.

## Set up

1. Copy `config/alerts.example.json` to `config/alerts.json`. The deploy script does this on the server if the file is missing.
2. Edit the limits, fleets, SMTP server and recipients (see the reference below).
3. Set `"email": { "enabled": true }`.
4. Test it: `npm run alerts:test-email` (add `-- --verify` to test only the SMTP login, or `-- 1735` to send to fleet 1735's recipients).

Changes take effect within one monitor cycle, with no restart. If the file contains a mistake, the backend keeps the last good settings and logs the problem. `GET /api/alerts/status` shows the active limits, whether monitor and email are on, the last run and any config errors. It never shows passwords or email addresses.

`alerts.json` is git-ignored because it contains the SMTP password. Instead of putting the password in the file, you can set `SMTP_PASSWORD` (also `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`) in `project/.env`. Environment values win over the file.

## Settings reference

| Setting | Meaning |
|---|---|
| `timezone` | Timezone used to pick today's `TrackData` table and print times. Default `Asia/Karachi`. |
| `dbTimestampsAreLocalTime` | `true` (default): tracking timestamps are local wall-clock time stored without a zone. |
| `temperature.enabled` | Turns temperature alerts on or off everywhere (portal and email). |
| `temperature.defaultThresholdC` | Limit in °C for every generator, e.g. `60`, `70`, `90`. |
| `temperature.vehicleThresholdsC` | Per-generator limits by vehicle ID, e.g. `{ "373157": 70 }`. These override the default. |
| `temperature.recoveryMarginC` | An alert clears only when the reading is this many °C below the limit. This stops readings that hover around the limit from sending repeated emails. Default `2`. |
| `monitor.enabled` | Turns the background email monitor on or off. |
| `monitor.intervalMinutes` | How often to check. Default `5`. |
| `monitor.fleetIds` | Fleets to watch, e.g. `[1735]`. |
| `monitor.maxReadingAgeMinutes` | Readings older than this are ignored, so a device that went silent doesn't keep alerting. Default `30`. |
| `monitor.repeatEmailEveryMinutes` | Reminder interval while a generator stays hot. `0` = no reminders. Default `60`. |
| `monitor.sendRecoveryEmail` | Send a "back to normal" email when an alert clears. |
| `email.enabled` | Master switch for sending email. |
| `email.from` | Sender, e.g. `EMS Alerts <alerts@itecknologi.com>`. Must be allowed by the SMTP account. |
| `email.subjectPrefix` | Text placed in front of every subject. |
| `email.recipients.default` | `to` / `cc` lists used for any fleet without its own list. |
| `email.recipients.byFleet` | Per-fleet `to` / `cc` lists, keyed by fleet ID. |
| `email.smtp.host`, `port`, `secure` | SMTP server. Port 587 with `secure: false` (STARTTLS) for Office 365 or Gmail; port 465 with `secure: true` for implicit TLS. |
| `email.smtp.auth.user`, `pass` | SMTP login. Leave `user` empty for an open internal relay. |
| `email.smtp.tls.rejectUnauthorized` | Keep `true`. Set `false` only for an internal server with a self-signed certificate. |

## How emails behave

- **Above limit**: one email per fleet per cycle, listing every generator that newly went over.
- **Still above limit**: a reminder every `repeatEmailEveryMinutes`.
- **Back to normal**: sent when the reading drops to the limit minus `recoveryMarginC` or lower. Only sent if the original alert email went out.
- **Failed send**: retried on the next cycle.
- Alert state is saved in `project/data/alert-state.json`, so restarting the backend does not resend alerts that were already emailed.

## Portal behaviour

- The backend adds `temperatureThreshold`, `temperatureAlert` and `temperatureAt` to every vehicle's analytics, so the portal and the emails always use the same limits.
- For week or month views, the alert reflects the latest reading in the period.
- A vehicle that sent nothing today shows its last known temperature, but does not raise an alert from that stale value.
