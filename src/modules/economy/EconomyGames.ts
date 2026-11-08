import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { users, economyTransactions } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';

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

export class EconomyGamesService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private activeGames: Map<string, ActiveGame> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Economy Games Service', 'Multiplayer games initialized');
  }

  public async getBalance(userId: string): Promise<number> {
    if (!this.db) return 0;
    const result = await this.db.select().from(users).where(eq(users.id, userId));
    if (!result[0]) {
      await this.db.insert(users).values({
        id: userId,
        username: '',
        discriminator: null,
        avatar: null,
        bot: false,
        balance: 0,
        xp: 0,
        level: 1,
        total_xp: 0,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      return 0;
    }
    return result[0].balance || 0;
  }

  public async addBalance(userId: string, amount: number): Promise<void> {
    if (!this.db) return;
    const current = await this.getBalance(userId);
    await this.db.update(users).set({ balance: current + amount }).where(eq(users.id, userId));
    await this.db.insert(economyTransactions).values({
      id: `txn_${Date.now()}`,
      guild_id: '',
      user_id: userId,
      type: 'credit',
      amount,
      description: 'Game win',
      created_at: new Date(),
    } as any);
  }

  public async removeBalance(userId: string, amount: number): Promise<boolean> {
    if (!this.db) return false;
    const current = await this.getBalance(userId);
    if (current < amount) return false;
    await this.db.update(users).set({ balance: current - amount }).where(eq(users.id, userId));
    await this.db.insert(economyTransactions).values({
      id: `txn_${Date.now()}`,
      guild_id: '',
      user_id: userId,
      type: 'debit',
      amount,
      description: 'Game entry fee',
      created_at: new Date(),
    } as any);
    return true;
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
    const id = `game_${Date.now()}`;
    const game: ActiveGame = {
      id,
      guildId,
      channelId,
      hostId,
      type,
      prize,
      entryFee,
      players: new Map(),
      status: 'waiting',
      winnerId: null,
      createdAt: Date.now(),
      endsAt: Date.now() + durationMinutes * 60 * 1000,
      gameData: {},
    };

    this.activeGames.set(id, game);
    this.logger.info('Economy Games Service', `Created game ${id}: ${type} with ${prize} coins prize`);
    return id;
  }

  public async joinGame(gameId: string, userId: string, username: string): Promise<{ success: boolean; message: string }> {
    const game = this.activeGames.get(gameId);
    if (!game) return { success: false, message: 'Game not found.' };
    if (game.status !== 'waiting') return { success: false, message: 'Game already started.' };
    if (game.players.has(userId)) return { success: false, message: 'Already joined.' };

    if (game.entryFee > 0) {
      const hasEnough = await this.removeBalance(userId, game.entryFee);
      if (!hasEnough) return { success: false, message: 'Insufficient balance for entry fee.' };
    }

    game.players.set(userId, {
      userId,
      username,
      bet: game.entryFee,
      joinedAt: Date.now(),
    });

    return { success: true, message: 'Joined the game!' };
  }

  public async endGame(gameId: string): Promise<{ winnerId: string | null; winnerUsername: string | null; prize: number }> {
    const game = this.activeGames.get(gameId);
    if (!game) return { winnerId: null, winnerUsername: null, prize: 0 };

    game.status = 'finished';

    let winnerId: string | null = null;
    let winnerUsername: string | null = null;

    if (game.players.size > 0) {
      const players = Array.from(game.players.values());

      switch (game.type) {
        case 'dice': {
          const rolls = players.map(p => ({ player: p, roll: Math.floor(Math.random() * 6) + 1 }));
          const maxRoll = Math.max(...rolls.map(r => r.roll));
          const winners = rolls.filter(r => r.roll === maxRoll);
          const winner = winners[0];
          if (winner) {
            winnerId = winner.player.userId;
            winnerUsername = winner.player.username;
          }
          game.gameData = { rolls: rolls.map(r => ({ user: r.player.username, roll: r.roll })) };
          break;
        }
        case 'coinflip': {
          const flip = Math.random() < 0.5 ? 'heads' : 'tails';
          const winningPlayers = players.filter(p => {
            const pick = game.gameData.picks?.[p.userId] || (Math.random() < 0.5 ? 'heads' : 'tails');
            return pick === flip;
          });
          if (winningPlayers.length > 0) {
            const wp = winningPlayers[Math.floor(Math.random() * winningPlayers.length)];
            if (wp) {
              winnerId = wp.userId;
              winnerUsername = wp.username;
            }
          } else {
            const p = players[Math.floor(Math.random() * players.length)];
            if (p) {
              winnerId = p.userId;
              winnerUsername = p.username;
            }
          }
          game.gameData = { flip };
          break;
        }
        case 'lucky_number': {
          const target = Math.floor(Math.random() * 100) + 1;
          let closest: GamePlayer | null = null;
          let closestDiff = Infinity;
          for (const p of players) {
            const pick = game.gameData.picks?.[p.userId] || Math.floor(Math.random() * 100) + 1;
            const diff = Math.abs(pick - target);
            if (diff < closestDiff) {
              closestDiff = diff;
              closest = p;
            }
          }
          winnerId = closest?.userId ?? null;
          winnerUsername = closest?.username ?? null;
          game.gameData = { target, picks: game.gameData.picks };
          break;
        }
        case 'reaction_race': {
          winnerId = game.winnerId;
          winnerUsername = game.players.get(game.winnerId!)?.username ?? null;
          break;
        }
        case 'trivia': {
          winnerId = game.winnerId;
          winnerUsername = game.players.get(game.winnerId!)?.username ?? null;
          break;
        }
      }
    }

    if (winnerId && game.prize > 0) {
      await this.addBalance(winnerId, game.prize);
    }

    this.activeGames.delete(gameId);
    this.logger.info('Economy Games Service', `Game ${gameId} finished. Winner: ${winnerUsername}`);

    return { winnerId, winnerUsername, prize: game.prize };
  }

  public async recordPick(gameId: string, userId: string, pick: string | number): Promise<void> {
    const game = this.activeGames.get(gameId);
    if (!game) return;
    if (!game.gameData.picks) game.gameData.picks = {};
    game.gameData.picks[userId] = pick;
  }

  public async recordWinner(gameId: string, userId: string): Promise<void> {
    const game = this.activeGames.get(gameId);
    if (game) {
      game.winnerId = userId;
    }
  }

  public getGame(gameId: string): ActiveGame | undefined {
    return this.activeGames.get(gameId);
  }

  public getActiveGames(guildId: string): ActiveGame[] {
    return Array.from(this.activeGames.values()).filter(g => g.guildId === guildId && g.status === 'waiting');
  }

  public async shutdown(): Promise<void> {
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
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins').setRequired(true).setMinValue(1))
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
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins').setRequired(true).setMinValue(1))
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
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins').setRequired(true).setMinValue(1))
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
      .addIntegerOption((o: any) => o.setName('prize').setDescription('Prize pool in coins').setRequired(true).setMinValue(1))
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
      const game = this.service.getGame(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const result = await this.service.joinGame(gameId, interaction.user.id, interaction.user.username);
      await interaction.reply({ content: result.message, flags: result.success ? undefined : MessageFlags.Ephemeral });
    },
  };

  private async startGame(interaction: ChatInputCommandInteraction, type: ActiveGame['type'], isGiveaway = false): Promise<void> {
    const prize = interaction.options.getInteger('prize', true);
    const fee = interaction.options.getInteger('fee') ?? (isGiveaway ? 0 : 0);
    const minutes = interaction.options.getInteger('minutes') ?? (isGiveaway ? 10 : 5);

    const balance = await this.service.getBalance(interaction.user.id);
    if (fee > 0 && balance < fee) {
      await interaction.reply({ content: 'Insufficient balance to host this game.', flags: MessageFlags.Ephemeral });
      return;
    }

    const gameId = await this.service.createGame(
      interaction.guildId!,
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

    setTimeout(async () => {
      const result = await this.service.endGame(gameId);
      if (result.winnerId) {
        await (interaction.channel as any)?.send?.(`🏆 Game ${gameId} ended! Winner: <@${result.winnerId}> won ${result.prize} coins!`);
      } else {
        await (interaction.channel as any)?.send?.(`🎮 Game ${gameId} ended with no winner.`);
      }
    }, minutes * 60 * 1000);
  }
}
