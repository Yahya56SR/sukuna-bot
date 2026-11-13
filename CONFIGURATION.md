# Sukuna Bot - Configuration System

## Overview
This document describes the configuration system for Sukuna Bot, including environment variable handling, database-backed guild settings, and configuration validation.

## Configuration Architecture

### Configuration Sources
1. **Environment Variables**: Secrets and deployment settings
2. **Database Configuration**: Guild-specific settings
3. **File Configuration**: Local development settings
4. **Default Configuration**: Safe application defaults

### Configuration Structure
```typescript
Application Settings
  - General behavior
  - Performance tuning
  - Feature flags

Guild Configuration
  - Module-specific settings
  - Custom personalities
  - Moderation rules
  - Economy parameters

Module Configuration
  - AI provider settings
  - Music node configuration
  - Automation rules
```

## Panels & Custom Emoji

All "big" Discord panels (staff applications, ticket support, temporary voice,
giveaways, leaderboard) are built by one shared kit so they always look the
same.

They use **Components v2** (`MessageFlags.IsComponentsV2`, `1 << 15`) — a
message with components v2 carries no embeds and no content, so the title,
the dividers and the artwork are real components:

| Component | Type | Used for |
| --- | --- | --- |
| Container | 17 | The panel box with its accent colour |
| Section | 9 | Title + server icon (thumbnail accessory) |
| Text Display | 10 | Title, intro, feature bullets, note, footer |
| Separator | 14 | The thin divider lines between sections |
| Media Gallery | 12 | The banner / podium artwork (attachments are not shown on their own in v2) |
| Action Row + Button | 1 / 2 | The button grid (5 per row, 25 max) |

| File | Purpose |
| --- | --- |
| `src/utils/panel.ts` | Container/button builder — title, separators, feature bullets, button grid, banner wiring |
| `src/utils/panelBanner.ts` | Renders the full-width banner artwork (1024×300 PNG) with `@napi-rs/canvas` |
| `src/utils/emoji.ts` | Emoji registry — maps semantic keys (`ticket`, `staff`, `donate`, …) to the bot's own emoji |
| `src/services/PanelService.ts` | Loads the emoji server, applies the emoji map, owns the panel look config |

### Panel layout

```
Container
  Section      # <emoji> <Server> • <Section>        [server icon]
  TextDisplay  <intro paragraph, optional link>
  Separator
  TextDisplay  • <emoji> **Label**: `value`
  Separator
  TextDisplay  • <emoji> <closing note>
  MediaGallery [big banner artwork]
ActionRow     [button grid — 5 buttons per row]
```

### Dashboard → Settings → Panels & emoji

| Setting | Meaning |
| --- | --- |
| Banner artwork | Master switch for the generated banner image |
| Emoji server | Guild id (or name) that holds the bot's custom emoji — auto-detected if empty |
| Emoji map | `key = emoji_name` (or `key = <a:name:id>`) lines, e.g. `staff = sukuna_staff` |
| Banner accent | Overrides the accent colour of every banner |

Keys without a match fall back to the bot's own emoji, so a missing custom
emoji never breaks a panel.

### Environment variables

```bash
PANELS_EMOJI_GUILD=Emoji Hub
PANELS_EMOJI_MAP=staff = sukuna_staff
PANELS_BANNER=true
PANELS_ACCENT=#ef4444
```

### Other dashboard fields used by panels

- **Staff applications → Role pitch** (`Role Name = short description`) feeds the
  bullet list next to each role button.
- **Tickets → Panel categories** (`key | Label | emoji | description`) creates one
  button per category; empty uses the built-in Pub / Bugs / Abuse / Server /
  Staff / Donate list.

## Leaderboards

The bot runs **two separate leaderboards** per server:

| Board | Who is on it | Command | Look |
| --- | --- | --- | --- |
| 👥 Members | Everyone except the staff team | `/leaderboard` | Trophy, indigo accent, zone layout |
| 🛡️ Staff | The staff team only | `/staffboard` (staff only) | Shield, red accent, plain ranking |

Both boards read the same XP data — the difference is the **track** stored on
each leveling profile (`member` or `staff`), so the two rankings never
overlap and each board can be queried with an indexed filter.

### Who counts as staff

A member is on the staff track when they have **one of the configured staff
roles** or a moderation permission (Manage Messages / Kick / Ban / Admin /
Manage Guild). Configure the roles in the dashboard under
**Leveling → Who counts as Staff?** (`LEVELING_STAFF_ROLES` in `.env`).

The track is kept up to date automatically:

- on every XP gain (message, voice, command),
- when a member is promoted or demoted (`guildMemberUpdate`),
- whenever a board is rendered (cached members are re-checked).

### Live boards

A live board is a panel in a channel that the bot keeps up to date.

| Command | What it does |
| --- | --- |
| `/board post board:members\|staff channel:#board rows:25` | Publishes (or moves) a live board |
| `/board refresh board:members\|staff` | Refreshes it right now |
| `/board remove board:members\|staff` | Deletes the panel and the board |
| `/board list` | Shows the live boards of the server |

The same thing can be done from the dashboard (**Leveling → Live
Leaderboards**): pick a channel and the number of ranks for each board.

Live boards are rendered **without** the podium artwork, so a refresh is a
single component edit — the panel can never pile up attachments. The
interactive `/leaderboard` and `/staffboard` commands still show the full
MEE6-style podium.

### Environment variables

```bash
LEADERBOARD_ENABLED=true
LEADERBOARD_REFRESH_MINUTES=5   # refresh interval of the live boards
LEADERBOARD_DEFAULT_ROWS=25     # ranks shown when nothing else is set
```

### Files

| File | Purpose |
| --- | --- |
| `src/modules/leveling/LeaderboardService.ts` | The two boards: rendering, live panels, refresh loop, commands |
| `src/utils/liveLeaderboard.ts` | MEE6-style panel (top 3, zones, progress bars) + per-board themes |
| `src/modules/leveling/LevelingService.ts` | XP accounting and the track-aware leaderboard queries |

## Icons & Fonts

### Custom icons

Every icon in a panel is a **semantic key** (`ticket`, `staff`, `donate`,
`medal1`, `trophy`, …) resolved through the emoji registry, so nothing is
hardcoded:

| Priority | Source | Example |
| --- | --- | --- |
| 1 | Direct override in the dashboard | `ticket = <a:money:123456789012345678>` |
| 2 | Alias to an emoji in the bot's emoji server | `ticket = sukuna_ticket` |
| 3 | The bot's built-in emoji | `<:ticket:1570774090027900928>` |

The **Panels & emoji** page has a picker: click a key to write the mapping
line into the map, and a live preview of every key.

### Canvas fonts

`src/utils/fonts.ts` owns the font catalog. Missing fonts are **downloaded
automatically** into `data/fonts` the first time a canvas is rendered, so a
bare Linux container still draws Arabic names, symbols and colour emoji
instead of empty boxes.

- Core: Noto Sans (regular/bold), Noto Serif, Noto Sans Mono
- Symbols: Noto Sans Symbols 2, Noto Sans Symbols, Noto Sans Math
- Scripts: Arabic, Naskh Arabic, Hebrew, Devanagari, Thai
- Emoji: Noto Color Emoji, Noto Emoji (both optional, ~7 MB)

Downloads are best-effort — a failure never breaks a render, the card simply
falls back to the next font in the stack. The **Panels & emoji** page shows
which fonts are present.

Fancy unicode that no card font can draw (for example the mathematical
letters in `𝓘𝓼𝓶𝓪𝓲𝓵`) is folded back to plain ASCII with NFKC normalisation
before it is drawn, so such names never render as empty boxes.