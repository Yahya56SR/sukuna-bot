# 爱 Doctora — All-in-One Discord Bot

A modular, slash-command-first Discord bot with moderation, economy, leveling, tickets, fun, utility, and more — inspired by PeakBot and similar all-in-one bots.

## 📦 What's Included

| Category | Commands |
|----------|----------|
| **Utility** | `ping`, `help`, `userinfo`, `serverinfo`, `voice` |
| **Moderation** | `kick`, `ban`, `timeout`, `clear`, `warn` |
| **Economy** | `balance`, `daily`, `work` |
| **Leveling** | `rank`, `leaderboard`, `levels` (setup / `role` / `leaderboard`), `xp` (`channel` / `nocxp`) |
| **Fun** | `8ball`, `coinflip`, `dice` |
| **Configuration** | `setup` (owner only) |

## 🚀 Quick Start

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g., "爱 Doctora")
3. Go to **Bot** → **Reset Token** to get your `BOT_TOKEN`
4. Copy the **Application ID** → that's your `CLIENT_ID`
5. Under **Privileged Gateway Intents**, enable:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Save changes

### 2. Invite the Bot to Your Server

Use this URL (replace `CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&integration_type=0&scope=bot+applications.commands
```

Or use the **OAuth2 → URL Generator** in the Developer Portal with:
- Scopes: `bot`, `applications.commands`
- Permissions: `Administrator` (or select specific ones)

### 3. Set Up MongoDB Atlas

爱 Doctora uses **MongoDB Atlas** (cloud) by default.

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a free account
2. Create a **Shared Cluster** (free tier M0/M2/M5)
3. **Database Access:** Add a database user with read/write permissions
4. **Network Access:** Add your IP address (or `0.0.0.0/0` to allow all)
5. **Connect:** Click Connect → Drivers → copy the connection string
6. Paste it into your `.env` as `MONGO_URI`

Your connection string looks like:
```
mongodb+srv://<username>:<password>@<cluster>.mongodb.net/sukuna-bot?retryWrites=true&w=majority
```

### 4. Configure `.env`

Your `.env` already exists with `GEMINI_API_KEY`. Fill in the Discord values:

```env
# Discord Bot
BOT_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_client_id_here
OWNER_IDS=your_discord_user_id_here
GUILD_ID=your_guild_id_here   # optional; registers commands instantly in one server

# Database
MONGO_URI=mongodb://127.0.0.1:27017/sukuna-bot

# Optional AI
GEMINI_API_KEY=your_gemini_api_key_here
```

> ⚠️ Never share your `BOT_TOKEN` or commit `.env` to git.

### 5. Install Dependencies

```bash
npm install
```

### 6. Register Slash Commands

```bash
npx ts-node deploy-commands.ts
```

This registers all `/` commands globally (or to `GUILD_ID` if set, which makes them appear instantly).

### 7. Run the Bot

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## 📁 Project Structure

```
src/
├── index.ts              # Entry point
├── client.ts             # Extended Discord client
├── database/
│   ├── connection.ts     # Mongoose connection
│   └── models/           # Guild, User, Ticket schemas
├── events/               # Discord event listeners
│   ├── ready.ts
│   ├── interactionCreate.ts  # Slash command dispatcher
│   └── messageCreate.ts      # XP leveling on messages
├── handlers/             # Auto-loaders for commands & events
├── commands/             # Slash commands (one file per command)
│   ├── utility/
│   ├── moderation/
│   ├── economy/
│   ├── leveling/
│   ├── fun/
│   └── configuration/
├── types/                # TypeScript interfaces
└── utils/                # Helpers (permissions, formatting, XP)
```

## 🔧 Adding New Commands

Create a new file in `src/commands/<category>/<name>.ts`:

```typescript
import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("mycommand")
    .setDescription("My awesome command"),
  category: "Utility",
  execute: async (client, interaction, guild) => {
    await interaction.reply("Hello!");
  },
};
```

The command handler auto-loads all files from `src/commands/`.

## 🛡️ Security

- `.env` is in `.gitignore` — never commit it
- `OWNER_IDS` gates owner-only commands
- Commands check user/bot permissions before running
- Sensitive responses are ephemeral
- Cooldowns prevent spam

## 🖥️ Dashboard

The bot serves a token-protected control panel on `$SERVER_PORT` (fallback `3001`).
It starts when `DASHBOARD_ENABLED=true`, `SUKUNA_ENABLED=true`, or when the persona
was enabled from the panel itself.

```bash
# .env
DASHBOARD_ENABLED=true
DASHBOARD_TOKEN=some-long-private-token   # omit to get a generated token in the console
```

Open `http://<host>:<port>/` and paste the token to unlock. The session is a signed
HttpOnly cookie; `Authorization: Bearer <token>` also works for scripting.

What you can do from it:

- **Overview** – guild/member counts, uptime, ping, memory, DB state, live counters
- **Guilds** – per-server modules, XP/level-up settings (message and voice
  rates, cooldowns, no-XP channels, level reward roles, live leaderboard),
  memories, rules, FAQ, announcements, scheduled messages
- **Persona** – enable/disable, model, temperature, system prompt, activation
  channels, rate limits, and a sandbox that runs one real Gemini call
- **Economy** – search/sort user balances and levels, edit records (XP edits
  re-derive the level)
- **Commands / Activity / System** – command registry, live in-memory log feed,
  runtime and security details

Changes made in the dashboard are persisted in MongoDB (`bot_configs` for the
persona, `guilds` for per-server settings) and apply without a restart.

## 🎙️ Voice

`/voice join` puts 爱 Doctora in your voice channel and opens a duplex Gemini
Live session:

- **Listening** – every member who speaks is decoded (Opus → 48 kHz stereo PCM),
  downmixed to 16 kHz mono and streamed to the Live API in 20 ms frames, with
  silence padding so the server-side VAD can end a turn.
- **Talking** – the model's audio (24 kHz PCM) is converted to 48 kHz stereo and
  played with `@discordjs/voice` (`StreamType.Raw`, so no ffmpeg). Talking over
  her sends `interrupted`, which flushes playback (barge-in).
- **Text replies** – in duplex mode she answers out loud only. If no Gemini key
  is configured (or `SUKUNA_VOICE_DUPLEX=false`), the bot falls back to reading
  its text replies out loud with a dedicated Live TTS turn instead.

```
/voice join     # join your channel and start talking
/voice status   # channel, mode, how many members are heard, speaking/idle
/voice say      # TTS mode only: read a line out loud
/voice leave    # stop and disconnect
```

Notes:

- Requires **Connect** and **Speak** in the channel, plus `GEMINI_API_KEY` and a
  Live model (`SUKUNA_MODEL`).
- `SUKUNA_VOICE_NAME` picks the prebuilt voice (default `Aoede`).
- `@discordjs/voice@0.19.2` negotiates DAVE/E2EE, which Discord now expects on
  voice connections. It depends on the native `@snazzah/davey` package (prebuilt
  per platform), so it stays outside the bundle and must be installed by the
  host's `npm install`.
- `opusscript` and `tweetnacl` are runtime dependencies like `@google/genai`:
  they must be present in `node_modules` next to `index.js` (prism-media itself
  is bundled).

## 📈 Leveling

The XP system uses MEE6's curve (`5·level² + 50·level + 100` XP to advance) and
matches MEE6's defaults:

- **Message XP** – random 15-25 XP per message, one XP-earning message per user
  per 60 s. The cooldown is persisted on the user row, so it survives restarts.
- **Voice XP** – random 5-8 XP per minute while connected, awarded by a
  one-minute tick. Sessions are seeded at startup, so members already in voice
  keep earning after a restart.
- **Filters** – bots can be excluded, channels can be excluded from XP, or a
  single channel can be made the only XP source.
- **Level rewards** – `/levels role add level: <n> role: @Role` grants a role on
  reaching a level. Tiers are exclusive: the highest reached role is granted and
  lower tiers are removed. Roles are restored when a member rejoins.
- **Announcements** – configurable channel and template with `{user}`,
  `{username}`, `{level}`, `{server}`, `{role}`, `{xp}` and `{xpneeded}`.
- **Rank cards** – `/rank` renders a PNG card and `/leaderboard` a PNG board
  (falls back to an embed when the canvas renderer is unavailable).
- **Live leaderboard** – `/levels leaderboard start channel:#board` posts one
  message and edits it on an interval (default 10 min, 25 rows) with a top-3
  podium image. `/levels leaderboard stop|status` manage it; it is also
  configurable from the dashboard.

```
/rank [user]                              # XP card
/leaderboard [limit]                      # top members
/levels setup                             # XP rates, cooldown, announce channel/message
/levels role add|remove|list              # level reward roles
/levels leaderboard start|stop|status     # self-updating board
/xp channel [channel]                     # only earn XP in one channel
/xp nocxp add|remove|list                 # exclude channels from XP
```

`@napi-rs/canvas` is a native package, so it stays outside the esbuild bundle
(next to `index.js` in `node_modules`) and is loaded lazily: if it is missing,
rank cards silently fall back to embeds. Bundled Noto fonts live in
`assets/fonts`; larger scripts and the colour emoji face are downloaded once into
`data/fonts` (gitignored).

## 📜 Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run with ts-node (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` |

## 🎯 Roadmap

- [x] Core scaffolding (client, handlers, database)
- [x] Moderation (kick, ban, timeout, clear, warn)
- [x] Economy (balance, daily, work)
- [x] Leveling (message + voice XP, rank cards, level rewards, live leaderboard)
- [x] Utility (ping, userinfo, serverinfo, help)
- [x] Fun (8ball, coinflip, dice)
- [ ] Tickets (button-based, transcripts)
- [ ] Music (Lavalink integration)
- [ ] Giveaways, Starboard, Reminders
- [ ] Anti-nuke & Automod
- [x] Web dashboard

---

Made with ❤️ for Discord.