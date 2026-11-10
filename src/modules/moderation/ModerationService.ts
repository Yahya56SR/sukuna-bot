import { Client, Guild, GuildMember } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { and, desc, eq } from 'drizzle-orm';
import { warnings, moderationCases, guildSettings } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { moderationEmbed } from '../../utils/embed';
import { newId } from '../../utils/id';

export interface ModerationConfig {
  enabled: boolean;
  logChannelId: string;
  defaultReason: string;
  /** When set, warns are counted and the member is auto-muted at this count. 0 = off. */
  warnThreshold: number;
  /** Auto-mute duration (minutes) when `warnThreshold` is reached. */
  warnThresholdDuration: number;
}

export interface ModerationCase {
  id: string;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  type: string;
  reason: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  created_at: Date;
}

export interface WarningRecord {
  id: string;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string;
  active: boolean;
  removed_at: Date | null;
  removed_by: string | null;
  created_at: Date;
}

type ModerationAction = 'warn' | 'kick' | 'ban' | 'mute' | 'unmute' | 'unban';

export class ModerationService {
  private client: Client | null = null;
  private logger: Logger;
  private db: DrizzleDb | null = null;
  public config: ModerationConfig = {
    enabled: true,
    logChannelId: '',
    defaultReason: '',
    warnThreshold: 0,
    warnThresholdDuration: 60,
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.logger.info('Moderation Service', 'Moderation system initialized');
  }

  private resolveReason(reason?: string): string {
    const r = (reason ?? '').trim();
    return r || this.config.defaultReason || 'No reason provided';
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
  }

  /** Per-guild kill switch: an explicit moderation_enabled=false row in guild_settings wins. */
  private async assertGuildEnabled(guildId: string): Promise<void> {
    if (!this.db) return;
    try {
      const rows = await this.db
        .select({ moderation_enabled: guildSettings.moderation_enabled })
        .from(guildSettings)
        .where(eq(guildSettings.guild_id, guildId))
        .limit(1);
      const row = rows[0];
      if (row && row.moderation_enabled === false) {
        throw new Error('Moderation is disabled for this server (guild settings).');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('disabled for this server')) throw error;
      // Settings unreadable — fail open rather than blocking moderation.
    }
  }

  private getGuild(guildId: string): Guild {
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error('Server not found.');
    return guild;
  }

