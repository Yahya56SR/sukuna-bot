# 爱 Doctora Bot — Agent Notes

> The persona/bot is **爱 Doctora** (a girl speaking Arabizi Darija). `sukuna`/`Sukuna*`/`SUKUNA_*` names are the legacy internal namespace and are intentionally **not** renamed: they would break env vars, Mongo config keys and model names.

## Runtime pattern (vernova-bot style)
- Dev: `npm run dev` → `tsx watch src/index.ts`
- Production: `node index.js` (single esbuild CJS bundle committed at repo root)
- Bundle: `npm run bundle:bot` → esbuild bundles `src/index.ts` → `index.js` (~7.4MB, gated at 20MB)
- **`package.json` has NO `"type": "module"`** — the bundle runs as CJS (required for `mongoose require()`)

## Commands that matter
| Command | Purpose |
|---------|---------|
| `npm run dev` | tsx watch, dev mode |
| `npm run bundle:bot` | esbuild single-file bundle at `index.js` |
| `npm run typecheck` | `tsc --noEmit` (no build step needed) |

CI runs `typecheck` → `bundle:bot`, then auto-commits `index.js` on push to `main` if changed.

## Architecture gotchas (easy to miss)

**1. Command registry is static — not filesystem scanned**
`src/commands/index.ts` imports every command file and registers them in a `readonly Command[]` array. Adding a new command file is NOT enough; you must add the import and array entry in `src/commands/index.ts`. Dynamic loading breaks esbuild bundling.

**2. `@google/genai` is an external bundle dependency**
`scripts/bundle-bot.mjs` externalizes `@google/genai` (plus native addons). It must remain `require()`-able at runtime. Do not bundle it into `index.js`.

**3. Dashboard binds to `0.0.0.0:$SERVER_PORT`**
`dashboard/server.ts` reads `process.env.SERVER_PORT` (bot-hosting.net sets this). Falls back to `3001`. Starts only when `SUKUNA_ENABLED=true` (checked in `src/events/ready.ts`).

**4. Sukuna AI persona = Gemini Live API only (no `generateContent`)**
`src/core/gemini-live.ts` talks to Gemini over `ai.live.connect` (WebSocket / `bidiGenerateContent`) and every turn must end in one decision tool call (`send_message`, `send_sticker` or `stay_silent`). The configured model **must be a Live model** (e.g. `gemini-3.8-live`); `models.generateContent*` is intentionally absent from the codebase because Live-only models reject it with HTTP 400. `src/utils/sukuna.ts` owns the session cache, history, rate limiting and Discord delivery; `src/utils/sukuna-tools.ts` holds the information tools (`get_server_info`, `get_member_info`, `search_discord_messages`, memory, …) plus the `send_dm` side-effect tool (DM only the trigger author, someone they mentioned, or any member when the trigger author has `ManageGuild`; 10/hour per guild, 1/minute per member). Sessions are kept warm and recycled on request/time limits or config change.

**5. Env loading**
`src/config/env.ts` uses `process.loadEnvFile(".env")` (Node >=20.6) then validates via zod. `.env` is gitignored; `.env.example` is the template. Production host injects vars directly.

**6. MongoDB Atlas only**
Mongoose connection in `src/db/index.ts`. No local MongoDB, no Supabase.

**7. Slash commands registered at startup**
`registerApplicationCommands()` runs after `client.login()`. Set `DEV_GUILD_ID` for instant per-guild registration during dev; omit for global (takes up to 1 hour to propagate).

**8. Live 3.8 models reject `responseModalities: [TEXT]`**
`gemini-3.8-live` / `-extended-thinking` close the socket with code 1007 ("The requested combination of response modalities (TEXT) is not supported"). Always request `Modality.AUDIO` with `outputAudioTranscription: {}` and read `serverContent.outputTranscription` (see l7aj-bot, which runs the same models in production). Also: `gemini-3.8-live` must NOT receive `thinkingConfig`, while the extended-thinking model requires a `thinkingLevel`.

**9. Voice is opt-in and has two modes**
`/voice join` joins the caller's channel. `src/voice/manager.ts` keeps one connection + player per guild:
- `duplex` (default with `GEMINI_API_KEY`): `src/voice/conversation.ts` opens a second Live session. Mic path: OPUS from `connection.receiver.subscribe()` → `prism-media` decoder → `DiscordPcmTo16k` (48 kHz stereo → 16 kHz mono) → 20 ms frames via `sendRealtimeInput`, silence-padded so server VAD ends turns. Output path: Live 24 kHz PCM → `PcmToDiscord` → `StreamType.Raw` player; `serverContent.interrupted` flushes playback for barge-in.
- `tts` (fallback, or `SUKUNA_VOICE_DUPLEX=false`): `speech.ts` reads each posted text reply with a one-shot Live turn.
`speakInVoice()` (called from `src/utils/sukuna.ts` after a reply is posted) is a no-op in duplex mode, otherwise the reply would be spoken twice. The duplex system prompt (`buildSukunaVoicePrompt`) strips the tool-call decision contract, since a call cannot end in `send_message`.

