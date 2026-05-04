'use strict';

/**
 * Diagnostic script for vehicles 375742 & 375957.
 *
 * Checks every layer of the pipeline:
 *   1. CRM DB  — fleet membership, vehicle master record, sensor calibration
 *   2. Tracking DB — row count and sample rows in recent daily tables
 *
 * Run with:  node diag_vehicles.js [YYYY-MM-DD]
 * Default date: today (PKT naive, same as the app uses).
 */

const sql = require('mssql');

// ── DB configs (same as diag_theft.js) ───────────────────────────────────────

const crmCfg = {
  server:   'ha_crm_listener.itecknologi.internal',
  user:     'sa', password: 'iteck@1212', database: 'ERP_Tracking',
  options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};

const trackCfg = {
  server:   'ha_listener.itecknologi.internal',
  user:     'sa', password: 'iteck@12',   database: 'Tracking',
  options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};

// ── Target vehicles & fleet ───────────────────────────────────────────────────

const VEHICLE_IDS = [375742, 375957];
const FLEET_ID    = 1735;

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dateToTable(dateStr) {
  return 'TrackData' + dateStr.replace(/-/g, '');
}

function sep(title) {
  console.log('\n' + '─'.repeat(60));
  console.log('  ' + title);
  console.log('─'.repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const targetDate = process.argv[2] || todayStr();
  console.log(`\nDiagnostic for vehicles ${VEHICLE_IDS.join(', ')}  |  date: ${targetDate}`);

  // ── 1. CRM DB checks ────────────────────────────────────────────────────────
  sep('CRM DB — Fleet Membership');
  const crm = await sql.connect(crmCfg);

  // 1a. Are the vehicles registered in the Vehicles master table?
  const vMaster = await crm.request().query(`
    SELECT V_ID AS vehicleId, VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.Vehicles
    WHERE V_ID IN (375742, 375957)
  `);
  console.log('Vehicles master (ERP_Tracking.dbo.Vehicles):');
  if (vMaster.recordset.length === 0) {
    console.log('  *** NEITHER vehicle exists in ERP_Tracking.dbo.Vehicles ***');
    console.log('  => They may use a different V_ID in the Tracking DB, or are not registered in CRM.');
  } else {
    vMaster.recordset.forEach(r => console.log(`  vehicleId=${r.vehicleId}  name="${r.vehicleName}"`));
    const found = vMaster.recordset.map(r => r.vehicleId);
    VEHICLE_IDS.filter(id => !found.includes(id)).forEach(id =>
      console.log(`  *** Vehicle ${id} NOT FOUND in Vehicles master ***`)
    );
  }

  // 1b. Are they in fleet 1735?
  sep('CRM DB — Fleet 1735 Membership');
  const fv = await crm.request().query(`
    SELECT fv.VehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.FleetVehicles fv
    LEFT JOIN ERP_Tracking.dbo.Vehicles v ON fv.VehicleId = v.V_ID
    WHERE fv.FleetId = ${FLEET_ID}
      AND fv.VehicleId IN (375742, 375957)
  `);
  console.log(`FleetVehicles membership (FleetId=${FLEET_ID}):`);
  if (fv.recordset.length === 0) {
    console.log(`  *** Neither vehicle is mapped to fleet ${FLEET_ID} in FleetVehicles ***`);
    console.log('  => They will not appear on the dashboard at all.');
    console.log('  => Run the query below to see which fleet they DO belong to:');
    console.log(`
      SELECT fv.FleetId, fv.VehicleId, v.VEH_REG
      FROM ERP_Tracking.dbo.FleetVehicles fv
      LEFT JOIN ERP_Tracking.dbo.Vehicles v ON fv.VehicleId = v.V_ID
      WHERE fv.VehicleId IN (375742, 375957)
    `);
  } else {
    fv.recordset.forEach(r =>
      console.log(`  vehicleId=${r.VehicleId}  name="${r.vehicleName}"  ✓ in fleet ${FLEET_ID}`)
    );
    const found = fv.recordset.map(r => r.VehicleId);
    VEHICLE_IDS.filter(id => !found.includes(id)).forEach(id =>
      console.log(`  *** Vehicle ${id} NOT in fleet ${FLEET_ID} ***`)
    );
  }

  // 1c. Which fleet(s) do they actually belong to?
  sep('CRM DB — Actual Fleet Assignments');
  const allFleets = await crm.request().query(`
    SELECT fv.FleetId, fv.VehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.FleetVehicles fv
    LEFT JOIN ERP_Tracking.dbo.Vehicles v ON fv.VehicleId = v.V_ID
    WHERE fv.VehicleId IN (375742, 375957)
    ORDER BY fv.VehicleId
  `);
  if (allFleets.recordset.length === 0) {
    console.log('  *** These vehicle IDs appear in NO fleet at all ***');
  } else {
    console.log('  FleetId  |  VehicleId  |  Name');
    allFleets.recordset.forEach(r =>
      console.log(`  ${r.FleetId}  |  ${r.VehicleId}  |  "${r.vehicleName}"`)
    );
  }

  // 1d. Sensor calibration
  sep('CRM DB — Sensor Calibration (VehicleSensors)');
  const sensors = await crm.request().query(`
    SELECT VehicleId, Name, param, Unit, Min, Max, Calibration
    FROM ERP_Tracking.dbo.VehicleSensors
    WHERE VehicleId IN (375742, 375957)
    ORDER BY VehicleId, Name
  `);
  if (sensors.recordset.length === 0) {
    console.log('  *** NO sensor rows found for either vehicle ***');
    console.log('  => analyticsService will fall back to DEFAULT sensor keys (io327 / Battery column).');
    console.log('  => Without calibration, fuel level = raw ADC value (unscaled), which may look wrong.');
  } else {
    sensors.recordset.forEach(r => {
      console.log(`  vehicleId=${r.VehicleId}  Name="${r.Name}"  param="${r.param}"  Unit="${r.Unit}"`);
      console.log(`    Min=${r.Min}  Max=${r.Max}`);
      console.log(`    Calibration=${r.Calibration || '(null)'}`);
    });
  }

  await crm.close();

  // ── 2. Tracking DB checks ───────────────────────────────────────────────────
  sep('Tracking DB — Data Existence');
  const track = await new sql.ConnectionPool(trackCfg).connect();

  // Build 7 recent dates to check
  const dates = [];
  const base = new Date(targetDate + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dd}`);
  }

  console.log(`Checking last 7 days (${dates[dates.length-1]} → ${dates[0]}):\n`);
  console.log('  Date         | Table exists? | 375742 rows | 375957 rows');
  console.log('  ' + '-'.repeat(57));

  for (const d of dates) {
    const tbl = dateToTable(d);
    // Check table existence
    const tblCheck = await track.request()
      .input('tbl', tbl)
      .query(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tbl`);
    const tblExists = tblCheck.recordset[0].cnt > 0;

    if (!tblExists) {
      console.log(`  ${d}  |  NO TABLE     |      —      |      —`);
      continue;
    }

    const counts = {};
    for (const vid of VEHICLE_IDS) {
      const r = await track.request()
        .input('vid', sql.Int, vid)
        .query(`SELECT COUNT(*) AS cnt FROM ${tbl} WHERE V_Id = @vid`);
      counts[vid] = r.recordset[0].cnt;
    }
    const flag = (counts[375742] === 0 && counts[375957] === 0) ? '  ← NO DATA' : '';
    console.log(`  ${d}  |  YES          |  ${String(counts[375742]).padStart(8)}   |  ${String(counts[375957]).padStart(8)}${flag}`);
  }

  // 3. Sample rows from the target date (if any data found)
  sep(`Tracking DB — Sample Rows for ${targetDate}`);
  const tbl = dateToTable(targetDate);

  const tblOk = await track.request()
    .input('tbl', tbl)
    .query(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tbl`);

  if (tblOk.recordset[0].cnt === 0) {
    console.log(`  Table ${tbl} does not exist — no data for ${targetDate}`);
  } else {
    for (const vid of VEHICLE_IDS) {
      const rows = await track.request()
        .input('vid', sql.Int, vid)
        .query(`
          SELECT TOP 5
            ServerTime, Battery, FuelLevel, Ignition, EngineCut,
            LEFT(Params, 200) AS ParamsSnippet
          FROM ${tbl}
          WHERE V_Id = @vid
          ORDER BY ServerTime DESC
        `);

      console.log(`\n  Vehicle ${vid} — latest 5 rows from ${tbl}:`);
      if (rows.recordset.length === 0) {
        console.log('    *** No rows found ***');
      } else {
        rows.recordset.forEach(r => {
          console.log(`    ServerTime=${new Date(r.ServerTime).toISOString()}  Battery=${r.Battery}  FuelLevel=${r.FuelLevel}  Ignition=${r.Ignition}  EngineCut=${r.EngineCut}`);
          console.log(`      Params(first 200): ${r.ParamsSnippet}`);
        });
      }
    }

    // 4. Earliest and latest timestamp per vehicle for the target date
    sep(`Tracking DB — First/Last Row Timestamps for ${targetDate}`);
    for (const vid of VEHICLE_IDS) {
      const range = await track.request()
        .input('vid', sql.Int, vid)
        .query(`
          SELECT
            MIN(ServerTime) AS firstRow,
            MAX(ServerTime) AS lastRow,
            COUNT(*)        AS totalRows
          FROM ${tbl}
          WHERE V_Id = @vid
        `);
      const r = range.recordset[0];
      if (!r.totalRows) {
        console.log(`  Vehicle ${vid}: no rows`);
      } else {
        console.log(`  Vehicle ${vid}: totalRows=${r.totalRows}  first=${new Date(r.firstRow).toISOString()}  last=${new Date(r.lastRow).toISOString()}`);
      }
    }
  }

  // 5. Summary & diagnosis
  sep('DIAGNOSIS SUMMARY');
  console.log(`
  The data pipeline for these vehicles requires ALL of the following to be true:

  [A] Vehicle exists in ERP_Tracking.dbo.Vehicles (V_ID column)
  [B] Vehicle is mapped to fleet ${FLEET_ID} in ERP_Tracking.dbo.FleetVehicles
  [C] Rows exist in TrackDataYYYYMMDD for the queried date
  [D] Those rows have non-null Battery or FuelLevel or Params[io327]
  [E] (Optional) VehicleSensors row exists — without it, defaults are used (io327 / Battery)

  If [A] fails  → vehicle is unknown to the system entirely
  If [B] fails  → vehicle won't appear on the dashboard (not returned by getFleetVehicles)
  If [C] fails  → backend returns TrackingTableNotFoundError; analytics = null on that date
  If [D] fails  → analytics runs but returns fuel=0, workTime=0, everything blank
  If [E] fails  → fuel reads from Battery column (ADC) using default io327 key; display may be wrong scale
  `);

  await track.close();
}

run().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
