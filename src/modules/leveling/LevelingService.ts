import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, TextChannel, GuildMember, Client } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq, desc } from 'drizzle-orm';
import { users, levelingHistory } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { levelingEmbed, progressBar, formatNumber, brandedEmbed, BRAND } from '../../utils/embed';
import { AttachmentBuilder } from 'discord.js';
import { rankCard } from '../../utils/rankcard';
import { buildRankCard, buildLeaderboardEmbed } from '../../utils/rankEmbeds';
import { collectEntries, buildMessagePayload } from '../../utils/liveLeaderboard';

export type XpFormula = 'linear' | 'quadratic' | 'exponential' | 'custom';

export interface LevelRole {
  /** Minimum level required to get this role */
  level: number;
  /** Role ID to grant */
  roleId: string;
  /** When true, lower tier roles are removed when this role is granted */
  replaceLower: boolean;
}

export interface LevelAnnouncementChannel {
  /** Channel ID for announcements */
  channelId: string;
  /** Only announce levels >= this value (undefined = all) */
  minLevel?: number;
  /** Only announce for members with this role (undefined = all) */
  roleId?: string;
  /** Custom announcement message template */
  messageTemplate?: string;
  /** Color for the embed (hex string) */
  color?: string;
}

export interface LevelingConfig {
  enabled: boolean;
  /** XP calculation formula */
  xpFormula: XpFormula;
  /** Base XP per level (used by linear/quadratic formulas) */
  baseXpPerLevel: number;
  /** Multiplier applied to base XP per level */
  xpMultiplier: number;
  /** Custom XP required per level: { level: requiredTotalXp } */
  customXpTable: Record<number, number>;
  /** XP gain sources */
  xpSources: {
    message: { enabled: boolean; min: number; max: number; cooldownSeconds: number };
    voice: { enabled: boolean; perMinuteMin: number; perMinuteMax: number; cooldownSeconds: number };
    command: { enabled: boolean; amount: number; cooldownSeconds: number };
  };
  /** XP multipliers */
  xpMultipliers: {
    weekend: number;
    booster: number;
    role: Record<string, number>;
  };
  /** Channel blacklist (no XP earned here) */
  noXpChannels: string[];
  /** Channel whitelist (XP only earned here, empty = all channels) */
  xpChannelWhitelist: string[];
  /** Role-based gift roles: level -> role config (member track, legacy alias) */
  levelRoles: LevelRole[];
  /** Announcement channels (member track, legacy alias) */
  announcementChannels: LevelAnnouncementChannel[];
  /** Roles that mark a member as staff (in addition to Manages/Kicks/Bans/Admin perms) */
  staffRoleIds: string[];
  /** Staff-track gift roles (separate from member roles) */
  staffLevelRoles: LevelRole[];
  /** Staff-track announcement channels (separate from member channels) */
  staffAnnouncementChannels: LevelAnnouncementChannel[];
  /** Member-track aliases (kept in sync with levelRoles / announcementChannels) */
  memberLevelRoles: LevelRole[];
  memberAnnouncementChannels: LevelAnnouncementChannel[];
  /** Default color for announcements */
  defaultColor: string;
  /** When true, XP is not earned by bots */
  ignoreBots: boolean;
  /** Max level cap */
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
  xpMultipliers: {
    weekend: 1.5,
    booster: 2.0,
    role: {},
  },
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

export class LevelingService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private client: Client | null = null;
  private config: LevelingConfig;
  private xpCooldowns: Map<string, number> = new Map();
  private voiceSessions: Map<string, number> = new Map();

  constructor(logger: Logger, config?: Partial<LevelingConfig>) {
    this.logger = logger;
    this.config = { ...DEFAULT_LEVELING_CONFIG, ...config } as LevelingConfig;
    this.syncLegacyAliases();
  }

