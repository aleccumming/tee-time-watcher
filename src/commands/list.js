import { SlashCommandBuilder } from 'discord.js';
import { SITES } from '../adapters/sites.js';
import { getUserWatches } from '../db.js';
import { formatTimeOfDay } from '../time.js';

export const data = new SlashCommandBuilder()
  .setName('list')
  .setDescription('List your active tee time watches');

export async function execute(interaction) {
  const watches = getUserWatches(interaction.user.id);
  if (!watches.length) {
    await interaction.reply({ content: "You don't have any active watches.", ephemeral: true });
    return;
  }

  const lines = watches.map((w) => {
    const siteLabel = w.site === 'all' ? 'Vancouver & Burnaby' : SITES[w.site].label;
    const window = [
      w.time_min != null && `after ${formatTimeOfDay(w.time_min)}`,
      w.time_max != null && `before ${formatTimeOfDay(w.time_max + 1)}`,
    ]
      .filter(Boolean)
      .join(', ');
    const dateRange = w.date_end ? `${w.date} through ${w.date_end}` : w.date;
    return `#${w.id} — ${siteLabel} on ${dateRange}${window ? ` (${window})` : ''}`;
  });

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
