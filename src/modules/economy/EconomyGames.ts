import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, Client, TextChannel, ChannelType } from 'discord.js';
import { randomInt } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Logger } from '../../infrastructure/Logger';
import { economyGames, economyGamePlayers } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { newId } from '../../utils/id';
import type { EconomyService } from './EconomyService';

export interface GamePlayer {
  userId: string;
  username: string;
  bet: number;
  joinedAt: number;
}

export interface ActiveGame {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  type: 'dice' | 'coinflip' | 'lucky_number' | 'reaction_race' | 'trivia';
  prize: number;
  entryFee: number;
  players: Map<string, GamePlayer>;
  status: 'waiting' | 'playing' | 'finished';
  winnerId: string | null;
  createdAt: number;
  endsAt: number;
  gameData: any;
}

function rowToGame(row: any, players: GamePlayer[]): ActiveGame {
  const status = row.status === 'playing' || row.status === 'finished' ? row.status : 'waiting';
  const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
  const endsAt = row.ends_at instanceof Date ? row.ends_at.getTime() : Number(row.ends_at ?? Date.now());
  let gameData: any = {};
  try {
    gameData = row.game_data && typeof row.game_data === 'object' ? row.game_data : {};
  } catch { gameData = {}; }
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    hostId: row.host_id,
    type: row.type,
    prize: Number(row.prize_pool ?? 0),
    entryFee: Number(row.entry_fee ?? 0),
    players: new Map(players.map((p) => [p.userId, p])),
    status,
    winnerId: row.winner_id ?? null,
    createdAt,
    endsAt,
    gameData,
  };
}

function rowToPlayer(row: any): GamePlayer {
  return {
    userId: row.user_id,
    username: row.username,
    bet: Number(row.entry_fee ?? 0),
    joinedAt: row.joined_at instanceof Date ? row.joined_at.getTime() : Number(row.joined_at ?? Date.now()),
  };
}

/**
 * Persistent multiplayer games.
 *
 * The host's prize pool is collected into escrow when the game is created,
 * and entry fees are collected from each player as they join. The winner
 * receives the pool + fees; if nobody can win, everyone (host included) is
 * refunded. Money is never minted out of thin air.
 */
