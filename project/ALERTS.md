# Temperature alerts and the alert email portal

A generator raises an alert when its latest temperature reading (Teltonika `io72`) is **above** its limit.

- **Customer portal:** the alert appears in the notification bell and the Generator Alerts card. The generator's row is marked **Alert**, with a red Temp chip.
- **Email:** a background monitor in the backend checks every few minutes and emails the fleet's recipients. This works even when nobody has the portal open.

There are two places to configure:

| Where | Who | What |
|---|---|---|
| **Admin portal**, `https://<portal>/admin` | iTecknologi admins | Per fleet: recipients (To / CC / BCC), emails on or off, fleet limit, per-generator limits, test email, email history, activity log |
| **`project/config/alerts.json`** on the server | Server administrator | SMTP server and login, sender address, check interval, server default limit, master on/off switches |

Customers never see or change email settings.

## First-time setup

1. **Deploy:** `python deploy_production.py --deploy --install --restart`. On the server this installs the email package (nodemailer) and creates `config/alerts.json` from `alerts.example.json` if it's missing.
2. **SMTP:** on the server, edit `/opt/Energy-Management-Portal/project/config/alerts.json`:
   - fill in `email.smtp` (host, port, user, password) and `email.from`;
   - set `"email": { "enabled": true }`;
   - check `"monitor": { "enabled": true }`.

   Instead of putting the password in the file, you can set `SMTP_PASSWORD` (and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`) in `project/.env`.
3. **Check SMTP:** in `project/`, run `npm run alerts:test-email -- --verify`. It tests the SMTP login only and sends nothing.
4. **Create an admin account:** in `project/`, run `npm run admin -- add <username>`. It asks for a password (at least 10 characters, letters and numbers).
5. **Set up fleets:** open `/admin` and sign in. For each fleet:
   - enter its fleet ID;
   - add recipients;
   - set the limits;
   - click **Save and start alerts**;
   - click **Send test email**.

Changes take effect on the next check (within `monitor.intervalMinutes`), with no restart.

## Keeping fleets separate (confidentiality)

- **One fleet per email:** each fleet's email contains only that fleet's generators and goes only to that fleet's recipients.
- **No list means no email:** a fleet with no recipients, or with emails switched off, is not emailed.
- **BCC is private:** BCC addresses never appear in the email headers, so BCC recipients can't see who else received it. If a fleet has only BCC recipients, the email is addressed to the sender.
- **Shared addresses need confirmation:** if you add an address that already receives another fleet's alerts, the portal stops and asks for confirmation. The confirmation is recorded in the activity log.
- **Limits only for the fleet's own generators:** a generator limit can only be set for a generator that belongs to that fleet in the CRM (`FleetVehicles`).
- **Customer pages:** the bell and Alerts card show only the logged-in fleet's generators.
- **Default list:** `email.recipients.default` in `alerts.json` is used only by `npm run alerts:test-email`. It never receives fleet alerts unless you set `defaultForFleetsWithoutRecipients: true`; only do that for an internal operations mailbox.
- **Public status page:** `GET /api/alerts/status` shows on/off flags and counts only. There are no fleet or vehicle IDs, limits or addresses.

## Admin portal

- **Fleets:** recipients, on/off switch, fleet limit, and per-generator limits with each generator's latest reading. A generator currently above its limit is shown in red.
  - **Save** uses optimistic locking: if another admin changed the fleet meanwhile, you're asked to reload.
  - **Send test email** sends a sample to the fleet's *saved* recipients.
  - **Remove fleet** stops its emails and keeps its history.
- **Email history:** every alert and test email (sent or failed), with recipients, generators, readings, limits and any error. Filter by fleet or result.
- **Activity log:** sign-ins, failed sign-ins, every settings change (what was added or removed) and test emails, with the admin's name and IP.
- **System:** SMTP server (never the password), monitor settings, the last check's results and any configuration problems.

Admin sessions last 8 hours (set `ADMIN_SESSION_HOURS` to change). Five wrong passwords for a username from one IP lock it for 15 minutes.

### Admin accounts

```
npm run admin -- add <username>        create
npm run admin -- password <username>   change password (signs that admin out everywhere)
npm run admin -- remove <username>     delete
npm run admin -- list                  list
```

Accounts are stored in `config/admins.json` as scrypt password hashes (git-ignored). The session signing key is `ADMIN_TOKEN_SECRET` in `.env` (at least 32 characters), or one generated automatically into `data/admin-token-secret`.

## Temperature limits

The limit for a generator is the first of these that is set:

1. its own limit in the admin portal;
2. its fleet's limit in the admin portal;
3. `temperature.vehicleThresholdsC` in `alerts.json`;
4. `temperature.defaultThresholdC` in `alerts.json` (the server default, 90 °C).

An alert clears when the reading drops to the limit minus `recoveryMarginC` (default 2 °C) or lower. This stops readings that hover around the limit from sending repeated emails.

## How emails behave

- **Above limit:** one email per fleet per check, listing every generator that newly went over.
- **Still above limit:** a reminder every `monitor.repeatEmailEveryMinutes` (default 60; `0` = no reminders).
- **Back to normal:** sent when the alert clears (if `sendRecoveryEmail` is true), and only if the alert email went out.
- **Ignored readings:** readings older than `monitor.maxReadingAgeMinutes` (default 30) are ignored, so a silent device doesn't keep alerting.
- **Failed sends:** retried on the next check, and shown as Failed in Email history.

## Files on the server

| File | Contents | In Git? |
|---|---|---|
| `config/alerts.json` | SMTP and server settings | No |
| `config/admins.json` | Admin accounts (password hashes) | No |
| `data/fleet-alerts.json` | Per-fleet settings from the portal; the previous 20 versions are kept in `data/backups/` | No |
| `data/alert-history.jsonl` | Email history (latest 20,000) | No |
| `data/admin-audit.jsonl` | Admin activity (latest 20,000) | No |
| `data/alert-state.json` | Which alerts are active and when they were last emailed | No |

The first time the backend starts with this version, fleets listed in `alerts.json` (`monitor.fleetIds` / `email.recipients.byFleet`) are copied into `data/fleet-alerts.json`, so an existing setup keeps working.

## alerts.json reference

| Setting | Meaning |
|---|---|
| `timezone` | Timezone used to pick today's `TrackData` table. Default `Asia/Karachi`. |
| `dbTimestampsAreLocalTime` | `true`: tracking timestamps are local wall-clock time stored without a zone. |
| `temperature.enabled` | Master switch for temperature alerts (portal and email). |
| `temperature.defaultThresholdC` | Server default limit. |
| `temperature.vehicleThresholdsC` | Optional server-wide generator limits (the portal's limits take priority). |
| `temperature.recoveryMarginC` | Alert clears this many °C below the limit. |
| `monitor.enabled` | Master switch for the background monitor. |
| `monitor.intervalMinutes` | How often to check. |
| `monitor.fleetIds` | Only for older setups; fleets are normally switched on in the portal. |
| `monitor.maxReadingAgeMinutes` | Ignore readings older than this. |
| `monitor.repeatEmailEveryMinutes` | Reminder interval while hot. |
| `monitor.sendRecoveryEmail` | Send "back to normal" emails. |
| `email.enabled` | Master switch for sending email. |
| `email.from` | Sender; must be allowed by the SMTP account. |
| `email.subjectPrefix` | Text placed in front of every subject. |
| `email.smtp.host`, `port`, `secure` | SMTP server. Port 587 with `secure: false` (STARTTLS), or 465 with `secure: true`. |
| `email.smtp.auth.user`, `pass` | SMTP login. Leave `user` empty for an open internal relay. |
| `email.smtp.tls.rejectUnauthorized` | Keep `true`, so emails are encrypted to a verified server. |

## Hosting note

The admin portal is part of the same frontend at the path `/admin`. The current `npm start` frontend server handles that path automatically. If the frontend is ever served as a static build (nginx, IIS), configure it to return `index.html` for `/admin` as well.
