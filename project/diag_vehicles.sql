-- ============================================================
-- Diagnostic queries for vehicles 375742 & 375957
-- Run each block separately in SSMS or any SQL client.
-- CRM DB  : ha_crm_listener.itecknologi.internal  / ERP_Tracking
-- Tracking: ha_listener.itecknologi.internal       / Tracking
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- BLOCK 1 (CRM DB)
-- Are these vehicle IDs registered in the Vehicles master?
-- ─────────────────────────────────────────────────────────────
USE ERP_Tracking;

SELECT
    V_ID        AS vehicleId,
    VEH_REG     AS vehicleName,
    V_TypeId    AS typeId
FROM dbo.Vehicles
WHERE V_ID IN (375742, 375957);
-- Expected: 2 rows. Missing row = ID doesn't exist in CRM at all.


-- ─────────────────────────────────────────────────────────────
-- BLOCK 2 (CRM DB)
-- Are they mapped to fleet 1735?
-- ─────────────────────────────────────────────────────────────
USE ERP_Tracking;

SELECT
    fv.FleetId,
    fv.VehicleId,
    v.VEH_REG   AS vehicleName
FROM dbo.FleetVehicles fv
LEFT JOIN dbo.Vehicles v ON fv.VehicleId = v.V_ID
WHERE fv.VehicleId IN (375742, 375957);
-- Shows every fleet these vehicles belong to.
-- If FleetId != 1735, they won't show on the dashboard.


-- ─────────────────────────────────────────────────────────────
-- BLOCK 3 (CRM DB)
-- Do they have sensor calibration rows?
-- ─────────────────────────────────────────────────────────────
USE ERP_Tracking;

SELECT
    VehicleId,
    Name,
    param,
    Unit,
    Min,
    Max,
    Calibration
FROM dbo.VehicleSensors
WHERE VehicleId IN (375742, 375957)
ORDER BY VehicleId, Name;
-- 0 rows = no calibration; app falls back to Battery column (raw ADC, unscaled).
-- "fuel" param with Calibration = NULL also means unscaled fuel display.


-- ─────────────────────────────────────────────────────────────
-- BLOCK 4 (Tracking DB)
-- How many rows per vehicle in recent daily tables?
-- Change the table names to match the dates you want to check.
-- Pattern: TrackDataYYYYMMDD
-- ─────────────────────────────────────────────────────────────
USE Tracking;

SELECT 'TrackData20260504' AS [Table], V_Id, COUNT(*) AS RowCount
FROM dbo.TrackData20260504 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
UNION ALL
SELECT 'TrackData20260503', V_Id, COUNT(*)
FROM dbo.TrackData20260503 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
UNION ALL
SELECT 'TrackData20260502', V_Id, COUNT(*)
FROM dbo.TrackData20260502 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
UNION ALL
SELECT 'TrackData20260501', V_Id, COUNT(*)
FROM dbo.TrackData20260501 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
UNION ALL
SELECT 'TrackData20260430', V_Id, COUNT(*)
FROM dbo.TrackData20260430 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
UNION ALL
SELECT 'TrackData20260429', V_Id, COUNT(*)
FROM dbo.TrackData20260429 WHERE V_Id IN (375742, 375957) GROUP BY V_Id
ORDER BY [Table] DESC, V_Id;
-- 0 rows for a vehicle on a date = no tracking data that day.
-- If ALL tables show 0, the device is offline / not reporting.


-- ─────────────────────────────────────────────────────────────
-- BLOCK 5 (Tracking DB)
-- Most recent 10 rows for each vehicle — inspect raw sensor values.
-- Change date (20260504) to a date where rows were found in Block 4.
-- ─────────────────────────────────────────────────────────────
USE Tracking;

-- Vehicle 375742
SELECT TOP 10
    ServerTime,
    Battery,
    FuelLevel,
    Ignition,
    EngineCut,
    BackupBattery,
    PowerVolt,
    LEFT(Params, 300) AS Params
FROM dbo.TrackData20260504
WHERE V_Id = 375742
ORDER BY ServerTime DESC;

-- Vehicle 375957
SELECT TOP 10
    ServerTime,
    Battery,
    FuelLevel,
    Ignition,
    EngineCut,
    BackupBattery,
    PowerVolt,
    LEFT(Params, 300) AS Params
FROM dbo.TrackData20260504
WHERE V_Id = 375957
ORDER BY ServerTime DESC;
-- If Battery and FuelLevel are NULL and Params is empty/NULL → device not sending sensor data.
-- If Battery has values but FuelLevel is NULL → app reads from Battery column (ADC path).


-- ─────────────────────────────────────────────────────────────
-- BLOCK 6 (Tracking DB)
-- Are there ANY rows ever for these vehicles (across all tables)?
-- This scans the table catalog — slow but definitive.
-- ─────────────────────────────────────────────────────────────
USE Tracking;

-- Lists every TrackDataYYYYMMDD table that has rows for these vehicles.
-- WARNING: this generates and executes dynamic SQL for every daily table.
DECLARE @vid1 INT = 375742;
DECLARE @vid2 INT = 375957;
DECLARE @sql  NVARCHAR(MAX) = N'';
DECLARE @tbl  NVARCHAR(128);

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'TrackData2%'
    ORDER BY TABLE_NAME DESC;

CREATE TABLE #Results (TableName NVARCHAR(128), V_Id INT, RowCount INT);

OPEN cur;
FETCH NEXT FROM cur INTO @tbl;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'INSERT INTO #Results SELECT ''' + @tbl + N''' AS TableName, V_Id, COUNT(*) '
             + N'FROM dbo.' + QUOTENAME(@tbl)
             + N' WHERE V_Id IN (' + CAST(@vid1 AS NVARCHAR) + N',' + CAST(@vid2 AS NVARCHAR) + N') '
             + N'GROUP BY V_Id';
    BEGIN TRY EXEC sp_executesql @sql; END TRY BEGIN CATCH END CATCH;
    FETCH NEXT FROM cur INTO @tbl;
END;
CLOSE cur; DEALLOCATE cur;

SELECT * FROM #Results WHERE RowCount > 0 ORDER BY TableName DESC, V_Id;
DROP TABLE #Results;
-- 0 result rows = these vehicles have NEVER sent data to this Tracking DB.


-- ─────────────────────────────────────────────────────────────
-- BLOCK 7 (Tracking DB)
-- Quick check: do ANY rows exist in the very latest available table?
-- ─────────────────────────────────────────────────────────────
USE Tracking;

SELECT TOP 1 TABLE_NAME AS LatestTable
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE 'TrackData2%'
ORDER BY TABLE_NAME DESC;
-- Use this table name to quickly spot-check:
-- SELECT COUNT(*) FROM dbo.TrackData<YYYYMMDD> WHERE V_Id IN (375742, 375957)
