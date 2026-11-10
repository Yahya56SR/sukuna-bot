# Dashboard — Discord login & full system coverage

The web dashboard (`http://localhost:3000` by default) is the control plane for every
Sukuna system. It is protected by **Discord OAuth2**, and each page maps to a real
module with live data and (where safe) management actions.

---

## 1. Enabling Discord login

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and
   create (or open) your application. The **Application ID** is your `DISCORD_CLIENT_ID`.
2. Under **OAuth2 → General**:
   - *Redirects* → add `<DASHBOARD_URL>/auth/callback`
     (for example `http://localhost:3000/auth/callback`).
   - *Scopes* → the bot requests `identify guilds` (no extra consent needed).
3. Under **Bot → Reset Token** copy the client secret into `DISCORD_CLIENT_SECRET`.
4. Configure `.env`:

```env
DASHBOARD_URL=http://localhost:3000
DISCORD_CLIENT_ID=1234567890
DISCORD_CLIENT_SECRET=your_client_secret
DASHBOARD_SESSION_SECRET=a-long-random-string   # signs the session cookie
DASHBOARD_SESSION_DAYS=7                        # session lifetime
DASHBOARD_OWNER_IDS=111111111,222222222        # optional: bot owners
DASHBOARD_GUILD_ID=                            # optional: restrict to one server
DASHBOARD_AUTH_DISABLED=false
```

5. Restart the bot and open the dashboard → you are redirected to Discord → after
   approving, you land back on the dashboard signed in.

### Who can sign in

| Role | Access |
|---|---|
| Listed in `DASHBOARD_OWNER_IDS` | Every server the bot is in + bot-wide settings (global config, secrets, process control, logs, AI provider, music node) |
| Server manager | Only servers where the Discord account has **Manage Server** or **Administrator**; guild-scoped data and actions (tickets, giveaways, games, applications, temp voice, community, automation, moderation, economy, leveling, analytics) |
| Everybody else | Sign-in is refused (`/login?error=forbidden`) |

### Local development

```env
DASHBOARD_AUTH_DISABLED=true
```

Disables Discord login entirely and grants owner rights to the local browser.
**Never enable this on a public deployment.**

### Security notes

- Sessions are stateless: `base64url(payload).HMAC-SHA256(payload)` in an `HttpOnly`,
  `SameSite=Lax` cookie. OAuth access tokens are **never** stored.
- The OAuth `state` parameter is verified against a short-lived cookie (CSRF guard).
- State-changing requests with a foreign `Origin` header are rejected with `403`.
- `cors()` was removed — the dashboard is same-origin only.
- Set `DASHBOARD_SESSION_SECRET` explicitly, otherwise sessions die on restart.

---

## 2. Dashboard pages

| Page | What it shows | Actions |
|---|---|---|
| **Dashboard** | Gateway status, KPIs, 7-day activity, "Every system" tiles for all 12 modules | Click a tile to open that module |
| **Servers** | Every server the bot can see (already filtered by your access) | Channel/role inspection |
| **Moderation** | Cases, warnings, kicks, bans, mutes | Warn / kick / ban / mute with your Discord ID as the moderator |
| **Economy** | Wallet totals, transaction feed, manual balance editing | Set balance (guild-scoped, same wallet `/balance` reads) |
| **Leveling** | Leaderboard, XP editing, level roles | Set XP for a member |
| **Tickets** | Every persisted ticket with status, category, assignee | Claim, close, reopen, delete |
| **Giveaways** | Escrow pool, entries, winners, end timer | End now, cancel (refunds escrow), reroll (unfunded only) |
| **Games** | Dice / coinflip / lucky-number / giveaway games, escrow and players | End now (winner picked, pool paid or refunded) |
| **Staff apps** | Applications with answers | View answers, approve (grants the role), deny (DMs the applicant) |
| **Temp voice** | Live temporary channels, owners, member counts, setup config | Delete a temporary channel |
| **Community** | Per-server welcome, goodbye and autoroles (stored in `guild_settings`) | Edit and save all three |
| **Automation** | Cron jobs with type, schedule, next/last run, state | Create, run now, pause/enable, delete |
| **AI** | Provider, model, API-key state, limits, conversation history | Send a test prompt (owner only for the prompt) |
| **Music** | Lavalink node health, players, now playing, queue | Skip, pause, resume, stop |
| **Analytics** | Messages, members, moderation, economy totals and a daily bar chart | Switch server and range |
| **Cards** | Welcome / rank / leaderboard card designer (owner only) | Live preview, save, send a test card |
| **Settings** | 14 config panes: overview, bot & modules, leveling, economy, welcome, AI, music, temp voice, automation, analytics, moderation, tickets, staff apps, danger zone | Save per-service configuration |
| **System** | Process, memory, uptime, logs (owner only) | Clear logs, restart, shut down, presence |

---

## 3. API surface

All routes are session-authenticated. Guild-scoped routes take `guildId` (query or body)
and are rejected with `403` when the signed-in user cannot manage that server.

```
GET    /api/auth/me                     current identity + visible guilds
POST   /auth/logout                     clear the session cookie

GET    /api/systems/overview            counts for every system (used by the tiles)
GET    /api/tickets                     ticket list
POST   /api/tickets/:id/:action          claim | close | reopen | delete
GET    /api/giveaways                   giveaway list
POST   /api/giveaways/:id/:action       end | cancel | reroll
GET    /api/games                       game list
POST   /api/games/:id/end               end a game now
GET    /api/staffapps                   application list
POST   /api/staffapps/:id/:action       approve | deny
GET    /api/tempvc                      temp-voice config + live instances
DELETE /api/tempvc/:channelId           delete a temporary channel
GET    /api/community                   per-server welcome/goodbye/autoroles
POST   /api/community                   save them
GET    /api/automation                  cron jobs
POST   /api/automation                  create a job
POST   /api/automation/:id/:action      run | toggle | delete
GET    /api/ai/status                   provider, model, limits (owner only)
GET    /api/ai/conversations            conversation history
POST   /api/ai/test                     send a test prompt (owner only)
GET    /api/music/status                Lavalink node + players (owner only)
GET    /api/music/queue                 now playing + queue
POST   /api/music/controls              skip | stop | pause | resume | volume
GET    /api/analytics                   stats + activity series
```

Existing endpoints (`/api/status`, `/api/stats`, `/api/overview`, `/api/guilds`,
`/api/moderation/*`, `/api/economy/*`, `/api/leveling/*`, `/api/config/*`,
`/api/cards/*`, `/api/logs`, `/api/system/*`, `/api/control/*`) keep working and are now
access-checked.

---

## 4. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/login?error=not_configured` | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` missing, or the login page is shown without credentials |
| `/login?error=forbidden` | The account manages none of the bot's servers — add it to `DASHBOARD_OWNER_IDS` |
| `/login?error=state` | The OAuth state cookie expired (10 min) — start again |
| `/login?error=failed` | Check the bot logs for the Discord API error (wrong redirect URI is common) |
| Dashboard loads but every API call is `401` | The session cookie was dropped — set `DASHBOARD_SESSION_SECRET` and sign in again |
| `403 owner_only` | That area (Settings, Cards, System, AI status, music status) is owner-only |
| `403 guild_forbidden` | The selected server is not one you manage |
