# 爱 Doctora Bot — Agent Notes

> The bot identity is **爱 Doctora**. `sukuna`/`Sukuna*`/`SUKUNA_*` is the legacy internal namespace — do **not** rename it; it breaks env vars, Mongo config keys and model names.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | `tsx watch --clear-screen=false src/index.ts` |
| `npm start` | `tsx src/index.ts` |
| `npm run bundle:bot` | esbuild `src/index.ts` → committed `index.js` (~7 MB, hard gate at 20 MB) |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |

CI (`.github/workflows/ci.yml`): `npm ci` → `typecheck` → `bundle:bot`, then auto-commits `index.js` on push to `main` if changed. Also runs on PRs (no commit step there).

## Gotchas (easy to miss)

**1. No `"type": "module"` — bundle is CJS**
`package.json` has no `type` field. `index.js` is a single esbuild CJS bundle required for `mongoose require()`. Production runs `node index.js`. Never edit `index.js` directly — edit `src/` then re-bundle.

**2. Command registry is static**
`src/commands/index.ts` imports every command and registers them in a `readonly Command[]` array. Adding a new command file is not enough — add the import and array entry there. Dynamic loading breaks esbuild bundling.

**3. Gemini Live API only (no `generateContent`)**
The persona uses `ai.live.connect` (WebSocket `bidiGenerateContent`), not `generateContent`. Model must be a Live model (default `gemini-3.8-live`); Live-only models reject `generateContent` with HTTP 400. Every turn must end in one decision tool call (`send_message`, `send_sticker`, `stay_silent`). Request `Modality.AUDIO` with `outputAudioTranscription: {}` — `responseModalities: [TEXT]` closes the socket with code 1007. `gemini-3.8-live` must not receive `thinkingConfig`; the extended-thinking model requires `thinkingLevel`.

**4. Voice needs native addons the bundle can't include**
`@discordjs/voice@0.19.2` negotiates DAVE/E2EE and requires native `@snazzah/davey` (per-platform prebuilts) — listed in `EXTERNALS` in `scripts/bundle-bot.mjs`, installed by the host's `npm install`. `opusscript`, `tweetnacl`, `ffmpeg-static` stay runtime-resolved; `prism-media` is bundled. Voice is lazy-loaded in `src/index.ts` (`shutdownVoiceSafely`) so a missing native dep never blocks startup/shutdown.

**5. `@napi-rs/canvas` is external and lazy-loaded**
Native per-platform binaries, external in the bundle; loaded via `src/utils/canvas-runtime.ts`. Rank cards fall back to `src/utils/rankEmbeds.ts` (plain embeds) when the addon is missing. Committed fonts in `assets/fonts`; larger scripts/emoji face download once into gitignored `data/fonts`.

**6. XP is global; level is re-derived, never trusted**
`User.xp` mirrors `User.totalXp` (one total per user, no per-guild split). `level` is always re-derived from the total (`levelFromXp`) — a stale level swallows every future level-up. Reads use `effectiveXp(doc)` = `max(xp, totalXp)` so legacy rows still rank. Per-guild settings (rates, cooldown, no-XP channels, exclusive channel, ignore-bots, reward roles, live leaderboard) live on the `Guild` document via `readLevelSettings()`. XP is awarded by `src/events/messageCreate.ts` (cooldown cached in `client.xpCooldowns` + `User.lastMessageAt`) and `src/events/voiceStateUpdate.ts` (one-minute tick). `src/handlers/levelUp.ts` (`resolveLevelRoles`) grants the highest reached tier, removes lower ones, and never removes the role being granted.

**7. Dashboard binds `0.0.0.0:$SERVER_PORT`**
`dashboard/server.ts` reads `SERVER_PORT` (bot-hosting.net sets it), falls back to `3001`. Started in `src/events/ready.ts` only when `DASHBOARD_ENABLED=true`, `SUKUNA_ENABLED=true`, or the persona was enabled from the panel. Token-protected JSON API + SPA; a random token is generated and printed at startup unless `DASHBOARD_TOKEN` is set. Session is a signed HttpOnly cookie; `Authorization: Bearer <token>` also works. Static assets (`index.html`, `styles.css`, `app.js`) are served from `process.cwd()`, not bundled.

**8. Env loading**
`src/config/env.ts` uses `process.loadEnvFile(".env")` (Node >=20.6) then validates via zod. `.env` is gitignored; `.env.example` is the template. Required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGO_URI`. Optional: `GUILD_ID` (when set, the bot auto-leaves any other guild on ready, ignores interactions from other guilds, and the dashboard only lists that guild — test in the allowed guild only), `DEV_GUILD_ID` (instant per-guild command registration during dev), `DASHBOARD_TOKEN`.

**9. MongoDB Atlas only**
Mongoose connection in `src/db/index.ts`. Models: `Guild`, `User`, `SukunaMemory`, `BotConfig`, plus ticket models (`TicketPanel`, `TicketDepartment`, `OpenTicket`, `TicketConfig`). No local MongoDB.

**10. Slash commands registered at startup**
`registerApplicationCommands()` runs after `client.login()` in `src/index.ts`. Set `DEV_GUILD_ID` for instant per-guild registration during dev; omit for global (takes up to 1 hour to propagate).

## Common mistakes to avoid

- Adding a command file without updating `src/commands/index.ts` → command won't be bundled/registered
- Editing `index.js` directly → it's generated; always edit `src/` then re-bundle
- Setting `"type": "module"` → breaks CJS `require()` for mongoose
- Using `generateContent` or `TEXT` response modality with `gemini-3.8-live` → socket closed with code 1007
- Editing dashboard `index.html`/`app.js`/`styles.css` → they're static files served from `process.cwd()`, not bundled
- Forgetting `GUILD_ID` makes the bot auto-leave other guilds on ready → test in the allowed guild only
