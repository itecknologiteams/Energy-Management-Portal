# Fleet Vehicle Analytics API

A Node.js backend service for analyzing fleet vehicle data including fuel consumption, battery health, generator runtime, and refuel/theft detection. Integrates with CRM and GPS tracking databases.

## Overview

This API provides comprehensive analytics for fleet vehicles by:
- Querying vehicle registry from the CRM database
- Reading GPS tracking data from daily SQL Server tables
- Calculating metrics like fuel consumption, engine hours, and work time
- Detecting fuel refills and potential theft events
- Monitoring battery health and generator status

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js 4.x |
| Database | SQL Server (mssql package) |
| Logging | Morgan + Custom logger |
| Environment | dotenv |

## Project Structure

```
project/
├── src/
│   ├── app.js                    # Express app configuration
│   ├── server.js                 # Server startup and DB initialization
│   ├── config/
│   │   └── dbConfig.js           # Database configuration objects
│   ├── constants/
│   │   └── index.js              # Business constants and table names
│   ├── controllers/
│   │   └── fleetController.js    # HTTP request handlers
│   ├── db/
│   │   ├── crmDb.js              # CRM database connection pool
│   │   └── trackingDb.js         # Tracking database connection pool
│   ├── helpers/
│   │   ├── paramsParser.js       # Parse sensor params from tracking data
│   │   ├── sensorMapper.js       # Map sensors to ioXXX keys
│   │   └── trackingTableHelper.js# Date-to-table-name conversion
│   ├── middleware/
│   │   ├── errorHandler.js       # Global error handling
│   │   ├── requestLogger.js      # Request logging
│   │   └── validate.js           # Input validation middleware
│   ├── repositories/
│   │   ├── fleetRepository.js    # CRM database queries
│   │   ├── sensorRepository.js   # Sensor mapping queries
│   │   └── trackingRepository.js # Tracking data queries
│   ├── routes/
│   │   └── fleetRoutes.js        # API route definitions
│   ├── services/
│   │   ├── analyticsService.js   # Metric calculations
│   │   └── fleetService.js       # Business logic orchestration
│   └── utils/
│       ├── errors.js             # Custom error classes
│       └── logger.js             # Logging utility
├── .env                          # Environment variables (not in git)
├── .env.example                  # Environment template
├── package.json                  # Dependencies and scripts
└── README.md                     # This file
```

## Setup Instructions

### 1. Clone and Install

```bash
git clone <repository-url>
cd project
npm install
```

### 2. Configure Environment

Copy the example file and fill in your actual values:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```bash
# CRM Database
CRM_DB_HOST=ha_crm_listener.itecknologi.internal
CRM_DB_USER=sa
CRM_DB_PASSWORD=your_crm_password
CRM_DB_NAME=CRM_REMOTE

# Tracking Database
TRACKING_DB_HOST=ha_listener.itecknologi.internal
TRACKING_DB_USER=sa
TRACKING_DB_PASSWORD=your_tracking_password
TRACKING_DB_NAME=  # Leave blank or fill if discovered

# Server
PORT=3000
NODE_ENV=development
```

### 3. Verify Database Column Names

Before running, verify the exact column names in your tracking tables:

```sql
-- Run this against your Tracking database
SELECT TOP 1 T_Id, V_Id, ServerTime, GpsTime, Params, FuelLevel
FROM TrackData20260415;
```

Then update `src/constants/index.js` if needed:
- `TRACKING_VEHICLE_COLUMN` — usually `V_Id` or `VehicleId`
- `TRACKING_TIMESTAMP_COLUMN` — usually `ServerTime` or `GpsTime`
- `TRACKING_PARAMS_COLUMN` — usually `Params`