  /**
   * Backward compatibility: old configs only set levelRoles /
   * announcementChannels. Mirror them into the member-track aliases so
   * the staff/member logic can treat both shapes the same.
   * If member* is already set, it wins and legacy fields are synced from it.
   */
  private syncLegacyAliases(): void {
    const c = this.config as any;
    // staffRoleIds may arrive as a single string from env/dashboard
    if (typeof c.staffRoleIds === 'string') {
      try { c.staffRoleIds = JSON.parse(c.staffRoleIds); } catch { c.staffRoleIds = c.staffRoleIds ? [c.staffRoleIds] : []; }
    }
    if (!Array.isArray(c.staffRoleIds)) c.staffRoleIds = [];
    if (!Array.isArray(c.staffLevelRoles)) c.staffLevelRoles = Array.isArray(c.staffLevelRoles) ? c.staffLevelRoles : [];
    if (!Array.isArray(c.staffAnnouncementChannels)) c.staffAnnouncementChannels = [];
    if (!Array.isArray(c.memberLevelRoles) || c.memberLevelRoles.length === 0) {
      c.memberLevelRoles = Array.isArray(c.levelRoles) ? [...c.levelRoles] : [];
    }
    if (!Array.isArray(c.memberAnnouncementChannels) || c.memberAnnouncementChannels.length === 0) {
      c.memberAnnouncementChannels = Array.isArray(c.announcementChannels) ? [...c.announcementChannels] : [];
    }
    // Keep legacy fields pointing at the member track (single source of truth).
    c.levelRoles = c.memberLevelRoles;
    c.announcementChannels = c.memberAnnouncementChannels;
  }

  /** Public accessor used by the dashboard / WebServer. */
  public getConfig(): LevelingConfig {
    return this.config;
  }

  /**
   * Keep legacy aliases in sync after a direct mutation of this.config
   * (e.g. dashboard deep-assign). Call this from WebServer after saving.
   */
  public refreshLegacyAliases(): void {
    this.syncLegacyAliases();
  }

  /** Member-track gift roles. */
  public memberRoles(): LevelRole[] {
    return (this.config.memberLevelRoles?.length ? this.config.memberLevelRoles : this.config.levelRoles) ?? [];
  }

  /** Staff-track gift roles. */
  public staffRoles(): LevelRole[] {
    return this.config.staffLevelRoles ?? [];
  }

  /** Member-track announcement channels. */
  public memberChannels(): LevelAnnouncementChannel[] {
    return (this.config.memberAnnouncementChannels?.length ? this.config.memberAnnouncementChannels : this.config.announcementChannels) ?? [];
  }

  /** Staff-track announcement channels. */
  public staffChannels(): LevelAnnouncementChannel[] {
    return this.config.staffAnnouncementChannels ?? [];
  }

  /**
   * A member is staff if they hold any configured staff role, or have a
   * moderation-capable permission (ManageMessages/Kick/Ban/Admin).
   * The permission fallback keeps servers working before any staff role
   * is configured.
   */
  public isStaffMember(member: GuildMember | null | undefined): boolean {
    if (!member) return false;
    const staffIds = this.config.staffRoleIds ?? [];
    if (staffIds.length > 0) {
      for (const rid of staffIds) {
        if (rid && member.roles.cache.has(rid)) return true;
      }
    }
    try {
      const perms = member.permissions as any;
      if (perms && typeof perms.has === 'function') {
        if (
          perms.has('ManageMessages') ||
          perms.has('KickMembers') ||
          perms.has('BanMembers') ||
          perms.has('Administrator') ||
          perms.has('ManageGuild')
        ) return true;
      } else if (perms && typeof perms === 'object') {
        // bitfield-style fallback
        const MANAGE_MSG = 1n << 13n;
        const KICK = 1n << 1n;
        const BAN = 1n << 2n;
        const ADMIN = 1n << 3n;
        const MANAGE_GUILD = 1n << 5n;
        const bf: bigint = (perms as any).bitfield ?? 0n;
        if ((bf & (MANAGE_MSG | KICK | BAN | ADMIN | MANAGE_GUILD)) !== 0n) return true;
      }
    } catch { /* best-effort */ }
    return false;
  }

