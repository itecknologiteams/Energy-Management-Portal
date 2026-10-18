'use strict';
const sql = require('mssql');

const trackCfg = {
  server: 'ha_listener.itecknologi.internal',
  user: 'sa', password: 'iteck@12', database: 'Tracking',
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};

const VID = 373265; // Agha Pura L/S

async function checkDay(pool, tbl) {
  try {
    const r = await pool.request().input('vid', sql.Int, VID).query(`
      SELECT ServerTime, Ignition, Battery, BackupBattery, PowerVolt, Params
      FROM ${tbl}
      WHERE V_Id = @vid
      ORDER BY ServerTime ASC
    `);

    if (!r.recordset.length) { console.log(`  ${tbl}: no rows`); return; }

    console.log(`\n=== ${tbl}  (${r.recordset.length} rows) ===`);

    // Transitions only
    let prev = null;
    let runStart = null;
    r.recordset.forEach(row => {
      const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;

      // Parse params for io66 / io67
      let p66 = null, p67 = null;
      try {
        const p = JSON.parse(row.Params || '{}');
        p66 = p['66'] ?? null;
        p67 = p['67'] ?? null;
      } catch {}

      if (prev !== null && ign !== prev) {
        const ts = new Date(row.ServerTime).toISOString();
        const dur = runStart
          ? ((new Date(row.ServerTime) - new Date(runStart)) / 60000).toFixed(1) + ' min'
          : '?';

        if (ign === 1) {
          runStart = row.ServerTime;
          console.log(`  ON  ${ts}  bat=${row.Battery}  backup=${row.BackupBattery}  pwr=${row.PowerVolt}  p66=${p66}  p67=${p67}`);
        } else {
          console.log(`  OFF ${ts}  bat=${row.Battery}  backup=${row.BackupBattery}  pwr=${row.PowerVolt}  p66=${p66}  p67=${p67}  [dur=${dur}]`);
          runStart = null;
        }
      }
      prev = ign;
    });

    // Sample a few rows around each ON transition for voltage context
    console.log('\n  Sample rows during ignition=ON:');
    let printed = 0;
    prev = null;
    r.recordset.forEach(row => {
      const ign = (row.Ignition === true || row.Ignition === 1) ? 1 : 0;
      if (ign === 1 && printed < 10) {
        let p66 = null, p67 = null;
        try { const p = JSON.parse(row.Params || '{}'); p66=p['66']??null; p67=p['67']??null; } catch {}
        console.log(`    ${new Date(row.ServerTime).toISOString()}  bat=${row.Battery}  backup=${row.BackupBattery}  pwr=${row.PowerVolt}  p66=${p66}  p67=${p67}`);
        printed++;
      }
      prev = ign;
    });

  } catch(e) { console.log(`  ${tbl}: ${e.message}`); }
}

async function run() {
  const pool = await new sql.ConnectionPool(trackCfg).connect();
  for (const tbl of ['TrackData20260420','TrackData20260422','TrackData20260423','TrackData20260424','TrackData20260425']) {
    await checkDay(pool, tbl);
  }
  await pool.close();
}
run().catch(console.error);
