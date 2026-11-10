"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.economyGamePlayers = exports.economyGames = exports.tempvcInstances = exports.tempvcConfigs = exports.guildSettings = exports.automationJobs = exports.musicSessions = exports.aiConversations = exports.staffApplications = exports.giveawayEntries = exports.giveaways = exports.tickets = exports.levelingProfiles = exports.levelingHistory = exports.economyAccounts = exports.economyTransactions = exports.warnings = exports.moderationCases = exports.messages = exports.roles = exports.channels = exports.guildMembers = exports.guilds = exports.users = void 0;
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
/**
 * Global user metadata. XP and balance are intentionally *not* authoritative
 * here anymore — they live in the guild-scoped tables below. The legacy
 * columns are kept so old dashboards/queries continue to work and are
 * mirrored on write.
 */
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
    revoked_at: (0, sqlite_core_1.integer)('revoked_at', { mode: 'timestamp' }),
    revoked_by: (0, sqlite_core_1.text)('revoked_by'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('moderation_cases_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('moderation_cases_user_id_idx').on(table.user_id),
    createdIdx: (0, sqlite_core_1.index)('moderation_cases_created_idx').on(table.created_at),
}));
exports.warnings = (0, sqlite_core_1.sqliteTable)('warnings', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    moderator_id: (0, sqlite_core_1.text)('moderator_id').notNull(),
    reason: (0, sqlite_core_1.text)('reason').notNull(),
    active: (0, sqlite_core_1.integer)('active', { mode: 'boolean' }).notNull().default(true),
    removed_at: (0, sqlite_core_1.integer)('removed_at', { mode: 'timestamp' }),
    removed_by: (0, sqlite_core_1.text)('removed_by'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('warnings_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('warnings_user_id_idx').on(table.user_id),
    activeIdx: (0, sqlite_core_1.index)('warnings_active_idx').on(table.guild_id, table.user_id, table.active),
}));
exports.economyTransactions = (0, sqlite_core_1.sqliteTable)('economy_transactions', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    amount: (0, sqlite_core_1.real)('amount').notNull(),
    balance_after: (0, sqlite_core_1.real)('balance_after'),
    description: (0, sqlite_core_1.text)('description'),
    reference: (0, sqlite_core_1.text)('reference'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('economy_transactions_guild_id_idx').on(table.guild_id),
    userIdx: (0, sqlite_core_1.index)('economy_transactions_user_id_idx').on(table.guild_id, table.user_id),
    createdIdx: (0, sqlite_core_1.index)('economy_transactions_created_idx').on(table.created_at),
}));
/**
 * Guild-scoped wallet. The previous implementation stored a single balance
 * on `users`, which leaked money across servers and made transfers racy.
 */
exports.economyAccounts = (0, sqlite_core_1.sqliteTable)('economy_accounts', {
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    balance: (0, sqlite_core_1.real)('balance').notNull().default(0),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    pk: (0, sqlite_core_1.primaryKey)({ columns: [table.guild_id, table.user_id] }),
    balanceIdx: (0, sqlite_core_1.index)('economy_accounts_balance_idx').on(table.guild_id, table.balance),
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
    userIdx: (0, sqlite_core_1.index)('leveling_history_user_idx').on(table.guild_id, table.user_id),
}));
/**
 * Guild-scoped level profile. `total_xp` is the single source of truth;
 * the level is derived from it. The per-source timestamps replace the old
 * in-memory cooldown map so cooldowns survive restarts.
 */
