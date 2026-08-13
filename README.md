# Tee Time Watcher

Discord bot that watches golfvancouver.cps.golf and golfburnaby.cps.golf for
last-minute tee time openings and notifies you when one matches a saved watch.

See [CLAUDE.md](./CLAUDE.md) for the full architecture and API reverse-engineering
notes.

## Setup

### 1. Install Node.js

Node isn't installed on this machine yet. Grab the LTS installer from
https://nodejs.org and install it, then verify with `node -v` in a new terminal
(needs a fresh shell so PATH picks it up).

### 2. Create the Discord bot

1. Go to https://discord.com/developers/applications → **New Application**.
2. Under **Bot**, click **Reset Token** to get a token, and save it — you'll put it
   in `.env` as `DISCORD_TOKEN`.
3. Still under **Bot**, no privileged intents are needed for this bot (it doesn't
   read message content).
4. Copy the **Application ID** from **General Information** → that's `DISCORD_CLIENT_ID`.
5. Under **OAuth2 → URL Generator**, check scopes `bot` and `applications.commands`,
   and under bot permissions check **Send Messages** and **Use Slash Commands**.
   Open the generated URL to invite the bot to your server.
6. (Optional but recommended for development) Right-click your Discord server icon
   → **Copy Server ID** (enable Developer Mode in Discord settings first if you
   don't see this option) → that's `DISCORD_GUILD_ID`. Guild-scoped commands show
   up instantly; global commands can take up to an hour.

### 3. Configure

```
cp .env.example .env
```

Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optionally `DISCORD_GUILD_ID`.

### 4. Install dependencies and register commands

```
npm install
npm run deploy-commands
```

### 5. Run the bot

```
npm start
```

## Usage

- `/watch date:tomorrow before:7pm` — watch every course at both Vancouver and
  Burnaby for tomorrow, notify on anything before 7pm. (`site` is optional and
  defaults to both — pass `site:vancouver` or `site:burnaby` to narrow it.)
- `/watch date:tomorrow until:2026-08-17 before:6:45pm` — watch every day from
  tomorrow through Aug 17, across both sites, for anything before 6:45pm —
  e.g. when you don't have a set date and just want the next opening this week.
- `/list` — see your active watches and their ids.
- `/unwatch id:3` — stop a watch.

When a new slot opens (or is already open) matching your watch, the bot posts in
the channel where you ran `/watch` and pings you — then automatically stops that
watch (one notification and done). Run `/watch` again if you want to keep
looking after that.

## Notes

- This uses an unofficial, reverse-engineered API from the booking site's own
  Angular app — see CLAUDE.md. It could break if the site changes.
- No automated booking. You still book manually through the site once notified.
- Default poll interval is every 3 minutes (`POLL_INTERVAL_MINUTES` in `.env`).
