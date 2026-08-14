/** Parse "today" / "tomorrow" / "YYYY-MM-DD" into a YYYY-MM-DD string. */
export function parseDateInput(input) {
  const lower = input.trim().toLowerCase();
  const today = new Date();
  if (lower === 'today') return toDateKey(today);
  if (lower === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toDateKey(d);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lower);
  if (match) return lower;
  throw new Error(`Couldn't parse date "${input}". Use "today", "tomorrow", or YYYY-MM-DD.`);
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateKeyToDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** All date keys from startKey to endKey, inclusive. */
export function dateKeyRange(startKey, endKey) {
  const keys = [];
  const cursor = dateKeyToDate(startKey);
  const end = dateKeyToDate(endKey);
  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/** Parse a loose time string ("7pm", "6:50pm", "19:00", "19") into minutes since midnight (0-1439). */
export function parseTimeOfDay(input) {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s);
  if (!match) throw new Error(`Couldn't parse time "${input}". Try formats like "7pm", "6:50pm", or "19:00".`);
  const [, hourStr, minuteStr, ampm] = match;
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`Time out of range: ${input}`);
  return hour * 60 + minute;
}

/** Format minutes-since-midnight back into a human time like "6:50pm". */
export function formatTimeOfDay(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${hour12}:${String(minute).padStart(2, '0')}${period}` : `${hour12}${period}`;
}
