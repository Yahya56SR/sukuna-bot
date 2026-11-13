import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Global user metadata. XP and balance are intentionally *not* authoritative
 * here anymore — they live in the guild-scoped tables below. The legacy
 * columns are kept so old dashboards/queries continue to work and are
 * mirrored on write.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  discriminator: text('discriminator'),
  avatar: text('avatar'),
  bot: integer('bot', { mode: 'boolean' }).notNull().default(false),
  balance: real('balance').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  total_xp: integer('total_xp').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});

export const guilds = sqliteTable('guilds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  owner_id: text('owner_id').notNull(),
  prefix: text('prefix').notNull().default('!'),
  language: text('language').notNull().default('en'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});

export const guildMembers = sqliteTable('guild_members', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  nickname: text('nickname'),
  joined_at: integer('joined_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('guild_members_guild_id_idx').on(table.guild_id),
  userIdx: index('guild_members_user_id_idx').on(table.user_id),
}));

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('channels_guild_id_idx').on(table.guild_id),
}));

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  name: text('name').notNull(),
  color: integer('color').notNull().default(0),
  hoist: integer('hoist', { mode: 'boolean' }).notNull().default(false),
  mentionable: integer('mentionable', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('roles_guild_id_idx').on(table.guild_id),
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  author_id: text('author_id').notNull(),
  content: text('content'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('messages_guild_id_idx').on(table.guild_id),
  channelIdx: index('messages_channel_id_idx').on(table.channel_id),
  authorIdx: index('messages_author_id_idx').on(table.author_id),
}));

export const moderationCases = sqliteTable('moderation_cases', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  moderator_id: text('moderator_id').notNull(),
  type: text('type').notNull(),
  reason: text('reason'),
  expires_at: integer('expires_at', { mode: 'timestamp' }),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
  revoked_by: text('revoked_by'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('moderation_cases_guild_id_idx').on(table.guild_id),
  userIdx: index('moderation_cases_user_id_idx').on(table.user_id),
  createdIdx: index('moderation_cases_created_idx').on(table.created_at),
}));

export const warnings = sqliteTable('warnings', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  moderator_id: text('moderator_id').notNull(),
  reason: text('reason').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  removed_at: integer('removed_at', { mode: 'timestamp' }),
  removed_by: text('removed_by'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('warnings_guild_id_idx').on(table.guild_id),
  userIdx: index('warnings_user_id_idx').on(table.user_id),
  activeIdx: index('warnings_active_idx').on(table.guild_id, table.user_id, table.active),
}));

export const economyTransactions = sqliteTable('economy_transactions', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  amount: real('amount').notNull(),
  balance_after: real('balance_after'),
  description: text('description'),
  reference: text('reference'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('economy_transactions_guild_id_idx').on(table.guild_id),
  userIdx: index('economy_transactions_user_id_idx').on(table.guild_id, table.user_id),
  createdIdx: index('economy_transactions_created_idx').on(table.created_at),
}));

/**
 * Guild-scoped wallet. The previous implementation stored a single balance
 * on `users`, which leaked money across servers and made transfers racy.
 */
export const economyAccounts = sqliteTable('economy_accounts', {
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  balance: real('balance').notNull().default(0),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.guild_id, table.user_id] }),
  balanceIdx: index('economy_accounts_balance_idx').on(table.guild_id, table.balance),
}));

export const levelingHistory = sqliteTable('leveling_history', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  old_level: integer('old_level').notNull(),
  new_level: integer('new_level').notNull(),
  xp_gained: integer('xp_gained').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('leveling_history_guild_id_idx').on(table.guild_id),
  userIdx: index('leveling_history_user_idx').on(table.guild_id, table.user_id),
}));

/**
 * Guild-scoped level profile. `total_xp` is the single source of truth;
 * the level is derived from it. The per-source timestamps replace the old
 * in-memory cooldown map so cooldowns survive restarts.
 *
 * `track` splits the profile onto the **member** board or the **staff**
 * board (`member` | `staff`). It is kept in sync with the guild roles by
 * the leveling service so both leaderboards can be queried with a cheap
 * indexed filter instead of scanning every member.
 */
