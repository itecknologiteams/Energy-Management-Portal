'use strict';

/**
 * Diagnostic: list all fleet 1735 vehicles and their fuel-sensor status.
 *
 * Outputs three groups:
 *   A) Has fuel sensor rows WITH calibration  → should show in fuel chart
 *   B) Has sensor rows but NO fuel calibration → will NOT show (no calibration)
 *   C) Has NO sensor rows at all (defaults)   → will NOT show (isDefault)
 *
 * Run:  node diag_fleet_sensors.js
 */

const sql = require('mssql');

const crmCfg = {
  server:   'ha_crm_listener.itecknologi.internal',
  user:     'sa', password: 'iteck@1212', database: 'ERP_Tracking',
  options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};

const FLEET_ID = 1735;

async function run() {
  const crm = await sql.connect(crmCfg);

  // All vehicles in fleet 1735
  const vRes = await crm.request().query(`
    SELECT fv.VehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.FleetVehicles fv
    JOIN ERP_Tracking.dbo.Vehicles v ON fv.VehicleId = v.V_ID
    WHERE fv.FleetId = ${FLEET_ID}
    ORDER BY v.VEH_REG
  `);

  const vehicles = vRes.recordset;
  console.log(`\nFleet ${FLEET_ID} — ${vehicles.length} vehicles total\n`);

  // Sensor rows for all vehicles in one query
  const ids = vehicles.map(v => v.VehicleId).join(',');
  const sRes = await crm.request().query(`
    SELECT
      VehicleId,
      Name,
      param,
      Unit,
      Calibration,
      CASE WHEN Calibration IS NOT NULL THEN 1 ELSE 0 END AS HasCalibration
    FROM ERP_Tracking.dbo.VehicleSensors
    WHERE VehicleId IN (${ids})
    ORDER BY VehicleId, Name
  `);

  // Group sensor rows by vehicleId
  const sensorsByVehicle = {};
  for (const row of sRes.recordset) {
    if (!sensorsByVehicle[row.VehicleId]) sensorsByVehicle[row.VehicleId] = [];
    sensorsByVehicle[row.VehicleId].push(row);
  }

  const groupA = []; // fuel sensor + calibration  → SHOW
  const groupB = []; // sensor rows but no fuel cal → HIDE
  const groupC = []; // no sensor rows at all       → HIDE

  for (const v of vehicles) {
    const rows = sensorsByVehicle[v.VehicleId] || [];

    if (rows.length === 0) {
      groupC.push(v);
      continue;
    }

    // Is there a fuel-type row with calibration?
    const hasFuelCalibration = rows.some(r => {
      const name  = (r.Name  || '').toLowerCase();
      const param = (r.param || '').toLowerCase();
      const isFuel = name.includes('fuel') || param.includes('fuel');
      return isFuel && r.HasCalibration === 1;
    });

    if (hasFuelCalibration) {
      groupA.push({ ...v, sensors: rows });
    } else {
      groupB.push({ ...v, sensors: rows });
    }
  }

  // ── Print results ──────────────────────────────────────────────────────────

  console.log('═'.repeat(65));
  console.log('GROUP A — Fuel sensor WITH calibration  (SHOW in fuel chart)');
  console.log('═'.repeat(65));
  for (const v of groupA) {
    console.log(`  [${v.VehicleId}] ${v.vehicleName}`);
    for (const s of v.sensors) {
      const cal = s.HasCalibration ? '✓ calibrated' : '✗ no calibration';
      console.log(`    • ${s.Name} / param=${s.param} — ${cal}`);
    }
  }

  console.log('\n' + '═'.repeat(65));
  console.log('GROUP B — Sensor rows but NO fuel calibration  (HIDE)');
  console.log('═'.repeat(65));
  for (const v of groupB) {
    console.log(`  [${v.VehicleId}] ${v.vehicleName}`);
    for (const s of v.sensors) {
      const cal = s.HasCalibration ? '✓ calibrated' : '✗ no calibration';
      console.log(`    • ${s.Name} / param=${s.param} — ${cal}`);
    }
  }

  console.log('\n' + '═'.repeat(65));
  console.log('GROUP C — NO sensor rows at all  (HIDE)');
  console.log('═'.repeat(65));
  for (const v of groupC) {
    console.log(`  [${v.VehicleId}] ${v.vehicleName}`);
  }

  console.log('\n── Summary ─────────────────────────────────────────────────');
  console.log(`  Group A (show): ${groupA.length}`);
  console.log(`  Group B (hide): ${groupB.length}  ← may include VEHARI ROAD D/S etc.`);
  console.log(`  Group C (hide): ${groupC.length}`);
  console.log('─────────────────────────────────────────────────────────────\n');

  await crm.close();
}

run().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