  private async fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    const cached = guild.members.cache.get(userId);
    if (cached) return cached;
    return guild.members.fetch(userId).catch(() => null);
  }

  /**
   * Validates that `moderatorId` may act on `userId`:
   * - no self-moderation
   * - neither the guild owner nor the bot may be targeted
   * - the moderator must outrank the target (unless they are the owner)
   * - the bot itself must outrank the target
   */
  private async assertCanAct(
    guild: Guild,
    moderatorId: string,
    userId: string,
    action: ModerationAction,
    requireMember: boolean
  ): Promise<GuildMember | null> {
    if (moderatorId === userId) throw new Error(`You cannot ${action} yourself.`);
    if (userId === guild.ownerId) throw new Error(`Cannot ${action} the server owner.`);
    if (this.client?.user && userId === this.client.user.id) throw new Error(`Cannot ${action} the bot.`);

    const [moderator, target] = await Promise.all([
      this.fetchMember(guild, moderatorId),
      this.fetchMember(guild, userId),
    ]);

    if (!moderator) throw new Error('Could not resolve your membership in this server.');
    if (!target) {
      if (requireMember) throw new Error('User not found in this server.');
      return null;
    }

    const isOwner = moderator.id === guild.ownerId;
    if (!isOwner && moderator.roles.highest.position <= target.roles.highest.position) {
      throw new Error('You cannot moderate a member with an equal or higher role.');
    }

    const me = guild.members.me;
    if (me && me.id !== guild.ownerId && me.roles.highest.position <= target.roles.highest.position) {
      throw new Error('I do not have a high enough role to moderate this member.');
    }

    return target;
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest}m` : ''}`;
  }

  private async recordCase(params: {
    id: string;
    guildId: string;
    userId: string;
    moderatorId: string;
    type: ModerationAction;
    reason: string;
    expiresAt?: Date | null;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.insert(moderationCases).values({
      id: params.id,
      guild_id: params.guildId,
      user_id: params.userId,
      moderator_id: params.moderatorId,
      type: params.type,
      reason: params.reason,
      expires_at: params.expiresAt ?? null,
    } as any);
  }

  private async logAction(params: {
    guildId: string;
    action: ModerationAction;
    caseId: string;
    target: { id: string; username: string; tag?: string | undefined };
    moderator: { id: string; username: string; tag?: string | undefined };
    reason: string;
    duration?: string;
  }): Promise<void> {
    const channelId = this.config.logChannelId;
    if (!channelId || !this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !('send' in channel)) return;
      const embed = moderationEmbed({
        action: params.action,
        target: params.target,
        moderator: params.moderator,
        reason: params.reason,
        caseId: params.caseId,
        duration: params.duration,
      });
      await (channel as unknown as { send: (o: unknown) => Promise<unknown> }).send({ embeds: [embed] });
    } catch (error) {
      this.logger.warn('Moderation Service', `Failed to send moderation log: ${(error as Error).message}`);
    }
  }

  public async warn(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    this.assertEnabled();
    await this.assertGuildEnabled(guildId);
    if (!this.db) throw new Error('Database not connected');
    const guild = this.getGuild(guildId);
    const target = await this.assertCanAct(guild, moderatorId, userId, 'warn', true);
    const finalReason = this.resolveReason(reason);
    const caseId = newId('warn');
    const moderator = await this.fetchMember(guild, moderatorId);

    await this.db.insert(warnings).values({
      id: caseId,
      guild_id: guildId,
      user_id: userId,
      moderator_id: moderatorId,
      reason: finalReason,
      active: true,
    } as any);
    await this.recordCase({
      id: caseId, guildId, userId, moderatorId, type: 'warn', reason: finalReason,
    });

    await this.logAction({
      guildId,
      action: 'warn',
      caseId,
      target: { id: userId, username: target?.user.username ?? userId, tag: target?.user.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
    });

    this.logger.info('Moderation Service', `Warned user ${userId} in guild ${guildId}: ${finalReason}`);

    // Optional automatic escalation.
    if (this.config.warnThreshold > 0) {
      const active = await this.getWarnings(guildId, userId);
      if (active.length >= this.config.warnThreshold && target?.moderatable) {
        try {
          await this.mute(
            guildId,
            userId,
            moderatorId,
            `Automatic mute after ${active.length} warnings`,
            this.config.warnThresholdDuration
          );
        } catch (error) {
          this.logger.warn('Moderation Service', `Auto-mute escalation failed: ${(error as Error).message}`);
        }
      }
    }

    return caseId;
  }

  public async kick(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    this.assertEnabled();
    await this.assertGuildEnabled(guildId);
    const guild = this.getGuild(guildId);
    const target = await this.assertCanAct(guild, moderatorId, userId, 'kick', true);
    if (!target) throw new Error('User not found in this server.');
    if (!target.kickable) throw new Error('Cannot kick this user (missing permissions or higher role).');

    const finalReason = this.resolveReason(reason);
    const caseId = newId('kick');
    const moderator = await this.fetchMember(guild, moderatorId);

    await target.kick(finalReason);
    await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'kick', reason: finalReason });
    await this.logAction({
      guildId, action: 'kick', caseId,
      target: { id: userId, username: target.user.username, tag: target.user.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
    });

    this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${finalReason}`);
    return caseId;
  }

  public async ban(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string,
    deleteMessageDays: number = 0
  ): Promise<string> {
    this.assertEnabled();
    await this.assertGuildEnabled(guildId);
    const guild = this.getGuild(guildId);
    await this.assertCanAct(guild, moderatorId, userId, 'ban', false);

    const finalReason = this.resolveReason(reason);
    const days = Math.max(0, Math.min(7, Math.floor(deleteMessageDays) || 0));
    const caseId = newId('ban');
    const moderator = await this.fetchMember(guild, moderatorId);
    const targetUser = await this.client?.users.fetch(userId).catch(() => null);

    await guild.members.ban(userId, {
      reason: `Case ${caseId}: ${finalReason}`,
      deleteMessageSeconds: days * 24 * 60 * 60,
    });
    await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'ban', reason: finalReason });
    await this.logAction({
      guildId, action: 'ban', caseId,
      target: { id: userId, username: targetUser?.username ?? userId, tag: targetUser?.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
    });

    this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${finalReason}`);
    return caseId;
  }

  public async mute(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string,
    durationMinutes: number
  ): Promise<string> {
    this.assertEnabled();
    await this.assertGuildEnabled(guildId);
    const guild = this.getGuild(guildId);
    const target = await this.assertCanAct(guild, moderatorId, userId, 'mute', true);
    if (!target) throw new Error('User not found in this server.');
    if (!target.moderatable) throw new Error('Cannot mute this user (missing permissions or higher role).');

    const finalReason = this.resolveReason(reason);
    const minutes = Math.max(1, Math.min(40320, Math.floor(durationMinutes) || 60)); // 28 days max
    const caseId = newId('mute');
    const moderator = await this.fetchMember(guild, moderatorId);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    await target.timeout(minutes * 60 * 1000, `Case ${caseId}: ${finalReason}`);
    await this.recordCase({
      id: caseId, guildId, userId, moderatorId, type: 'mute', reason: finalReason, expiresAt,
    });
    await this.logAction({
      guildId, action: 'mute', caseId,
      target: { id: userId, username: target.user.username, tag: target.user.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
      duration: this.formatDuration(minutes),
    });

    this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${finalReason} (${minutes}m)`);
    return caseId;
  }

  public async unmute(guildId: string, userId: string, moderatorId: string, reason?: string): Promise<string> {
    this.assertEnabled();
    const guild = this.getGuild(guildId);
    const target = await this.assertCanAct(guild, moderatorId, userId, 'unmute', true);
    if (!target) throw new Error('User not found in this server.');
    if (!target.isCommunicationDisabled()) throw new Error('This user is not currently muted.');

    const finalReason = this.resolveReason(reason);
    const caseId = newId('unmute');
    const moderator = await this.fetchMember(guild, moderatorId);

    await target.timeout(null, `Case ${caseId}: ${finalReason}`);
    await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'unmute', reason: finalReason });
    await this.logAction({
      guildId, action: 'unmute', caseId,
      target: { id: userId, username: target.user.username, tag: target.user.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
    });

    this.logger.info('Moderation Service', `Unmuted user ${userId} in guild ${guildId}`);
    return caseId;
  }

  public async unban(guildId: string, userId: string, moderatorId: string, reason?: string): Promise<string> {
    this.assertEnabled();
    const guild = this.getGuild(guildId);
    const finalReason = this.resolveReason(reason);
    const caseId = newId('unban');

    const ban = await guild.bans.fetch(userId).catch(() => null);
    if (!ban) throw new Error('This user is not banned.');
    const moderator = await this.fetchMember(guild, moderatorId);

    await guild.members.unban(userId, `Case ${caseId}: ${finalReason}`);
    await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'unban', reason: finalReason });
    await this.logAction({
      guildId, action: 'unban', caseId,
      target: { id: userId, username: ban.user.username, tag: ban.user.tag },
      moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
      reason: finalReason,
    });

    this.logger.info('Moderation Service', `Unbanned user ${userId} in guild ${guildId}`);
    return caseId;
  }

  /** Active warnings by default; pass `true` to include removed ones. */
  public async getWarnings(guildId: string, userId: string, includeInactive = false): Promise<WarningRecord[]> {
    if (!this.db) return [];
    const where = includeInactive
      ? and(eq(warnings.guild_id, guildId), eq(warnings.user_id, userId))
      : and(eq(warnings.guild_id, guildId), eq(warnings.user_id, userId), eq(warnings.active, true));
    return this.db
      .select()
      .from(warnings)
      .where(where)
      .orderBy(desc(warnings.created_at)) as unknown as Promise<WarningRecord[]>;
  }

  public async removeWarning(
    guildId: string,
    warningId: string,
    moderatorId: string,
    reason?: string
  ): Promise<boolean> {
    if (!this.db) return false;
    const row = await this.db
      .select({ id: warnings.id, user_id: warnings.user_id, active: warnings.active })
      .from(warnings)
      .where(and(eq(warnings.id, warningId), eq(warnings.guild_id, guildId)))
      .limit(1);
    const warning = row[0];
    if (!warning || !warning.active) return false;

    await this.db
      .update(warnings)
      .set({
        active: false,
        removed_at: new Date(),
        removed_by: moderatorId,
      } as any)
      .where(and(eq(warnings.id, warningId), eq(warnings.guild_id, guildId)));

    await this.recordCase({
      id: newId('unwarn'),
      guildId,
      userId: warning.user_id,
      moderatorId,
      type: 'warn',
      reason: reason ? `Warning ${warningId} removed: ${reason}` : `Warning ${warningId} removed`,
    });

    this.logger.info('Moderation Service', `Removed warning ${warningId} (guild ${guildId})`);
    return true;
  }

  public async clearWarnings(guildId: string, userId: string, moderatorId: string): Promise<number> {
    if (!this.db) return 0;
    const result = await this.db
      .update(warnings)
      .set({
        active: false,
        removed_at: new Date(),
        removed_by: moderatorId,
      } as any)
      .where(and(eq(warnings.guild_id, guildId), eq(warnings.user_id, userId), eq(warnings.active, true)))
      .run();
    const changes = Number((result as { changes?: number }).changes ?? 0);
    if (changes > 0) {
      await this.recordCase({
        id: newId('unwarn'),
        guildId,
        userId,
        moderatorId,
        type: 'warn',
        reason: `Cleared ${changes} warning${changes === 1 ? '' : 's'}`,
      });
      this.logger.info('Moderation Service', `Cleared ${changes} warnings for ${userId} in guild ${guildId}`);
    }
    return changes;
  }

  public async getCases(
    guildId: string,
    userId?: string,
    limit = 50,
    offset = 0
  ): Promise<ModerationCase[]> {
    if (!this.db) return [];
    const where = userId
      ? and(eq(moderationCases.guild_id, guildId), eq(moderationCases.user_id, userId))
      : eq(moderationCases.guild_id, guildId);
    return this.db
      .select()
      .from(moderationCases)
      .where(where)
      .orderBy(desc(moderationCases.created_at))
      .limit(Math.max(1, Math.min(200, Math.floor(limit))))
      .offset(Math.max(0, Math.floor(offset))) as unknown as Promise<ModerationCase[]>;
  }

  public async getCase(guildId: string, caseId: string): Promise<ModerationCase | null> {
    if (!this.db) return null;
    const rows = await this.db
      .select()
      .from(moderationCases)
      .where(and(eq(moderationCases.guild_id, guildId), eq(moderationCases.id, caseId)))
      .limit(1);
    return (rows[0] as unknown as ModerationCase) ?? null;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Moderation Service', 'Moderation system shutdown');
  }
}
