'use strict';
const sql = require('mssql');

const crmCfg = {
  server: 'ha_crm_listener.itecknologi.internal',
  user: 'sa', password: 'iteck@1212', database: 'ERP_Tracking',
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};
const trackCfg = {
  server: 'ha_listener.itecknologi.internal',
  user: 'sa', password: 'iteck@12', database: 'Tracking',
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};

async function run() {
  // 1. Find vehicle ID
  const crm = await sql.connect(crmCfg);
  const vRes = await crm.request().query(`
    SELECT v.V_Id AS vehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.Vehicles v
    WHERE v.VEH_REG LIKE '%Madina Colony%'
  `);
  console.log('Vehicle lookup:', JSON.stringify(vRes.recordset, null, 2));
  await crm.close();

  if (!vRes.recordset.length) { console.log('Vehicle not found'); return; }
  const { vehicleId, vehicleName } = vRes.recordset[0];
  console.log(`\nUsing vehicleId=${vehicleId}  name="${vehicleName}"\n`);

  const track = await new sql.ConnectionPool(trackCfg).connect();

  // 2. Check tables for Apr 25-27
  for (const tbl of ['TrackData20260425', 'TrackData20260426', 'TrackData20260427']) {
    const r = await track.request()
      .input('t', sql.NVarChar, tbl)
      .query(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=@t`);
    console.log(`Table ${tbl}: ${r.recordset[0].cnt ? 'EXISTS' : 'MISSING'}`);
  }

  // 3. Full fuel trace for Apr 26 (most likely date for current "Today" view)
  for (const tbl of ['TrackData20260425', 'TrackData20260426']) {
    console.log(`\n=== ${tbl} fuel trace ===`);
    try {
      const r = await track.request()
        .input('vid', sql.Int, vehicleId)
        .query(`
          SELECT ServerTime, Ignition, Battery, BackupBattery, PowerVolt
          FROM ${tbl}
          WHERE V_Id = @vid
          ORDER BY ServerTime ASC
        `);

      if (!r.recordset.length) { console.log('  No rows'); continue; }
      console.log(`  Total rows: ${r.recordset.length}`);

      // Print ALL rows so we can see the fuel trace and spot the spike
      let prev = null;
      r.recordset.forEach((row, i) => {
        const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
        const bat = row.Battery;
        const ts  = new Date(row.ServerTime).toISOString();

        // Print every row but flag large changes
        let flag = '';
        if (prev !== null) {
          const delta = bat - prev;
          if (Math.abs(delta) > 100) flag = `  *** JUMP ${delta > 0 ? '+' : ''}${delta}`;
        }
        // Print only rows with large jumps or ignition changes, plus every 20th row
        const ignChange = prev !== null && ign !== (prev < 0 ? -1 : 0);
        if (flag || i % 30 === 0) {
          console.log(`  [${String(i).padStart(4)}] ${ts}  ign=${ign}  bat=${bat}  backup=${row.BackupBattery}${flag}`);
        }
        prev = bat;
      });

      // Find the min and max battery to understand calibration range
      const bats = r.recordset.map(r2 => r2.Battery).filter(b => b !== null);
      console.log(`  Battery range: min=${Math.min(...bats)}  max=${Math.max(...bats)}`);

      // Find all large jumps (>= 100 raw ADC units upward = potential refuel spikes)
      console.log('\n  All upward jumps >= 100 ADC:');
      prev = null;
      r.recordset.forEach((row, i) => {
        if (prev !== null) {
          const delta = row.Battery - prev;
          if (delta >= 100) {
            const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
            console.log(`  [${String(i).padStart(4)}] ${new Date(row.ServerTime).toISOString()}  ign=${ign}  bat=${row.Battery}  prev=${prev}  delta=+${delta}`);
          }
        }
        prev = row.Battery;
      });

      // Find all large downward jumps
      console.log('\n  All downward jumps >= 100 ADC:');
      prev = null;
      r.recordset.forEach((row, i) => {
        if (prev !== null) {
          const delta = row.Battery - prev;
          if (delta <= -100) {
            const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
            console.log(`  [${String(i).padStart(4)}] ${new Date(row.ServerTime).toISOString()}  ign=${ign}  bat=${row.Battery}  prev=${prev}  delta=${delta}`);
          }
        }
        prev = row.Battery;
      });

    } catch(e) { console.log(`  Error: ${e.message}`); }
  }

  await track.close();
}

run().catch(console.error);
