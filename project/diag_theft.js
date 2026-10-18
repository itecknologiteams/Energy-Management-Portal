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
  const crm   = await sql.connect(crmCfg);

  // 1. Find vehicle IDs for the two generators
  const names = ['INNER BYE PASS D/S', 'Madina Colony L/S'];
  const vRes = await crm.request().query(`
    SELECT v.V_Id AS vehicleId, v.VEH_REG AS vehicleName
    FROM ERP_Tracking.dbo.Vehicles v
    WHERE v.VEH_REG IN ('INNER BYE PASS D/S', 'Madina Colony L/S')
  `);
  console.log('Vehicles:', JSON.stringify(vRes.recordset, null, 2));

  await crm.close();

  // 2. Raw data ±2 hours around theft times for each vehicle
  const events = [
    { name: 'INNER BYE PASS D/S', theftTime: '2026-04-24T04:11:00Z' },
    { name: 'Madina Colony L/S',   theftTime: '2026-04-23T00:29:00Z' },
  ];

  const track = await new sql.ConnectionPool(trackCfg).connect();

  // first get table name mapping
  const tblMap = {};
  for (const v of vRes.recordset) {
    // Try to find table
    const yr = new Date().getFullYear();
    for (const suffix of [`${yr}`, `${yr-1}`]) {
      try {
        const r = await track.request()
          .input('vid', sql.Int, v.vehicleId)
          .query(`SELECT TOP 1 V_Id FROM TrackData${suffix} WHERE V_Id=@vid`);
        if (r.recordset.length > 0) { tblMap[v.vehicleId] = `TrackData${suffix}`; break; }
      } catch(e) { /* table may not exist */ }
    }
  }
  console.log('Table map:', tblMap);

  for (const ev of events) {
    const veh = vRes.recordset.find(v => v.vehicleName === ev.name);
    if (!veh) { console.log('Vehicle not found:', ev.name); continue; }
    const tbl = tblMap[veh.vehicleId];
    if (!tbl) { console.log('Table not found for:', ev.name); continue; }

    const lo = new Date(new Date(ev.theftTime).getTime() - 2*60*60*1000).toISOString();
    const hi = new Date(new Date(ev.theftTime).getTime() + 2*60*60*1000).toISOString();

    const r = await track.request()
      .input('vid', sql.Int, veh.vehicleId)
      .input('lo', sql.DateTime2, lo)
      .input('hi', sql.DateTime2, hi)
      .query(`
        SELECT TOP 200 ServerTime, Battery, Ignition
        FROM ${tbl}
        WHERE V_Id=@vid AND ServerTime BETWEEN @lo AND @hi
        ORDER BY ServerTime ASC
      `);

    console.log(`\n=== ${ev.name} (${veh.vehicleId}) around ${ev.theftTime} ===`);
    r.recordset.forEach(row => {
      console.log(new Date(row.ServerTime).toISOString(), 'battery:', row.Battery, 'ign:', row.Ignition);
    });
  }

  await track.close();
}

run().catch(console.error);
