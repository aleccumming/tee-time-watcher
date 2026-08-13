import { SlashCommandBuilder } from 'discord.js';
import { deactivateWatch } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('unwatch')
  .setDescription('Stop watching a tee time (use /list to find the id)')
  .addIntegerOption((opt) => opt.setName('id').setDescription('Watch id from /list').setRequired(true));

export async function execute(interaction) {
  const id = interaction.options.getInteger('id', true);
  const removed = deactivateWatch(id, interaction.user.id);
  await interaction.reply({
    content: removed ? `Stopped watch #${id}.` : `Couldn't find an active watch #${id} owned by you.`,
    ephemeral: true,
  });
}
