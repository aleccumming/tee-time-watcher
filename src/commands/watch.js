import { SlashCommandBuilder } from 'discord.js';
import { SITES } from '../adapters/sites.js';
import { createWatch } from '../db.js';
import { parseDateInput, parseHour } from '../time.js';

export const data = new SlashCommandBuilder()
  .setName('watch')
  .setDescription('Watch for last-minute tee time openings')
  .addStringOption((opt) =>
    opt.setName('date').setDescription('today, tomorrow, or YYYY-MM-DD').setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('until')
      .setDescription('Watch every day from date through this day too (today, tomorrow, or YYYY-MM-DD)'),
  )
  .addStringOption((opt) =>
    opt
      .setName('site')
      .setDescription('Which municipal system to watch (default: both)')
      .addChoices(...Object.entries(SITES).map(([value, s]) => ({ name: s.label, value }))),
  )
  .addStringOption((opt) => opt.setName('before').setDescription('Only notify for tee times before this time, e.g. 7pm'))
  .addStringOption((opt) => opt.setName('after').setDescription('Only notify for tee times after this time, e.g. 6am'));

export async function execute(interaction) {
  const dateInput = interaction.options.getString('date', true);
  const untilInput = interaction.options.getString('until');
  const site = interaction.options.getString('site') ?? 'all';
  const beforeInput = interaction.options.getString('before');
  const afterInput = interaction.options.getString('after');

  let date, dateEnd, timeMin, timeMax;
  try {
    date = parseDateInput(dateInput);
    if (untilInput) {
      dateEnd = parseDateInput(untilInput);
      if (dateEnd < date) {
        await interaction.reply({
          content: `"until" (${dateEnd}) can't be before the date (${date}).`,
          ephemeral: true,
        });
        return;
      }
    }
    if (afterInput) timeMin = parseHour(afterInput);
    if (beforeInput) {
      const hour = parseHour(beforeInput);
      // "before 7pm" should include the 6pm-7pm slot, so max is inclusive of that hour.
      timeMax = hour === 0 ? 23 : hour - 1;
    }
  } catch (err) {
    await interaction.reply({ content: err.message, ephemeral: true });
    return;
  }

  const watchId = createWatch({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    site,
    date,
    dateEnd,
    timeMin,
    timeMax,
  });

  const siteLabel = site === 'all' ? 'Vancouver & Burnaby' : SITES[site].label;
  const window = [afterInput && `after ${afterInput}`, beforeInput && `before ${beforeInput}`]
    .filter(Boolean)
    .join(' and ');
  const dateRange = dateEnd ? `**${date}** through **${dateEnd}**` : `**${date}**`;

  await interaction.reply(
    `Watching **${siteLabel}** on ${dateRange}${window ? ` (${window})` : ''}. I'll ping you here when a slot opens up. (watch #${watchId})`,
  );
}
