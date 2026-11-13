import {
  AttachmentBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq, sql } from 'drizzle-orm';
import { leaderboardBoards } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { LevelingService, type LevelingTrack } from './LevelingService';
import {
  buildContentPanel,
  buildMessagePayload,
  collectEntries,
  type LeaderboardTheme,
  type LiveEntry,
} from '../../utils/liveLeaderboard';
import { brandedEmbed, BRAND, errorEmbed } from '../../utils/embed';
import { newId } from '../../utils/id';

/**
 * The two boards the bot runs.
 *
 * - `members` — every ranked member of the guild (the public leaderboard).
 * - `staff`   — the staff team only (staff roles + moderation permissions).
 *
 * Both boards read the same XP data; the difference is the *track* stored
 * on each leveling profile, so the two rankings never overlap.
 */
export type LeaderboardBoard = 'members' | 'staff';

export const LEADERBOARD_BOARDS: LeaderboardBoard[] = ['members', 'staff'];

export interface BoardDefinition {
  board: LeaderboardBoard;
  /** Which leveling track feeds this board. */
  track: LevelingTrack;
  /** Default title (the guild name is prefixed). */
  title: string;
  /** Emoji key used for the board. */
  emoji: string;
  theme: LeaderboardTheme;
}

export const BOARD_DEFINITIONS: Record<LeaderboardBoard, BoardDefinition> = {
  members: {
    board: 'members',
    track: 'member',
    title: 'Members Leaderboard',
    emoji: 'trophy',
    theme: {
      accentColor: 0x2b2d63,
      titleEmoji: 'trophy',
      scopeEmoji: 'members',
      scopeLabel: 'members',
      countMode: 'guild',
      zones: true,
    },
  },
  staff: {
    board: 'staff',
    track: 'staff',
    title: 'Staff Leaderboard',
    emoji: 'shield',
    theme: {
      accentColor: 0xef4444,
      titleEmoji: 'shield',
      scopeEmoji: 'staff',
      scopeLabel: 'staff team',
      countMode: 'ranked',
      zones: false,
    },
  },
};

export function normalizeBoard(board: unknown): LeaderboardBoard | null {
  const value = String(board ?? '').trim().toLowerCase();
  if (value === 'staff' || value === 'staffs' || value === 'staffboard') return 'staff';
  if (value === 'members' || value === 'member' || value === 'people') return 'members';
  return null;
}

export interface LeaderboardServiceConfig {
  /** Master switch for the live boards. */
  enabled: boolean;
  /** How often a live board is refreshed (minutes). */
  refreshMinutes: number;
  /** Default number of ranks shown on a board. */
  defaultRows: number;
}

export const DEFAULT_LEADERBOARD_CONFIG: LeaderboardServiceConfig = {
  enabled: true,
  refreshMinutes: 5,
  defaultRows: 25,
};

