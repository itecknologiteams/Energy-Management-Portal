'use strict';

/**
 * Fleet repository — handles all CRM database queries for fleet/vehicle lookups.
 */

const { getPool } = require('../db/crmDb');
const { CRM_FLEET_VEHICLES_TABLE, CRM_VEHICLES_TABLE } = require('../constants');

/**
 * Retrieve all vehicles belonging to a specific fleet with their names.
 *
 * @param {number} fleetId
 * @returns {Promise<Array<{vehicleId: number, vehicleName: string}>>} Array of vehicle objects
 */
async function getVehiclesByFleetId(fleetId) {
  const pool = await getPool();

  try {
    const query = `
      SELECT
        fv.VehicleId AS vehicleId,
        v.VEH_REG AS vehicleName
      FROM ${CRM_FLEET_VEHICLES_TABLE} fv
      INNER JOIN ${CRM_VEHICLES_TABLE} v ON fv.VehicleId = v.V_ID
      WHERE fv.FleetId = @fleetId
    `;

    const result = await pool
      .request()
      .input('fleetId', fleetId)
      .query(query);

    return result.recordset;
  } catch (err) {
    console.error('[fleetRepository] Error fetching vehicles by fleet:', err.message);
    throw err;
  }
}

module.exports = {
  getVehiclesByFleetId,
};
