import { searchTeeTimes } from './adapters/cps.js';
import { SITES } from './adapters/sites.js';
import { getActiveWatches, hasSeenSlot, markSlotSeen, deactivateWatch } from './db.js';
import { dateKeyToDate, dateKeyRange } from './time.js';

// courseId alone can collide across sites (e.g. courseId 1 exists at both
// Vancouver's Langara and Burnaby Mountain), so a multi-site watch needs the
// site baked into the identity to avoid treating them as the same slot.
//
// teeSheetId (not courseTimeId!) is what's actually unique per specific time
// slot — courseTimeId turns out to be constant for every time at a given
// course on a given day (confirmed against live data), so using it collapsed
// every distinct time at the same course into one identity and made all but
// the first look "already seen".
function slotKey(siteKey, slot) {
  return `${siteKey}:${slot.courseId}:${slot.teeSheetId ?? slot.courseTimeId}`;
}

// The CPS API's teeOffTimeMin/Max filter is hour-granularity only, but watches
// store exact minutes (e.g. "before 6:50pm"). Query a broadened hour window
// server-side, then filter to the exact minute bound ourselves below.
function hourBounds(timeMinMinutes, timeMaxMinutes) {
  return {
    hourMin: timeMinMinutes != null ? Math.floor(timeMinMinutes / 60) : undefined,
    hourMax: timeMaxMinutes != null ? Math.floor(timeMaxMinutes / 60) : undefined,
  };
}

function inTimeWindow(slot, timeMinMinutes, timeMaxMinutes) {
  const start = new Date(slot.startTime);
  const minutes = start.getHours() * 60 + start.getMinutes();
  if (timeMinMinutes != null && minutes < timeMinMinutes) return false;
  if (timeMaxMinutes != null && minutes > timeMaxMinutes) return false;
  return true;
}

function formatSlot(site, slot, showDate) {
  const start = new Date(slot.startTime);
  const dateStr = showDate ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' : '';
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const price = slot.shItemPrices?.[0]?.displayPrice;
  const priceStr = price != null ? `$${Number(price).toFixed(2)}` : 'price n/a';
  return `**${slot.courseName}** — ${dateStr}${time}, ${slot.holes} holes, ${priceStr} — <${site.bookingUrl}>`;
}

export async function pollOnce(client) {
  const watches = getActiveWatches();
  if (!watches.length) return;

  // A config/auth failure for a site is site-wide, not watch-specific — once one
  // watch hits it this cycle, retrying the same doomed request for every other
  // watch on that site just hammers an already-failing endpoint for no benefit.
  const failedSites = new Set();

  for (const watch of watches) {
    const siteKeys = watch.site === 'all' ? Object.keys(SITES) : [watch.site];
    const dateKeys = watch.date_end ? dateKeyRange(watch.date, watch.date_end) : [watch.date];
    const { hourMin, hourMax } = hourBounds(watch.time_min, watch.time_max);
    const newSlots = []; // { site, slot }

    for (const siteKey of siteKeys) {
      const site = SITES[siteKey];
      if (!site || failedSites.has(siteKey)) continue;

      for (const dateKey of dateKeys) {
        try {
          const slots = await searchTeeTimes(siteKey, {
            date: dateKeyToDate(dateKey),
            teeOffTimeMin: hourMin,
            teeOffTimeMax: hourMax,
          });
          for (const slot of slots) {
            if (!inTimeWindow(slot, watch.time_min, watch.time_max)) continue;
            const key = slotKey(siteKey, slot);
            if (!hasSeenSlot(watch.id, key)) newSlots.push({ site, slot });
            markSlotSeen(watch.id, key);
          }
        } catch (err) {
          console.error(`[poller] watch ${watch.id} (${siteKey} ${dateKey}) failed:`, err.message);
          failedSites.add(siteKey);
          break; // this site's down for the cycle — no point trying its other dates
        }
      }
    }

    if (!newSlots.length) continue;

    const channel = await client.channels.fetch(watch.discord_channel_id).catch(() => null);
    if (!channel) continue;

    const showDate = !!watch.date_end;
    const dateLabel = watch.date_end ? `${watch.date} through ${watch.date_end}` : watch.date;
    const lines = newSlots.map(({ site, slot }) => formatSlot(site, slot, showDate));
    await channel.send({
      content: `<@${watch.discord_user_id}> new tee time opening${newSlots.length > 1 ? 's' : ''} (${dateLabel}):\n${lines.join('\n')}\n(watch #${watch.id} stopped — /watch again if you want to keep looking)`,
      allowedMentions: { users: [watch.discord_user_id] },
    });

    // One notification and done — the user books manually from here. They can
    // /watch again if they want to keep monitoring for further openings.
    deactivateWatch(watch.id, watch.discord_user_id);
  }
}
