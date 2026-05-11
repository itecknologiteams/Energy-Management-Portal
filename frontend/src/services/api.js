// API Service for Fleet Analytics Backend
// Base URL configuration
// const API_BASE_URL ="http://192.168.20.69:3010";
const API_BASE_URL ="http://localhost:3010";

// Custom Error Classes for different validation failures
export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';  
    this.statusCode = 404;
  }
}

export class ServerError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'ServerError';
    this.statusCode = statusCode;
  }
}

// Validation Utilities
const validators = {
  // Validate fleet ID - must be a positive number
  fleetId: (fleetId) => {
    const num = Number(fleetId);
    if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
      throw new ValidationError(
        `Invalid fleet ID: "${fleetId}". Fleet ID must be a positive integer.`,
        'fleetId'
      );
    }
    return num;
  },

  // Validate vehicle ID - must be a positive number
  vehicleId: (vehicleId) => {
    const num = Number(vehicleId);
    if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
      throw new ValidationError(
        `Invalid vehicle ID: "${vehicleId}". Vehicle ID must be a positive integer.`,
        'vehicleId'
      );
    }
    return num;
  },

  // Validate date format (YYYY-MM-DD)
  dateFormat: (date) => {
    if (!date) {
      throw new ValidationError(
        'Date parameter is required. Please provide a date in YYYY-MM-DD format.',
        'date'
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError(
        `Invalid date format: "${date}". Date must be in YYYY-MM-DD format.`,
        'date'
      );
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new ValidationError(
        `Invalid date: "${date}". Please provide a valid calendar date.`,
        'date'
      );
    }

    return date;
  },

  // Validate date is not in the future
  dateNotFuture: (date) => {
    const inputDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (inputDate > today) {
      throw new NotFoundError(
        `Future date not available: "${date}". Analytics data is only available for past dates.`
      );
    }

    return date;
  },

  // Full date validation (format + not future)
  date: (date) => {
    if (!date) return null;
    validators.dateFormat(date);
    validators.dateNotFuture(date);
    return date;
  }
};