export const levelingProfiles = sqliteTable('leveling_profiles', {
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  total_xp: integer('total_xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  track: text('track').notNull().default('member'),
  last_message_at: integer('last_message_at', { mode: 'timestamp' }),
  last_voice_at: integer('last_voice_at', { mode: 'timestamp' }),
  last_command_at: integer('last_command_at', { mode: 'timestamp' }),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.guild_id, table.user_id] }),
  xpIdx: index('leveling_profiles_xp_idx').on(table.guild_id, table.total_xp),
  trackIdx: index('leveling_profiles_track_idx').on(table.guild_id, table.track, table.total_xp),
}));

/**
 * A live leaderboard panel posted in a channel. One row per guild + board
 * (`members` | `staff`) — the bot keeps the message up to date so the
 * channel always shows the current ranking.
 */
export const leaderboardBoards = sqliteTable('leaderboard_boards', {
  id: text('id').notNull(),
  guild_id: text('guild_id').notNull(),
  board: text('board').notNull().default('members'),
  channel_id: text('channel_id').notNull(),
  message_id: text('message_id'),
  rows: integer('rows').notNull().default(25),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.guild_id, table.board] }),
  idIdx: index('leaderboard_boards_id_idx').on(table.id),
  guildIdx: index('leaderboard_boards_guild_idx').on(table.guild_id),
}));

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  channel_id: text('channel_id').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('open'),
  assigned_to: text('assigned_to'),
  close_reason: text('close_reason'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('tickets_guild_id_idx').on(table.guild_id),
  userIdx: index('tickets_user_idx').on(table.guild_id, table.user_id),
  channelIdx: index('tickets_channel_idx').on(table.channel_id),
}));

export const giveaways = sqliteTable('giveaways', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  message_id: text('message_id'),
  host_id: text('host_id').notNull(),
  prize: text('prize').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  ends_at: integer('ends_at', { mode: 'timestamp' }).notNull(),
  winner_count: integer('winner_count').notNull().default(1),
  winner_ids: text('winner_ids', { mode: 'json' }).notNull().$default(() => ([])),
  required_roles: text('required_roles', { mode: 'json' }).notNull().$default(() => ([])),
  entry_count: integer('entry_count').notNull().default(0),
  prize_amount: real('prize_amount').notNull().default(0),
  funded: integer('funded', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('giveaways_guild_id_idx').on(table.guild_id),
  statusIdx: index('giveaways_status_idx').on(table.status, table.ends_at),
}));

export const giveawayEntries = sqliteTable('giveaway_entries', {
  giveaway_id: text('giveaway_id').notNull(),
  user_id: text('user_id').notNull(),
  entered_at: integer('entered_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.giveaway_id, table.user_id] }),
  userIdx: index('giveaway_entries_user_idx').on(table.user_id),
}));

export const staffApplications = sqliteTable('staff_applications', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  role_id: text('role_id').notNull(),
  answers: text('answers', { mode: 'json' }).notNull().$default(() => ([])),
  status: text('status').notNull().default('pending'),
  reviewer_id: text('reviewer_id'),
  review_reason: text('review_reason'),
  review_channel_id: text('review_channel_id'),
  message_id: text('message_id'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  reviewed_at: integer('reviewed_at', { mode: 'timestamp' }),
}, (table) => ({
  guildIdx: index('staff_applications_guild_idx').on(table.guild_id, table.status),
  userIdx: index('staff_applications_user_idx').on(table.guild_id, table.user_id, table.status),
}));

export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  channel_id: text('channel_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  messages: text('messages', { mode: 'json' }).notNull().$default(() => ([])),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('ai_conversations_guild_id_idx').on(table.guild_id),
  userIdx: index('ai_conversations_user_idx').on(table.guild_id, table.user_id),
}));