### 4. Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### 5. Verify Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{ "status": "ok", "timestamp": "2026-04-15T14:32:01.123Z" }
```

## API Endpoints

| Method | Path | Description | Example |
|--------|------|-------------|---------|
| GET | `/health` | Service health check | `curl /health` |
| GET | `/api/fleets/:fleetId/vehicles` | List all vehicles in a fleet | `/api/fleets/1735/vehicles` |
| GET | `/api/fleets/:fleetId/vehicles-with-sensors` | Vehicles with sensor configs | `/api/fleets/1735/vehicles-with-sensors` |
| GET | `/api/vehicles/:vehicleId/sensors` | Get vehicle sensor mapping | `/api/vehicles/373157/sensors` |
| GET | `/api/fleets/:fleetId/analytics` | **Analytics for entire fleet** | `/api/fleets/1735/analytics?date=2026-04-15` |
| GET | `/api/vehicles/:vehicleId/analytics` | **Analytics for single vehicle** | `/api/vehicles/373157/analytics?date=2026-04-15` |

### Example Response: GET /api/fleets/1735/analytics?date=2026-04-15

```json
{
  "success": true,
  "fleetId": 1735,
  "date": "2026-04-15",
  "vehicles": [
    {
      "vehicleId": 373157,
      "analytics": {
        "batteryHealth": 27.99,
        "fuelConsumption": 45.5,
        "totalEngineHours": 8.5,
        "fuelRefilled": 50.0,
        "fuelTheft": 0,
        "generatorStartTime": "2026-04-15T06:30:00.000Z",
        "generatorStopTime": "2026-04-15T18:45:00.000Z",
        "workTime": 735.0,
        "fuel": 32.5
      }
    },
    {
      "vehicleId": 373197,
      "analytics": {
        "batteryHealth": 28.5,
        "fuelConsumption": 32.2,
        "totalEngineHours": 6.25,
        "fuelRefilled": 0,
        "fuelTheft": 0,
        "generatorStartTime": "2026-04-15T08:00:00.000Z",
        "generatorStopTime": "2026-04-15T16:30:00.000Z",
        "workTime": 510.0,
        "fuel": 45.8
      }
    }
  ],
  "count": 2
}
```

## Configuration Constants

All tunable constants are in `src/constants/index.js`:

| Constant | Default | Description | When to Tune |
|----------|---------|-------------|--------------|
| `FUEL_REFILL_MIN_CHANGE` | 10 | Minimum fuel increase (liters) to count as refill | Increase if getting false refills from noise |
| `FUEL_THEFT_MIN_CHANGE` | 10 | Minimum fuel decrease (liters) to count as theft | Increase if getting false theft alerts |
| `MIN_VALID_RUNNING_MINUTES` | 2 | Minimum generator ON time to count as work | Increase if ignoring brief starts |
| `DEFAULT_SENSOR_KEYS.fuel` | '327' | Default ioXXX key for fuel | Update after Part 2 discovery |
| `DEFAULT_SENSOR_KEYS.battery` | '9' | Default ioXXX key for battery | Update after Part 2 discovery |
| `DEFAULT_SENSOR_KEYS.engineHours` | '239' | Default ioXXX key for engine hours | Update after Part 2 discovery |
| `DEFAULT_SENSOR_KEYS.generator` | '236' | Default ioXXX key for generator | Update after Part 2 discovery |

## Important: Verify Table Names

The following constants in `src/constants/index.js` **must be verified** against your actual database:

```javascript
// VERIFY THESE: Run SELECT TOP 1 * FROM TrackDataYYYYMMDD to confirm
const TRACKING_VEHICLE_COLUMN = 'V_Id';       // or 'VehicleId', 'V_ID'
const TRACKING_TIMESTAMP_COLUMN = 'ServerTime'; // or 'GpsTime', 'DateTime'
const TRACKING_PARAMS_COLUMN = 'Params';        // or 'params', 'Parameters'

// CRM table (should be correct but verify)
const CRM_FLEET_VEHICLES_TABLE = 'ERP_Tracking.dbo.FleetVehicles';

// Sensor mapping table (verify with:)
// SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%sensor%'
const TRACKING_SENSOR_MAPPING_TABLE = 'dbo.VehicleSensors';
```

## Temperature Alerts

Temperature limits, the background email monitor and SMTP are configured in `config/alerts.json`. See [ALERTS.md](ALERTS.md).

## Error Handling

The API uses structured error responses:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "fleetId must be a positive integer",
    "field": "fleetId"
  }
}
```

Common error codes:
- `VALIDATION_ERROR` (400) — Invalid input
- `NOT_FOUND` (404) — Fleet or vehicle not found
- `TRACKING_TABLE_NOT_FOUND` (404) — No data for requested date
- `DATABASE_ERROR` (500) — Database query failure
- `INTERNAL_ERROR` (500) — Unexpected server error

In `DEBUG_MODE` (non-production), error responses include stack traces.

## Logging

Request logs appear in console:
```
[2026-04-15 14:32:01] GET /api/fleets/1735/vehicles 200 45ms
[2026-04-15 14:32:02] GET /api/fleets/1735/analytics?date=2026-04-15 200 234ms
```

Server logs use structured format:
```
[2026-04-15T14:32:01.123Z] [INFO] Fleet Analytics API running on port 3000
[2026-04-15T14:32:01.456Z] [INFO] CRM database connected successfully
```

## Database Connections

The service connects to two SQL Server databases:

1. **CRM Database** — Contains `FleetVehicles` table mapping vehicles to fleets
2. **Tracking Database** — Contains daily `TrackDataYYYYMMDD` tables with GPS and sensor data

Both use connection pooling with retry logic (3 attempts, 3 second delay).

## Development Notes

- All database queries use parameterized inputs (`@paramName`) to prevent SQL injection
- Table names are built from constants only (prefix + validated date string)
- The `params` parser handles multiple formats: JSON, `key:value`, `ioXXX:value`
- Analytics calculations are pure functions with no database calls
- `DEBUG_MODE` adds verbose logging and stack traces (enabled when `NODE_ENV !== 'production'`)

## Troubleshooting

### "Failed to connect to CRM database"
- Check `.env` credentials
- Verify SQL Server is running and accessible
- Check firewall rules for port 1433

### "Tracking data not available for this date"
- The daily table `TrackDataYYYYMMDD` doesn't exist for that date
- Try a more recent date
- Verify `TRACKING_DATA_TABLE_PREFIX` constant

### "No vehicles found for fleet X"
- FleetId doesn't exist in CRM database
- Run: `SELECT COUNT(*) FROM CRM_REMOTE.ERP_Tracking.dbo.FleetVehicles WHERE FleetId = X`

## License

ISC