// Helper function for making API calls
const fetchApi = async (endpoint, options = {}) => {
  //remove the API_BASE_URL before deploying to production
  const url = `${API_BASE_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);

    // Check if response is JSON before parsing
    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let errorData = null;

      if (isJson) {
        try {
          errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // Response body is not valid JSON
        }
      } else {
        // Response is HTML - get text for debugging
        try {
          const textResponse = await response.text();
          // If it's HTML, provide a clearer message
          if (textResponse.trim().startsWith('<')) {
            errorMessage = `Server returned HTML instead of JSON. The API endpoint may not exist or the server is not running. Status: ${response.status}`;
          }
        } catch (e) {
          // Can't read response body
        }
      }

      if (response.status === 400) {
        throw new ValidationError(errorMessage, errorData?.field);
      } else if (response.status === 404) {
        throw new NotFoundError(errorMessage);
      } else {
        throw new ServerError(errorMessage, response.status);
      }
    }

    // For successful responses, verify we have JSON
    if (!isJson) {
      const textResponse = await response.text();
      throw new ServerError(
        `API returned non-JSON response (Content-Type: ${contentType}). ` +
        `The server may be returning an error page or proxy HTML. ` +
        `Response starts with: "${textResponse.substring(0, 100)}..."`
      );
    }

    return await response.json();
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ServerError) {
      throw error;
    }

    // Handle SyntaxError (invalid JSON)
    if (error instanceof SyntaxError) {
      throw new ServerError(
        'Invalid JSON received from API. The backend server may not be running, ' +
        'or a proxy/redirect is returning HTML instead of JSON.'
      );
    }

    // Network or other errors
    console.error('API Error:', error);
    throw new ServerError(error.message || 'Network error. Please check your connection.');
  }
};

// Health Check
export const checkHealth = () => {
  return fetchApi('/health');
};

// Fleet Endpoints
export const getFleetDetails = (fleetId = 1735) => {
  // Client-side validation for fleetId (must be positive integer)
  const validatedFleetId = validators.fleetId(fleetId);
  return fetchApi(`/api/fleets/${validatedFleetId}`);
};

export const getFleetVehicles = (fleetId = 1735) => {
  // Client-side validation for fleetId (must be positive integer)
  const validatedFleetId = validators.fleetId(fleetId);
  return fetchApi(`/api/fleets/${validatedFleetId}/vehicles`);
};

export const getFleetVehiclesWithSensors = (fleetId = 1735) => {
  // Client-side validation for fleetId (must be positive integer)
  const validatedFleetId = validators.fleetId(fleetId);
  return fetchApi(`/api/fleets/${validatedFleetId}/vehicles-with-sensors`);
};

export const getFleetAnalytics = (fleetId = 1735, date) => {
  // Client-side validation for fleetId
  const validatedFleetId = validators.fleetId(fleetId);

  // Client-side validation for date (required parameter)
  const formattedDate = date || new Date().toISOString().split('T')[0];
  validators.dateFormat(formattedDate);
  validators.dateNotFuture(formattedDate);

  return fetchApi(`/api/fleets/${validatedFleetId}/analytics?date=${formattedDate}`);
};

// Vehicle Endpoints
export const getVehicleSensors = (vehicleId) => {
  // Client-side validation for vehicleId (must be positive integer)
  const validatedVehicleId = validators.vehicleId(vehicleId);
  return fetchApi(`/api/vehicles/${validatedVehicleId}/sensors`);
};

export const getVehicleAnalytics = (vehicleId, date) => {
  // Client-side validation for vehicleId
  const validatedVehicleId = validators.vehicleId(vehicleId);

  // Client-side validation for date (required parameter)
  const formattedDate = date || new Date().toISOString().split('T')[0];
  validators.dateFormat(formattedDate);
  validators.dateNotFuture(formattedDate);

  return fetchApi(`/api/vehicles/${validatedVehicleId}/analytics?date=${formattedDate}`);
};

// Get fuel series data for a vehicle (time-series fuel level data)
export const getVehicleFuelSeries = (vehicleId, date) => {
  // Client-side validation for vehicleId
  const validatedVehicleId = validators.vehicleId(vehicleId);

  // Client-side validation for date (required parameter)
  const formattedDate = date || new Date().toISOString().split('T')[0];
  validators.dateFormat(formattedDate);
  validators.dateNotFuture(formattedDate);

  return fetchApi(`/api/vehicles/${validatedVehicleId}/fuel-series?date=${formattedDate}`);
};

// Dashboard Data Aggregator - Combines multiple API calls for dashboard
export const getDashboardData = async (fleetId = 1735, date) => {
  // Validate inputs before making any API calls
  const validatedFleetId = validators.fleetId(fleetId);
  const formattedDate = date || new Date().toISOString().split('T')[0];
  validators.dateFormat(formattedDate);
  validators.dateNotFuture(formattedDate);

  try {
    // Fetch all data in parallel
    const [fleetAnalytics, fleetVehicles] = await Promise.all([
      getFleetAnalytics(validatedFleetId, formattedDate),
      getFleetVehiclesWithSensors(validatedFleetId),
    ]);

    // Create a map of vehicle sensors by vehicleId for quick lookup
    const sensorsMap = new Map();
    fleetVehicles.vehicles?.forEach(v => {
      sensorsMap.set(String(v.vehicleId), v.sensors);
    });

    // Calculate aggregate metrics from the analytics data
    const vehicles = fleetAnalytics.vehicles || [];
    const totalFuelConsumed = vehicles.reduce((sum, v) => sum + (v.analytics?.fuelConsumption || 0), 0);
    const totalWorkTime = vehicles.reduce((sum, v) => sum + (v.analytics?.workTime || 0), 0);
    const activeVehicles = vehicles.filter(v => (v.analytics?.workTime || 0) > 0).length;
    const totalFuelTheft = vehicles.reduce((sum, v) => sum + (v.analytics?.fuelTheft || 0), 0);

    // Transform fleet analytics to dashboard format
    const dashboardData = {
      // KPI Cards Data
      kpi: {
        totalFuelConsumed: totalFuelConsumed,
        totalFuelTheft: totalFuelTheft,
        activeVehicles: activeVehicles,
        totalWorkTime: Math.round(totalWorkTime / 60 * 10) / 10, // Convert to hours
        totalVehicles: vehicles.length,
        batteryHealth: vehicles.length > 0
          ? Math.round(vehicles.reduce((sum, v) => sum + (v.analytics?.batteryHealth || 0), 0) / vehicles.length)
          : 0,
      },

      // Table Data - Vehicles with detailed analytics
      vehicles: vehicles.map(v => {
        const sensors = sensorsMap.get(v.vehicleId?.toString()) || {};
        const analytics = v.analytics || {};

        // Format start/stop times
        const startTime = analytics.generatorStartTime
          ? new Date(analytics.generatorStartTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '-';
        const stopTime = analytics.generatorStopTime
          ? new Date(analytics.generatorStopTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '-';

        // Determine status based on work time and fuel theft
        let status = 'Normal';
        let statusClass = 'normal';
        let iconClass = '';

        if (analytics.fuelTheft > 0) {
          status = 'Alert';
          statusClass = 'alert';
          iconClass = 'red';
        } else if ((analytics.workTime || 0) > 0) {
          status = 'Running';
          statusClass = 'running';
          iconClass = 'green';
        }

        return {
          id: v.vehicleId,
          name: v.vehicleName || v.name || `Generator-${v.vehicleId?.toString().slice(-3)}`,
          type: 'Generator',
          // Core metrics from analytics
          batteryHealth: analytics.batteryHealth || '-',
          fuelLevel: analytics.fuel || '-',
          fuelConsumption: analytics.fuelConsumption || 0,
          fuelTheft: analytics.fuelTheft || 0,
          fuelRefilled: analytics.fuelRefilled || 0,
          engineHours: analytics.totalEngineHours || 0,
          workTime: analytics.workTime || 0,
          workTimeHours: analytics.workTime ? Math.round((analytics.workTime / 60) * 10) / 10 : 0,
          generatorStartTime: startTime,
          generatorStopTime: stopTime,
          generatorStartTimeRaw: analytics.generatorStartTime,
          generatorStopTimeRaw: analytics.generatorStopTime,
          dailyRuns: (analytics.generatorRuns || []).map((run, idx) => ({
            date:            formattedDate,
            startTime:       run.start,
            stopTime:        run.stop,   // always the last-known time; isOpen flag handles display
            workTime:        run.workMinutes || 0,
            fuelConsumption: idx === 0 ? (analytics.fuelConsumption ?? null) : null,
            isOpen:          run.isOpen,
            isCarryover:     run.isCarryover || false,
          })),
          // Sensor info
          sensors: sensors,
          sensorCount: sensors.fuelKeys?.length || 0,
          // Status
          status: status,
          statusClass: statusClass,
          iconClass: iconClass,
        };
      }),

      // Chart Data - Fuel consumption trend (based on current data)
      fuelTrend: generateLast7DaysData(formattedDate, vehicles),

      // Chart Data - Generator-wise fuel consumption
      vehicleFuelData: vehicles.map(v => ({
        name: v.vehicleName || v.name || `Generator-${v.vehicleId?.toString().slice(-3)}`,
        fuelConsumed: v.analytics?.fuelConsumption || 0,
        fuelLevel: v.analytics?.fuel || 0,
        workTime: v.analytics?.workTime || 0,
      })),

      // Alerts Data
      alerts: generateAlerts(vehicles),

      // Raw data for reference
      raw: fleetAnalytics,
    };

    return dashboardData;
  } catch (error) {
    console.error('Dashboard data fetch error:', error);
    throw error;
  }
};

// ─── Date-range helpers ───────────────────────────────────────────────────────

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildDateRange(startDate, endDate) {
  const dates = [];
  const cur = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (cur <= end) {
    dates.push(toLocalDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function aggregateVehiclesAcrossDates(dayResults) {
  const map = new Map();

  for (const result of dayResults) {
    const dayDate = result.date;
    for (const v of (result?.vehicles || [])) {
      const a = v.analytics || {};

      if (!map.has(v.vehicleId)) {
        map.set(v.vehicleId, {
          vehicleId:   v.vehicleId,
          vehicleName: v.vehicleName,
          analytics: {
            batteryHealth:      a.batteryHealth      ?? null,
            fuelConsumption:    a.fuelConsumption     ?? 0,
            totalEngineHours:   a.totalEngineHours    ?? 0,
            fuelRefilled:       a.fuelRefilled        ?? 0,
            fuelTheft:          a.fuelTheft           ?? 0,
            generatorStartTime: a.generatorStartTime  ?? null,
            generatorStopTime:  a.generatorStopTime   ?? null,
            workTime:           a.workTime            ?? 0,
            fuel:               a.fuel                ?? null,
            dailyRuns:          [],
          },
        });
      } else {
        const e = map.get(v.vehicleId).analytics;
        e.fuelConsumption  = Math.round(((e.fuelConsumption  || 0) + (a.fuelConsumption  || 0)) * 100) / 100;
        e.totalEngineHours = Math.round(((e.totalEngineHours || 0) + (a.totalEngineHours || 0)) * 100) / 100;
        e.fuelRefilled     = Math.round(((e.fuelRefilled     || 0) + (a.fuelRefilled     || 0)) * 100) / 100;
        e.fuelTheft        = Math.round(((e.fuelTheft        || 0) + (a.fuelTheft        || 0)) * 100) / 100;
        e.workTime         = Math.round(((e.workTime         || 0) + (a.workTime         || 0)) * 10)  / 10;
        if (a.batteryHealth != null) e.batteryHealth = a.batteryHealth;
        if (a.fuel          != null) e.fuel          = a.fuel;
        if (!e.generatorStartTime && a.generatorStartTime) e.generatorStartTime = a.generatorStartTime;
        if (a.generatorStopTime)                           e.generatorStopTime  = a.generatorStopTime;
      }

      (a.generatorRuns || []).forEach((run, idx) => {
        map.get(v.vehicleId).analytics.dailyRuns.push({
          date:            dayDate,
          startTime:       run.start,
          stopTime:        run.stop,   // always the last-known time; isOpen flag handles display
          workTime:        run.workMinutes || 0,
          fuelConsumption: idx === 0 ? (a.fuelConsumption ?? null) : null,
          isOpen:          run.isOpen,
          isCarryover:     run.isCarryover || false,
        });
      });
    }
  }

  return Array.from(map.values());
}

export const getDashboardDataRange = async (fleetId = 1735, startDate, endDate) => {
  const validatedFleetId = validators.fleetId(fleetId);
  const dates = buildDateRange(startDate, endDate);

  const [dayResults, fleetVehicles] = await Promise.all([
    Promise.all(
      dates.map(d =>
        fetchApi(`/api/fleets/${validatedFleetId}/analytics?date=${d}`).catch(() => null)
      )
    ),
    getFleetVehiclesWithSensors(validatedFleetId),
  ]);

  const validDays  = dayResults.filter(Boolean);
  const aggregated = aggregateVehiclesAcrossDates(validDays);

  const sensorsMap = new Map();
  fleetVehicles.vehicles?.forEach(v => sensorsMap.set(String(v.vehicleId), v.sensors));

  const totalFuelConsumed = aggregated.reduce((s, v) => s + (v.analytics?.fuelConsumption || 0), 0);
  const totalWorkTime     = aggregated.reduce((s, v) => s + (v.analytics?.workTime        || 0), 0);
  const activeVehicles    = aggregated.filter(v => (v.analytics?.workTime || 0) > 0).length;
  const totalFuelTheft    = aggregated.reduce((s, v) => s + (v.analytics?.fuelTheft       || 0), 0);

  const transformedVehicles = aggregated.map(v => {
    const sensors   = sensorsMap.get(v.vehicleId?.toString()) || {};
    const analytics = v.analytics || {};

    let status = 'Normal', statusClass = 'normal', iconClass = '';
    if (analytics.fuelTheft > 0)            { status = 'Alert';   statusClass = 'alert';   iconClass = 'red';   }
    else if ((analytics.workTime || 0) > 0) { status = 'Running'; statusClass = 'running'; iconClass = 'green'; }

    return {
      id:               v.vehicleId,
      name:             v.vehicleName || `Generator-${v.vehicleId?.toString().slice(-3)}`,
      type:             'Generator',
      batteryHealth:    analytics.batteryHealth || '-',
      fuelLevel:        analytics.fuel          || '-',
      fuelConsumption:  analytics.fuelConsumption  || 0,
      fuelTheft:        analytics.fuelTheft        || 0,
      fuelRefilled:     analytics.fuelRefilled     || 0,
      engineHours:      analytics.totalEngineHours || 0,
      workTime:         analytics.workTime         || 0,
      workTimeHours:    analytics.workTime ? Math.round((analytics.workTime / 60) * 10) / 10 : 0,
      generatorStartTime:    analytics.generatorStartTime || '-',
      generatorStopTime:     analytics.generatorStopTime  || '-',
      generatorStartTimeRaw: analytics.generatorStartTime,
      generatorStopTimeRaw:  analytics.generatorStopTime,
      dailyRuns:             analytics.dailyRuns || [],
      sensors,
      sensorCount: sensors.fuelKeys?.length || 0,
      status, statusClass, iconClass,
    };
  });

  return {
    kpi: {
      totalFuelConsumed,
      totalFuelTheft,
      activeVehicles,
      totalWorkTime: Math.round(totalWorkTime / 60 * 10) / 10,
      totalVehicles: aggregated.length,
      batteryHealth: aggregated.length > 0
        ? Math.round(aggregated.reduce((s, v) => s + (v.analytics?.batteryHealth || 0), 0) / aggregated.length)
        : 0,
    },
    vehicles:        transformedVehicles,
    fuelTrend:       buildRangeTrendData(validDays, dates),
    vehicleFuelData: aggregated.map(v => ({
      name:         v.vehicleName || `Generator-${v.vehicleId?.toString().slice(-3)}`,
      fuelConsumed: v.analytics?.fuelConsumption || 0,
      fuelLevel:    v.analytics?.fuel            || 0,
      workTime:     v.analytics?.workTime        || 0,
    })),
    alerts: generateAlerts(aggregated),
    raw: { success: true, fleetId: validatedFleetId, date: endDate, vehicles: aggregated },
  };
};

// Helper to generate last 7 days trend data (used for single-day "Today" view)
function generateLast7DaysData(endDate, vehicles) {
  const dates = [];
  const current = new Date(endDate);

  for (let i = 6; i >= 0; i--) {
    const d = new Date(current);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const labels = dates.map(d => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  });

  const currentTotal = vehicles.reduce((sum, v) => sum + (v.analytics?.fuelConsumption || 0), 0);

  return {
    labels,
    thisWeek: currentTotal > 0 ? dates.map(() => Math.round(currentTotal * 10) / 10) : [],
    lastWeek: [],
  };
}

// Build real per-day fuel totals for range views (This Week / This Month)
function buildRangeTrendData(dayResults, allDates) {
  const totalByDate = new Map(
    dayResults.map(day => [
      day.date,
      (day.vehicles || []).reduce((s, v) => s + (v.analytics?.fuelConsumption || 0), 0),
    ])
  );
  const labels = allDates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return allDates.length <= 7
      ? dt.toLocaleDateString('en-US', { weekday: 'short' })
      : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  return {
    labels,
    thisWeek: allDates.map(d => Math.round((totalByDate.get(d) || 0) * 10) / 10),
    lastWeek: [],
  };
}

// Helper to get vehicle display name
function getVehicleDisplayName(v) {
  return v.vehicleName || v.name || `Generator-${v.vehicleId?.toString().slice(-3)}`;
}

// Helper to generate alerts from vehicles analytics data
function generateAlerts(vehicles) {
  const alerts = [];

  if (!vehicles || vehicles.length === 0) {
    return alerts;
  }

  // Fuel theft alerts
  vehicles.forEach(v => {
    const analytics = v.analytics || {};
    if (analytics.fuelTheft > 0) {
      alerts.push({
        id: `theft-${v.vehicleId}`,
        type: 'theft',
        icon: 'fa-exclamation-triangle',
        iconClass: 'red',
        title: getVehicleDisplayName(v),
        time: 'Just now',
        description: `Fuel theft detected: ${analytics.fuelTheft}L`,
        severity: 'high',
      });
    }
  });

  // Low fuel alerts (fuel level below 20%)
  vehicles.forEach(v => {
    const analytics = v.analytics || {};
    const fuelLevel = analytics.fuel || 0;
    // Assuming max fuel is around 250L based on calibration data
    const maxFuel = 250;
    const fuelPercent = (fuelLevel / maxFuel) * 100;

    if (fuelPercent > 0 && fuelPercent < 20 && analytics.fuelTheft === 0) {
      alerts.push({
        id: `low-fuel-${v.vehicleId}`,
        type: 'fuel',
        icon: 'fa-gas-pump',
        iconClass: 'amber',
        title: getVehicleDisplayName(v),
        time: 'Just now',
        progress: Math.round(fuelPercent),
        progressText: `${Math.round(fuelPercent)}% remaining`,
        description: `Low fuel level: ${fuelLevel}L remaining`,
      });
    }
  });

  // Low battery alerts (battery health below 4000)
  vehicles.forEach(v => {
    const analytics = v.analytics || {};
    const batteryHealth = analytics.batteryHealth;

    if (batteryHealth && batteryHealth < 4000) {
      alerts.push({
        id: `battery-${v.vehicleId}`,
        type: 'battery',
        icon: 'fa-battery-quarter',
        iconClass: 'amber',
        title: getVehicleDisplayName(v),
        time: '2 hours ago',
        description: `Low battery health: ${batteryHealth}mV`,
      });
    }
  });

  // Engine running alerts (vehicles currently running)
  vehicles.forEach(v => {
    const analytics = v.analytics || {};
    if ((analytics.workTime || 0) > 0 && analytics.generatorStartTime && !analytics.generatorStopTime) {
      alerts.push({
        id: `running-${v.vehicleId}`,
        type: 'info',
        icon: 'fa-play-circle',
        iconClass: 'green',
        title: getVehicleDisplayName(v),
        time: 'Running',
        description: `Generator running for ${Math.round(analytics.workTime / 60 * 10) / 10} hours`,
      });
    }
  });

  return alerts.slice(0, 5); // Limit to 5 alerts
}

// Transform vehicle analytics to generator-like table data
export const transformToTableData = (vehicles = []) => {
  return vehicles.map(v => {
    const analytics = v.analytics || {};

    // Calculate running hours from workTime (convert minutes to hours)
    const runningHours = analytics.workTime ? Math.round((analytics.workTime / 60) * 10) / 10 : 0;
    const fuelConsumed = analytics.fuelConsumption || 0;
    const fuelTheft = analytics.fuelTheft || 0;
    const fuelLevel = analytics.fuel || 0;
    const batteryHealth = analytics.batteryHealth || '-';

    // Format start/stop times
    const startTime = analytics.generatorStartTime
      ? new Date(analytics.generatorStartTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '-';
    const stopTime = analytics.generatorStopTime
      ? new Date(analytics.generatorStopTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '-';

    // Determine status based on fuel theft, work time, and fuel level
    let status = 'Normal';
    let statusClass = 'normal';
    let iconClass = '';

    if (fuelTheft > 0) {
      status = 'Alert';
      statusClass = 'alert';
      iconClass = 'red';
    } else if (runningHours > 0) {
      status = 'Running';
      statusClass = 'running';
      iconClass = 'green';
    } else if (fuelLevel > 0 && fuelLevel < 30) {
      status = 'Low Fuel';
      statusClass = 'warning';
      iconClass = 'amber';
    }

    return {
      id: v.vehicleId,
      name: getVehicleDisplayName(v),
      type: 'Generator',
      // Core metrics
      hours: `${runningHours} hrs`,
      fuelConsumed: `${fuelConsumed} L`,
      fuelLevel: fuelLevel ? `${fuelLevel} L` : '-',
      fuelTheft: fuelTheft > 0 ? `${fuelTheft} L` : '-',
      batteryHealth: batteryHealth,
      // Time info
      generatorStartTime: startTime,
      generatorStopTime: stopTime,
      // Status
      status: status,
      statusClass: statusClass,
      iconClass: iconClass,
      // Raw data for debugging
      analytics: analytics,
    };
  });
};

// Helper to format error messages for display
export const formatApiError = (error) => {
  if (error instanceof ValidationError) {
    return {
      type: 'validation',
      title: 'Validation Error',
      message: error.message,
      field: error.field,
      icon: 'fa-exclamation-circle',
      iconColor: '#f59e0b'
    };
  }

  if (error instanceof NotFoundError) {
    return {
      type: 'notFound',
      title: 'Not Found',
      message: error.message,
      icon: 'fa-search',
      iconColor: '#6b7280'
    };
  }

  if (error instanceof ServerError) {
    return {
      type: 'server',
      title: error.statusCode >= 500 ? 'Server Error' : 'Request Failed',
      message: error.message,
      icon: 'fa-server',
      iconColor: '#ef4444'
    };
  }

  // Generic error fallback
  return {
    type: 'unknown',
    title: 'Error',
    message: error.message || 'An unexpected error occurred',
    icon: 'fa-exclamation-triangle',
    iconColor: '#ef4444'
  };
};

// Export validators for external use (e.g., form validation)
export { validators };

export default {
  checkHealth,
  getFleetDetails,
  getFleetVehicles,
  getFleetVehiclesWithSensors,
  getFleetAnalytics,
  getVehicleSensors,
  getVehicleAnalytics,
  getVehicleFuelSeries,
  getDashboardData,
  transformToTableData,
  formatApiError,
  validators,
  ValidationError,
  NotFoundError,
  ServerError,
};