  /** Resolve staff status for any member, fetching when needed. */
  public async isStaff(guildId: string, userId: string, member?: GuildMember | null): Promise<boolean> {
    if (member) return this.isStaffMember(member);
    if (!this.client) return false;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    try {
      const cached = guild.members.cache.get(userId);
      if (cached) return this.isStaffMember(cached);
      const fetched = await guild.members.fetch(userId).catch(() => null);
      return this.isStaffMember(fetched);
    } catch {
      return false;
    }
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Leveling Service', `Leveling system initialized (formula: ${this.config.xpFormula}, max level: ${this.config.maxLevel})`);
  }

  /**
   * Calculate the total XP required to reach a given level.
   */
  public xpForLevel(level: number): number {
    if (level <= 1) return 0;

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
  public calculateLevel(totalXP: number): number {
    let level = 1;
    for (let lvl = 2; lvl <= this.config.maxLevel; lvl++) {
      const required = this.xpForLevel(lvl);
      if (totalXP >= required) {
        level = lvl;
      } else {
        break;
      }
    }
    return Math.min(level, this.config.maxLevel);
  }

  /**
   * Get XP needed for next level.
   */
  public xpForNextLevel(currentLevel: number): number {
    return this.xpForLevel(currentLevel + 1);
  }

  /**
   * Get progress within current level (0-100%).
   */
  public getLevelProgress(totalXP: number, level: number): { current: number; needed: number; percentage: number } {
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
  public getXpMultiplier(member?: GuildMember): number {
    let multiplier = 1;

    // Weekend multiplier
    const day = new Date().getDay();
    if (day === 0 || day === 6) {
      multiplier *= this.config.xpMultipliers.weekend;
    }

    // Booster role
    if (member && member.roles.cache.some((r: any) => r.premiumSubscriberRole)) {
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
  public canEarnXp(channelId: string): boolean {
    if (this.config.noXpChannels.includes(channelId)) return false;
    if (this.config.xpChannelWhitelist.length > 0 && !this.config.xpChannelWhitelist.includes(channelId)) {
      return false;
    }
    return true;
  }

  /**
   * Add XP from a message source.
   */
  public async addXpFromMessage(guildId: string, userId: string, channelId: string, member?: GuildMember): Promise<LevelUpResult | null> {
    if (!this.config.enabled) return null;
    if (!this.config.xpSources.message.enabled) return null;
    if (!this.canEarnXp(channelId)) return null;

    const rawXp = Math.floor(
      Math.random() * (this.config.xpSources.message.max - this.config.xpSources.message.min + 1) +
        this.config.xpSources.message.min
    );
    const multiplier = this.getXpMultiplier(member);
    const xpAmount = Math.floor(rawXp * multiplier);

    return this.addXP(guildId, userId, xpAmount, 'message');
  }

  /**
   * Add XP from voice activity (per tick).
   */
  public async addXpFromVoice(guildId: string, userId: string, member?: GuildMember): Promise<LevelUpResult | null> {
    if (!this.config.enabled) return null;
    if (!this.config.xpSources.voice.enabled) return null;

    const rawXp = Math.floor(
      Math.random() * (this.config.xpSources.voice.perMinuteMax - this.config.xpSources.voice.perMinuteMin + 1) +
        this.config.xpSources.voice.perMinuteMin
    );
    const multiplier = this.getXpMultiplier(member);
    const xpAmount = Math.floor(rawXp * multiplier);

    return this.addXP(guildId, userId, xpAmount, 'voice');
  }

  /**
   * Core XP addition logic with cooldown, level calculation, role granting, and announcements.
   */
  public async addXP(
    guildId: string,
    userId: string,
    xpAmount: number,
    source: string = 'manual'
  ): Promise<LevelUpResult | null> {
    if (!this.db) throw new Error('Database not connected');

    const cooldownKey = `${guildId}-${userId}-${source}`;
    const now = Date.now();
    const cooldownConfig = this.getCooldownConfig(source);
    const lastXp = this.xpCooldowns.get(cooldownKey);
    if (lastXp && now - lastXp < cooldownConfig * 1000) {
      return { leveledUp: false, oldLevel: 0, newLevel: 0, xpGained: 0, totalXP: 0, isStaff: false, rolesGranted: [], announcementChannelId: null };
    }
    this.xpCooldowns.set(cooldownKey, now);

    const userResult = await this.db.select().from(users).where(eq(users.id, userId));
    let user = userResult[0];

    if (!user) {
      await this.db.insert(users).values({
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
      } as any);
      user = { id: userId, xp: xpAmount, level: 1, total_xp: xpAmount } as any;
    }

    const oldLevel = (user as any).level || 1;
    const currentXp = ((user as any).xp || 0) + xpAmount;
    const totalXp = ((user as any).total_xp || 0) + xpAmount;
    const newLevel = this.calculateLevel(totalXp);

    const leveledUp = newLevel > oldLevel;

    await this.db.update(users)
      .set({ xp: currentXp, level: newLevel, total_xp: totalXp, updated_at: new Date() })
      .where(eq(users.id, userId));

    const isStaff = await this.isStaff(guildId, userId).catch(() => false);

    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: xpAmount,
      totalXP: totalXp,
      isStaff,
      rolesGranted: [],
      announcementChannelId: null,
    };

    if (leveledUp) {
      await this.db.insert(levelingHistory).values({
        id: `lvl_${Date.now()}`,
        guild_id: guildId,
        user_id: userId,
        old_level: oldLevel,
        new_level: newLevel,
        xp_gained: xpAmount,
      } as any);

      const rolesGranted = await this.handleLevelUpRoles(guildId, userId, newLevel, isStaff);
      result.rolesGranted = rolesGranted;

      const channelId = this.selectAnnouncementChannel(guildId, newLevel, userId, isStaff);
      result.announcementChannelId = channelId;

      if (channelId && this.client) {
        await this.sendLevelUpAnnouncement(channelId, userId, newLevel, oldLevel, totalXp, isStaff);
      }
    }

    return result;
  }

  private getCooldownConfig(source: string): number {
    switch (source) {
      case 'message': return this.config.xpSources.message.cooldownSeconds;
      case 'voice': return this.config.xpSources.voice.cooldownSeconds;
      case 'command': return this.config.xpSources.command.cooldownSeconds;
      default: return this.config.xpSources.message.cooldownSeconds;
    }
  }

  /**
   * Handle role granting based on the track (staff vs member).
   * Staff and members each have their OWN gift-role pool; replacement
   * only happens inside the same track. XP/level math is identical.
   */
  public async handleLevelUpRoles(
    guildId: string,
    userId: string,
    newLevel: number,
    isStaff?: boolean,
  ): Promise<string[]> {
    if (!this.client) return [];

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];

    let member: GuildMember | null = null;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return [];
    }
    if (!member) return [];

    const staff = isStaff ?? this.isStaffMember(member);
    const pool = staff ? this.staffRoles() : this.memberRoles();
    const trackLabel = staff ? 'staff' : 'member';

    const rolesGranted: string[] = [];
    const rolesToRemove: string[] = [];

    // Find all roles this member now qualifies for (track-scoped)
    const eligibleRoles = pool
      .filter(r => newLevel >= r.level)
      .sort((a, b) => a.level - b.level);

    // Determine which roles to grant
    for (const roleConfig of eligibleRoles) {
      const role = guild.roles.cache.get(roleConfig.roleId);
      if (!role) continue;
      if (member.roles.cache.has(role.id)) continue; // Already has it

      // If this role replaces lower tiers, mark those for removal (same track only)
      if (roleConfig.replaceLower) {
        const lowerRoles = pool
          .filter(r => r.level < roleConfig.level && r.roleId !== roleConfig.roleId)
          .map(r => r.roleId);
        rolesToRemove.push(...lowerRoles.filter(rid => member.roles.cache.has(rid)));
      }

      try {
        await member.roles.add(role.id, `Level ${newLevel} ${trackLabel} reward`);
        rolesGranted.push(role.id);
        this.logger.info('Leveling Service', `Granted ${trackLabel} role ${role.name} (level ${roleConfig.level}) to ${member.user.tag}`);
      } catch (err) {
        this.logger.error('Leveling Service', `Failed to grant ${trackLabel} role ${roleConfig.roleId} to ${member.user.tag}`, err as Error);
      }
    }

    // Remove lower tier roles after granting (same track only)
    if (rolesToRemove.length > 0) {
      const uniqueRemovals = [...new Set(rolesToRemove)];
      try {
        await member.roles.remove(uniqueRemovals, 'Replaced by higher level role');
        this.logger.info('Leveling Service', `Removed lower tier ${trackLabel} roles from ${member.user.tag}: ${uniqueRemovals.join(', ')}`);
      } catch (err) {
        this.logger.error('Leveling Service', `Failed to remove roles from ${member.user.tag}`, err as Error);
      }
    }

    return rolesGranted;
  }

  /**
   * Sync all roles for a member based on their current level (useful on rejoin).
   */
  public async syncMemberRoles(guildId: string, userId: string): Promise<void> {
    if (!this.db || !this.client) return;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    let member: GuildMember | null = null;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return;
    }
    if (!member) return;

    const data = await this.getLevel(guildId, userId);
    if (!data) return;

    await this.handleLevelUpRoles(guildId, userId, data.level);
  }

