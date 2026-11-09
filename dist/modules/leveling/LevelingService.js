"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevelingCommands = exports.LevelingService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const DEFAULT_LEVELING_CONFIG = {
    enabled: true,
    xpFormula: 'quadratic',
    baseXpPerLevel: 100,
    xpMultiplier: 1,
    customXpTable: {},
    xpSources: {
        message: { enabled: true, min: 15, max: 25, cooldownSeconds: 60 },
        voice: { enabled: true, perMinuteMin: 5, perMinuteMax: 8, cooldownSeconds: 60 },
        command: { enabled: true, amount: 10, cooldownSeconds: 300 },
    },
    xpMultipliers: {
        weekend: 1.5,
        booster: 2.0,
        role: {},
    },
    noXpChannels: [],
    xpChannelWhitelist: [],
    levelRoles: [],
    announcementChannels: [],
    defaultColor: '#0099ff',
    ignoreBots: true,
    maxLevel: 100,
};
class LevelingService {
    constructor(logger, config) {
        this.db = null;
        this.client = null;
        this.xpCooldowns = new Map();
        this.voiceSessions = new Map();
        this.logger = logger;
        this.config = { ...DEFAULT_LEVELING_CONFIG, ...config };
    }
    setDb(db) {
        this.db = db;
    }
    setClient(client) {
        this.client = client;
    }
    async initialize() {
        this.logger.info('Leveling Service', `Leveling system initialized (formula: ${this.config.xpFormula}, max level: ${this.config.maxLevel})`);
    }
    /**
     * Calculate the total XP required to reach a given level.
     */
    xpForLevel(level) {
        if (level <= 1)
            return 0;
        if (this.config.xpFormula === 'custom' && this.config.customXpTable[level] !== undefined) {
            return this.config.customXpTable[level];
        }
        const base = this.config.baseXpPerLevel * this.config.xpMultiplier;
        switch (this.config.xpFormula) {
            case 'linear':
                return base * (level - 1);
            case 'quadratic':
                return base * (level - 1) * (level - 1);
            case 'exponential':
                return base * Math.pow(1.5, level - 1);
            default:
                return base * (level - 1);
        }
    }
    /**
     * Calculate the level from total XP.
     */
    calculateLevel(totalXP) {
        let level = 1;
        for (let lvl = 2; lvl <= this.config.maxLevel; lvl++) {
            const required = this.xpForLevel(lvl);
            if (totalXP >= required) {
                level = lvl;
            }
            else {
                break;
            }
        }
        return Math.min(level, this.config.maxLevel);
    }
    /**
     * Get XP needed for next level.
     */
    xpForNextLevel(currentLevel) {
        return this.xpForLevel(currentLevel + 1);
    }
    /**
     * Get progress within current level (0-100%).
     */
    getLevelProgress(totalXP, level) {
        const levelStart = this.xpForLevel(level);
        const levelEnd = this.xpForNextLevel(level);
        const current = totalXP - levelStart;
        const needed = levelEnd - levelStart;
        const percentage = needed > 0 ? Math.min(100, Math.floor((current / needed) * 100)) : 100;
        return { current, needed, percentage };
    }
    /**
     * Calculate XP multiplier for a member based on roles, day, etc.
     */
    getXpMultiplier(member) {
        let multiplier = 1;
        // Weekend multiplier
        const day = new Date().getDay();
        if (day === 0 || day === 6) {
            multiplier *= this.config.xpMultipliers.weekend;
        }
        // Booster role
        if (member && member.roles.cache.some((r) => r.premiumSubscriberRole)) {
            multiplier *= this.config.xpMultipliers.booster;
        }
        // Role-based multipliers
        if (member && this.config.xpMultipliers.role) {
            for (const [roleId, mult] of Object.entries(this.config.xpMultipliers.role)) {
                if (member.roles.cache.has(roleId)) {
                    multiplier *= mult;
                }
            }
        }
        return multiplier;
    }
    /**
     * Check if a channel allows XP earning.
     */
    canEarnXp(channelId) {
        if (this.config.noXpChannels.includes(channelId))
            return false;
        if (this.config.xpChannelWhitelist.length > 0 && !this.config.xpChannelWhitelist.includes(channelId)) {
            return false;
        }
        return true;
    }
    /**
     * Add XP from a message source.
     */
    async addXpFromMessage(guildId, userId, channelId, member) {
        if (!this.config.enabled)
            return null;
        if (!this.config.xpSources.message.enabled)
            return null;
        if (!this.canEarnXp(channelId))
            return null;
        const rawXp = Math.floor(Math.random() * (this.config.xpSources.message.max - this.config.xpSources.message.min + 1) +
            this.config.xpSources.message.min);
        const multiplier = this.getXpMultiplier(member);
        const xpAmount = Math.floor(rawXp * multiplier);
        return this.addXP(guildId, userId, xpAmount, 'message');
    }
    /**
     * Add XP from voice activity (per tick).
     */
    async addXpFromVoice(guildId, userId, member) {
        if (!this.config.enabled)
            return null;
        if (!this.config.xpSources.voice.enabled)
            return null;
        const rawXp = Math.floor(Math.random() * (this.config.xpSources.voice.perMinuteMax - this.config.xpSources.voice.perMinuteMin + 1) +
            this.config.xpSources.voice.perMinuteMin);
        const multiplier = this.getXpMultiplier(member);
        const xpAmount = Math.floor(rawXp * multiplier);
        return this.addXP(guildId, userId, xpAmount, 'voice');
    }
    /**
     * Core XP addition logic with cooldown, level calculation, role granting, and announcements.
     */
    async addXP(guildId, userId, xpAmount, source = 'manual') {
        if (!this.db)
            throw new Error('Database not connected');
        const cooldownKey = `${guildId}-${userId}-${source}`;
        const now = Date.now();
        const cooldownConfig = this.getCooldownConfig(source);
        const lastXp = this.xpCooldowns.get(cooldownKey);
        if (lastXp && now - lastXp < cooldownConfig * 1000) {
            return { leveledUp: false, oldLevel: 0, newLevel: 0, xpGained: 0, totalXP: 0, rolesGranted: [], announcementChannelId: null };
        }
        this.xpCooldowns.set(cooldownKey, now);
        const userResult = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        let user = userResult[0];
        if (!user) {
            await this.db.insert(schema_1.users).values({
                id: userId,
                username: '',
                discriminator: null,
                avatar: null,
                bot: false,
                balance: 0,
                xp: xpAmount,
                level: 1,
                total_xp: xpAmount,
                created_at: new Date(),
                updated_at: new Date(),
            });
            user = { id: userId, xp: xpAmount, level: 1, total_xp: xpAmount };
        }
        const oldLevel = user.level || 1;
        const currentXp = (user.xp || 0) + xpAmount;
        const totalXp = (user.total_xp || 0) + xpAmount;
        const newLevel = this.calculateLevel(totalXp);
        const leveledUp = newLevel > oldLevel;
        await this.db.update(schema_1.users)
            .set({ xp: currentXp, level: newLevel, total_xp: totalXp, updated_at: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        const result = {
            leveledUp,
            oldLevel,
            newLevel,
            xpGained: xpAmount,
            totalXP: totalXp,
            rolesGranted: [],
            announcementChannelId: null,
        };
        if (leveledUp) {
            await this.db.insert(schema_1.levelingHistory).values({
                id: `lvl_${Date.now()}`,
                guild_id: guildId,
                user_id: userId,
                old_level: oldLevel,
                new_level: newLevel,
                xp_gained: xpAmount,
            });
            const rolesGranted = await this.handleLevelUpRoles(guildId, userId, newLevel);
            result.rolesGranted = rolesGranted;
            const channelId = this.selectAnnouncementChannel(guildId, newLevel, userId);
            result.announcementChannelId = channelId;
            if (channelId && this.client) {
                await this.sendLevelUpAnnouncement(channelId, userId, newLevel, oldLevel, totalXp);
            }
        }
        return result;
    }
    getCooldownConfig(source) {
        switch (source) {
            case 'message': return this.config.xpSources.message.cooldownSeconds;
            case 'voice': return this.config.xpSources.voice.cooldownSeconds;
            case 'command': return this.config.xpSources.command.cooldownSeconds;
            default: return this.config.xpSources.message.cooldownSeconds;
        }
    }
    /**
     * Handle role granting based on level roles config.
     * Supports role replacement (higher tier replaces lower tier).
     */
    async handleLevelUpRoles(guildId, userId, newLevel) {
        if (!this.client)
            return [];
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return [];
        let member = null;
        try {
            member = await guild.members.fetch(userId);
        }
        catch {
            return [];
        }
        if (!member)
            return [];
        const rolesGranted = [];
        const rolesToRemove = [];
        // Find all roles this member now qualifies for
        const eligibleRoles = this.config.levelRoles
            .filter(r => newLevel >= r.level)
            .sort((a, b) => a.level - b.level);
        // Determine which roles to grant
        for (const roleConfig of eligibleRoles) {
            const role = guild.roles.cache.get(roleConfig.roleId);
            if (!role)
                continue;
            if (member.roles.cache.has(role.id))
                continue; // Already has it
            // If this role replaces lower tiers, mark those for removal
            if (roleConfig.replaceLower) {
                const lowerRoles = this.config.levelRoles
                    .filter(r => r.level < roleConfig.level && r.roleId !== roleConfig.roleId)
                    .map(r => r.roleId);
                rolesToRemove.push(...lowerRoles.filter(rid => member.roles.cache.has(rid)));
            }
            try {
                await member.roles.add(role.id, `Level ${newLevel} reward`);
                rolesGranted.push(role.id);
                this.logger.info('Leveling Service', `Granted role ${role.name} (level ${roleConfig.level}) to ${member.user.tag}`);
            }
            catch (err) {
                this.logger.error('Leveling Service', `Failed to grant role ${roleConfig.roleId} to ${member.user.tag}`, err);
            }
        }
        // Remove lower tier roles after granting
        if (rolesToRemove.length > 0) {
            const uniqueRemovals = [...new Set(rolesToRemove)];
            try {
                await member.roles.remove(uniqueRemovals, 'Replaced by higher level role');
                this.logger.info('Leveling Service', `Removed lower tier roles from ${member.user.tag}: ${uniqueRemovals.join(', ')}`);
            }
            catch (err) {
                this.logger.error('Leveling Service', `Failed to remove roles from ${member.user.tag}`, err);
            }
        }
        return rolesGranted;
    }
    /**
     * Sync all roles for a member based on their current level (useful on rejoin).
     */
    async syncMemberRoles(guildId, userId) {
        if (!this.db || !this.client)
            return;
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return;
        let member = null;
        try {
            member = await guild.members.fetch(userId);
        }
        catch {
            return;
        }
        if (!member)
            return;
        const data = await this.getLevel(guildId, userId);
        if (!data)
            return;
        await this.handleLevelUpRoles(guildId, userId, data.level);
    }
    /**
     * Select the appropriate announcement channel for a level up.
     * Priority: exact level match > role-based > minLevel match > default.
     */
    selectAnnouncementChannel(guildId, newLevel, userId) {
        const channels = this.config.announcementChannels;
        if (channels.length === 0)
            return null;
        // Get member for role-based matching
        if (!this.client)
            return null;
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return null;
        let member = null;
        try {
            member = guild.members.cache.get(userId) ?? null;
        }
        catch {
            member = null;
        }
        // 1. Exact level match
        const exactMatch = channels.find(c => c.messageTemplate && c.minLevel === undefined);
        if (exactMatch)
            return exactMatch.channelId;
        // 2. Role-based channels
        if (member) {
            for (const ch of channels) {
                if (ch.roleId && member.roles.cache.has(ch.roleId)) {
                    return ch.channelId;
                }
            }
        }
        // 3. Min level match (highest minLevel <= newLevel)
        const minLevelMatches = channels
            .filter(c => c.minLevel !== undefined && newLevel >= c.minLevel)
            .sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0));
        if (minLevelMatches.length > 0)
            return minLevelMatches[0].channelId;
        // 4. Default (first channel without restrictions)
        const defaultChannel = channels.find(c => c.minLevel === undefined && !c.roleId);
        if (defaultChannel)
            return defaultChannel.channelId;
        return channels[0]?.channelId ?? null;
    }
    /**
     * Send a level-up announcement embed.
     */
    async sendLevelUpAnnouncement(channelId, userId, newLevel, oldLevel, totalXP) {
        if (!this.client)
            return;
        const channel = this.client.channels.cache.get(channelId);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function')
            return;
        const channelConfig = this.config.announcementChannels.find(c => c.channelId === channelId);
        const progress = this.getLevelProgress(totalXP, newLevel);
        const color = channelConfig?.color ?? this.config.defaultColor;
        const template = channelConfig?.messageTemplate ||
            '🎉 Congratulations {user}, you have reached **level {level}**!';
        const content = template
            .replace(/\{user\}/g, `<@${userId}>`)
            .replace(/\{username\}/g, '{username}') // Will be filled if we fetch user
            .replace(/\{level\}/g, String(newLevel))
            .replace(/\{oldLevel\}/g, String(oldLevel))
            .replace(/\{xp\}/g, progress.current.toLocaleString())
            .replace(/\{neededXp\}/g, progress.needed.toLocaleString())
            .replace(/\{progress\}/g, String(progress.percentage))
            .replace(/\{totalXp\}/g, totalXP.toLocaleString())
            .trim();
        try {
            let user;
            try {
                user = await this.client.users.fetch(userId);
            }
            catch {
                user = { username: 'Unknown', tag: 'Unknown#0000', id: userId };
            }
            const finalContent = content.replace(/\{username\}/g, user.username);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(color)
                .setTitle('🎉 Level Up!')
                .setDescription(finalContent)
                .addFields({ name: 'Level', value: `${oldLevel} → ${newLevel}`, inline: true }, { name: 'Progress', value: `${progress.current}/${progress.needed} (${progress.percentage}%)`, inline: true }, { name: 'Total XP', value: totalXP.toLocaleString(), inline: true })
                .setTimestamp()
                .setFooter({ text: `Level ${newLevel} achieved` });
            await channel.send({
                embeds: [embed],
                allowedMentions: { users: [userId] },
            });
        }
        catch (err) {
            this.logger.error('Leveling Service', `Failed to send level-up announcement to channel ${channelId}`, err);
        }
    }
    async getLevel(_guildId, userId) {
        if (!this.db)
            return null;
        const result = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        if (!result[0])
            return null;
        const u = result[0];
        return {
            level: u.level || 1,
            xp: u.xp || 0,
            totalXP: u.total_xp || 0,
        };
    }
    async getLeaderboard(_guildId, limit = 10) {
        if (!this.db)
            return [];
        return this.db.select().from(schema_1.users).orderBy((0, drizzle_orm_1.desc)(schema_1.users.total_xp)).limit(limit);
    }
    /**
     * Voice session tracking - call when member joins voice.
     */
    startVoiceSession(userId) {
        this.voiceSessions.set(userId, Date.now());
    }
    /**
     * Voice session tracking - call when member leaves voice. Returns minutes spent.
     */
    endVoiceSession(userId) {
        const joinTs = this.voiceSessions.get(userId);
        if (!joinTs)
            return 0;
        const minutes = Math.floor((Date.now() - joinTs) / 60000);
        this.voiceSessions.delete(userId);
        return minutes;
    }
    /**
     * Get voice session start time for a user.
     */
    getVoiceSession(userId) {
        return this.voiceSessions.get(userId) ?? null;
    }
    async shutdown() {
        this.xpCooldowns.clear();
        this.voiceSessions.clear();
        this.logger.info('Leveling Service', 'Leveling system shutdown');
    }
}
exports.LevelingService = LevelingService;
class LevelingCommands {
    constructor(service, logger, config) {
        this.levelCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('level')
                .setDescription('Check your level and XP progress')
                .addUserOption(option => option.setName('user').setDescription('User to check')),
            execute: async (interaction) => {
                const user = interaction.options.getUser('user') || interaction.user;
                try {
                    const data = await this.service.getLevel(interaction.guildId, user.id);
                    if (!data) {
                        await interaction.reply({ content: 'No leveling data found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const progress = this.service.getLevelProgress(data.totalXP, data.level);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle(`Level ${data.level} - ${user.tag}`)
                        .setDescription(`Total XP: ${data.totalXP.toLocaleString()}`)
                        .addFields({ name: 'Level Progress', value: `${progress.current}/${progress.needed} (${progress.percentage}%)`, inline: true }, { name: 'Current XP', value: data.xp.toLocaleString(), inline: true }, { name: 'Next Level XP', value: this.service.xpForNextLevel(data.level).toLocaleString(), inline: true })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                }
                catch (error) {
                    this.logger.error('Leveling Commands', 'Failed to get level', error);
                    await interaction.reply({ content: 'Failed to get level data.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.rankCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('rank')
                .setDescription('Check your rank in the server leaderboard')
                .addUserOption(option => option.setName('user').setDescription('User to check')),
            execute: async (interaction) => {
                const user = interaction.options.getUser('user') || interaction.user;
                try {
                    const leaderboard = await this.service.getLeaderboard(interaction.guildId, 1000);
                    const rank = leaderboard.findIndex((u) => u.id === user.id) + 1;
                    const data = await this.service.getLevel(interaction.guildId, user.id);
                    if (!data) {
                        await interaction.reply({ content: 'No leveling data found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.reply({ content: `#${rank} - Level ${data.level} (${data.totalXP} XP)`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Leveling Commands', 'Failed to get rank', error);
                    await interaction.reply({ content: 'Failed to get rank.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.leaderboardCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('leaderboard')
                .setDescription('View the server leveling leaderboard')
                .addIntegerOption(option => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(50)),
            execute: async (interaction) => {
                const limit = interaction.options.getInteger('limit') ?? 10;
                try {
                    const leaderboard = await this.service.getLeaderboard(interaction.guildId, limit);
                    if (leaderboard.length === 0) {
                        await interaction.reply({ content: 'No leveling data found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#ffd700')
                        .setTitle('🏆 Server Level Leaderboard')
                        .setDescription(leaderboard.map((u, i) => `${i + 1}. <@${u.id}> - Level ${u.level} (${(u.total_xp || 0).toLocaleString()} XP)`).join('\n'))
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                }
                catch (error) {
                    this.logger.error('Leveling Commands', 'Failed to get leaderboard', error);
                    await interaction.reply({ content: 'Failed to get leaderboard.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.xpCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('xp')
                .setDescription('Check your current XP')
                .addUserOption(option => option.setName('user').setDescription('User to check')),
            execute: async (interaction) => {
                const user = interaction.options.getUser('user') || interaction.user;
                try {
                    const data = await this.service.getLevel(interaction.guildId, user.id);
                    if (!data) {
                        await interaction.reply({ content: 'No leveling data found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const progress = this.service.getLevelProgress(data.totalXP, data.level);
                    await interaction.reply({
                        content: `**${user.username}** has ${data.xp.toLocaleString()} XP (Level ${data.level}, Total: ${data.totalXP.toLocaleString()}) - Progress: ${progress.percentage}%`,
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                }
                catch (error) {
                    this.logger.error('Leveling Commands', 'Failed to get XP', error);
                    await interaction.reply({ content: 'Failed to get XP data.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.rolesCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('levelroles')
                .setDescription('View all level-based gift roles'),
            execute: async (interaction) => {
                const roles = this.config.levelRoles
                    .sort((a, b) => a.level - b.level)
                    .map(r => `Level ${r.level}+: <@&${r.roleId}>${r.replaceLower ? ' (replaces lower)' : ''}`)
                    .join('\n') || 'No level roles configured.';
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🎁 Level Gift Roles')
                    .setDescription(roles)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], flags: discord_js_1.MessageFlags.Ephemeral });
            },
        };
        this.setxpCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('setxp')
                .setDescription('Set a user\'s XP (admin only)')
                .addUserOption(option => option.setName('user').setDescription('User to modify').setRequired(true))
                .addIntegerOption(option => option.setName('amount').setDescription('XP amount to set').setRequired(true).setMinValue(0))
                .setDefaultMemberPermissions(0n),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guild.members) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                try {
                    const member = interaction.guild.members.cache.get(user.id);
                    if (!member) {
                        await interaction.reply({ content: 'User not found in this server.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const newLevel = this.service.calculateLevel(amount);
                    await this.dbSetUserXp(interaction.guildId, user.id, amount, newLevel);
                    const rolesGranted = await this.service.handleLevelUpRoles(interaction.guildId, user.id, newLevel);
                    const roleText = rolesGranted.length > 0
                        ? `\nRoles granted: ${rolesGranted.map(r => `<@&${r}>`).join(', ')}`
                        : '';
                    await interaction.reply({
                        content: `✅ Set ${user.tag}'s XP to ${amount.toLocaleString()} (Level ${newLevel})${roleText}`,
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                }
                catch (error) {
                    this.logger.error('Leveling Commands', 'Failed to set XP', error);
                    await interaction.reply({ content: 'Failed to set XP.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.service = service;
        this.logger = logger;
        this.config = config;
    }
    getCommands() {
        return [this.levelCommand, this.rankCommand, this.leaderboardCommand, this.xpCommand, this.rolesCommand, this.setxpCommand];
    }
    async dbSetUserXp(_guildId, userId, xp, level) {
        if (!this.db)
            return;
        const existing = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        if (existing[0]) {
            await this.db.update(schema_1.users)
                .set({ xp, level, total_xp: xp, updated_at: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        }
        else {
            await this.db.insert(schema_1.users).values({
                id: userId,
                username: '',
                discriminator: null,
                avatar: null,
                bot: false,
                balance: 0,
                xp,
                level,
                total_xp: xp,
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }
    get db() {
        return this.service.db;
    }
}
exports.LevelingCommands = LevelingCommands;
