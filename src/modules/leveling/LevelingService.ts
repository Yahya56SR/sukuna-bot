import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  TextChannel,
  GuildMember,
  Client,
  AttachmentBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { levelingHistory, levelingProfiles } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { levelingEmbed, progressBar, formatNumber, brandedEmbed, BRAND, errorEmbed } from '../../utils/embed';
import { rankCard } from '../../utils/rankcard';
import { buildRankCard, buildLeaderboardPanel } from '../../utils/rankEmbeds';
import { collectEntries, buildMessagePayload } from '../../utils/liveLeaderboard';
import { newId } from '../../utils/id';

export type XpFormula = 'linear' | 'quadratic' | 'exponential' | 'custom';

export interface LevelRole {
  level: number;
  roleId: string;
  replaceLower: boolean;
}

export interface LevelAnnouncementChannel {
  channelId: string;
  minLevel?: number | undefined;
  roleId?: string | undefined;
  messageTemplate?: string | undefined;
  color?: string | undefined;
}

export interface LevelingConfig {
  enabled: boolean;
  xpFormula: XpFormula;
  baseXpPerLevel: number;
  xpMultiplier: number;
  customXpTable: Record<number, number>;
  xpSources: {
    message: { enabled: boolean; min: number; max: number; cooldownSeconds: number };
    voice: { enabled: boolean; perMinuteMin: number; perMinuteMax: number; cooldownSeconds: number };
    command: { enabled: boolean; amount: number; cooldownSeconds: number };
  };
  xpMultipliers: { weekend: number; booster: number; role: Record<string, number> };
  noXpChannels: string[];
  xpChannelWhitelist: string[];
  levelRoles: LevelRole[];
  announcementChannels: LevelAnnouncementChannel[];
  staffRoleIds: string[];
  staffLevelRoles: LevelRole[];
  staffAnnouncementChannels: LevelAnnouncementChannel[];
  memberLevelRoles: LevelRole[];
  memberAnnouncementChannels: LevelAnnouncementChannel[];
  defaultColor: string;
  ignoreBots: boolean;
  maxLevel: number;
}

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpGained: number;
  totalXP: number;
  isStaff: boolean;
  rolesGranted: string[];
  announcementChannelId: string | null;
}

const DEFAULT_LEVELING_CONFIG: LevelingConfig = {
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
  xpMultipliers: { weekend: 1.5, booster: 2.0, role: {} },
  noXpChannels: [],
  xpChannelWhitelist: [],
  levelRoles: [],
  announcementChannels: [],
  staffRoleIds: [],
  staffLevelRoles: [],
  staffAnnouncementChannels: [],
  memberLevelRoles: [],
  memberAnnouncementChannels: [],
  defaultColor: '#0099ff',
  ignoreBots: true,
  maxLevel: 100,
};

const LEGACY_GUILD = 'global';