  /**
   * Select the announcement channel for a level up, scoped to the track.
   * Staff use staffAnnouncementChannels; members use memberAnnouncementChannels.
   * Falls back to the other track only when the preferred track is empty,
   * so a server that only configures one track still announces.
   * Priority inside a track: exact tier > role > minLevel > default.
   */
  public selectAnnouncementChannel(guildId: string, newLevel: number, userId: string, isStaff?: boolean): string | null {
    let member: GuildMember | null = null;
    if (this.client) {
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) member = guild.members.cache.get(userId) ?? null;
    }
    // Resolve staff status when the caller didn't supply it (e.g. older callers)
    const staff = isStaff ?? (member ? this.isStaffMember(member) : false);

    const pick = (channels: LevelAnnouncementChannel[]): string | null => {
      if (!channels.length) return null;
      const exactTier = channels
        .filter((c) => c.minLevel === newLevel && c.messageTemplate)
        .sort((a, b) => (b.messageTemplate?.length ?? 0) - (a.messageTemplate?.length ?? 0))[0];
      if (exactTier) return exactTier.channelId;
      if (member) {
        for (const ch of channels) {
          if (ch.roleId && member.roles.cache.has(ch.roleId)) {
            if (ch.minLevel === undefined || newLevel >= ch.minLevel) return ch.channelId;
          }
        }
      }
      const minLevelMatches = channels
        .filter((c) => c.minLevel !== undefined && newLevel >= c.minLevel)
        .sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0));
      if (minLevelMatches[0]) return minLevelMatches[0].channelId;
      const defaultChannel = channels.find((c) => c.minLevel === undefined && !c.roleId);
      if (defaultChannel) return defaultChannel.channelId;
      return channels[0]?.channelId ?? null;
    };

    const primary = staff ? this.staffChannels() : this.memberChannels();
    const secondary = staff ? this.memberChannels() : this.staffChannels();
    // Only fall back when the primary track is unconfigured (backward compat:
    // legacy configs only set the member track).
    return pick(primary) ?? (primary.length === 0 ? pick(secondary) : null);
  }

  /**
   * Send a level-up announcement embed (track-aware).
   */
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
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') return;

    const allChannels = [...this.staffChannels(), ...this.memberChannels()];
    const channelConfig = allChannels.find(c => c.channelId === channelId);

    const progress = this.getLevelProgress(totalXP, newLevel);
    const color = channelConfig?.color ?? this.config.defaultColor;

    const staff = isStaff ?? false;
    const template = channelConfig?.messageTemplate ||
      (staff
        ? '🛡️ Staff {user} reached **level {level}**!'
        : '🎉 Congratulations {user}, you have reached **level {level}**!');

    const content = template
      .replace(/\{user\}/g, `<@${userId}>`)
      .replace(/\{username\}/g, '{username}')
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
      } catch {
        user = { username: 'Unknown', tag: 'Unknown#0000', id: userId, displayAvatarURL: () => '' } as any;
      }
      const finalContent = content.replace(/\{username\}/g, (user as any).username ?? 'Unknown');

      const embed = levelingEmbed({
        user: {
          username: (user as any).username ?? 'Unknown',
          tag: (user as any).tag,
          displayAvatarURL: (user as any).displayAvatarURL?.bind(user),
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
          `${finalContent}\n\n\`${progressBar(progress.percentage)}\`\n` +
          `\`${formatNumber(progress.current)} / ${formatNumber(progress.needed)} XP\` • Total: **${formatNumber(totalXP)}**` +
          (staff ? '\n**Track:** 🛡️ Staff' : '\n**Track:** 👥 Member')
        );
      if (color && color !== this.config.defaultColor) embed.setColor(color as any);

      await (channel as TextChannel).send({
        embeds: [embed],
        allowedMentions: { users: [userId] },
      });
    } catch (err) {
      this.logger.error('Leveling Service', `Failed to send level-up announcement to channel ${channelId}`, err as Error);
    }
  }

  public async getLevel(_guildId: string, userId: string): Promise<{ level: number; xp: number; totalXP: number } | null> {
    if (!this.db) return null;
    const result = await this.db.select().from(users).where(eq(users.id, userId));
    if (!result[0]) return null;
    const u = result[0];
    return {
      level: u.level || 1,
      xp: u.xp || 0,
      totalXP: u.total_xp || 0,
    };
  }

  public async getLeaderboard(_guildId: string, limit: number = 10): Promise<any[]> {
    if (!this.db) return [];
    return this.db.select().from(users).orderBy(desc(users.total_xp)).limit(limit);
  }

  public async getRankPosition(guildId: string, userId: string): Promise<number> {
    const rows = await this.getLeaderboard(guildId, 100000);
    const idx = rows.findIndex((r: any) => r.id === userId);
    return idx >= 0 ? idx + 1 : 0;
  }

  public async countRanked(): Promise<number> {
    if (!this.db) return 0;
    const rows = await this.db.select().from(users);
    return rows.filter((r: any) => (r.total_xp ?? 0) > 0).length;
  }

  /** MEE6-style LevelInfo derived from total XP using Sukuna's own level thresholds. */
  public mee6InfoFor(totalXP: number, level: number): { level: number; xpInLevel: number; xpForNext: number; totalXp: number } {
    // Use Sukuna's configured thresholds for the span, not MEE6's 5L² formula —
    // the card still looks MEE6 but numbers stay consistent with the database.
    const progress = this.getLevelProgress(totalXP, level);
    const span = progress.needed > 0 ? progress.needed : 1;
    return {
      level,
      xpInLevel: progress.current,
      xpForNext: span,
      totalXp: totalXP,
    };
  }

  /**
   * Voice session tracking - call when member joins voice.
   */
  public startVoiceSession(userId: string): void {
    this.voiceSessions.set(userId, Date.now());
  }

  /**
   * Voice session tracking - call when member leaves voice. Returns minutes spent.
   */
  public endVoiceSession(userId: string): number {
    const joinTs = this.voiceSessions.get(userId);
    if (!joinTs) return 0;
    const minutes = Math.floor((Date.now() - joinTs) / 60000);
    this.voiceSessions.delete(userId);
    return minutes;
  }

  /**
   * Get voice session start time for a user.
   */
  public getVoiceSession(userId: string): number | null {
    return this.voiceSessions.get(userId) ?? null;
  }

  public async shutdown(): Promise<void> {
    this.xpCooldowns.clear();
    this.voiceSessions.clear();
    this.logger.info('Leveling Service', 'Leveling system shutdown');
  }
}

