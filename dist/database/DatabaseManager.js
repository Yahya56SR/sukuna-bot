"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const better_sqlite3_2 = require("drizzle-orm/better-sqlite3");
const schema = __importStar(require("./schema"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DatabaseManager {
    constructor(config) {
        this.db = null;
        this.sqlite = null;
        this.config = config;
    }
    async initialize() {
        const dbDir = path_1.default.dirname(this.config.path);
        if (!fs_1.default.existsSync(dbDir)) {
            fs_1.default.mkdirSync(dbDir, { recursive: true });
        }
        this.sqlite = new better_sqlite3_1.default(this.config.path);
        this.sqlite.pragma('journal_mode = WAL');
        this.sqlite.pragma('foreign_keys = ON');
        this.sqlite.pragma('busy_timeout = 5000');
        this.runMigrations();
        this.migrateLegacyData();
        this.db = (0, better_sqlite3_2.drizzle)(this.sqlite, { schema });
    }
    runMigrations() {
        if (!this.sqlite)
            return;
        this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        discriminator TEXT,
        avatar TEXT,
        bot INTEGER NOT NULL DEFAULT 0,
        balance REAL NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        total_xp INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        owner_id TEXT NOT NULL,
        prefix TEXT NOT NULL DEFAULT '!',
        language TEXT NOT NULL DEFAULT 'en',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_members (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        nickname TEXT,
        joined_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color INTEGER NOT NULL DEFAULT 0,
        hoist INTEGER NOT NULL DEFAULT 0,
        mentionable INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS moderation_cases (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT,
        expires_at INTEGER,
        revoked_at INTEGER,
        revoked_by TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS warnings (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        removed_at INTEGER,
        removed_by TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS economy_transactions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_after REAL,
        description TEXT,
        reference TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS economy_accounts (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS leveling_history (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        old_level INTEGER NOT NULL,
        new_level INTEGER NOT NULL,
        xp_gained INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leveling_profiles (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        total_xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        last_message_at INTEGER,
        last_voice_at INTEGER,
        last_command_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_to TEXT,
        close_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        ends_at INTEGER NOT NULL,
        winner_count INTEGER NOT NULL DEFAULT 1,
        winner_ids TEXT NOT NULL DEFAULT '[]',
        required_roles TEXT NOT NULL DEFAULT '[]',
        entry_count INTEGER NOT NULL DEFAULT 0,
        prize_amount REAL NOT NULL DEFAULT 0,
        funded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        entered_at INTEGER NOT NULL,
        PRIMARY KEY (giveaway_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS staff_applications (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        answers TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewer_id TEXT,
        review_reason TEXT,
        review_channel_id TEXT,
        message_id TEXT,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        messages TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS music_sessions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        current_track TEXT,
        volume INTEGER NOT NULL DEFAULT 50,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_jobs (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        type TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        last_run INTEGER,
        next_run INTEGER NOT NULL,
        last_error TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        welcome_enabled INTEGER NOT NULL DEFAULT 0,
        welcome_channel_id TEXT,
        welcome_message TEXT,
        goodbye_enabled INTEGER NOT NULL DEFAULT 0,
        goodbye_channel_id TEXT,
        goodbye_message TEXT,
        autoroles_enabled INTEGER NOT NULL DEFAULT 0,
        autorole_ids TEXT NOT NULL DEFAULT '[]',
        moderation_enabled INTEGER NOT NULL DEFAULT 1,
        ai_enabled INTEGER NOT NULL DEFAULT 0,
        music_enabled INTEGER NOT NULL DEFAULT 0,
        leveling_enabled INTEGER NOT NULL DEFAULT 1,
        economy_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tempvc_configs (
        id TEXT PRIMARY KEY DEFAULT 'tempvc_main',
        guild_id TEXT NOT NULL DEFAULT 'global',
        create_channel_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        panel_channel_id TEXT,
        panel_message_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tempvc_instances (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL DEFAULT 'global',
        channel_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS economy_games (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        type TEXT NOT NULL,
        prize_pool REAL NOT NULL DEFAULT 0,
        entry_fee REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'waiting',
        winner_id TEXT,
        game_data TEXT NOT NULL DEFAULT '{}',
        ends_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS economy_game_players (
        game_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        entry_fee REAL NOT NULL DEFAULT 0,
        pick TEXT,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, user_id)
      );
    `);
        // Columns added after the first release. `CREATE TABLE IF NOT EXISTS`
        // does not add columns to an existing table, so patch them explicitly.
        this.ensureColumn('moderation_cases', 'revoked_at', 'INTEGER');
        this.ensureColumn('moderation_cases', 'revoked_by', 'TEXT');
        this.ensureColumn('warnings', 'active', 'INTEGER NOT NULL DEFAULT 1');
        this.ensureColumn('warnings', 'removed_at', 'INTEGER');
        this.ensureColumn('warnings', 'removed_by', 'TEXT');
        this.ensureColumn('economy_transactions', 'balance_after', 'REAL');
        this.ensureColumn('economy_transactions', 'reference', 'TEXT');
        this.ensureColumn('giveaways', 'message_id', 'TEXT');
        this.ensureColumn('giveaways', 'winner_ids', "TEXT NOT NULL DEFAULT '[]'");
        this.ensureColumn('giveaways', 'required_roles', "TEXT NOT NULL DEFAULT '[]'");
        this.ensureColumn('giveaways', 'prize_amount', 'REAL NOT NULL DEFAULT 0');
        this.ensureColumn('giveaways', 'funded', 'INTEGER NOT NULL DEFAULT 0');
        this.ensureColumn('automation_jobs', 'last_error', 'TEXT');
        this.ensureColumn('automation_jobs', 'run_count', 'INTEGER NOT NULL DEFAULT 0');
        this.ensureColumn('tempvc_configs', 'guild_id', "TEXT NOT NULL DEFAULT 'global'");
        this.ensureColumn('tempvc_instances', 'guild_id', "TEXT NOT NULL DEFAULT 'global'");
        this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS guild_members_guild_id_idx ON guild_members(guild_id);
      CREATE INDEX IF NOT EXISTS guild_members_user_id_idx ON guild_members(user_id);
      CREATE INDEX IF NOT EXISTS moderation_cases_guild_id_idx ON moderation_cases(guild_id);
      CREATE INDEX IF NOT EXISTS moderation_cases_created_idx ON moderation_cases(created_at);
      CREATE INDEX IF NOT EXISTS warnings_active_idx ON warnings(guild_id, user_id, active);
      CREATE INDEX IF NOT EXISTS economy_transactions_guild_id_idx ON economy_transactions(guild_id);
      CREATE INDEX IF NOT EXISTS economy_transactions_created_idx ON economy_transactions(created_at);
      CREATE INDEX IF NOT EXISTS economy_accounts_balance_idx ON economy_accounts(guild_id, balance);
      CREATE INDEX IF NOT EXISTS leveling_profiles_xp_idx ON leveling_profiles(guild_id, total_xp);
      CREATE INDEX IF NOT EXISTS tickets_guild_id_idx ON tickets(guild_id);
      CREATE INDEX IF NOT EXISTS tickets_channel_idx ON tickets(channel_id);
      CREATE INDEX IF NOT EXISTS giveaways_status_idx ON giveaways(status, ends_at);
      CREATE INDEX IF NOT EXISTS staff_applications_guild_idx ON staff_applications(guild_id, status);
      CREATE INDEX IF NOT EXISTS tempvc_configs_guild_idx ON tempvc_configs(guild_id);
      CREATE INDEX IF NOT EXISTS tempvc_instances_guild_idx ON tempvc_instances(guild_id);
      CREATE INDEX IF NOT EXISTS economy_games_due_idx ON economy_games(status, ends_at);
    `);
    }
    ensureColumn(table, column, definition) {
        if (!this.sqlite)
            return;
        try {
            const columns = this.sqlite.pragma(`table_info(${table})`);
            if (columns.some((c) => c.name === column))
                return;
            this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
        catch {
            // Table may not exist in a very old database; CREATE TABLE above covers it.
        }
    }
    /**
     * Move legacy single-user XP/balance rows into the new guild-scoped
     * tables once. Existing installs keep their progress under the `global`
     * bucket; real guild writes will start their own rows.
     */
    migrateLegacyData() {
        if (!this.sqlite)
            return;
        try {
            this.sqlite.exec(`
        INSERT OR IGNORE INTO economy_accounts (guild_id, user_id, balance, updated_at)
        SELECT 'global', id, balance, CAST(strftime('%s', 'now') AS INTEGER) * 1000
        FROM users WHERE balance != 0;

        INSERT OR IGNORE INTO leveling_profiles (guild_id, user_id, total_xp, level, updated_at)
        SELECT 'global', id, total_xp, level, CAST(strftime('%s', 'now') AS INTEGER) * 1000
        FROM users WHERE total_xp > 0;
      `);
        }
        catch {
            // Best-effort migration; a malformed legacy row must not stop startup.
        }
    }
    getDb() {
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        return this.db;
    }
    getSqlite() {
        if (!this.sqlite) {
            throw new Error('Database not initialized');
        }
        return this.sqlite;
    }
    async shutdown() {
        if (this.sqlite) {
            this.sqlite.close();
            this.sqlite = null;
        }
        this.db = null;
    }
}
exports.DatabaseManager = DatabaseManager;