export class EconomyGamesService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private economy: EconomyService | null = null;
  private client: Client | null = null;
  private activeGames: Map<string, ActiveGame> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setEconomy(economy: EconomyService): void {
    this.economy = economy;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(): Promise<void> {
    if (!this.db) {
      this.logger.info('Economy Games Service', 'Games service initialized (no database)');
      return;
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();

    const rows = await this.db
      .select()
      .from(economyGames)
      .where(eq(economyGames.status, 'waiting' as any));
    const now = Date.now();
    let recovered = 0;
    for (const row of rows) {
      const playerRows = await this.db
        .select()
        .from(economyGamePlayers)
        .where(eq(economyGamePlayers.game_id, row.id));
      const game = rowToGame(row, playerRows.map(rowToPlayer));
      this.activeGames.set(game.id, game);
      if (game.endsAt <= now) {
        void this.endGame(game.id);
      } else {
        recovered += 1;
        this.scheduleEnd(game);
      }
    }
    this.logger.info('Economy Games Service', `Games service initialized (${recovered} waiting game(s) scheduled)`);
  }

  private scheduleEnd(game: ActiveGame): void {
    const existing = this.timers.get(game.id);
    if (existing) clearTimeout(existing);
    const delay = game.endsAt - Date.now();
    if (delay <= 0) {
      void this.endGame(game.id);
      return;
    }
    const clamped = Math.min(delay, 2_147_483_647);
    const timer = setTimeout(() => {
      if (clamped < delay) this.scheduleEnd(game);
      else void this.endGame(game.id);
    }, clamped);
    timer.unref?.();
    this.timers.set(game.id, timer);
  }

  private async hydrate(gameId: string): Promise<ActiveGame | null> {
    const cached = this.activeGames.get(gameId);
    if (cached) return cached;
    if (!this.db) return null;
    const rows = await this.db.select().from(economyGames).where(eq(economyGames.id, gameId)).limit(1);
    if (!rows[0]) return null;
    const playerRows = await this.db.select().from(economyGamePlayers).where(eq(economyGamePlayers.game_id, gameId));
    const game = rowToGame(rows[0], playerRows.map(rowToPlayer));
    this.activeGames.set(game.id, game);
    return game;
  }

  private async save(game: ActiveGame): Promise<void> {
    if (!this.db) return;
    await this.db
      .update(economyGames)
      .set({
        status: game.status,
        winner_id: game.winnerId,
        game_data: game.gameData ?? {},
      } as any)
      .where(eq(economyGames.id, game.id));
  }

  private async persist(game: ActiveGame): Promise<void> {
    if (!this.db) return;
    await this.db.insert(economyGames).values({
      id: game.id,
      guild_id: game.guildId,
      channel_id: game.channelId,
      host_id: game.hostId,
      type: game.type,
      prize_pool: game.prize,
      entry_fee: game.entryFee,
      status: game.status,
      winner_id: game.winnerId,
      game_data: game.gameData ?? {},
      ends_at: new Date(game.endsAt),
      created_at: new Date(game.createdAt),
    } as any);
  }

  public async getBalance(guildId: string, userId: string): Promise<number> {
    if (!this.economy) return 0;
    return this.economy.getBalance(guildId, userId);
  }

  public async createGame(
    guildId: string,
    channelId: string,
    hostId: string,
    type: ActiveGame['type'],
    prize: number,
    entryFee: number,
    durationMinutes: number
  ): Promise<string> {
    if (!Number.isFinite(prize) || prize < 0) throw new Error('Prize pool cannot be negative.');
    if (!Number.isFinite(entryFee) || entryFee < 0) throw new Error('Entry fee cannot be negative.');
    if (!this.economy) throw new Error('Economy is not available for games.');

    const pool = Math.floor(prize);
    const fee = Math.floor(entryFee);
    const id = newId('game').slice(0, 24);

    // Escrow the host's prize pool up front.
    if (pool > 0) {
      const result = await this.economy.debit(guildId, hostId, pool, {
        type: 'game',
        description: `Game escrow (${type})`,
        reference: id,
      });
      if (!result.success) throw new Error('You do not have enough balance to fund the prize pool.');
    }

    const now = Date.now();
    const game: ActiveGame = {
      id,
      guildId,
      channelId,
      hostId,
      type,
      prize: pool,
      entryFee: fee,
      players: new Map(),
      status: 'waiting',
      winnerId: null,
      createdAt: now,
      endsAt: now + durationMinutes * 60 * 1000,
      gameData: {},
    };

    try {
      await this.persist(game);
    } catch (error) {
      // Refund the escrow if we couldn't persist the game.
      if (pool > 0) {
        await this.economy.credit(guildId, hostId, pool, {
          type: 'adjustment',
          description: `Refund: game creation failed (${type})`,
        }).catch(() => undefined);
      }
      throw error;
    }

    this.activeGames.set(id, game);
    this.scheduleEnd(game);
    this.logger.info('Economy Games Service', `Created game ${id}: ${type} with ${pool} coins prize pool`);
    return id;
  }

  public async joinGame(gameId: string, userId: string, username: string): Promise<{ success: boolean; message: string }> {
    const game = await this.hydrate(gameId);
    if (!game) return { success: false, message: 'Game not found.' };
    if (game.status !== 'waiting') return { success: false, message: 'Game already started.' };
    if (game.players.has(userId)) return { success: false, message: 'Already joined.' };
    if (game.endsAt <= Date.now()) return { success: false, message: 'This game has already ended.' };

    if (game.entryFee > 0) {
      if (!this.economy) return { success: false, message: 'Economy is not available.' };
      const result = await this.economy.debit(game.guildId, userId, game.entryFee, {
        type: 'game',
        description: 'Game entry fee',
        reference: game.id,
      });
      if (!result.success) return { success: false, message: 'Insufficient balance for entry fee.' };
    }

    game.players.set(userId, {
      userId,
      username,
      bet: game.entryFee,
      joinedAt: Date.now(),
    });

    if (this.db) {
      try {
        await this.db.insert(economyGamePlayers).values({
          game_id: game.id,
          user_id: userId,
          username,
          entry_fee: game.entryFee,
          joined_at: new Date(),
        } as any).onConflictDoNothing().run();
      } catch (error) {
        game.players.delete(userId);
        if (game.entryFee > 0 && this.economy) {
          await this.economy.credit(game.guildId, userId, game.entryFee, {
            type: 'game',
            description: 'Refund: failed to join game',
            reference: game.id,
          }).catch(() => undefined);
        }
        return { success: false, message: 'Could not join the game. Please try again.' };
      }
    }

    return { success: true, message: 'Joined the game!' };
  }

  public async endGame(gameId: string): Promise<{ winnerId: string | null; winnerUsername: string | null; prize: number }> {
    const game = await this.hydrate(gameId);
    if (!game || game.status === 'finished') return { winnerId: null, winnerUsername: null, prize: 0 };

    const timer = this.timers.get(game.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(game.id);

    game.status = 'finished';

    const players = Array.from(game.players.values());
    let winnerId: string | null = null;
    let winnerUsername: string | null = null;

    if (players.length > 0) {
      switch (game.type) {
        case 'dice': {
          const rolls = players.map((p) => ({ player: p, roll: randomInt(1, 7) }));
          const maxRoll = Math.max(...rolls.map((r) => r.roll));
          const winners = rolls.filter((r) => r.roll === maxRoll);
          const winner = winners[randomInt(winners.length)];
          if (winner) {
            winnerId = winner.player.userId;
            winnerUsername = winner.player.username;
          }
          game.gameData = { ...game.gameData, rolls: rolls.map((r) => ({ user: r.player.username, userId: r.player.userId, roll: r.roll })) };
          break;
        }
        case 'coinflip': {
          const flip = randomInt(0, 2) === 0 ? 'heads' : 'tails';
          const winningPlayers = players.filter((p) => {
            const pick = game.gameData?.picks?.[p.userId];
            return pick === flip;
          });
          const chosen = winningPlayers.length > 0 ? winningPlayers[randomInt(winningPlayers.length)] : players[randomInt(players.length)];
          if (chosen) {
            winnerId = chosen.userId;
            winnerUsername = chosen.username;
          }
          game.gameData = { ...game.gameData, flip };
          break;
        }
        case 'lucky_number': {
          const target = randomInt(1, 101);
          let closest: GamePlayer | null = null;
          let closestDiff = Infinity;
          for (const p of players) {
            const pick = Number(game.gameData?.picks?.[p.userId] ?? randomInt(1, 101));
            const diff = Math.abs(pick - target);
            if (diff < closestDiff) {
              closestDiff = diff;
              closest = p;
            }
          }
          winnerId = closest?.userId ?? null;
          winnerUsername = closest?.username ?? null;
          game.gameData = { ...game.gameData, target };
          break;
        }
        case 'reaction_race':
        case 'trivia': {
          winnerId = game.winnerId;
          winnerUsername = winnerId ? game.players.get(winnerId)?.username ?? null : null;
          break;
        }
      }
    }

    // Pay out: escrowed pool + collected fees go to the winner; otherwise refund everyone.
    const pot = players.reduce((sum, p) => sum + (Number(p.bet) || 0), 0);
    const payout = game.prize + pot;

    if (winnerId && payout > 0 && this.economy) {
      await this.economy.credit(game.guildId, winnerId, payout, {
        type: 'game',
        description: `${game.type} game winnings`,
        reference: game.id,
      }).catch((error) => this.logger.warn('Economy Games Service', `Prize payout failed: ${(error as Error).message}`));
    } else if (!winnerId) {
      if (game.prize > 0 && this.economy) {
        await this.economy.credit(game.guildId, game.hostId, game.prize, {
          type: 'adjustment',
          description: `Game refund (no winner): ${game.type}`,
          reference: game.id,
        }).catch(() => undefined);
      }
      if (this.economy && pot > 0) {
        for (const p of players) {
          if (p.bet > 0) {
            await this.economy.credit(game.guildId, p.userId, p.bet, {
              type: 'adjustment',
              description: `Game refund (no winner): ${game.type}`,
              reference: game.id,
            }).catch(() => undefined);
          }
        }
      }
    }

    game.winnerId = winnerId;
    await this.save(game);
    this.activeGames.delete(game.id);
    this.logger.info('Economy Games Service', `Game ${gameId} finished. Winner: ${winnerUsername ?? 'none'}`);

    // Announce the result in the channel.
    try {
      const channel = this.client ? await this.client.channels.fetch(game.channelId).catch(() => null) : null;
      if (channel && channel.type === ChannelType.GuildText) {
        const rolls = Array.isArray(game.gameData?.rolls)
          ? `\n${game.gameData.rolls.map((r: any) => `• ${r.user}: 🎲 ${r.roll}`).join('\n')}`
          : '';
        const outcome = winnerId
          ? `🏆 <@${winnerId}> won **${payout}** coins (${game.type.replace('_', ' ')})!${rolls}`
          : `🎮 ${game.type.replace('_', ' ')} ended with no winner — entry fees and the prize pool were refunded.`;
        await (channel as TextChannel).send({ content: outcome, allowedMentions: { users: winnerId ? [winnerId] : [] } });
      }
    } catch { /* best-effort */ }

    return { winnerId, winnerUsername, prize: payout };
  }

  public async recordPick(gameId: string, userId: string, pick: string | number): Promise<void> {
    const game = await this.hydrate(gameId);
    if (!game) return;
    game.gameData = { ...(game.gameData ?? {}), picks: { ...(game.gameData?.picks ?? {}), [userId]: pick } };
    await this.save(game);
    if (this.db) {
      await this.db.update(economyGamePlayers)
        .set({ pick: String(pick) } as any)
        .where(and(eq(economyGamePlayers.game_id, gameId), eq(economyGamePlayers.user_id, userId)));
    }
  }

  public async recordWinner(gameId: string, userId: string): Promise<void> {
    const game = await this.hydrate(gameId);
    if (!game) return;
    game.winnerId = userId;
    await this.save(game);
  }

  public getGame(gameId: string): ActiveGame | undefined {
    return this.activeGames.get(gameId);
  }

  public async getGameAsync(gameId: string): Promise<ActiveGame | null> {
    return this.hydrate(gameId);
  }

  public async getActiveGames(guildId: string): Promise<ActiveGame[]> {
    if (!this.db) {
      return Array.from(this.activeGames.values()).filter((g) => g.guildId === guildId && g.status === 'waiting');
    }
    const rows = await this.db
      .select()
      .from(economyGames)
      .where(and(eq(economyGames.guild_id, guildId), eq(economyGames.status, 'waiting' as any)));
    const games: ActiveGame[] = [];
    for (const row of rows) {
      games.push((await this.hydrate(row.id)) ?? rowToGame(row, []));
    }
    return games;
  }

  public async shutdown(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.activeGames.clear();
    this.logger.info('Economy Games Service', 'Games service shutdown');
  }
}

export class EconomyGamesCommands {
  private service: EconomyGamesService;

  constructor(service: EconomyGamesService) {
    this.service = service;
  }

  public getCommands(): any[] {
    return [this.diceCommand, this.coinflipCommand, this.luckyNumberCommand, this.giveawayGameCommand, this.joinCommand];
  }

  private diceCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('dice')
      .setDescription('Roll dice - highest roll wins the prize')
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
      .addIntegerOption((o: any) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o: any) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      return this.startGame(interaction, 'dice');
    },
  };

  private coinflipCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('coinflip')
      .setDescription('Coin flip game - pick heads or tails')
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
      .addIntegerOption((o: any) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o: any) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      return this.startGame(interaction, 'coinflip');
    },
  };

  private luckyNumberCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('lucky_number')
      .setDescription('Pick a number 1-100, closest to target wins')
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
      .addIntegerOption((o: any) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o: any) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      return this.startGame(interaction, 'lucky_number');
    },
  };

  private giveawayGameCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('giveaway_game')
      .setDescription('Start a giveaway game - players join and one wins')
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
      .addIntegerOption((o: any) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(120)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      return this.startGame(interaction, 'reaction_race', true);
    },
  };

  private joinCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('joingame')
      .setDescription('Join an active game')
      .addStringOption((o: any) => o.setName('game_id').setDescription('Game ID to join').setRequired(true)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const gameId = interaction.options.getString('game_id', true);
      const game = await this.service.getGameAsync(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const result = await this.service.joinGame(gameId, interaction.user.id, interaction.user.username);
      await interaction.reply({ content: result.message, flags: result.success ? undefined : MessageFlags.Ephemeral });
    },
  };

  private async startGame(interaction: ChatInputCommandInteraction, type: ActiveGame['type'], isGiveaway = false): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const prize = interaction.options.getInteger('prize', true);
    const fee = interaction.options.getInteger('fee') ?? (isGiveaway ? 0 : 0);
    const minutes = interaction.options.getInteger('minutes') ?? (isGiveaway ? 10 : 5);

    try {
      const gameId = await this.service.createGame(
        guildId,
        interaction.channelId,
        interaction.user.id,
        type,
        prize,
        fee,
        minutes
      );

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`🎮 ${type.replace('_', ' ').toUpperCase()} Game`)
        .setDescription(
          `**Prize:** ${prize} coins\n` +
          `**Entry Fee:** ${fee} coins\n` +
          `**Host:** <@${interaction.user.id}>\n` +
          `**Ends:** <t:${Math.floor(Date.now() / 1000 + minutes * 60)}:R>\n\n` +
          `Use \`/joingame ${gameId}\` to join!`
        )
        .setTimestamp();

      const joinButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`game_join:${gameId}`)
          .setLabel('Join Game')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎮')
      );

      await interaction.reply({ embeds: [embed], components: [joinButton] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${(error as Error).message}`, flags: MessageFlags.Ephemeral });
    }
  }
}
