// How each maintenance status is labelled and coloured across the cards.

export const MAINTENANCE_STATUS = {
  ok: { label: 'Service OK', short: 'On Schedule', tone: 'green' },
  due_soon: { label: 'Service Due Soon', short: 'Due Soon', tone: 'amber' },
  overdue: { label: 'Service Overdue', short: 'Overdue', tone: 'red' },
  not_configured: { label: 'Not Set Up', short: 'Not Set Up', tone: 'gray' },
};

export const maintenanceStatus = (m) => MAINTENANCE_STATUS[m?.status] || MAINTENANCE_STATUS.not_configured;

export function formatDueDate(date) {
  if (!date) return '—';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function daysLeftText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) return `${-daysLeft} days overdue`;
  if (daysLeft === 0) return 'today';
  return `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}