**10. `@discordjs/voice` is 0.19.2 and needs the native `@snazzah/davey`**
Discord requires DAVE/E2EE negotiation on voice connections; 0.18 has no DAVE support at all and the voice socket is refused. `@snazzah/davey` is a NAPI package with per-platform prebuilt optional deps, so it cannot be bundled: it is listed in `EXTERNALS` and installed from `package.json` by the host (`npm install` does run on bot-hosting.net). `prism-media` is bundled; `opusscript`, `tweetnacl` and `ffmpeg-static` stay runtime-resolved (the last one is external-only and never called).

`@discordjs/voice` ships ESM and calls `createRequire(import.meta.url)` at load time. In CJS output esbuild turns `import.meta` into `{}`, which crashed the bundle with `ERR_INVALID_ARG_VALUE` on the host. `scripts/bundle-bot.mjs` now injects `var __importMetaUrl = require("node:url").pathToFileURL(__filename).href;` in the banner and maps `import.meta.url` to it via `define` — keep both together when touching the banner.

**11. XP is global; level settings are per guild**
`User.xp` / `User.totalXp` store one total per user (no per-guild split) so the dashboard's global `/api/users` economy/levels view keeps working. `xp` is mirrored to `totalXp` and `level` is always re-derived from the total (`levelFromXp`), never trusted from the row — a stale level would swallow every future level-up. Reads go through `effectiveXp(doc)` = `max(xp, totalXp)` so legacy rows still rank. Everything else (rates, cooldown, no-XP channels, exclusive channel, ignore-bots, level reward roles, live leaderboard) lives on the `Guild` document and is normalised by `readLevelSettings()`.
- XP is awarded by `src/events/messageCreate.ts` (cooldown cached in `client.xpCooldowns` + persisted in `User.lastMessageAt`) and `src/events/voiceStateUpdate.ts` (one-minute tick; `startVoiceTracking`/`startLiveLeaderboard` are started in `ready.ts` and stopped in `src/index.ts`).
- `src/handlers/levelUp.ts` implements exclusive reward tiers (`resolveLevelRoles`): grant the highest reached tier, then remove lower ones, and never remove the role being granted.
- `src/utils/rankcard.ts` uses `@napi-rs/canvas`, which is native and therefore in `EXTERNALS` (host runs `npm install`). It is imported lazily through `src/utils/canvas-runtime.ts`; if the addon is missing the commands fall back to `src/utils/rankEmbeds.ts`. Fonts: `assets/fonts` is committed (Noto Latin/Arabic/CJK/…), larger scripts and the colour emoji face download once into gitignored `data/fonts`.
- XP commands are gated by the `leveling` module; `/levels` and `/xp` need `ManageGuild`.

## File locations
- Entry: `src/index.ts`
- Client: `src/core/client.ts` (`SukunaClient` extends `discord.js.Client`)
- Commands: `src/commands/<category>/<name>.ts` + registry in `src/commands/index.ts`
- Events: `src/events/<name>.ts` + registry in `src/events/index.ts`
- Config: `src/config/env.ts` (env schema), `src/config/index.ts` (Sukuna persona config)
- DB: `src/db/index.ts` + `src/db/models/*.ts`
- AI persona: `src/utils/sukuna.ts`, `src/core/gemini-live.ts`, `src/utils/sukuna-tools.ts`, `src/utils/sukuna-memory.ts`, `src/prompts/sukuna.ts`
- Voice: `src/voice/manager.ts` (connections/queue), `src/voice/conversation.ts` (duplex Live call), `src/voice/speech.ts` (TTS turn), `src/voice/pcm.ts` (resamplers), `/voice` in `src/commands/core/voice.ts`
- Leveling: `src/utils/level.ts` (MEE6 math), `src/utils/levelSettings.ts`, `src/db/utils.ts` (XP API), `src/handlers/levelUp.ts`, `src/utils/{rankcard,rankEmbeds,canvas-runtime,fonts}.ts`, `src/utils/liveLeaderboard.ts`, commands in `src/commands/leveling/`
- Dashboard: `dashboard/server.ts` + `dashboard/{index.html,styles.css,app.js}`
- Bundle script: `scripts/bundle-bot.mjs`

## Common mistakes to avoid
- Adding a command file without updating `src/commands/index.ts` → command won't be bundled/registered
- Editing `index.js` directly → it's generated; always edit `src/` then re-bundle
- Setting `"type": "module"` → breaks CJS `require()` for mongoose
- Forgetting `SUKUNA_ENABLED=true` + `GEMINI_API_KEY` on bot-hosting.net → dashboard won't start, Sukuna won't respond