export const musicSessions = sqliteTable('music_sessions', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  status: text('status').notNull().default('idle'),
  current_track: text('current_track'),
  volume: integer('volume').notNull().default(50),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('music_sessions_guild_id_idx').on(table.guild_id),
}));

export const automationJobs = sqliteTable('automation_jobs', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  type: text('type').notNull(),
  cron_expression: text('cron_expression').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  config: text('config', { mode: 'json' }).notNull().$default(() => ({})),
  last_run: integer('last_run', { mode: 'timestamp' }),
  next_run: integer('next_run', { mode: 'timestamp' }).notNull(),
  last_error: text('last_error'),
  run_count: integer('run_count').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('automation_jobs_guild_id_idx').on(table.guild_id),
  dueIdx: index('automation_jobs_due_idx').on(table.enabled, table.next_run),
}));

export const guildSettings = sqliteTable('guild_settings', {
  guild_id: text('guild_id').primaryKey(),
  welcome_enabled: integer('welcome_enabled', { mode: 'boolean' }).notNull().default(false),
  welcome_channel_id: text('welcome_channel_id'),
  welcome_message: text('welcome_message'),
  goodbye_enabled: integer('goodbye_enabled', { mode: 'boolean' }).notNull().default(false),
  goodbye_channel_id: text('goodbye_channel_id'),
  goodbye_message: text('goodbye_message'),
  autoroles_enabled: integer('autoroles_enabled', { mode: 'boolean' }).notNull().default(false),
  autorole_ids: text('autorole_ids', { mode: 'json' }).notNull().$default(() => ([])),
  moderation_enabled: integer('moderation_enabled', { mode: 'boolean' }).notNull().default(true),
  ai_enabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(false),
  music_enabled: integer('music_enabled', { mode: 'boolean' }).notNull().default(false),
  leveling_enabled: integer('leveling_enabled', { mode: 'boolean' }).notNull().default(true),
  economy_enabled: integer('economy_enabled', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});

/** Per-guild TempVC configuration. The legacy single-row setup is migrated to guild_id = 'global'. */
export const tempvcConfigs = sqliteTable('tempvc_configs', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull().default('global'),
  create_channel_id: text('create_channel_id').notNull(),
  category_id: text('category_id').notNull(),
  panel_channel_id: text('panel_channel_id'),
  panel_message_id: text('panel_message_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('tempvc_configs_guild_idx').on(table.guild_id),
}));

export const tempvcInstances = sqliteTable('tempvc_instances', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull().default('global'),
  channel_id: text('channel_id').notNull().unique(),
  owner_id: text('owner_id').notNull(),
  category_id: text('category_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('tempvc_instances_guild_idx').on(table.guild_id),
  ownerIdx: index('tempvc_instances_owner_idx').on(table.guild_id, table.owner_id),
}));

/**
 * Persistent multiplayer economy games. The previous map-only version lost
 * every game on restart and minted prize money out of thin air.
 */
export const economyGames = sqliteTable('economy_games', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  host_id: text('host_id').notNull(),
  type: text('type').notNull(),
  prize_pool: real('prize_pool').notNull().default(0),
  entry_fee: real('entry_fee').notNull().default(0),
  status: text('status').notNull().default('waiting'),
  winner_id: text('winner_id'),
  game_data: text('game_data', { mode: 'json' }).notNull().$default(() => ({})),
  ends_at: integer('ends_at', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('economy_games_guild_idx').on(table.guild_id, table.status),
  dueIdx: index('economy_games_due_idx').on(table.status, table.ends_at),
}));

export const economyGamePlayers = sqliteTable('economy_game_players', {
  game_id: text('game_id').notNull(),
  user_id: text('user_id').notNull(),
  username: text('username').notNull(),
  entry_fee: real('entry_fee').notNull().default(0),
  pick: text('pick'),
  joined_at: integer('joined_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.game_id, table.user_id] }),
}));
