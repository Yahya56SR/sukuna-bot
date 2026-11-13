import {
  Client,
  TextChannel,
  ChannelType,
  ContainerBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { randomInt } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Logger } from '../infrastructure/Logger';
import { giveaways as giveawaysTable, giveawayEntries } from '../database/schema';
import type { DrizzleDb } from '../types/database';
import { shortId } from '../utils/id';
import { formatNumber } from '../utils/embed';
import { buildPanel, type PanelFeature } from '../utils/panel';
import type { EconomyService } from './economy/EconomyService';

export interface GiveawayConfig {
  enabled: boolean;
  channel: string;
  roleRestrictions: boolean;
  minWinners: number;
  maxWinners: number;
}

export interface Giveaway {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  hostId: string;
  prize: string;
  description: string;
  status: 'active' | 'ended' | 'cancelled';
  endsAt: number;
  winnerIds: string[];
  winnerCount: number;
  eligibleRoles: string[];
  entryCount: number;
  prizeAmount: number;
  funded: boolean;
  createdAt: number;
}

export const GIVEAWAY_PREFIX = 'giveaway:';

export function giveawayButtons(giveawayId: string, status: Giveaway['status']): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (status === 'active') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${GIVEAWAY_PREFIX}enter:${giveawayId}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${GIVEAWAY_PREFIX}leave:${giveawayId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

function timestamp(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Parse `10m`, `2h`, `1d`, `90s` or a raw number of seconds. */
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase();
  const match = value.match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const seconds = unit === 's' ? amount : unit === 'm' ? amount * 60 : unit === 'h' ? amount * 3600 : amount * 86400;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

function toGiveaway(row: any): Giveaway {
  const status = row.status === 'ended' || row.status === 'cancelled' ? row.status : 'active';
  const endsAt = row.ends_at instanceof Date ? row.ends_at.getTime() : Number(row.ends_at ?? Date.now());
  const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
  const winnerIds: string[] = Array.isArray(row.winner_ids) ? row.winner_ids : [];
  const eligibleRoles: string[] = Array.isArray(row.required_roles) ? row.required_roles : [];
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id ?? '',
    hostId: row.host_id,
    prize: row.prize,
    description: row.description ?? '',
    status,
    endsAt,
    winnerIds,
    winnerCount: Number(row.winner_count ?? 1),
    eligibleRoles,
    entryCount: Number(row.entry_count ?? 0),
    prizeAmount: Number(row.prize_amount ?? 0),
    funded: Boolean(row.funded),
    createdAt,
  };
}

export class GiveawaysManager {
  private client: Client | null = null;
  private logger: Logger;
  private config: GiveawayConfig;
  private db: DrizzleDb | null = null;
  private economy: EconomyService | null = null;
  private giveaways: Map<string, Giveaway> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(logger: Logger, config: GiveawayConfig) {
    this.logger = logger;
    this.config = config;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setEconomy(economy: EconomyService): void {
    this.economy = economy;
  }

  public async initialize(client: Client): Promise<void> {
    try {
      this.client = client;
      this.giveaways.clear();
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();

      if (this.db) {
        const rows = await this.db.select().from(giveawaysTable).where(eq(giveawaysTable.status, 'active'));
        const now = Date.now();
        for (const row of rows) {
          const giveaway = toGiveaway(row);
          this.giveaways.set(giveaway.id, giveaway);
          if (giveaway.endsAt <= now) {
            void this.endGiveaway(giveaway.id);
          } else {
            this.scheduleEnd(giveaway);
          }
        }
        this.logger.info('Giveaways Manager', `Loaded ${rows.length} active giveaway(s)`);
      }
      this.logger.info('Giveaways Manager', 'Giveaways system initialized successfully');
    } catch (error) {
      this.logger.error('Giveaways Manager', 'Giveaways system initialization failed', error as Error);
      throw error;
    }
  }

  private scheduleEnd(giveaway: Giveaway): void {
    const existing = this.timers.get(giveaway.id);
    if (existing) clearTimeout(existing);
    const delay = giveaway.endsAt - Date.now();
    if (delay <= 0) {
      void this.endGiveaway(giveaway.id);
      return;
    }
    // setTimeout overflows above ~24.8 days; clamp and re-schedule on fire.
    const clamped = Math.min(delay, 2_147_483_647);
    const timer = setTimeout(() => {
      if (clamped < delay) {
        this.scheduleEnd(giveaway);
      } else {
        void this.endGiveaway(giveaway.id);
      }
    }, clamped);
    timer.unref?.();
    this.timers.set(giveaway.id, timer);
  }

  private async persist(giveaway: Giveaway): Promise<void> {
    if (!this.db) return;
    await this.db.insert(giveawaysTable).values({
      id: giveaway.id,
      guild_id: giveaway.guildId,
      channel_id: giveaway.channelId,
      message_id: giveaway.messageId || null,
      host_id: giveaway.hostId,
      prize: giveaway.prize,
      description: giveaway.description || null,
      status: giveaway.status,
      ends_at: new Date(giveaway.endsAt),
      winner_count: giveaway.winnerCount,
      winner_ids: giveaway.winnerIds,
      required_roles: giveaway.eligibleRoles,
      entry_count: giveaway.entryCount,
      prize_amount: giveaway.prizeAmount,
      funded: giveaway.funded,
      created_at: new Date(giveaway.createdAt),
    } as any);
  }

  private async save(giveaway: Giveaway): Promise<void> {
    if (!this.db) return;
    await this.db
      .update(giveawaysTable)
      .set({
        message_id: giveaway.messageId || null,
        status: giveaway.status,
        winner_ids: giveaway.winnerIds,
        entry_count: giveaway.entryCount,
        funded: giveaway.funded,
      } as any)
      .where(eq(giveawaysTable.id, giveaway.id));
  }

  private async countEntries(giveawayId: string): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>(sql`
      SELECT COUNT(*) as c FROM giveaway_entries WHERE giveaway_id = ${giveawayId}
    `);
    return Number(row?.c ?? 0);
  }

  private buildPanel(giveaway: Giveaway): ContainerBuilder {
    const ended = giveaway.status !== 'active';
    const guild = this.client?.guilds.cache.get(giveaway.guildId);

    const features: PanelFeature[] = [
      { emoji: 'giveaway', label: 'Prize', value: giveaway.prize },
      ...(giveaway.prizeAmount > 0
        ? [{ emoji: 'donate', label: 'Prize pool', value: `${formatNumber(giveaway.prizeAmount)} coins` } as PanelFeature]
        : []),
      { emoji: 'member', label: 'Hosted by', value: `<@${giveaway.hostId}>`, code: false },
      ...(ended ? [] : [{ emoji: 'clock', label: 'Ends', value: timestamp(giveaway.endsAt), code: false } as PanelFeature]),
      { emoji: 'ticket', label: 'Entries', value: formatNumber(giveaway.entryCount) },
    ];

    if (giveaway.eligibleRoles.length > 0) {
      features.push({
        emoji: 'role',
        label: 'Required roles',
        value: giveaway.eligibleRoles.map((r) => `<@&${r}>`).join(', '),
        code: false,
      });
    }
    if (ended) {
      features.push({
        emoji: 'crown',
        label: 'Winners',
        value: giveaway.winnerIds.length > 0
          ? giveaway.winnerIds.map((id) => `<@${id}>`).join(', ')
          : 'No valid entries.',
        code: false,
      });
    }

    return buildPanel({
      emoji: 'giveaway',
      title: ended ? 'Giveaway Ended' : 'Giveaway',
      guildName: guild?.name,
      guildIconUrl: guild?.iconURL({ extension: 'png', size: 256 }) ?? undefined,
      color: ended ? '#00ff00' : '#ffd700',
      intro: giveaway.description || 'Enter below for a chance to win — good luck!',
      features,
      note: ended
        ? 'Thanks to everyone who entered — the winner(s) have been picked.'
        : 'Click **Enter** below to take part!',
      footer: ended ? `Giveaway ${giveaway.id}` : 'Click Enter to participate!',
    });
  }

  private async sendGiveawayMessage(channel: TextChannel, giveaway: Giveaway): Promise<void> {
    const message = await channel.send({
      components: [this.buildPanel(giveaway), ...giveawayButtons(giveaway.id, giveaway.status)],
      flags: MessageFlags.IsComponentsV2,
    });
    giveaway.messageId = message.id;
    await this.save(giveaway);
  }

  private async updateMessage(giveaway: Giveaway): Promise<void> {
    if (!this.client || !giveaway.messageId) return;
    try {
      const channel = await this.client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return;
      const message = await (channel as TextChannel).messages.fetch(giveaway.messageId).catch(() => null);
      if (!message) return;
      await message.edit({
        components: [this.buildPanel(giveaway), ...giveawayButtons(giveaway.id, giveaway.status)],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch { /* best-effort */ }
  }

  public async createGiveaway(
    guildId: string,
    hostId: string,
    channelId: string,
    prize: string,
    description: string,
    durationSeconds: number,
    eligibleRoles: string[] = [],
    options: { winnerCount?: number; prizeAmount?: number } = {}
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Giveaways system is disabled');
    if (!Number.isFinite(durationSeconds) || durationSeconds < 10) throw new Error('Duration must be at least 10 seconds.');
    if (!prize.trim()) throw new Error('A prize is required.');

    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error('Server not found.');
    const channel = this.client?.channels.cache.get(channelId) ?? await this.client?.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Giveaway channel not found.');
    if (!(channel as TextChannel).permissionsFor(this.client!.user!)?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('I cannot send messages in that channel.');
    }

    const winnerCount = Math.max(1, Math.min(
      this.config.maxWinners || 20,
      Math.floor(options.winnerCount ?? this.config.minWinners ?? 1)
    ));
    const prizeAmount = Math.max(0, Math.floor(options.prizeAmount ?? 0));
    if (prizeAmount > 0 && !this.economy) throw new Error('Economy is not available for cash prizes.');

    if (prizeAmount > 0 && this.economy) {
      const result = await this.economy.debit(guildId, hostId, prizeAmount, {
        type: 'game',
        description: `Giveaway escrow: ${prize}`,
      });
      if (!result.success) throw new Error('You do not have enough balance to fund this giveaway.');
    }

    const now = Date.now();
    const giveaway: Giveaway = {
      id: shortId('g'),
      guildId,
      channelId,
      messageId: '',
      hostId,
      prize: prize.trim(),
      description: description.trim(),
      status: 'active',
      endsAt: now + durationSeconds * 1000,
      winnerIds: [],
      winnerCount,
      eligibleRoles,
      entryCount: 0,
      prizeAmount,
      funded: prizeAmount > 0,
      createdAt: now,
    };
    this.giveaways.set(giveaway.id, giveaway);

    try {
      await this.persist(giveaway);
    } catch (error) {
      this.giveaways.delete(giveaway.id);
      if (prizeAmount > 0 && this.economy) {
        await this.economy.credit(guildId, hostId, prizeAmount, {
          type: 'adjustment',
          description: `Refund: giveaway creation failed (${prize})`,
        }).catch(() => undefined);
      }
      throw error;
    }

    try {
      await this.sendGiveawayMessage(channel as TextChannel, giveaway);
    } catch (error) {
      this.logger.warn('Giveaways Manager', `Failed to post giveaway ${giveaway.id}: ${(error as Error).message}`);
    }

    this.scheduleEnd(giveaway);
    this.logger.info('Giveaways Manager', `Created giveaway ${giveaway.id}: ${prize}`);
    return giveaway.id;
  }

  public async getGiveaway(giveawayId: string): Promise<Giveaway | null> {
    const cached = this.giveaways.get(giveawayId);
    if (cached) return cached;
    if (!this.db) return null;
    const rows = await this.db.select().from(giveawaysTable).where(eq(giveawaysTable.id, giveawayId)).limit(1);
    if (!rows[0]) return null;
    const giveaway = toGiveaway(rows[0]);
    this.giveaways.set(giveaway.id, giveaway);
    return giveaway;
  }

  private memberRoleIds(member: { roles?: any } | null | undefined): string[] {
    const r = member?.roles;
    if (!r) return [];
    // discord.js GuildMember: roles.cache is a Collection of role ids.
    if (typeof r.cache?.keys === 'function') return [...r.cache.keys()] as string[];
    // APIInteractionGuildMember: roles is a plain array of role id strings.
    if (Array.isArray(r)) return r.map(String);
    return [];
  }

  public async enterGiveaway(
    giveawayId: string,
    userId: string,
    member: { roles?: any } | null
  ): Promise<{ ok: boolean; message: string }> {
    const giveaway = await this.getGiveaway(giveawayId);
    if (!giveaway) return { ok: false, message: 'Giveaway not found.' };
    if (giveaway.status !== 'active') return { ok: false, message: 'This giveaway has already ended.' };
    if (giveaway.endsAt <= Date.now()) return { ok: false, message: 'This giveaway has already ended.' };

    if (giveaway.eligibleRoles.length > 0) {
      const roleIds = this.memberRoleIds(member);
      if (!giveaway.eligibleRoles.some((rid) => roleIds.includes(rid))) {
        return { ok: false, message: 'You do not have a role required to enter this giveaway.' };
      }
    }

    if (this.db) {
      const result = await this.db.insert(giveawayEntries).values({
        giveaway_id: giveaway.id,
        user_id: userId,
        entered_at: new Date(),
      } as any).onConflictDoNothing().run();
      const changes = Number((result as { changes?: number }).changes ?? 0);
      if (changes === 0) return { ok: false, message: 'You are already entered in this giveaway.' };
      giveaway.entryCount = await this.countEntries(giveaway.id);
    } else {
      giveaway.entryCount += 1;
    }

    await this.save(giveaway);
    await this.updateMessage(giveaway);
    return { ok: true, message: 'You are entered! Good luck 🎉' };
  }

  public async leaveGiveaway(giveawayId: string, userId: string): Promise<{ ok: boolean; message: string }> {
    const giveaway = await this.getGiveaway(giveawayId);
    if (!giveaway) return { ok: false, message: 'Giveaway not found.' };
    if (giveaway.status !== 'active') return { ok: false, message: 'This giveaway has already ended.' };
    if (!this.db) {
      giveaway.entryCount = Math.max(0, giveaway.entryCount - 1);
      return { ok: true, message: 'You have left the giveaway.' };
    }
    const result = await this.db
      .delete(giveawayEntries)
      .where(and(eq(giveawayEntries.giveaway_id, giveaway.id), eq(giveawayEntries.user_id, userId)))
      .run();
    const changes = Number((result as { changes?: number }).changes ?? 0);
    if (changes === 0) return { ok: false, message: 'You are not entered in this giveaway.' };
    giveaway.entryCount = await this.countEntries(giveaway.id);
    await this.save(giveaway);
    await this.updateMessage(giveaway);
    return { ok: true, message: 'You have left the giveaway.' };
  }

  private async pickWinners(giveawayId: string, count: number): Promise<string[]> {
    if (!this.db) return [];
    const rows = await this.db
      .select({ user_id: giveawayEntries.user_id })
      .from(giveawayEntries)
      .where(eq(giveawayEntries.giveaway_id, giveawayId));
    const pool = rows.map((r) => r.user_id);
    const winners: string[] = [];
    while (winners.length < count && pool.length > 0) {
      const index = randomInt(pool.length);
      const [picked] = pool.splice(index, 1);
      if (picked && !winners.includes(picked)) winners.push(picked);
    }
    return winners;
  }

  public async endGiveaway(giveawayId: string, endedBy?: string): Promise<void> {
    const giveaway = await this.getGiveaway(giveawayId);
    if (!giveaway || giveaway.status !== 'active') return;

    const timer = this.timers.get(giveaway.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(giveaway.id);

    giveaway.status = 'ended';
    giveaway.entryCount = await this.countEntries(giveaway.id);
    giveaway.winnerIds = await this.pickWinners(giveaway.id, Math.min(giveaway.winnerCount, Math.max(1, giveaway.entryCount)));

    // Pay out funded prizes from escrow; never mint new money.
    if (giveaway.funded && giveaway.prizeAmount > 0 && this.economy) {
      if (giveaway.winnerIds.length > 0) {
        const share = Math.floor((giveaway.prizeAmount / giveaway.winnerIds.length) * 100) / 100;
        let remaining = giveaway.prizeAmount;
        for (let i = 0; i < giveaway.winnerIds.length; i++) {
          const winnerId = giveaway.winnerIds[i]!;
          const amount = i === giveaway.winnerIds.length - 1 ? Math.floor(remaining * 100) / 100 : share;
          remaining = Math.floor((remaining - amount) * 100) / 100;
          if (amount > 0) {
            await this.economy.credit(giveaway.guildId, winnerId, amount, {
              type: 'game',
              description: `Giveaway prize: ${giveaway.prize}`,
              reference: giveaway.id,
            }).catch((error) => this.logger.warn('Giveaways Manager', `Prize payout failed: ${(error as Error).message}`));
          }
        }
      } else {
        // Nobody entered — return the escrow to the host.
        await this.economy.credit(giveaway.guildId, giveaway.hostId, giveaway.prizeAmount, {
          type: 'adjustment',
          description: `Giveaway refund (no entries): ${giveaway.prize}`,
          reference: giveaway.id,
        }).catch(() => undefined);
      }
    }

    await this.save(giveaway);
    await this.updateMessage(giveaway);

    try {
      const channel = await this.client?.channels.fetch(giveaway.channelId).catch(() => null);
      if (channel && channel.type === ChannelType.GuildText) {
        const winners = giveaway.winnerIds.length
          ? giveaway.winnerIds.map((id) => `<@${id}>`).join(', ')
          : 'No valid entries.';
        await (channel as TextChannel).send({
          content: `🎉 **${giveaway.prize}** — winners: ${winners}${endedBy ? `\nEnded by <@${endedBy}>` : ''}`,
          allowedMentions: { users: giveaway.winnerIds },
        });
      }
    } catch { /* best-effort */ }

    this.logger.info('Giveaways Manager', `Giveaway ${giveawayId} ended with winners: ${giveaway.winnerIds.join(', ') || 'none'}`);
  }

  public async rerollGiveaway(giveawayId: string): Promise<string[]> {
    const giveaway = await this.getGiveaway(giveawayId);
    if (!giveaway) throw new Error('Giveaway not found.');
    if (giveaway.status !== 'ended') throw new Error('Only ended giveaways can be rerolled.');
    if (giveaway.funded && giveaway.prizeAmount > 0) {
      throw new Error('Funded giveaways cannot be rerolled because the prize was already paid out.');
    }
    const winners = await this.pickWinners(giveaway.id, giveaway.winnerCount);
    giveaway.winnerIds = winners;
    await this.save(giveaway);
    await this.updateMessage(giveaway);
    this.logger.info('Giveaways Manager', `Rerolled ${giveawayId}: ${winners.join(', ') || 'none'}`);
    return winners;
  }

  public async cancelGiveaway(giveawayId: string, userId: string): Promise<void> {
    const giveaway = await this.getGiveaway(giveawayId);
    if (!giveaway) throw new Error('Giveaway not found.');
    if (giveaway.status !== 'active') throw new Error('This giveaway is no longer active.');
    if (giveaway.hostId !== userId) {
      const guild = this.client?.guilds.cache.get(giveaway.guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error('Only the host or a server manager can cancel this giveaway.');
      }
    }

    const timer = this.timers.get(giveaway.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(giveaway.id);

    giveaway.status = 'cancelled';
    giveaway.winnerIds = [];
    if (giveaway.funded && giveaway.prizeAmount > 0 && this.economy) {
      await this.economy.credit(giveaway.guildId, giveaway.hostId, giveaway.prizeAmount, {
        type: 'adjustment',
        description: `Giveaway cancelled, escrow refunded: ${giveaway.prize}`,
        reference: giveaway.id,
      }).catch(() => undefined);
    }
    await this.save(giveaway);
    await this.updateMessage(giveaway);
    this.logger.info('Giveaways Manager', `Cancelled giveaway ${giveawayId}`);
  }

  public async listGiveaways(guildId: string): Promise<Giveaway[]> {
    if (!this.db) return Array.from(this.giveaways.values()).filter((g) => g.guildId === guildId);
    const rows = await this.db.select().from(giveawaysTable).where(eq(giveawaysTable.guild_id, guildId));
    return rows.map(toGiveaway).sort((a, b) => b.createdAt - a.createdAt);
  }

  public async shutdown(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.giveaways.clear();
    this.logger.info('Giveaways Manager', 'Giveaways system shutdown successfully');
  }
}

export class GiveawayCommands {
  private service: GiveawaysManager;
  private logger: Logger;

  constructor(service: GiveawaysManager, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.giveawayCommand];
  }

  private giveawayCommand: any = {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Create and manage giveaways')
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Start a giveaway')
          .addStringOption((o) => o.setName('prize').setDescription('What is being given away?').setRequired(true))
          .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d').setRequired(true))
          .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').addChannelTypes(ChannelType.GuildText))
          .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName('prize_pool').setDescription('Coins funded by you as the prize pool').setMinValue(0))
          .addStringOption((o) => o.setName('description').setDescription('Extra details'))
          .addRoleOption((o) => o.setName('required_role').setDescription('Role required to enter'))
      )
      .addSubcommand((sub) =>
        sub.setName('end').setDescription('End a giveaway now').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('reroll').setDescription('Draw new winners for an ended giveaway').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('cancel').setDescription('Cancel a giveaway and refund escrow').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List giveaways in this server')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const sub = interaction.options.getSubcommand();
      try {
        if (sub === 'create') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'You need Manage Server to create giveaways.', flags: MessageFlags.Ephemeral });
            return;
          }
          const prize = interaction.options.getString('prize', true);
          const durationRaw = interaction.options.getString('duration', true);
          const seconds = parseDuration(durationRaw);
          if (!seconds) {
            await interaction.reply({ content: 'Invalid duration. Use formats like `10m`, `2h` or `1d`.', flags: MessageFlags.Ephemeral });
            return;
          }
          const channel = interaction.options.getChannel('channel') ?? interaction.channel;
          if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({ content: 'Please choose a text channel.', flags: MessageFlags.Ephemeral });
            return;
          }
          const winnerCount = interaction.options.getInteger('winners') ?? undefined;
          const prizeAmount = interaction.options.getInteger('prize_pool') ?? 0;
          const description = interaction.options.getString('description') ?? '';
          const role = interaction.options.getRole('required_role');
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const id = await this.service.createGiveaway(
            guildId,
            interaction.user.id,
            channel.id,
            prize,
            description,
            seconds,
            role ? [role.id] : [],
            { ...(winnerCount !== undefined ? { winnerCount } : {}), prizeAmount }
          );
          await interaction.editReply({ content: `🎉 Giveaway created in <#${channel.id}> (\`${id}\`).` });
          return;
        }

        if (sub === 'list') {
          const rows = await this.service.listGiveaways(guildId);
          const active = rows.filter((g) => g.status === 'active');
          const description = active.length
            ? active.map((g) => `• \`${g.id}\` — **${g.prize}** • ${timestamp(g.endsAt)} • <#${g.channelId}>`).join('\n')
            : 'No active giveaways.';
          await interaction.reply({
            embeds: [new EmbedBuilder().setColor('#ffd700').setTitle('🎉 Active giveaways').setDescription(description)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const id = (interaction.options.getString('id', true) ?? '').trim();
        if (sub === 'end') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'You need Manage Server to end giveaways.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.service.endGiveaway(id, interaction.user.id);
          await interaction.editReply({ content: `✅ Giveaway \`${id}\` ended.` });
        } else if (sub === 'reroll') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'You need Manage Server to reroll giveaways.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const winners = await this.service.rerollGiveaway(id);
          await interaction.editReply({ content: winners.length ? `🎲 New winners: ${winners.map((w) => `<@${w}>`).join(', ')}` : 'No entries to draw from.' });
        } else if (sub === 'cancel') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.service.cancelGiveaway(id, interaction.user.id);
          await interaction.editReply({ content: `🗑️ Giveaway \`${id}\` cancelled.` });
        }
      } catch (error) {
        this.logger.error('Giveaway Commands', `Failed /giveaway ${sub}`, error as Error);
        const message = `❌ ${(error as Error).message}`;
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => undefined);
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    },
  };
}
