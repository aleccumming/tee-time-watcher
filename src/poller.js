import { searchTeeTimes } from './adapters/cps.js';
import { SITES } from './adapters/sites.js';
import { getActiveWatches, hasSeenSlot, markSlotSeen } from './db.js';
import { dateKeyToDate } from './time.js';

function slotKey(slot) {
  return `${slot.courseId}:${slot.courseTimeId ?? slot.teeSheetId}`;
}

function formatSlot(site, slot) {
  const time = new Date(slot.startTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const price = slot.shItemPrices?.[0]?.displayPrice;
  const priceStr = price != null ? `$${Number(price).toFixed(2)}` : 'price n/a';
  return `**${slot.courseName}** — ${time}, ${slot.holes} holes, ${priceStr} — <${site.bookingUrl}>`;
}

export async function pollOnce(client) {
  const watches = getActiveWatches();
  if (!watches.length) return;

  for (const watch of watches) {
    try {
      const site = SITES[watch.site];
      if (!site) continue;

      const slots = await searchTeeTimes(watch.site, {
        date: dateKeyToDate(watch.date),
        courseIds: watch.course_id ? [watch.course_id] : undefined,
        teeOffTimeMin: watch.time_min ?? undefined,
        teeOffTimeMax: watch.time_max ?? undefined,
      });

      const newSlots = slots.filter((slot) => !hasSeenSlot(watch.id, slotKey(slot)));
      for (const slot of slots) markSlotSeen(watch.id, slotKey(slot));

      if (!newSlots.length) continue;

      const channel = await client.channels.fetch(watch.discord_channel_id).catch(() => null);
      if (!channel) continue;

      const lines = newSlots.map((slot) => formatSlot(site, slot));
      await channel.send({
        content: `<@${watch.discord_user_id}> new tee time opening${newSlots.length > 1 ? 's' : ''} for **${site.label}** on ${watch.date}:\n${lines.join('\n')}`,
        allowedMentions: { users: [watch.discord_user_id] },
      });
    } catch (err) {
      console.error(`[poller] watch ${watch.id} failed:`, err.message);
    }
  }
}
