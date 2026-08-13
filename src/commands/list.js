import { SlashCommandBuilder } from 'discord.js';
import { SITES } from '../adapters/sites.js';
import { getUserWatches } from '../db.js';

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
    const site = SITES[w.site];
    const scope = w.course_id ? site.courses[w.course_id] : `all courses at ${site.label}`;
    const window = [w.time_min != null && `after ${w.time_min}:00`, w.time_max != null && `before ${w.time_max + 1}:00`]
      .filter(Boolean)
      .join(', ');
    return `#${w.id} — ${scope} on ${w.date}${window ? ` (${window})` : ''}`;
  });

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
