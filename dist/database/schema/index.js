"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tempvcInstances = exports.tempvcConfigs = exports.guildSettings = exports.automationJobs = exports.musicSessions = exports.aiConversations = exports.giveaways = exports.tickets = exports.levelingHistory = exports.economyTransactions = exports.warnings = exports.moderationCases = exports.messages = exports.roles = exports.channels = exports.guildMembers = exports.guilds = exports.users = void 0;
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
exports.users = (0, sqlite_core_1.sqliteTable)('users', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    username: (0, sqlite_core_1.text)('username').notNull(),
    discriminator: (0, sqlite_core_1.text)('discriminator'),
    avatar: (0, sqlite_core_1.text)('avatar'),
    bot: (0, sqlite_core_1.integer)('bot', { mode: 'boolean' }).notNull().default(false),
    balance: (0, sqlite_core_1.real)('balance').notNull().default(0),
    xp: (0, sqlite_core_1.integer)('xp').notNull().default(0),
    level: (0, sqlite_core_1.integer)('level').notNull().default(1),
    total_xp: (0, sqlite_core_1.integer)('total_xp').notNull().default(0),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
exports.guilds = (0, sqlite_core_1.sqliteTable)('guilds', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    name: (0, sqlite_core_1.text)('name').notNull(),
    icon: (0, sqlite_core_1.text)('icon'),
    owner_id: (0, sqlite_core_1.text)('owner_id').notNull(),
    prefix: (0, sqlite_core_1.text)('prefix').notNull().default('!'),
    language: (0, sqlite_core_1.text)('language').notNull().default('en'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
exports.guildMembers = (0, sqlite_core_1.sqliteTable)('guild_members', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    nickname: (0, sqlite_core_1.text)('nickname'),
    joined_at: (0, sqlite_core_1.integer)('joined_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('guild_members_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('guild_members_user_id_idx').on(table.user_id),
}));
exports.channels = (0, sqlite_core_1.sqliteTable)('channels', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    name: (0, sqlite_core_1.text)('name').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('channels_guild_id_idx').on(table.guild_id),
}));
exports.roles = (0, sqlite_core_1.sqliteTable)('roles', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    name: (0, sqlite_core_1.text)('name').notNull(),
    color: (0, sqlite_core_1.integer)('color').notNull().default(0),
    hoist: (0, sqlite_core_1.integer)('hoist', { mode: 'boolean' }).notNull().default(false),
    mentionable: (0, sqlite_core_1.integer)('mentionable', { mode: 'boolean' }).notNull().default(false),
    position: (0, sqlite_core_1.integer)('position').notNull().default(0),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('roles_guild_id_idx').on(table.guild_id),
}));
exports.messages = (0, sqlite_core_1.sqliteTable)('messages', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    author_id: (0, sqlite_core_1.text)('author_id').notNull(),
    content: (0, sqlite_core_1.text)('content'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('messages_guild_id_idx').on(table.guild_id),
    channelIdx: (0, sqlite_core_1.index)('messages_channel_id_idx').on(table.channel_id),
    authorIdx: (0, sqlite_core_1.index)('messages_author_id_idx').on(table.author_id),
}));
exports.moderationCases = (0, sqlite_core_1.sqliteTable)('moderation_cases', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    moderator_id: (0, sqlite_core_1.text)('moderator_id').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    reason: (0, sqlite_core_1.text)('reason'),
    expires_at: (0, sqlite_core_1.integer)('expires_at', { mode: 'timestamp' }),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('moderation_cases_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('moderation_cases_user_id_idx').on(table.user_id),
}));
exports.warnings = (0, sqlite_core_1.sqliteTable)('warnings', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    moderator_id: (0, sqlite_core_1.text)('moderator_id').notNull(),
    reason: (0, sqlite_core_1.text)('reason').notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('warnings_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('warnings_user_id_idx').on(table.user_id),
}));
exports.economyTransactions = (0, sqlite_core_1.sqliteTable)('economy_transactions', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    amount: (0, sqlite_core_1.real)('amount').notNull(),
    description: (0, sqlite_core_1.text)('description'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('economy_transactions_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('economy_transactions_user_id_idx').on(table.user_id),
}));
exports.levelingHistory = (0, sqlite_core_1.sqliteTable)('leveling_history', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    old_level: (0, sqlite_core_1.integer)('old_level').notNull(),
    new_level: (0, sqlite_core_1.integer)('new_level').notNull(),
    xp_gained: (0, sqlite_core_1.integer)('xp_gained').notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('leveling_history_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('leveling_history_user_id_idx').on(table.user_id),
}));
exports.tickets = (0, sqlite_core_1.sqliteTable)('tickets', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    category: (0, sqlite_core_1.text)('category').notNull(),
    status: (0, sqlite_core_1.text)('status').notNull().default('open'),
    assigned_to: (0, sqlite_core_1.text)('assigned_to'),
    close_reason: (0, sqlite_core_1.text)('close_reason'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('tickets_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('tickets_user_id_idx').on(table.user_id),
}));
exports.giveaways = (0, sqlite_core_1.sqliteTable)('giveaways', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    host_id: (0, sqlite_core_1.text)('host_id').notNull(),
    prize: (0, sqlite_core_1.text)('prize').notNull(),
    description: (0, sqlite_core_1.text)('description'),
    status: (0, sqlite_core_1.text)('status').notNull().default('active'),
    ends_at: (0, sqlite_core_1.integer)('ends_at', { mode: 'timestamp' }).notNull(),
    winner_count: (0, sqlite_core_1.integer)('winner_count').notNull().default(1),
    entry_count: (0, sqlite_core_1.integer)('entry_count').notNull().default(0),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('giveaways_guild_id_idx').on(table.guild_id),
}));
exports.aiConversations = (0, sqlite_core_1.sqliteTable)('ai_conversations', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    provider: (0, sqlite_core_1.text)('provider').notNull(),
    model: (0, sqlite_core_1.text)('model').notNull(),
    messages: (0, sqlite_core_1.text)('messages', { mode: 'json' }).notNull().$default(() => '[]'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('ai_conversations_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('ai_conversations_user_id_idx').on(table.user_id),
}));
exports.musicSessions = (0, sqlite_core_1.sqliteTable)('music_sessions', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    status: (0, sqlite_core_1.text)('status').notNull().default('idle'),
    current_track: (0, sqlite_core_1.text)('current_track'),
    volume: (0, sqlite_core_1.integer)('volume').notNull().default(50),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('music_sessions_guild_id_idx').on(table.guild_id),
}));
exports.automationJobs = (0, sqlite_core_1.sqliteTable)('automation_jobs', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    cron_expression: (0, sqlite_core_1.text)('cron_expression').notNull(),
    enabled: (0, sqlite_core_1.integer)('enabled', { mode: 'boolean' }).notNull().default(true),
    config: (0, sqlite_core_1.text)('config', { mode: 'json' }).notNull().$default(() => '{}'),
    last_run: (0, sqlite_core_1.integer)('last_run', { mode: 'timestamp' }),
    next_run: (0, sqlite_core_1.integer)('next_run', { mode: 'timestamp' }).notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('automation_jobs_guild_id_idx').on(table.guild_id),
}));
exports.guildSettings = (0, sqlite_core_1.sqliteTable)('guild_settings', {
    guild_id: (0, sqlite_core_1.text)('guild_id').primaryKey(),
    welcome_enabled: (0, sqlite_core_1.integer)('welcome_enabled', { mode: 'boolean' }).notNull().default(false),
    welcome_channel_id: (0, sqlite_core_1.text)('welcome_channel_id'),
    welcome_message: (0, sqlite_core_1.text)('welcome_message'),
    goodbye_enabled: (0, sqlite_core_1.integer)('goodbye_enabled', { mode: 'boolean' }).notNull().default(false),
    goodbye_channel_id: (0, sqlite_core_1.text)('goodbye_channel_id'),
    goodbye_message: (0, sqlite_core_1.text)('goodbye_message'),
    autoroles_enabled: (0, sqlite_core_1.integer)('autoroles_enabled', { mode: 'boolean' }).notNull().default(false),
    autorole_ids: (0, sqlite_core_1.text)('autorole_ids', { mode: 'json' }).notNull().$default(() => '[]'),
    moderation_enabled: (0, sqlite_core_1.integer)('moderation_enabled', { mode: 'boolean' }).notNull().default(true),
    ai_enabled: (0, sqlite_core_1.integer)('ai_enabled', { mode: 'boolean' }).notNull().default(false),
    music_enabled: (0, sqlite_core_1.integer)('music_enabled', { mode: 'boolean' }).notNull().default(false),
    leveling_enabled: (0, sqlite_core_1.integer)('leveling_enabled', { mode: 'boolean' }).notNull().default(true),
    economy_enabled: (0, sqlite_core_1.integer)('economy_enabled', { mode: 'boolean' }).notNull().default(false),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
exports.tempvcConfigs = (0, sqlite_core_1.sqliteTable)('tempvc_configs', {
    id: (0, sqlite_core_1.text)('id').primaryKey().$default(() => 'tempvc_main'),
    create_channel_id: (0, sqlite_core_1.text)('create_channel_id').notNull(),
    category_id: (0, sqlite_core_1.text)('category_id').notNull(),
    panel_channel_id: (0, sqlite_core_1.text)('panel_channel_id'),
    panel_message_id: (0, sqlite_core_1.text)('panel_message_id'),
    enabled: (0, sqlite_core_1.integer)('enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
exports.tempvcInstances = (0, sqlite_core_1.sqliteTable)('tempvc_instances', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull().unique(),
    owner_id: (0, sqlite_core_1.text)('owner_id').notNull(),
    category_id: (0, sqlite_core_1.text)('category_id').notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
});