exports.levelingProfiles = (0, sqlite_core_1.sqliteTable)('leveling_profiles', {
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    total_xp: (0, sqlite_core_1.integer)('total_xp').notNull().default(0),
    level: (0, sqlite_core_1.integer)('level').notNull().default(1),
    last_message_at: (0, sqlite_core_1.integer)('last_message_at', { mode: 'timestamp' }),
    last_voice_at: (0, sqlite_core_1.integer)('last_voice_at', { mode: 'timestamp' }),
    last_command_at: (0, sqlite_core_1.integer)('last_command_at', { mode: 'timestamp' }),
    updated_at: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    pk: (0, sqlite_core_1.primaryKey)({ columns: [table.guild_id, table.user_id] }),
    xpIdx: (0, sqlite_core_1.index)('leveling_profiles_xp_idx').on(table.guild_id, table.total_xp),
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
    userIdx: (0, sqlite_core_1.index)('tickets_user_idx').on(table.guild_id, table.user_id),
    channelIdx: (0, sqlite_core_1.index)('tickets_channel_idx').on(table.channel_id),
}));
exports.giveaways = (0, sqlite_core_1.sqliteTable)('giveaways', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    message_id: (0, sqlite_core_1.text)('message_id'),
    host_id: (0, sqlite_core_1.text)('host_id').notNull(),
    prize: (0, sqlite_core_1.text)('prize').notNull(),
    description: (0, sqlite_core_1.text)('description'),
    status: (0, sqlite_core_1.text)('status').notNull().default('active'),
    ends_at: (0, sqlite_core_1.integer)('ends_at', { mode: 'timestamp' }).notNull(),
    winner_count: (0, sqlite_core_1.integer)('winner_count').notNull().default(1),
    winner_ids: (0, sqlite_core_1.text)('winner_ids', { mode: 'json' }).notNull().$default(() => '[]'),
    required_roles: (0, sqlite_core_1.text)('required_roles', { mode: 'json' }).notNull().$default(() => '[]'),
    entry_count: (0, sqlite_core_1.integer)('entry_count').notNull().default(0),
    prize_amount: (0, sqlite_core_1.real)('prize_amount').notNull().default(0),
    funded: (0, sqlite_core_1.integer)('funded', { mode: 'boolean' }).notNull().default(false),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('giveaways_guild_id_idx').on(table.guild_id),
    statusIdx: (0, sqlite_core_1.index)('giveaways_status_idx').on(table.status, table.ends_at),
}));
exports.giveawayEntries = (0, sqlite_core_1.sqliteTable)('giveaway_entries', {
    giveaway_id: (0, sqlite_core_1.text)('giveaway_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    entered_at: (0, sqlite_core_1.integer)('entered_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    pk: (0, sqlite_core_1.primaryKey)({ columns: [table.giveaway_id, table.user_id] }),
    userIdx: (0, sqlite_core_1.index)('giveaway_entries_user_idx').on(table.user_id),
}));
exports.staffApplications = (0, sqlite_core_1.sqliteTable)('staff_applications', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    role_id: (0, sqlite_core_1.text)('role_id').notNull(),
    answers: (0, sqlite_core_1.text)('answers', { mode: 'json' }).notNull().$default(() => '[]'),
    status: (0, sqlite_core_1.text)('status').notNull().default('pending'),
    reviewer_id: (0, sqlite_core_1.text)('reviewer_id'),
    review_reason: (0, sqlite_core_1.text)('review_reason'),
    review_channel_id: (0, sqlite_core_1.text)('review_channel_id'),
    message_id: (0, sqlite_core_1.text)('message_id'),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
    reviewed_at: (0, sqlite_core_1.integer)('reviewed_at', { mode: 'timestamp' }),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('staff_applications_guild_idx').on(table.guild_id, table.status),
    userIdx: (0, sqlite_core_1.index)('staff_applications_user_idx').on(table.guild_id, table.user_id, table.status),
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
    userIdx: (0, sqlite_core_1.index)('ai_conversations_user_idx').on(table.guild_id, table.user_id),
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
    last_error: (0, sqlite_core_1.text)('last_error'),
    run_count: (0, sqlite_core_1.integer)('run_count').notNull().default(0),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('automation_jobs_guild_id_idx').on(table.guild_id),
    dueIdx: (0, sqlite_core_1.index)('automation_jobs_due_idx').on(table.enabled, table.next_run),
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
/** Per-guild TempVC configuration. The legacy single-row setup is migrated to guild_id = 'global'. */
exports.tempvcConfigs = (0, sqlite_core_1.sqliteTable)('tempvc_configs', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull().default('global'),
    create_channel_id: (0, sqlite_core_1.text)('create_channel_id').notNull(),
    category_id: (0, sqlite_core_1.text)('category_id').notNull(),
    panel_channel_id: (0, sqlite_core_1.text)('panel_channel_id'),
    panel_message_id: (0, sqlite_core_1.text)('panel_message_id'),
    enabled: (0, sqlite_core_1.integer)('enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('tempvc_configs_guild_idx').on(table.guild_id),
}));
exports.tempvcInstances = (0, sqlite_core_1.sqliteTable)('tempvc_instances', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull().default('global'),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull().unique(),
    owner_id: (0, sqlite_core_1.text)('owner_id').notNull(),
    category_id: (0, sqlite_core_1.text)('category_id').notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('tempvc_instances_guild_idx').on(table.guild_id),
    ownerIdx: (0, sqlite_core_1.index)('tempvc_instances_owner_idx').on(table.guild_id, table.owner_id),
}));
/**
 * Persistent multiplayer economy games. The previous map-only version lost
 * every game on restart and minted prize money out of thin air.
 */
exports.economyGames = (0, sqlite_core_1.sqliteTable)('economy_games', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    guild_id: (0, sqlite_core_1.text)('guild_id').notNull(),
    channel_id: (0, sqlite_core_1.text)('channel_id').notNull(),
    host_id: (0, sqlite_core_1.text)('host_id').notNull(),
    type: (0, sqlite_core_1.text)('type').notNull(),
    prize_pool: (0, sqlite_core_1.real)('prize_pool').notNull().default(0),
    entry_fee: (0, sqlite_core_1.real)('entry_fee').notNull().default(0),
    status: (0, sqlite_core_1.text)('status').notNull().default('waiting'),
    winner_id: (0, sqlite_core_1.text)('winner_id'),
    game_data: (0, sqlite_core_1.text)('game_data', { mode: 'json' }).notNull().$default(() => '{}'),
    ends_at: (0, sqlite_core_1.integer)('ends_at', { mode: 'timestamp' }).notNull(),
    created_at: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    guildIdx: (0, sqlite_core_1.index)('economy_games_guild_idx').on(table.guild_id, table.status),
    dueIdx: (0, sqlite_core_1.index)('economy_games_due_idx').on(table.status, table.ends_at),
}));
exports.economyGamePlayers = (0, sqlite_core_1.sqliteTable)('economy_game_players', {
    game_id: (0, sqlite_core_1.text)('game_id').notNull(),
    user_id: (0, sqlite_core_1.text)('user_id').notNull(),
    username: (0, sqlite_core_1.text)('username').notNull(),
    entry_fee: (0, sqlite_core_1.real)('entry_fee').notNull().default(0),
    pick: (0, sqlite_core_1.text)('pick'),
    joined_at: (0, sqlite_core_1.integer)('joined_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
}, (table) => ({
    pk: (0, sqlite_core_1.primaryKey)({ columns: [table.game_id, table.user_id] }),
}));
