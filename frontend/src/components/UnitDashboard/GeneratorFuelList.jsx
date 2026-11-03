import React from 'react';
import { Card, CardTitle } from './ui';
import { currentFuel, fuelCapacity, fmt2 } from '../../utils/unitData';

/**
 * Every unit's current fuel level as a bar against its tank capacity
 * (or against the fullest tank when a capacity is unknown). The selected
 * unit is drawn in the strong orange.
 */
const GeneratorFuelList = ({ units, selectedId, onSelectUnit }) => {
  const rows = units.map((u) => ({ id: u.id, name: u.name, fuel: currentFuel(u), capacity: fuelCapacity(u) }));
  const fallbackMax = Math.max(1, ...rows.map((r) => r.fuel ?? 0));

  return (
    <Card className="p-5 h-full flex flex-col">
      <CardTitle icon="fa-bars-progress" title="Generator-wise Fuel (Today)" subtitle="Current fuel level by unit (L)" />
      <ul className="mt-4 space-y-3.5 overflow-y-auto max-h-64 pr-1">
        {rows.map((r) => {
          const share = r.fuel === null ? 0 : Math.min(100, (r.fuel / (r.capacity || fallbackMax)) * 100);
          const selected = r.id === selectedId;
          return (
            <li key={r.id}>
              <button
                type="button"
                className="w-full grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-left group"
                onClick={() => onSelectUnit(r.id)}
                aria-pressed={selected}
              >
                <span className={`text-xs truncate ${selected ? 'font-bold text-gray-900' : 'font-semibold text-gray-700 group-hover:text-gray-900'}`}>{r.name}</span>
                <span className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${selected ? 'bg-orange-600' : 'bg-orange-300'}`}
                    style={{ width: `${share}%` }}
                  ></span>
                </span>
                <span className="text-sm font-bold text-gray-900 text-right whitespace-nowrap">{r.fuel === null ? '—' : `${fmt2(r.fuel)} L`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export default GeneratorFuelList;