export class LevelingCommands {
  private service: LevelingService;
  private logger: Logger;
  private config: LevelingConfig;

  constructor(service: LevelingService, logger: Logger, config: LevelingConfig) {
    this.service = service;
    this.logger = logger;
    this.config = config;
  }

  public getCommands(): any[] {
    return [this.levelCommand, this.rankCommand, this.leaderboardCommand, this.xpCommand, this.rolesCommand, this.setxpCommand];
  }

  private levelCommand: any = {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Check your level and XP progress (MEE6-style card)')
      .addUserOption(option =>
        option.setName('user').setDescription('User to check')
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId!, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet. Chat to earn XP!', flags: MessageFlags.Ephemeral });
          return;
        }

        const rank = await this.service.getRankPosition(interaction.guildId!, user.id);
        const totalRanked = await this.service.countRanked();
        const info = this.service.mee6InfoFor(data.totalXP, data.level);
        const isStaff = await this.service.isStaff(interaction.guildId!, user.id).catch(() => false);

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
          const progress = this.service.getLevelProgress(data.totalXP, data.level);
          const embed = buildRankCard({
            user: user as any,
            info,
            guildName: interaction.guild?.name ?? 'this server',
            position: rank || undefined,
          });
          void progress;
          await interaction.editReply({ embeds: [embed] });
        }
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get level', error as Error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Failed to get level data.', flags: MessageFlags.Ephemeral });
        } else {
          await interaction.editReply({ content: 'Failed to get level data.' }).catch(() => undefined);
        }
      }
    },
  };

  private rankCommand: any = {
    data: new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Check your rank in the server leaderboard (MEE6-style card)')
      .addUserOption(option =>
        option.setName('user').setDescription('User to check')
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId!, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        const rank = await this.service.getRankPosition(interaction.guildId!, user.id);
        const totalRanked = await this.service.countRanked();
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
          const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
          await interaction.editReply({ files: [attachment] });
        } catch (cardErr) {
          this.logger.warn('Leveling Commands', 'Rank card render failed, using embed fallback', cardErr as Error);
          const embed = buildRankCard({
            user: user as any,
            info,
            guildName: interaction.guild?.name ?? 'this server',
            position: rank || undefined,
          });
          await interaction.editReply({ embeds: [embed] });
        }
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get rank', error as Error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Failed to get rank.', flags: MessageFlags.Ephemeral });
        } else {
          await interaction.editReply({ content: 'Failed to get rank.' }).catch(() => undefined);
        }
      }
    },
  };

  private leaderboardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the server leveling leaderboard (MEE6-style)')
      .addIntegerOption(option =>
        option.setName('limit').setDescription('Number of entries (default 25, max 25)').setMinValue(1).setMaxValue(25)
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const limit = interaction.options.getInteger('limit') ?? 25;
      try {
        if (!interaction.guild) {
          await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
          return;
        }
        const rows = await this.service.getLeaderboard(interaction.guildId!, limit);
        if (rows.length === 0) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }

        await interaction.deferReply();

        // Reference design: podium image on TOP + zones text below (like MEE6 / L7aj live board).
        // collectEntries() resolves avatars + progress; buildMessagePayload()
        // inlines the podium PNG at the top of the embed description.
        try {
          const entries = await collectEntries(this.service, interaction.guild, Math.max(limit, 10), interaction.client);
          const payload = await buildMessagePayload(
            entries,
            interaction.guild,
            Math.min(25, Math.max(10, limit)),
            '',
            Date.now(),
          );
          await interaction.editReply(payload);
        } catch (boardErr) {
          this.logger.warn('Leveling Commands', 'Leaderboard board render failed, using fallback image', boardErr as Error);
          // Fallback: simple rows image, then text embed
          const entries = await Promise.all(
            rows.map(async (row: any) => {
              let displayName = row.username || 'Unknown user';
              let avatarUrl = '';
              let fetched: any = interaction.client.users.cache.get(row.id);
              if (!fetched) {
                try { fetched = await interaction.client.users.fetch(row.id); } catch { fetched = undefined; }
              }
              if (fetched) {
                displayName = interaction.guild?.members.cache.get(row.id)?.displayName ?? fetched.globalName ?? fetched.username ?? displayName;
                avatarUrl = fetched.displayAvatarURL({ extension: 'png', size: 128 });
              }
              return {
                userId: row.id,
                username: displayName,
                avatarUrl,
                level: row.level || 1,
                totalXp: row.total_xp || 0,
              };
            }),
          );
          const embed = buildLeaderboardEmbed(
            entries.map((e: any) => ({
              userId: e.userId,
              username: e.username,
              level: e.level,
              totalXp: e.totalXp,
            })),
            interaction.guild?.name ?? 'this server',
          );
          await interaction.editReply({ embeds: [embed] });
        }
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to get leaderboard', error as Error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Failed to get leaderboard.', flags: MessageFlags.Ephemeral });
        } else {
          await interaction.editReply({ content: 'Failed to get leaderboard.' }).catch(() => undefined);
        }
      }
    },
  };

  private xpCommand: any = {
    data: new SlashCommandBuilder()
      .setName('xp')
      .setDescription('Check your current XP')
      .addUserOption(option =>
        option.setName('user').setDescription('User to check')
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const data = await this.service.getLevel(interaction.guildId!, user.id);
        if (!data) {
          await interaction.reply({ content: 'No leveling data found yet.', flags: MessageFlags.Ephemeral });
          return;
        }

        const isStaff = await this.service.isStaff(interaction.guildId!, user.id).catch(() => false);
        const progress = this.service.getLevelProgress(data.totalXP, data.level);
        const embed = brandedEmbed(BRAND.blue)
          .setTitle(`${isStaff ? '🛡️' : '✨'} XP — ${user.username}`)
          .setDescription(
            `Level **${data.level}** • **${formatNumber(data.xp)} XP**\n` +
            `Total: **${formatNumber(data.totalXP)} XP**\n` +
            `\`${progressBar(progress.percentage)}\` ${formatNumber(progress.current)} / ${formatNumber(progress.needed)}\n` +
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
    data: new SlashCommandBuilder()
      .setName('levelroles')
      .setDescription('View member & staff level gift roles'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const cfg: any = (this.service as any).config ?? this.config;
      const memberRoles: any[] = (this.service as any).memberRoles?.() ?? cfg.memberLevelRoles ?? cfg.levelRoles ?? [];
      const staffRoles: any[] = (this.service as any).staffRoles?.() ?? cfg.staffLevelRoles ?? [];

      const fmt = (arr: any[]) => arr.length
        ? [...arr].sort((a, b) => a.level - b.level).map(r => `**Level ${r.level}+** — <@&${r.roleId}>${r.replaceLower ? ' *(replaces lower)*' : ''}`).join('\n')
        : 'None — configure in the dashboard under Leveling.';

      const embed = brandedEmbed(BRAND.gold)
        .setTitle('🎁 Level Gift Roles')
        .addFields(
          { name: '👥 Members', value: fmt(memberRoles).slice(0, 900) },
          { name: '🛡️ Staff', value: fmt(staffRoles).slice(0, 900) },
        )
        .setDescription('Staff and members share the same XP curve — only the gift roles differ. Staff announcements go to the staff channel.');

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  };

  private setxpCommand: any = {
    data: new SlashCommandBuilder()
      .setName('setxp')
      .setDescription('Set a user\'s XP (admin only)')
      .addUserOption(option =>
        option.setName('user').setDescription('User to modify').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('amount').setDescription('XP amount to set').setRequired(true).setMinValue(0)
      )
      .setDefaultMemberPermissions(0n),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild || !interaction.guild.members) {
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

        const newLevel = this.service.calculateLevel(amount);

        await this.dbSetUserXp(interaction.guildId!, user.id, amount, newLevel);

        const rolesGranted = await this.service.handleLevelUpRoles(interaction.guildId!, user.id, newLevel);

        const roleText = rolesGranted.length > 0
          ? `\nRoles granted: ${rolesGranted.map(r => `<@&${r}>`).join(', ')}`
          : '';

        await interaction.reply({
          content: `✅ Set ${user.tag}'s XP to ${amount.toLocaleString()} (Level ${newLevel})${roleText}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        this.logger.error('Leveling Commands', 'Failed to set XP', error as Error);
        await interaction.reply({ content: 'Failed to set XP.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private async dbSetUserXp(_guildId: string, userId: string, xp: number, level: number): Promise<void> {
    if (!this.db) return;

    const existing = await this.db.select().from(users).where(eq(users.id, userId));
    if (existing[0]) {
      await this.db.update(users)
        .set({ xp, level, total_xp: xp, updated_at: new Date() })
        .where(eq(users.id, userId));
    } else {
      await this.db.insert(users).values({
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
      } as any);
    }
  }

  private get db() {
    return (this.service as any).db;
  }
}
