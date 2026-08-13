import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import * as watch from './commands/watch.js';
import * as list from './commands/list.js';
import * as unwatch from './commands/unwatch.js';
import { pollOnce } from './poller.js';

const commands = new Map([watch, list, unwatch].map((c) => [c.data.name, c]));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  const intervalMinutes = Number(process.env.POLL_INTERVAL_MINUTES ?? 3);
  cron.schedule(`*/${intervalMinutes} * * * *`, () => {
    pollOnce(client).catch((err) => console.error('[poller] top-level error:', err));
  });
  console.log(`Polling every ${intervalMinutes} minute(s).`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
