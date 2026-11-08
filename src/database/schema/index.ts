import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

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
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('moderation_cases_guild_id_idx').on(table.guild_id),
  userIdx: index('moderation_cases_user_id_idx').on(table.user_id),
}));

export const warnings = sqliteTable('warnings', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  moderator_id: text('moderator_id').notNull(),
  reason: text('reason').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('warnings_guild_id_idx').on(table.guild_id),
  userIdx: index('warnings_user_id_idx').on(table.user_id),
}));

export const economyTransactions = sqliteTable('economy_transactions', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  amount: real('amount').notNull(),
  description: text('description'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('economy_transactions_guild_id_idx').on(table.guild_id),
  userIdx: index('economy_transactions_user_id_idx').on(table.user_id),
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
  userIdx: index('leveling_history_user_id_idx').on(table.user_id),
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
  userIdx: index('tickets_user_id_idx').on(table.user_id),
}));

export const giveaways = sqliteTable('giveaways', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  host_id: text('host_id').notNull(),
  prize: text('prize').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  ends_at: integer('ends_at', { mode: 'timestamp' }).notNull(),
  winner_count: integer('winner_count').notNull().default(1),
  entry_count: integer('entry_count').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('giveaways_guild_id_idx').on(table.guild_id),
}));

export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  user_id: text('user_id').notNull(),
  channel_id: text('channel_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  messages: text('messages', { mode: 'json' }).notNull().$default(() => '[]'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('ai_conversations_guild_id_idx').on(table.guild_id),
  userIdx: index('ai_conversations_user_id_idx').on(table.user_id),
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
  config: text('config', { mode: 'json' }).notNull().$default(() => '{}'),
  last_run: integer('last_run', { mode: 'timestamp' }),
  next_run: integer('next_run', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
  guildIdx: index('automation_jobs_guild_id_idx').on(table.guild_id),
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
  autorole_ids: text('autorole_ids', { mode: 'json' }).notNull().$default(() => '[]'),
  moderation_enabled: integer('moderation_enabled', { mode: 'boolean' }).notNull().default(true),
  ai_enabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(false),
  music_enabled: integer('music_enabled', { mode: 'boolean' }).notNull().default(false),
  leveling_enabled: integer('leveling_enabled', { mode: 'boolean' }).notNull().default(true),
  economy_enabled: integer('economy_enabled', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});

export const tempvcConfigs = sqliteTable('tempvc_configs', {
  id: text('id').primaryKey().$default(() => 'tempvc_main'),
  create_channel_id: text('create_channel_id').notNull(),
  category_id: text('category_id').notNull(),
  panel_channel_id: text('panel_channel_id'),
  panel_message_id: text('panel_message_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});

export const tempvcInstances = sqliteTable('tempvc_instances', {
  id: text('id').primaryKey(),
  channel_id: text('channel_id').notNull().unique(),
  owner_id: text('owner_id').notNull(),
  category_id: text('category_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