export interface LiveBoard {
  id: string;
  guildId: string;
  board: LeaderboardBoard;
  channelId: string;
  messageId: string | null;
  rows: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface BoardRow {
  id: string;
  guild_id: string;
  board: string;
  channel_id: string;
  message_id: string | null;
  rows: number;
  enabled: boolean;
  created_at: Date | number | null;
  updated_at: Date | number | null;
}

function toMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n === 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

function rowToBoard(row: BoardRow): LiveBoard {
  const board = normalizeBoard(row.board) ?? 'members';
  return {
    id: row.id,
    guildId: row.guild_id,
    board,
    channelId: row.channel_id,
    messageId: row.message_id ?? null,
    rows: Number(row.rows ?? DEFAULT_LEADERBOARD_CONFIG.defaultRows),
    enabled: Boolean(row.enabled),
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

/**
 * Owns the two leaderboards: rendering them, posting them into channels
 * and keeping the posted panels up to date.
 */
export class LeaderboardService {
  private logger: Logger;
  private leveling: LevelingService;
  private db: DrizzleDb | null = null;
  private client: Client | null = null;
  private config: LeaderboardServiceConfig;
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private boardLocks = new Set<string>();

  constructor(logger: Logger, leveling: LevelingService, config?: Partial<LeaderboardServiceConfig>) {
    this.logger = logger;
    this.leveling = leveling;
    this.config = { ...DEFAULT_LEADERBOARD_CONFIG, ...(config ?? {}) };
  }

  public getConfig(): LeaderboardServiceConfig { return this.config; }

  public setConfig(next: Partial<LeaderboardServiceConfig>): LeaderboardServiceConfig {
    this.config = { ...this.config, ...(next ?? {}) };
    this.restartScheduler();
    return this.config;
  }

  public setDb(db: DrizzleDb): void { this.db = db; }
  public setClient(client: Client): void { this.client = client; }

  public async initialize(): Promise<void> {
    this.restartScheduler();
    this.logger.info(
      'Leaderboard Service',
      `Leaderboards initialized (${LEADERBOARD_BOARDS.join(' + ')}, refresh every ${this.config.refreshMinutes} min)`,
    );
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  public definition(board: LeaderboardBoard): BoardDefinition {
    return BOARD_DEFINITIONS[board] ?? BOARD_DEFINITIONS.members;
  }

  public titleFor(guild: Guild, board: LeaderboardBoard): string {
    return `${guild.name} • ${this.definition(board).title}`;
  }

  /** The leveling service behind the boards (rank + staff checks). */
  public get levelingService(): LevelingService {
    return this.leveling;
  }

  /** Ranked entries of a board (staff refreshes first so the boards match the roles). */
  public async entries(guild: Guild, board: LeaderboardBoard, limit?: number): Promise<LiveEntry[]> {
    const definition = this.definition(board);
    // Keep the stored track in sync with the live guild roles before reading.
    await this.leveling.refreshGuildTracks(guild.id).catch(() => undefined);
    const rows = Math.max(3, Math.min(100, limit ?? this.config.defaultRows));
    return collectEntries(this.leveling, guild, rows, this.client, definition.track);
  }

  /**
   * Full message payload (components + podium artwork) for a board.
   *
   * `podium` is only used for the interactive commands — a live board in a
   * channel is refreshed with a component-only edit, so it never re-uploads
   * the artwork (and can never pile up attachments).
   */
  public async payload(
    guild: Guild,
    board: LeaderboardBoard,
    rows?: number,
    updatedAt: number = Date.now(),
    podium = true,
  ): Promise<{ components: any[]; files: AttachmentBuilder[]; flags: MessageFlags.IsComponentsV2 }> {
    const definition = this.definition(board);
    const limit = Math.max(3, Math.min(100, rows ?? this.config.defaultRows));
    const entries = await this.entries(guild, board, limit);
    if (podium) {
      return buildMessagePayload(
        entries,
        guild,
        limit,
        this.titleFor(guild, board),
        updatedAt,
        definition.theme,
      );
    }
    return {
      components: [buildContentPanel({
        entries,
        guild,
        rows: limit,
        title: this.titleFor(guild, board),
        updatedAt,
        theme: definition.theme,
      })],
      files: [],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  // ------------------------------------------------------------------
  // Live boards
  // ------------------------------------------------------------------

  public async listBoards(guildId?: string): Promise<LiveBoard[]> {
    if (!this.db) return [];
    const rows = guildId
      ? await this.db.select().from(leaderboardBoards).where(eq(leaderboardBoards.guild_id, guildId))
      : await this.db.select().from(leaderboardBoards);
    return (rows as unknown as BoardRow[]).map(rowToBoard);
  }

  public async getBoard(guildId: string, board: LeaderboardBoard): Promise<LiveBoard | null> {
    if (!this.db) return null;
    const rows = await this.db
      .select()
      .from(leaderboardBoards)
      .where(sql`${leaderboardBoards.guild_id} = ${guildId} AND ${leaderboardBoards.board} = ${board}`)
      .limit(1);
    return rows[0] ? rowToBoard(rows[0] as unknown as BoardRow) : null;
  }

  /**
   * Posts (or re-posts) a board in a channel and remembers the message so
   * it can be refreshed later.
   *
   * Reposting in the same channel re-uses the existing message; moving the
   * board to another channel deletes the old one so a server never ends up
   * with two copies of the same board.
   */
  public async postBoard(
    guild: Guild,
    board: LeaderboardBoard,
    channelId: string,
    rows?: number,
  ): Promise<LiveBoard> {
    if (!this.db) throw new Error('Database not connected');
    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error('That channel is not a text channel.');
    }

    const limit = Math.max(3, Math.min(100, rows ?? this.config.defaultRows));
    const existing = await this.getBoard(guild.id, board);

    // Same channel → re-post the panel (with the podium) so the artwork is
    // replaced rather than kept stale. The old message is removed first.
    if (existing?.messageId && existing.channelId === channelId) {
      await this.deleteBoardMessage(existing);
    }

    // The board moved → clean up the old message first.
    if (existing) {
      await this.deleteBoardMessage(existing);
    }

    // Live boards carry the podium artwork so they match the /leaderboard look.
    // The refresh path re-posts the whole message so the image is replaced
    // instead of piling up on the channel.
    const payload = await this.payload(guild, board, limit, Date.now(), true);
    const message = await (channel as TextChannel).send({
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: { parse: [] },
    });

    const now = new Date();
    const record = {
      id: existing?.id ?? newId('lbl'),
      guild_id: guild.id,
      board,
      channel_id: channelId,
      message_id: message.id,
      rows: limit,
      enabled: true,
      created_at: existing ? new Date(existing.createdAt || Date.now()) : now,
      updated_at: now,
    };
    await this.db
      .insert(leaderboardBoards)
      .values(record as any)
      .onConflictDoUpdate({
        target: [leaderboardBoards.guild_id, leaderboardBoards.board],
        set: {
          channel_id: record.channel_id,
          message_id: record.message_id,
          rows: record.rows,
          enabled: true,
          updated_at: record.updated_at,
        } as any,
      });

    this.logger.info('Leaderboard Service', `Posted ${board} leaderboard in ${channelId} (${guild.name})`);
    const saved = await this.getBoard(guild.id, board);
    return saved ?? rowToBoard(record as unknown as BoardRow);
  }

  /** Re-renders a posted board (with the podium) by re-posting it. */
  public async refreshBoard(guild: Guild, board: LeaderboardBoard): Promise<boolean> {
    if (!this.db) return false;
    const lockKey = `${guild.id}:${board}`;
    if (this.boardLocks.has(lockKey)) return false;
    this.boardLocks.add(lockKey);
    try {
      const live = await this.getBoard(guild.id, board);
      if (!live) return false;

    const channel = await this.client?.channels.fetch(live.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    // Drop the stale panel and post a fresh one with the new podium artwork.
    await this.deleteBoardMessage(live);
    const payload = await this.payload(guild, board, live.rows, Date.now(), true);
    const message = await (channel as TextChannel).send({
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (!message) {
      this.logger.warn('Leaderboard Service', `Could not re-post the ${board} board in ${live.channelId}`);
      return false;
    }

    await this.db
      .update(leaderboardBoards)
      .set({ message_id: message.id, updated_at: new Date() } as any)
      .where(sql`${leaderboardBoards.guild_id} = ${guild.id} AND ${leaderboardBoards.board} = ${board}`);
    return true;
    } finally {
      this.boardLocks.delete(lockKey);
    }
  }

  /** Deletes the message of a live board (best effort). */
  private async deleteBoardMessage(live: LiveBoard): Promise<void> {
    if (!live.messageId || !this.client) return;
    const channel = await this.client.channels.fetch(live.channelId).catch(() => null);
    if (!channel || !('messages' in channel)) return;
    const message = await (channel as TextChannel).messages.fetch(live.messageId).catch(() => null);
    await message?.delete().catch(() => undefined);
  }

  /** Removes a live board (and its message). */
  public async removeBoard(guildId: string, board: LeaderboardBoard, deleteMessage = true): Promise<boolean> {
    if (!this.db) return false;
    const live = await this.getBoard(guildId, board);
    if (!live) return false;

    if (deleteMessage) await this.deleteBoardMessage(live);

    await this.db
      .delete(leaderboardBoards)
      .where(sql`${leaderboardBoards.guild_id} = ${guildId} AND ${leaderboardBoards.board} = ${board}`);
    this.logger.info('Leaderboard Service', `Removed ${board} leaderboard for guild ${guildId}`);
    return true;
  }

  /** Refreshes every enabled board (used by the scheduler). */
  public async refreshAll(): Promise<number> {
    if (this.refreshing || !this.config.enabled || !this.client) return 0;
    this.refreshing = true;
    let refreshed = 0;
    try {
      const boards = (await this.listBoards()).filter((b) => b.enabled);
      for (const live of boards) {
        const guild = this.client.guilds.cache.get(live.guildId);
        if (!guild) continue;
        try {
          if (await this.refreshBoard(guild, live.board)) refreshed++;
        } catch (err) {
          this.logger.warn('Leaderboard Service', `Could not refresh ${live.board} board in ${live.guildId}: ${(err as Error).message}`);
        }
        // Small gap so several boards never hit the rate limit at once.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } catch (err) {
      this.logger.error('Leaderboard Service', 'Board refresh cycle failed', err as Error);
    } finally {
      this.refreshing = false;
    }
    return refreshed;
  }

  private restartScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.config.enabled) return;
    const minutes = Math.max(1, Math.floor(this.config.refreshMinutes) || 5);
    this.timer = setInterval(() => {
      void this.refreshAll().catch((err) => {
        this.logger.error('Leaderboard Service', 'Scheduled refresh failed', err as Error);
      });
    }, minutes * 60_000);
    (this.timer as any)?.unref?.();
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Leaderboard Service', 'Leaderboard service shutdown');
  }
}

/**
 * Slash commands for the two boards:
 *   /leaderboard  — the public members leaderboard
 *   /staffboard   — the staff leaderboard (staff only)
 *   /board        — manage the live boards (admin)
 */
export class LeaderboardCommands {
  private service: LeaderboardService;
  private logger: Logger;

  constructor(service: LeaderboardService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.leaderboardCommand, this.staffboardCommand, this.boardCommand];
  }

  private leaderboardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the members leaderboard')
      .addIntegerOption((option) => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(25)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      await this.showBoard(interaction, 'members');
    },
  };

  private staffboardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('staffboard')
      .setDescription('View the staff team leaderboard')
      .addIntegerOption((option) => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(25)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId || !interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const isStaff = await this.service.levelingService.isStaffMember(interaction.member as any);
      if (!isStaff) {
        await interaction.reply({
          embeds: [errorEmbed('Staff only', 'The staff leaderboard is only visible to the staff team.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await this.showBoard(interaction, 'staff');
    },
  };

  /** Shared renderer for both boards. */
  private async showBoard(interaction: ChatInputCommandInteraction, board: LeaderboardBoard): Promise<void> {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const limit = interaction.options.getInteger('limit') ?? 10;
    try {
      const definition = this.service.definition(board);
      const entries = await this.service.entries(interaction.guild, board, limit);
      if (entries.length === 0) {
        await interaction.reply({
          content: board === 'staff'
            ? 'No staff members have earned XP yet.'
            : 'No members have earned XP yet — chat to earn XP!',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply();
      const payload = await this.service.payload(interaction.guild, board, Math.max(10, limit));
      await interaction.editReply(payload).catch(async (err: Error) => {
        this.logger.warn('Leaderboard Commands', `Panel send failed: ${err.message}`);
        const embed = brandedEmbed(BRAND.gold)
          .setTitle(`${definition.emoji === 'shield' ? '🛡️' : '🏆'} ${definition.title}`)
          .setDescription(
            entries
              .map((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
                return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
              })
              .join('\n'),
          );
        await interaction.editReply({ embeds: [embed] });
      });
    } catch (error) {
      this.logger.error('Leaderboard Commands', `Failed to get ${board} leaderboard`, error as Error);
      await this.replyError(interaction, 'Failed to get the leaderboard.');
    }
  }

  private boardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('board')
      .setDescription('Manage the live leaderboard panels')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('post')
          .setDescription('Post a live leaderboard in a channel')
          .addStringOption((o) =>
            o.setName('board').setDescription('Which leaderboard').setRequired(true)
              .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' }),
          )
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Channel to post the board in').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addIntegerOption((o) => o.setName('rows').setDescription('How many ranks to show (default 25)').setMinValue(3).setMaxValue(100)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('refresh')
          .setDescription('Refresh a live leaderboard now')
          .addStringOption((o) =>
            o.setName('board').setDescription('Which leaderboard').setRequired(true)
              .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' }),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a live leaderboard')
          .addStringOption((o) =>
            o.setName('board').setDescription('Which leaderboard').setRequired(true)
              .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' }),
          ),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('Show the live leaderboards of this server')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild || !interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const sub = interaction.options.getSubcommand();
      try {
        if (sub === 'post') {
          const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
          const channel = interaction.options.getChannel('channel', true);
          const rows = interaction.options.getInteger('rows') ?? undefined;
          await interaction.deferReply();
          const live = await this.service.postBoard(interaction.guild, board, channel.id, rows);
          await interaction.editReply({
            embeds: [brandedEmbed(BRAND.green)
              .setTitle('✅ Leaderboard posted')
              .setDescription(
                `**Board:** ${this.service.definition(board).title}\n` +
                `**Channel:** <#${live.channelId}>\n` +
                `**Ranks shown:** ${live.rows}\n` +
                `The board refreshes every ${this.service.getConfig().refreshMinutes} minute(s).`,
              )],
          });
          return;
        }

        if (sub === 'refresh') {
          const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
          await interaction.deferReply();
          const ok = await this.service.refreshBoard(interaction.guild, board);
          await interaction.editReply({
            content: ok
              ? `🔄 ${this.service.definition(board).title} refreshed.`
              : `No live ${board} board is set up yet — use \`/board post\`.`,
          });
          return;
        }

        if (sub === 'remove') {
          const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
          const removed = await this.service.removeBoard(interaction.guildId, board);
          await interaction.reply({
            content: removed ? `🗑️ ${this.service.definition(board).title} removed.` : 'No live board was set up.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'list') {
          const boards = await this.service.listBoards(interaction.guildId);
          const description = boards.length
            ? boards.map((b) => {
                const definition = this.service.definition(b.board);
                return `${definition.emoji === 'shield' ? '🛡️' : '🏆'} **${definition.title}** — <#${b.channelId}> • ${b.rows} ranks • ${b.enabled ? '🟢 live' : '🔴 paused'}`;
              }).join('\n')
            : 'No live leaderboards yet. Use `/board post` to create one.';
          await interaction.reply({
            embeds: [brandedEmbed(BRAND.blue).setTitle('📋 Live Leaderboards').setDescription(description)],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (error) {
        this.logger.error('Leaderboard Commands', `Failed /board ${sub}`, error as Error);
        await this.replyError(interaction, (error as Error).message || 'Failed to manage the leaderboard.');
      }
    },
  };

  private async replyError(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed('Leaderboard', message)], flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else {
      await interaction.editReply({ content: message }).catch(() => undefined);
    }
  }
}
