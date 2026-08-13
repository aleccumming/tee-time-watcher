import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as watch from './commands/watch.js';
import * as list from './commands/list.js';
import * as unwatch from './commands/unwatch.js';

const commands = [watch, list, unwatch].map((c) => c.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

const route = process.env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

const result = await rest.put(route, { body: commands });
console.log(`Registered ${result.length} commands${process.env.DISCORD_GUILD_ID ? ' (guild-scoped, instant)' : ' (global, may take up to 1hr to propagate)'}.`);
