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
giveaways) are built by one shared kit so they always look the same.

| File | Purpose |
| --- | --- |
| `src/utils/panel.ts` | Embed/button builder — title, dividers, feature bullets, button grid, banner wiring |
| `src/utils/panelBanner.ts` | Renders the full-width banner artwork (1024×300 PNG) with `@napi-rs/canvas` |
| `src/utils/emoji.ts` | Emoji registry — maps semantic keys (`ticket`, `staff`, `donate`, …) to the bot's own emoji |
| `src/services/PanelService.ts` | Loads the emoji server, applies the emoji map, owns the panel look config |

### Panel layout

```
<emoji> <Server> • <Section>          ← big bold title
<intro paragraph, optional link>      ← description
──────────────────────────────        ← thin divider
• <emoji> **Label**: `value`          ← feature bullets
──────────────────────────────
• <emoji> <closing note>
[big banner artwork]                  ← generated PNG
[button grid]                         ← 5 buttons per row, 25 max
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