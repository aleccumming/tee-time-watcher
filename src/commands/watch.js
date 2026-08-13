import { SlashCommandBuilder } from 'discord.js';
import { SITES, findCourse } from '../adapters/sites.js';
import { createWatch } from '../db.js';
import { parseDateInput, parseHour } from '../time.js';

export const data = new SlashCommandBuilder()
  .setName('watch')
  .setDescription('Watch a golf course for last-minute tee time openings')
  .addStringOption((opt) =>
    opt
      .setName('site')
      .setDescription('Which municipal system to watch')
      .setRequired(true)
      .addChoices(...Object.entries(SITES).map(([value, s]) => ({ name: s.label, value }))),
  )
  .addStringOption((opt) =>
    opt.setName('date').setDescription('today, tomorrow, or YYYY-MM-DD').setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('course').setDescription('Specific course name (default: watch all courses at the site)'),
  )
  .addStringOption((opt) => opt.setName('before').setDescription('Only notify for tee times before this time, e.g. 7pm'))
  .addStringOption((opt) => opt.setName('after').setDescription('Only notify for tee times after this time, e.g. 6am'));

export async function execute(interaction) {
  const site = interaction.options.getString('site', true);
  const dateInput = interaction.options.getString('date', true);
  const courseInput = interaction.options.getString('course');
  const beforeInput = interaction.options.getString('before');
  const afterInput = interaction.options.getString('after');

  let date, timeMin, timeMax, courseId, courseName;
  try {
    date = parseDateInput(dateInput);
    if (afterInput) timeMin = parseHour(afterInput);
    if (beforeInput) {
      const hour = parseHour(beforeInput);
      // "before 7pm" should include the 6pm-7pm slot, so max is inclusive of that hour.
      timeMax = hour === 0 ? 23 : hour - 1;
    }
    if (courseInput) {
      const found = findCourse(site, courseInput);
      if (!found) {
        const names = Object.values(SITES[site].courses).join(', ');
        await interaction.reply({
          content: `Couldn't find a course matching "${courseInput}" at ${SITES[site].label}. Options: ${names}`,
          ephemeral: true,
        });
        return;
      }
      courseId = found.id;
      courseName = found.name;
    }
  } catch (err) {
    await interaction.reply({ content: err.message, ephemeral: true });
    return;
  }

  const watchId = createWatch({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    site,
    courseId,
    date,
    timeMin,
    timeMax,
  });

  const scope = courseName ?? `all courses at ${SITES[site].label}`;
  const window = [afterInput && `after ${afterInput}`, beforeInput && `before ${beforeInput}`]
    .filter(Boolean)
    .join(' and ');

  await interaction.reply(
    `Watching **${scope}** on **${date}**${window ? ` (${window})` : ''}. I'll ping you here when a slot opens up. (watch #${watchId})`,
  );
}
