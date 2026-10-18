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
  // ── 1. Find vehicle ID for Agha Pura L/S ──────────────────────────────────
  const crm = await sql.connect(crmCfg);
  const vRes = await crm.request().query(`
    SELECT v.V_Id AS vehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.Vehicles v
    WHERE v.VEH_REG LIKE '%Agha Pura%'
  `);
  console.log('Vehicle lookup:', JSON.stringify(vRes.recordset, null, 2));
  await crm.close();

  if (!vRes.recordset.length) { console.log('Vehicle not found'); return; }
  const { vehicleId, vehicleName } = vRes.recordset[0];
  console.log(`\nUsing vehicleId=${vehicleId}  name="${vehicleName}"\n`);

  // ── 2. Check which tables exist for Apr 22–24 ─────────────────────────────
  const track = await new sql.ConnectionPool(trackCfg).connect();
  for (const tbl of ['TrackData20260422', 'TrackData20260423', 'TrackData20260424']) {
    const r = await track.request()
      .input('t', sql.NVarChar, tbl)
      .query(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=@t`);
    console.log(`Table ${tbl}: ${r.recordset[0].cnt ? 'EXISTS' : 'MISSING'}`);
  }

  // ── 3. Apr 23 full ignition scan ─────────────────────────────────────────
  console.log('\n=== TrackData20260423 ignition summary ===');
  try {
    const r = await track.request()
      .input('vid', sql.Int, vehicleId)
      .query(`
        SELECT
          ServerTime, Ignition,
          Battery,
          BackupBattery,
          PowerVolt
        FROM TrackData20260423
        WHERE V_Id = @vid
        ORDER BY ServerTime ASC
      `);

    if (!r.recordset.length) {
      console.log('No rows for this vehicle on Apr 23');
    } else {
      console.log(`Total rows: ${r.recordset.length}`);

      // Count ignition values
      let on = 0, off = 0, nulls = 0;
      r.recordset.forEach(row => {
        const ign = row.Ignition;
        if (ign === true  || ign === 1 || ign === '1') on++;
        else if (ign === false || ign === 0 || ign === '0') off++;
        else nulls++;
      });
      console.log(`Ignition ON:${on}  OFF:${off}  NULL/other:${nulls}`);

      // Show all ON transitions
      console.log('\nAll rows where Ignition=ON (or transitions):');
      let prev = null;
      r.recordset.forEach((row, i) => {
        const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
        if (ign === 1 || (prev === 0 && ign === 1) || (prev === 1 && ign === 0)) {
          console.log(
            `  [${String(i).padStart(4)}] ${new Date(row.ServerTime).toISOString()}`,
            `ign=${ign}`,
            `bat=${row.Battery}`,
            `backup=${row.BackupBattery}`,
            `pwr=${row.PowerVolt}`
          );
        }
        prev = ign;
      });

      // Show transitions only
      console.log('\nIgnition transitions:');
      prev = null;
      let runStart = null;
      r.recordset.forEach((row) => {
        const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
        if (prev !== null && ign !== prev) {
          const ts = new Date(row.ServerTime).toISOString();
          if (ign === 1) {
            runStart = ts;
            console.log(`  ON  at ${ts}  bat=${row.Battery}  backup=${row.BackupBattery}`);
          } else {
            const dur = runStart
              ? ((new Date(row.ServerTime) - new Date(runStart)) / 60000).toFixed(1) + ' min'
              : '?';
            console.log(`  OFF at ${ts}  bat=${row.Battery}  backup=${row.BackupBattery}  duration=${dur}`);
            runStart = null;
          }
        }
        prev = ign;
      });

      // First and last row
      const first = r.recordset[0];
      const last  = r.recordset[r.recordset.length - 1];
      console.log(`\nFirst row: ${new Date(first.ServerTime).toISOString()}  ign=${first.Ignition}  bat=${first.Battery}  backup=${first.BackupBattery}`);
      console.log(`Last  row: ${new Date(last.ServerTime).toISOString()}   ign=${last.Ignition}  bat=${last.Battery}  backup=${last.BackupBattery}`);
    }
  } catch (e) {
    console.log('Apr 23 query error:', e.message);
  }

  // ── 4. Apr 22 last 20 rows (to see if ignition carries over) ─────────────
  console.log('\n=== TrackData20260422 — last 20 rows ===');
  try {
    const r = await track.request()
      .input('vid', sql.Int, vehicleId)
      .query(`
        SELECT TOP 20 ServerTime, Ignition, Battery, BackupBattery
        FROM TrackData20260422
        WHERE V_Id = @vid
        ORDER BY ServerTime DESC
      `);
    r.recordset.reverse().forEach(row =>
      console.log(
        `  ${new Date(row.ServerTime).toISOString()}`,
        `ign=${row.Ignition}`,
        `bat=${row.Battery}`,
        `backup=${row.BackupBattery}`
      )
    );
  } catch (e) { console.log('Apr 22 tail query error:', e.message); }

  await track.close();
}

run().catch(console.error);
