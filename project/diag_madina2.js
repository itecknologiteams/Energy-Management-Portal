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

const VID = 373059;

function applyCalibration(rawValue, pts) {
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  if (rawValue <= sorted[0].x) return sorted[0].y;
  if (rawValue >= sorted[sorted.length-1].x) return sorted[sorted.length-1].y;
  for (let i = 0; i < sorted.length-1; i++) {
    if (rawValue >= sorted[i].x && rawValue <= sorted[i+1].x) {
      const r = (rawValue - sorted[i].x) / (sorted[i+1].x - sorted[i].x);
      return Number(sorted[i].y) + r * (Number(sorted[i+1].y) - Number(sorted[i].y));
    }
  }
  return rawValue;
}

function median5(arr) {
  const sorted = [...arr].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)];
}

async function run() {
  // 1. Get calibration
  const crm = await sql.connect(crmCfg);
  const calRes = await crm.request().input('vid', sql.Int, VID).query(`
    SELECT vs.Calibration, vs.param FROM ERP_Tracking.dbo.VehicleSensors vs WHERE vs.VehicleId=@vid
  `);
  await crm.close();

  let calibration = null;
  for (const row of calRes.recordset) {
    if (row.Calibration) {
      try {
        const parsed = JSON.parse(row.Calibration);
        calibration = parsed.map(p => ({ x: parseFloat(p.x), y: parseFloat(p.y) }));
        break;
      } catch {}
    }
  }
  console.log('Calibration:', JSON.stringify(calibration));
  if (!calibration) { console.log('No calibration'); return; }

  const maxX = Math.max(...calibration.map(p => p.x));
  const MIN_FUEL = 10;
  const RISE = 8;
  const SAMPLES = 5;

  const track = await new sql.ConnectionPool(trackCfg).connect();

  // 2. Scan Apr 21 – Apr 27
  const tables = [
    'TrackData20260421','TrackData20260422','TrackData20260423',
    'TrackData20260424','TrackData20260425','TrackData20260426','TrackData20260427'
  ];

  let allRows = [];
  for (const tbl of tables) {
    try {
      const r = await track.request()
        .input('vid', sql.Int, VID)
        .query(`SELECT ServerTime, Ignition, Battery FROM ${tbl} WHERE V_Id=@vid ORDER BY ServerTime ASC`);
      for (const row of r.recordset) {
        allRows.push({ ts: new Date(row.ServerTime), bat: row.Battery,
          ign: (row.Ignition===true||row.Ignition===1)?1:0, table: tbl });
      }
      console.log(`${tbl}: ${r.recordset.length} rows`);
    } catch(e) { console.log(`${tbl}: MISSING`); }
  }

  // 3. Build calibrated series (exclude power events + low fuel)
  let series = [];
  for (const row of allRows) {
    if (row.bat === null) continue;
    if (row.bat > maxX * 2.0) continue;
    const fuel = applyCalibration(row.bat, calibration);
    if (isNaN(fuel) || fuel < MIN_FUEL) continue;
    series.push({ ts: row.ts, raw: row.bat, fuel, ign: row.ign, table: row.table });
  }
  console.log(`\nTotal series points: ${series.length}`);

  // 4. Smooth (5-sample backward median)
  const smoothed = series.map((pt, i) => {
    const win = series.slice(Math.max(0,i-SAMPLES+1), i+1).map(p=>p.fuel);
    return { ts: pt.ts, raw: pt.raw, fuel: median5(win), ign: pt.ign, table: pt.table };
  });

  // 5. Find all rises >= 8L in smoothed series
  console.log('\n=== ALL rises >= 8L in smoothed series (Apr 21-27) ===');
  let foundAny = false;
  for (let i = 0; i < smoothed.length-1; i++) {
    const delta = smoothed[i+1].fuel - smoothed[i].fuel;
    if (delta >= RISE) {
      foundAny = true;
      console.log(`\n  [${i}→${i+1}] ${smoothed[i].ts.toISOString()} (${smoothed[i].table})`);
      console.log(`    ${smoothed[i].fuel.toFixed(1)}L → ${smoothed[i+1].fuel.toFixed(1)}L  +${delta.toFixed(1)}L  raw:${smoothed[i].raw}→${smoothed[i+1].raw}  ign=${smoothed[i+1].ign}`);
      // Context: 10 rows before, 20 rows after
      const lo = Math.max(0, i-10);
      const hi = Math.min(smoothed.length-1, i+20);
      for (let k=lo; k<=hi; k++) {
        const mark = (k===i||k===i+1)?'<<':'  ';
        console.log(`    ${mark} [${k}] ${smoothed[k].ts.toISOString()}  fuel=${smoothed[k].fuel.toFixed(1)}L  raw=${smoothed[k].raw}  ign=${smoothed[k].ign}  (${smoothed[k].table})`);
      }
    }
  }
  if (!foundAny) console.log('  NONE found');

  // 6. Summary per day
  console.log('\n=== Per-day fuel range (smoothed) ===');
  for (const tbl of tables) {
    const pts = smoothed.filter(p=>p.table===tbl);
    if (!pts.length) { console.log(`  ${tbl}: no points`); continue; }
    const fuels = pts.map(p=>p.fuel);
    console.log(`  ${tbl}: ${pts.length} pts  min=${Math.min(...fuels).toFixed(1)}L  max=${Math.max(...fuels).toFixed(1)}L  first=${fuels[0].toFixed(1)}L  last=${fuels[fuels.length-1].toFixed(1)}L`);
  }

  await track.close();
}
run().catch(console.error);