export class LevelingService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private client: Client | null = null;
  private config: LevelingConfig;
  private voiceSessions: Map<string, number> = new Map();

  constructor(logger: Logger, config?: Partial<LevelingConfig>) {
    this.logger = logger;
    this.config = { ...DEFAULT_LEVELING_CONFIG, ...config } as LevelingConfig;
    this.syncLegacyAliases();
  }

  private syncLegacyAliases(): void {
    const c = this.config as any;
    if (typeof c.staffRoleIds === 'string') {
      try { c.staffRoleIds = JSON.parse(c.staffRoleIds); } catch { c.staffRoleIds = c.staffRoleIds ? [c.staffRoleIds] : []; }
    }
    if (!Array.isArray(c.staffRoleIds)) c.staffRoleIds = [];
    if (!Array.isArray(c.staffLevelRoles)) c.staffLevelRoles = [];
    if (!Array.isArray(c.staffAnnouncementChannels)) c.staffAnnouncementChannels = [];
    if (!Array.isArray(c.memberLevelRoles) || c.memberLevelRoles.length === 0) {
      c.memberLevelRoles = Array.isArray(c.levelRoles) ? [...c.levelRoles] : [];
    }
    if (!Array.isArray(c.memberAnnouncementChannels) || c.memberAnnouncementChannels.length === 0) {
      c.memberAnnouncementChannels = Array.isArray(c.announcementChannels) ? [...c.announcementChannels] : [];
    }
    c.levelRoles = c.memberLevelRoles;
    c.announcementChannels = c.memberAnnouncementChannels;
  }

  public getConfig(): LevelingConfig { return this.config; }

  public refreshLegacyAliases(): void { this.syncLegacyAliases(); }

  public memberRoles(): LevelRole[] {
    return (this.config.memberLevelRoles?.length ? this.config.memberLevelRoles : this.config.levelRoles) ?? [];
  }

  public staffRoles(): LevelRole[] { return this.config.staffLevelRoles ?? []; }

  public memberChannels(): LevelAnnouncementChannel[] {
    return (this.config.memberAnnouncementChannels?.length ? this.config.memberAnnouncementChannels : this.config.announcementChannels) ?? [];
  }

  public staffChannels(): LevelAnnouncementChannel[] { return this.config.staffAnnouncementChannels ?? []; }

  public isStaffMember(member: GuildMember | null | undefined): boolean {
    if (!member) return false;
    const staffIds = this.config.staffRoleIds ?? [];
    if (staffIds.some((rid) => rid && member.roles.cache.has(rid))) return true;
    const perms = member.permissions as any;
    if (perms && typeof perms.has === 'function') {
      if (
        perms.has(PermissionFlagsBits.ManageMessages) ||
        perms.has(PermissionFlagsBits.KickMembers) ||
        perms.has(PermissionFlagsBits.BanMembers) ||
        perms.has(PermissionFlagsBits.Administrator) ||
        perms.has(PermissionFlagsBits.ManageGuild)
      ) return true;
    }
    return false;
  }

  public async isStaff(guildId: string, userId: string, member?: GuildMember | null): Promise<boolean> {
    if (member) return this.isStaffMember(member);
    if (!this.client) return false;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const cached = guild.members.cache.get(userId);
    if (cached) return this.isStaffMember(cached);
    const fetched = await guild.members.fetch(userId).catch(() => null);
    return this.isStaffMember(fetched);
  }

  public setDb(db: DrizzleDb): void { this.db = db; }
  public setClient(client: Client): void { this.client = client; }

  public async initialize(): Promise<void> {
    this.logger.info('Leveling Service', `Leveling initialized (formula: ${this.config.xpFormula}, max level: ${this.config.maxLevel})`);
  }

  public xpForLevel(level: number): number {
    if (level <= 1) return 0;
    if (this.config.xpFormula === 'custom' && this.config.customXpTable[level] !== undefined) {
      return Math.max(0, Math.floor(Number(this.config.customXpTable[level])));
    }
    const base = (Number(this.config.baseXpPerLevel) || 0) * (Number(this.config.xpMultiplier) || 1);
    switch (this.config.xpFormula) {
      case 'linear': return Math.floor(base * (level - 1));
      case 'quadratic': return Math.floor(base * (level - 1) * (level - 1));
      case 'exponential': return Math.floor(base * Math.pow(1.5, level - 1));
      default: return Math.floor(base * (level - 1));
    }
  }

  public calculateLevel(totalXP: number): number {
    const total = Number.isFinite(totalXP) ? Math.max(0, Math.floor(totalXP)) : 0;
    const maxLevel = Math.max(1, Math.floor(this.config.maxLevel) || 1);
    let level = 1;
    for (let lvl = 2; lvl <= maxLevel; lvl++) {
      if (total >= this.xpForLevel(lvl)) level = lvl;
      else break;
    }
    return level;
  }

  public xpForNextLevel(currentLevel: number): number {
    return this.xpForLevel(currentLevel + 1);
  }

  public getLevelProgress(totalXP: number, level: number): { current: number; needed: number; percentage: number } {
    const levelStart = this.xpForLevel(level);
    const levelEnd = this.xpForNextLevel(level);
    const current = Math.max(0, totalXP - levelStart);
    const needed = Math.max(0, levelEnd - levelStart);
    const percentage = needed > 0 ? Math.min(100, Math.floor((current / needed) * 100)) : 100;
    return { current, needed, percentage };
  }

  public getXpMultiplier(member?: GuildMember): number {
    let multiplier = 1;
    const multipliers = this.config.xpMultipliers ?? { weekend: 1, booster: 1, role: {} };
    const day = new Date().getDay();
    if (day === 0 || day === 6) multiplier *= multipliers.weekend ?? 1;
    const isBoosting = !!member && (
      !!(member as any).premiumSince ||
      member.roles.cache.some((r: any) => r.tags?.premiumSubscriberRole)
    );
    if (isBoosting) multiplier *= multipliers.booster ?? 1;
    if (member && multipliers.role) {
      for (const [roleId, mult] of Object.entries(multipliers.role)) {
        if (member.roles.cache.has(roleId)) multiplier *= Number(mult) || 1;
      }
    }
    return Math.max(0, multiplier);
  }

  public canEarnXp(channelId: string): boolean {
    if ((this.config.noXpChannels ?? []).includes(channelId)) return false;
    const whitelist = this.config.xpChannelWhitelist ?? [];
    return whitelist.length === 0 || whitelist.includes(channelId);
  }

  public async addXpFromMessage(guildId: string, userId: string, channelId: string, member?: GuildMember): Promise<LevelUpResult | null> {
    if (!this.config.enabled) return null;
    const source = this.config.xpSources?.message;
    if (!source?.enabled || !this.canEarnXp(channelId)) return null;
    const min = Number.isFinite(source.min) ? source.min : 15;
    const max = Number.isFinite(source.max) ? Math.max(source.max, min) : min;
    const rawXp = Math.floor(Math.random() * (max - min + 1) + min);
    const xpAmount = Math.floor(rawXp * this.getXpMultiplier(member));
    if (xpAmount <= 0) return null;
    return this.addXP(guildId, userId, xpAmount, 'message');
  }

  public async addXpFromVoice(guildId: string, userId: string, member?: GuildMember, minutes = 1): Promise<LevelUpResult | null> {
    if (!this.config.enabled) return null;
    const source = this.config.xpSources?.voice;
    if (!source?.enabled) return null;
    const min = Number.isFinite(source.perMinuteMin) ? source.perMinuteMin : 5;
    const max = Number.isFinite(source.perMinuteMax) ? Math.max(source.perMinuteMax, min) : min;
    const elapsed = Math.max(1, Math.min(1440, Math.floor(Number.isFinite(minutes) ? minutes : 1)));
    // One roll per minute keeps the reward distribution identical to the old
    // loop but avoids doing `minutes` database-less random calls.
    let rawXp = 0;
    for (let i = 0; i < elapsed; i++) {
      rawXp += Math.floor(Math.random() * (max - min + 1) + min);
    }
    const xpAmount = Math.floor(rawXp * this.getXpMultiplier(member));
    if (xpAmount <= 0) return null;
    return this.addXP(guildId, userId, xpAmount, 'voice');
  }

  private sourceCooldown(source: string): number {
    switch (source) {
      case 'message': return Math.max(0, this.config.xpSources?.message?.cooldownSeconds ?? 60);
      case 'voice': return Math.max(0, this.config.xpSources?.voice?.cooldownSeconds ?? 60);
      case 'command': return Math.max(0, this.config.xpSources?.command?.cooldownSeconds ?? 300);
      default: return 0;
    }
  }

  private sourceColumn(source: string): string | null {
    switch (source) {
      case 'message': return 'last_message_at';
      case 'voice': return 'last_voice_at';
      case 'command': return 'last_command_at';
      default: return null;
    }
  }

  /**
   * Core XP mutation. Reads and writes happen inside one SQLite transaction,
   * so two simultaneous messages cannot both start from the same total.
   */
  public async addXP(guildId: string, userId: string, xpAmount: number, source = 'manual'): Promise<LevelUpResult | null> {
    if (!this.db) throw new Error('Database not connected');
    if (!Number.isFinite(xpAmount) || xpAmount <= 0) return null;
    const amount = Math.floor(xpAmount);
    const cooldown = this.sourceCooldown(source);
    const column = this.sourceColumn(source);
    const db = this.db;

    const outcome = db.transaction((tx) => {
      const now = Math.floor(Date.now() / 1000);
      const row = tx.get<any>(sql`
        SELECT total_xp, level, last_message_at, last_voice_at, last_command_at
        FROM leveling_profiles
        WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
      const lastAt = column ? Number(row?.[column] ?? 0) : 0;
      if (column && cooldown > 0 && lastAt > 0 && now - lastAt < cooldown) {
        return { applied: false, oldLevel: Number(row?.level ?? 1), newLevel: Number(row?.level ?? 1), totalXp: Number(row?.total_xp ?? 0), amount: 0 };
      }

      const oldLevel = Number(row?.level ?? 1);
      const totalXp = Number(row?.total_xp ?? 0) + amount;
      const newLevel = this.calculateLevel(totalXp);
      const inLevelXp = Math.max(0, totalXp - this.xpForLevel(newLevel));

      if (!row) {
        if (column) {
          tx.run(sql`
            INSERT INTO leveling_profiles (guild_id, user_id, total_xp, level, ${sql.identifier(column)}, updated_at)
            VALUES (${guildId}, ${userId}, ${totalXp}, ${newLevel}, ${now}, ${now})
          `);
        } else {
          tx.run(sql`
            INSERT INTO leveling_profiles (guild_id, user_id, total_xp, level, updated_at)
            VALUES (${guildId}, ${userId}, ${totalXp}, ${newLevel}, ${now})
          `);
        }
      } else {
        const setParts = [
          sql`total_xp = ${totalXp}`,
          sql`level = ${newLevel}`,
          sql`updated_at = ${now}`,
        ];
        if (column) setParts.push(sql`${sql.identifier(column)} = ${now}`);
        tx.run(sql`UPDATE leveling_profiles SET ${sql.join(setParts, sql`, `)} WHERE guild_id = ${guildId} AND user_id = ${userId}`);
      }

      tx.run(sql`
        INSERT INTO users (id, username, bot, balance, xp, level, total_xp, created_at, updated_at)
        VALUES (${userId}, '', 0, 0, ${inLevelXp}, ${newLevel}, ${totalXp}, ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET xp = ${inLevelXp}, level = ${newLevel}, total_xp = ${totalXp}, updated_at = ${now}
      `);

      return { applied: true, oldLevel, newLevel, totalXp, amount };
    });

    if (!outcome.applied) {
      return { leveledUp: false, oldLevel: outcome.oldLevel, newLevel: outcome.newLevel, xpGained: 0, totalXP: outcome.totalXp, isStaff: false, rolesGranted: [], announcementChannelId: null };
    }

    const oldLevel = outcome.oldLevel;
    const newLevel = outcome.newLevel;
    const totalXp = outcome.totalXp;
    const leveledUp = newLevel > oldLevel;

    const isStaff = await this.isStaff(guildId, userId).catch(() => false);
    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: amount,
      totalXP: totalXp,
      isStaff,
      rolesGranted: [],
      announcementChannelId: null,
    };

    if (leveledUp) {
      if (this.db) {
        await this.db.insert(levelingHistory).values({
          id: newId('lvl'),
          guild_id: guildId,
          user_id: userId,
          old_level: oldLevel,
          new_level: newLevel,
          xp_gained: amount,
        } as any);
      }
      result.rolesGranted = await this.handleLevelUpRoles(guildId, userId, newLevel, isStaff);
      const channelId = this.selectAnnouncementChannel(guildId, newLevel, userId, isStaff);
      result.announcementChannelId = channelId;
      if (channelId && this.client) {
        await this.sendLevelUpAnnouncement(channelId, userId, newLevel, oldLevel, totalXp, isStaff);
      }
    }

    return result;
  }

  public async setXP(guildId: string, userId: string, totalXP: number): Promise<{ level: number; xp: number; totalXP: number }> {
    if (!this.db) throw new Error('Database not connected');
    const total = Number.isFinite(totalXP) ? Math.max(0, Math.floor(totalXP)) : 0;
    const level = this.calculateLevel(total);
    const inLevel = Math.max(0, total - this.xpForLevel(level));
    const now = Math.floor(Date.now() / 1000);
    const db = this.db;

    db.transaction((tx) => {
      tx.run(sql`
        INSERT INTO leveling_profiles (guild_id, user_id, total_xp, level, updated_at)
        VALUES (${guildId}, ${userId}, ${total}, ${level}, ${now})
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          total_xp = ${total}, level = ${level}, updated_at = ${now},
          last_message_at = NULL, last_voice_at = NULL, last_command_at = NULL
      `);
      tx.run(sql`
        INSERT INTO users (id, username, bot, balance, xp, level, total_xp, created_at, updated_at)
        VALUES (${userId}, '', 0, 0, ${inLevel}, ${level}, ${total}, ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET xp = ${inLevel}, level = ${level}, total_xp = ${total}, updated_at = ${now}
      `);
    });

    return { level, xp: inLevel, totalXP: total };
  }

  public async handleLevelUpRoles(guildId: string, userId: string, newLevel: number, isStaff?: boolean): Promise<string[]> {
    if (!this.client) return [];
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return [];

    const staff = isStaff ?? this.isStaffMember(member);
    const pool = staff ? this.staffRoles() : this.memberRoles();
    const trackLabel = staff ? 'staff' : 'member';
    const rolesGranted: string[] = [];
    const rolesToRemove = new Set<string>();

    const eligible = pool
      .filter((r) => r.roleId && newLevel >= Number(r.level))
      .sort((a, b) => Number(a.level) - Number(b.level));

    for (const roleConfig of eligible) {
      const role = guild.roles.cache.get(roleConfig.roleId);
      if (!role) continue;
      if (roleConfig.replaceLower) {
        for (const lower of pool) {
          if (lower.roleId !== roleConfig.roleId && Number(lower.level) < Number(roleConfig.level)) {
            rolesToRemove.add(lower.roleId);
          }
        }
      }
      if (member.roles.cache.has(role.id)) continue;
      try {
        await member.roles.add(role.id, `Level ${newLevel} ${trackLabel} reward`);
        rolesGranted.push(role.id);
        this.logger.info('Leveling Service', `Granted ${trackLabel} role ${role.name} (level ${roleConfig.level}) to ${member.user.tag}`);
      } catch (err) {
        this.logger.error('Leveling Service', `Failed to grant ${trackLabel} role ${roleConfig.roleId} to ${member.user.tag}`, err as Error);
      }
    }

    const removeIds = [...rolesToRemove].filter((rid) => rid && member.roles.cache.has(rid));
    if (removeIds.length) {
      try {
        await member.roles.remove(removeIds, 'Replaced by higher level role');
        this.logger.info('Leveling Service', `Removed lower tier ${trackLabel} roles from ${member.user.tag}`);
      } catch (err) {
        this.logger.error('Leveling Service', `Failed to remove roles from ${member.user.tag}`, err as Error);
      }
    }
    return rolesGranted;
  }

  public async syncMemberRoles(guildId: string, userId: string): Promise<void> {
    if (!this.db || !this.client) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    const data = await this.getLevel(guildId, userId);
    if (!data) return;
    await this.handleLevelUpRoles(guildId, userId, data.level);
  }

  public selectAnnouncementChannel(guildId: string, newLevel: number, userId: string, isStaff?: boolean): string | null {
    let member: GuildMember | null = null;
    if (this.client) {
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) member = guild.members.cache.get(userId) ?? null;
    }
    const staff = isStaff ?? (member ? this.isStaffMember(member) : false);

    const pick = (channels: LevelAnnouncementChannel[]): string | null => {
      if (!channels.length) return null;
      const exactTier = channels
        .filter((c) => c.minLevel === newLevel && c.messageTemplate)
        .sort((a, b) => (b.messageTemplate?.length ?? 0) - (a.messageTemplate?.length ?? 0))[0];
      if (exactTier) return exactTier.channelId;
      if (member) {
        for (const ch of channels) {
          if (ch.roleId && member.roles.cache.has(ch.roleId) && (ch.minLevel === undefined || newLevel >= ch.minLevel)) {
            return ch.channelId;
          }
        }
      }
      const minLevelMatches = channels
        .filter((c) => c.minLevel !== undefined && newLevel >= c.minLevel)
        .sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0));
      if (minLevelMatches[0]) return minLevelMatches[0].channelId;
      return channels.find((c) => c.minLevel === undefined && !c.roleId)?.channelId ?? channels[0]?.channelId ?? null;
    };

    const primary = staff ? this.staffChannels() : this.memberChannels();
    const secondary = staff ? this.memberChannels() : this.staffChannels();
    return pick(primary) ?? (primary.length === 0 ? pick(secondary) : null);
  }

  public async sendLevelUpAnnouncement(
    channelId: string,
    userId: string,
    newLevel: number,
    oldLevel: number,
    totalXP: number,
    isStaff?: boolean,
  ): Promise<void> {
    if (!this.client) return;
    const channel = this.client.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const allChannels = [...this.staffChannels(), ...this.memberChannels()];
    const channelConfig = allChannels.find((c) => c.channelId === channelId);
    const progress = this.getLevelProgress(totalXP, newLevel);
    const color = channelConfig?.color ?? this.config.defaultColor;
    const staff = isStaff ?? false;
    const template = channelConfig?.messageTemplate ||
      (staff
        ? '🛡️ Staff {user} reached **level {level}**!'
        : '🎉 Congratulations {user}, you have reached **level {level}**!');

    try {
      const user = await this.client.users.fetch(userId).catch(() => null);
      const username = user?.username ?? 'Unknown';
      const content = template
        .replace(/\{user\}/g, `<@${userId}>`)
        .replace(/\{username\}/g, username)
        .replace(/\{level\}/g, String(newLevel))
        .replace(/\{oldLevel\}/g, String(oldLevel))
        .replace(/\{xp\}/g, progress.current.toLocaleString())
        .replace(/\{neededXp\}/g, progress.needed.toLocaleString())
        .replace(/\{progress\}/g, String(progress.percentage))
        .replace(/\{totalXp\}/g, totalXP.toLocaleString())
        .trim();

      const embed = levelingEmbed({
        user: {
          username,
          tag: user?.tag,
          displayAvatarURL: user ? () => user.displayAvatarURL() : undefined,
        },
        userId,
        level: newLevel,
        oldLevel,
        totalXP,
        currentXP: progress.current,
        neededXP: progress.needed,
        percentage: progress.percentage,
        title: staff ? `🛡️ Staff Level Up! ${oldLevel} → ${newLevel}` : undefined,
      })
        .setDescription(
          `${content}\n\n\`${progressBar(progress.percentage)}\`\n` +
          `\`${formatNumber(progress.current)} / ${formatNumber(progress.needed)} XP\` • Total: **${formatNumber(totalXP)}**` +
          (staff ? '\n**Track:** 🛡️ Staff' : '\n**Track:** 👥 Member')
        );
      if (color) embed.setColor(color as any);

      await (channel as TextChannel).send({ embeds: [embed], allowedMentions: { users: [userId] } });
    } catch (err) {
      this.logger.error('Leveling Service', `Failed to send level-up announcement to channel ${channelId}`, err as Error);
    }
  }

  /** Guild-scoped profile, falling back to the migrated legacy bucket. */
  public async getLevel(guildId: string, userId: string): Promise<{ level: number; xp: number; totalXP: number } | null> {
    if (!this.db) return null;
    const row = await this.db
      .select()
      .from(levelingProfiles)
      .where(and(eq(levelingProfiles.guild_id, guildId), eq(levelingProfiles.user_id, userId)))
      .limit(1);
    let profile = row[0];
    if (!profile && guildId !== LEGACY_GUILD) {
      const legacy = await this.db
        .select()
        .from(levelingProfiles)
        .where(and(eq(levelingProfiles.guild_id, LEGACY_GUILD), eq(levelingProfiles.user_id, userId)))
        .limit(1);
      profile = legacy[0];
    }
    if (!profile) return null;
    const totalXP = Number(profile.total_xp ?? 0);
    const level = Number(profile.level ?? this.calculateLevel(totalXP));
    return { level, xp: Math.max(0, totalXP - this.xpForLevel(level)), totalXP };
  }

  public async getLeaderboard(guildId: string, limit = 10): Promise<any[]> {
    if (!this.db) return [];
    const rows = await this.db
      .select()
      .from(levelingProfiles)
      .where(eq(levelingProfiles.guild_id, guildId))
      .orderBy(desc(levelingProfiles.total_xp))
      .limit(Math.max(1, Math.min(1000, Math.floor(limit))));
    return rows.map((r: any) => ({
      id: r.user_id,
      user_id: r.user_id,
      username: '',
      level: r.level,
      xp: Math.max(0, Number(r.total_xp ?? 0) - this.xpForLevel(Number(r.level ?? 1))),
      total_xp: Number(r.total_xp ?? 0),
    }));
  }

  public async getRankPosition(guildId: string, userId: string): Promise<number> {
    if (!this.db) return 0;
    const current = await this.getLevel(guildId, userId);
    if (!current) return 0;
    const row = await this.db.get<{ value: number }>(sql`
      SELECT COUNT(*) + 1 AS value FROM leveling_profiles
      WHERE guild_id = ${guildId} AND total_xp > ${current.totalXP}
    `);
    return Number(row?.value ?? 0);
  }

  public async countRanked(guildId?: string): Promise<number> {
    if (!this.db) return 0;
    const row = guildId
      ? await this.db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM leveling_profiles WHERE guild_id = ${guildId}`)
      : await this.db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM leveling_profiles`);
    return Number(row?.value ?? 0);
  }

  public mee6InfoFor(totalXP: number, level: number): { level: number; xpInLevel: number; xpForNext: number; totalXp: number } {
    const progress = this.getLevelProgress(totalXP, level);
    return { level, xpInLevel: progress.current, xpForNext: Math.max(1, progress.needed), totalXp: totalXP };
  }

  public startVoiceSession(userId: string): void { this.voiceSessions.set(userId, Date.now()); }

  public endVoiceSession(userId: string): number {
    const joinTs = this.voiceSessions.get(userId);
    if (!joinTs) return 0;
    this.voiceSessions.delete(userId);
    return Math.floor((Date.now() - joinTs) / 60000);
  }

  public getVoiceSession(userId: string): number | null { return this.voiceSessions.get(userId) ?? null; }

  public async shutdown(): Promise<void> {
    this.voiceSessions.clear();
    this.logger.info('Leveling Service', 'Leveling system shutdown');
  }
}

export class LevelingCommands {
  private service: LevelingService;
  private logger: Logger;

  constructor(service: LevelingService, logger: Logger, _config?: LevelingConfig) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.levelCommand, this.rankCommand, this.leaderboardCommand, this.xpCommand, this.rolesCommand, this.setxpCommand];
  }

  private levelCommand: any = {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Check your level and XP progress (MEE6-style card)')
      .addUserOption((option) => option.setName('user').setDescription('User to check')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet. Chat to earn XP!', flags: MessageFlags.Ephemeral });
          return;
        }
        const rank = await this.service.getRankPosition(interaction.guildId, user.id);
        const totalRanked = await this.service.countRanked(interaction.guildId);
        const info = this.service.mee6InfoFor(data.totalXP, data.level);
        const isStaff = await this.service.isStaff(interaction.guildId, user.id).catch(() => false);
        await interaction.deferReply();
        try {
          const buffer = await rankCard.generate({
            avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
            username: interaction.guild?.members.cache.get(user.id)?.displayName ?? user.username,
            level: info.level,
            rank: rank || null,
            totalRanked,
            xpIntoLevel: info.xpInLevel,
            xpNeeded: info.xpForNext,
            totalXp: info.totalXp,
            guildName: interaction.guild?.name,
          });
          const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
          const progress = this.service.getLevelProgress(data.totalXP, data.level);
          const captionEmbed = levelingEmbed({
            user: { username: user.username, tag: user.tag, displayAvatarURL: () => user.displayAvatarURL() },
            userId: user.id,
            level: data.level,
            totalXP: data.totalXP,
            currentXP: progress.current,
            neededXP: progress.needed,
            percentage: progress.percentage,
            rank: rank || undefined,
            title: isStaff ? `🛡️ Staff — Level ${data.level}` : `📈 Level ${data.level}`,
          }).addFields(
            { name: 'Track', value: isStaff ? '🛡️ Staff' : '👥 Member', inline: true },
            { name: 'Next Level', value: `${formatNumber(this.service.xpForNextLevel(data.level))} XP`, inline: true },
            { name: 'Total XP', value: formatNumber(data.totalXP), inline: true },
          );
          await interaction.editReply({ files: [attachment], embeds: [captionEmbed] });
        } catch (cardErr) {
          this.logger.warn('Leveling Commands', 'Rank card render failed, using embed fallback', cardErr as Error);
          await interaction.editReply({
            components: [buildRankCard({
              user: user as any,
              info,
              guildName: interaction.guild?.name ?? 'this server',
              position: rank || undefined,
            })],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get level', error as Error);
        await this.replyError(interaction, 'Failed to get level data.');
      }
    },
  };

  private rankCommand: any = {
    data: new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Check your rank in the server leaderboard (MEE6-style card)')
      .addUserOption((option) => option.setName('user').setDescription('User to check')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        const rank = await this.service.getRankPosition(interaction.guildId, user.id);
        const totalRanked = await this.service.countRanked(interaction.guildId);
        const info = this.service.mee6InfoFor(data.totalXP, data.level);
        await interaction.deferReply();
        try {
          const buffer = await rankCard.generate({
            avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
            username: interaction.guild?.members.cache.get(user.id)?.displayName ?? user.username,
            level: info.level,
            rank: rank || null,
            totalRanked,
            xpIntoLevel: info.xpInLevel,
            xpNeeded: info.xpForNext,
            totalXp: info.totalXp,
            guildName: interaction.guild?.name,
          });
          await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'rank.png' })] });
        } catch (cardErr) {
          this.logger.warn('Leveling Commands', 'Rank card render failed, using embed fallback', cardErr as Error);
          await interaction.editReply({
            components: [buildRankCard({
              user: user as any,
              info,
              guildName: interaction.guild?.name ?? 'this server',
              position: rank || undefined,
            })],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get rank', error as Error);
        await this.replyError(interaction, 'Failed to get rank.');
      }
    },
  };

  private leaderboardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the server leveling leaderboard')
      .addIntegerOption((option) => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(25)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild || !interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const limit = interaction.options.getInteger('limit') ?? 10;
      try {
        const rows = await this.service.getLeaderboard(interaction.guildId, limit);
        if (rows.length === 0) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply();
        const entries = await collectEntries(this.service, interaction.guild, Math.max(limit, 10), interaction.client);
        const payload = await buildMessagePayload(entries, interaction.guild, Math.min(25, Math.max(10, limit)), '', Date.now());
        await interaction.editReply(payload).catch(async () => {
          const panel = buildLeaderboardPanel(entries.map((e: any) => ({
            userId: e.userId, username: e.username, level: e.level, totalXp: e.totalXp,
          })), interaction.guild?.name ?? 'this server');
          await interaction.editReply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        });
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get leaderboard', error as Error);
        await this.replyError(interaction, 'Failed to get leaderboard.');
      }
    },
  };

  private xpCommand: any = {
    data: new SlashCommandBuilder()
      .setName('xp')
      .setDescription('Check your current XP')
      .addUserOption((option) => option.setName('user').setDescription('User to check')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        const isStaff = await this.service.isStaff(interaction.guildId, user.id).catch(() => false);
        const progress = this.service.getLevelProgress(data.totalXP, data.level);
        const embed = brandedEmbed(BRAND.blue)
          .setTitle(`${isStaff ? '🛡️' : '✨'} XP — ${user.username}`)
          .setDescription(
            `Level **${data.level}** • **${formatNumber(progress.current)} / ${formatNumber(progress.needed)} XP**\n` +
            `Total: **${formatNumber(data.totalXP)} XP**\n` +
            `\`${progressBar(progress.percentage)}\`\n` +
            `Track: **${isStaff ? '🛡️ Staff' : '👥 Member'}**`
          )
          .setThumbnail(user.displayAvatarURL());
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get XP', error as Error);
        await interaction.reply({ content: 'Failed to get XP data.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private rolesCommand: any = {
    data: new SlashCommandBuilder().setName('levelroles').setDescription('View member & staff level gift roles'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const memberRoles = this.service.memberRoles();
      const staffRoles = this.service.staffRoles();
      const fmt = (arr: LevelRole[]) => arr.length
        ? [...arr].sort((a, b) => a.level - b.level).map((r) => `**Level ${r.level}+** — <@&${r.roleId}>${r.replaceLower ? ' *(replaces lower)*' : ''}`).join('\n')
        : 'None — configure in the dashboard under Leveling.';
      const embed = brandedEmbed(BRAND.gold)
        .setTitle('🎁 Level Gift Roles')
        .addFields(
          { name: '👥 Members', value: fmt(memberRoles).slice(0, 900) },
          { name: '🛡️ Staff', value: fmt(staffRoles).slice(0, 900) },
        )
        .setDescription('Staff and members share the same XP curve — only the gift roles differ.');
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  };

  private setxpCommand: any = {
    data: new SlashCommandBuilder()
      .setName('setxp')
      .setDescription('Set a user\'s total XP (admin only)')
      .addUserOption((option) => option.setName('user').setDescription('User to modify').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Total XP to set').setRequired(true).setMinValue(0))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild || !interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      try {
        const member = interaction.guild.members.cache.get(user.id);
        if (!member) {
          await interaction.reply({ content: 'User not found in this server.', flags: MessageFlags.Ephemeral });
          return;
        }
        const result = await this.service.setXP(interaction.guildId, user.id, amount);
        const rolesGranted = await this.service.handleLevelUpRoles(interaction.guildId, user.id, result.level);
        const roleText = rolesGranted.length ? `\nRoles granted: ${rolesGranted.map((r) => `<@&${r}>`).join(', ')}` : '';
        await interaction.reply({
          content: `✅ Set ${user.tag}'s total XP to ${amount.toLocaleString()} (Level ${result.level})${roleText}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to set XP', error as Error);
        await this.replyError(interaction, 'Failed to set XP.');
      }
    },
  };

  private async replyError(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed('Leveling', message)], flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else {
      await interaction.editReply({ content: message }).catch(() => undefined);
    }
  }
}
