import { useCallback, useEffect, useRef, useState } from 'react';
import { checkFleetAlerts } from '../services/api';

// How often the dashboard asks the backend whether any alert rule is broken
const POLL_MS = 60 * 1000;

// One breach = one rule on one vehicle
export const alertKey = (a) => `${a.ruleId}:${a.vehicleId}`;

export const describeAlert = (a) =>
  `Temperature ${Number(a.value).toFixed(1)} °C is ${a.operator} ${a.threshold} °C`;

// Breaches already announced are remembered per fleet, so reloading the page
// does not announce an ongoing breach again. Storage may be unavailable
// (private mode); then a reload simply announces it once more.
const storageKey = (fleetId) => `ems.temperatureAlerts.announced.${fleetId}`;

function loadAnnounced(fleetId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey(fleetId)) || '[]'));
  } catch {
    return new Set();
  }
}

function saveAnnounced(fleetId, keys) {
  try {
    localStorage.setItem(storageKey(fleetId), JSON.stringify([...keys]));
  } catch {
    // ignore — see loadAnnounced
  }
}

/**
 * Polls the fleet's temperature alert rules and calls `onNewAlert` once for
 * each breach that starts. A breach that clears and comes back is announced
 * again.
 *
 * @param {number} fleetId
 * @param {(alert: Object) => void} onNewAlert
 * @returns {{ triggered: Object[], refresh: () => Promise<void> }}
 */
export default function useTemperatureAlerts(fleetId, onNewAlert) {
  const [triggered, setTriggered] = useState([]);
  const onNewAlertRef = useRef(onNewAlert);
  onNewAlertRef.current = onNewAlert;

  const refresh = useCallback(async () => {
    if (!fleetId) return;
    try {
      const result = await checkFleetAlerts(fleetId);
      const list = result.triggered || [];
      setTriggered(list);

      const announced = loadAnnounced(fleetId);
      list.filter((a) => !announced.has(alertKey(a))).forEach((a) => onNewAlertRef.current?.(a));
      // Keep only breaches still active, so a cleared one can fire again
      saveAnnounced(fleetId, new Set(list.map(alertKey)));
    } catch (err) {
      console.error('Temperature alert check failed:', err);
    }
  }, [fleetId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { triggered, refresh };
}
