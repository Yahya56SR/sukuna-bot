# Sukuna Bot — All-in-One Discord Bot

A modular, slash-command-first Discord bot with moderation, economy, leveling, tickets, fun, utility, and more — inspired by PeakBot and similar all-in-one bots.

## 📦 What's Included

| Category | Commands |
|----------|----------|
| **Utility** | `ping`, `help`, `userinfo`, `serverinfo` |
| **Moderation** | `kick`, `ban`, `timeout`, `clear`, `warn` |
| **Economy** | `balance`, `daily`, `work` |
| **Leveling** | `rank` (XP gained on messages) |
| **Fun** | `8ball`, `coinflip`, `dice` |
| **Configuration** | `setup` (owner only) |

## 🚀 Quick Start

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g., "Sukuna")
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

Sukuna Bot uses **MongoDB Atlas** (cloud) by default.

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
- **Guilds** – per-server modules, XP/level-up settings, memories, rules, FAQ,
  announcements, scheduled messages
- **Persona** – enable/disable, model, temperature, system prompt, activation
  channels, rate limits, and a sandbox that runs one real Gemini call
- **Economy** – search/sort user balances and levels, edit records
- **Commands / Activity / System** – command registry, live in-memory log feed,
  runtime and security details

Changes made in the dashboard are persisted in MongoDB (`bot_configs` for the
persona, `guilds` for per-server settings) and apply without a restart.

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
- [x] Leveling (XP on messages, rank)
- [x] Utility (ping, userinfo, serverinfo, help)
- [x] Fun (8ball, coinflip, dice)
- [ ] Tickets (button-based, transcripts)
- [ ] Music (Lavalink integration)
- [ ] Giveaways, Starboard, Reminders
- [ ] Anti-nuke & Automod
- [x] Web dashboard

---

Made with ❤️ for Discord.