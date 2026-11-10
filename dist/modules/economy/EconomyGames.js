"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EconomyGamesCommands = exports.EconomyGamesService = void 0;
const discord_js_1 = require("discord.js");
const crypto_1 = require("crypto");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const id_1 = require("../../utils/id");
function rowToGame(row, players) {
    const status = row.status === 'playing' || row.status === 'finished' ? row.status : 'waiting';
    const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
    const endsAt = row.ends_at instanceof Date ? row.ends_at.getTime() : Number(row.ends_at ?? Date.now());
    let gameData = {};
    try {
        gameData = row.game_data && typeof row.game_data === 'object' ? row.game_data : {};
    }
    catch {
        gameData = {};
    }
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
function rowToPlayer(row) {
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
class EconomyGamesService {
    constructor(logger) {
        this.db = null;
        this.economy = null;
        this.client = null;
        this.activeGames = new Map();
        this.timers = new Map();
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    setEconomy(economy) {
        this.economy = economy;
    }
    setClient(client) {
        this.client = client;
    }
    async initialize() {
        if (!this.db) {
            this.logger.info('Economy Games Service', 'Games service initialized (no database)');
            return;
        }
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        const rows = await this.db
            .select()
            .from(schema_1.economyGames)
            .where((0, drizzle_orm_1.eq)(schema_1.economyGames.status, 'waiting'));
        const now = Date.now();
        let recovered = 0;
        for (const row of rows) {
            const playerRows = await this.db
                .select()
                .from(schema_1.economyGamePlayers)
                .where((0, drizzle_orm_1.eq)(schema_1.economyGamePlayers.game_id, row.id));
            const game = rowToGame(row, playerRows.map(rowToPlayer));
            this.activeGames.set(game.id, game);
            if (game.endsAt <= now) {
                void this.endGame(game.id);
            }
            else {
                recovered += 1;
                this.scheduleEnd(game);
            }
        }
        this.logger.info('Economy Games Service', `Games service initialized (${recovered} waiting game(s) scheduled)`);
    }
    scheduleEnd(game) {
        const existing = this.timers.get(game.id);
        if (existing)
            clearTimeout(existing);
        const delay = game.endsAt - Date.now();
        if (delay <= 0) {
            void this.endGame(game.id);
            return;
        }
        const clamped = Math.min(delay, 2_147_483_647);
        const timer = setTimeout(() => {
            if (clamped < delay)
                this.scheduleEnd(game);
            else
                void this.endGame(game.id);
        }, clamped);
        timer.unref?.();
        this.timers.set(game.id, timer);
    }
    async hydrate(gameId) {
        const cached = this.activeGames.get(gameId);
        if (cached)
            return cached;
        if (!this.db)
            return null;
        const rows = await this.db.select().from(schema_1.economyGames).where((0, drizzle_orm_1.eq)(schema_1.economyGames.id, gameId)).limit(1);
        if (!rows[0])
            return null;
        const playerRows = await this.db.select().from(schema_1.economyGamePlayers).where((0, drizzle_orm_1.eq)(schema_1.economyGamePlayers.game_id, gameId));
        const game = rowToGame(rows[0], playerRows.map(rowToPlayer));
        this.activeGames.set(game.id, game);
        return game;
    }
    async save(game) {
        if (!this.db)
            return;
        await this.db
            .update(schema_1.economyGames)
            .set({
            status: game.status,
            winner_id: game.winnerId,
            game_data: game.gameData ?? {},
        })
            .where((0, drizzle_orm_1.eq)(schema_1.economyGames.id, game.id));
    }
    async persist(game) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.economyGames).values({
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
        });
    }
    async getBalance(guildId, userId) {
        if (!this.economy)
            return 0;
        return this.economy.getBalance(guildId, userId);
    }
    async createGame(guildId, channelId, hostId, type, prize, entryFee, durationMinutes) {
        if (!Number.isFinite(prize) || prize < 0)
            throw new Error('Prize pool cannot be negative.');
        if (!Number.isFinite(entryFee) || entryFee < 0)
            throw new Error('Entry fee cannot be negative.');
        if (!this.economy)
            throw new Error('Economy is not available for games.');
        const pool = Math.floor(prize);
        const fee = Math.floor(entryFee);
        const id = (0, id_1.newId)('game').slice(0, 24);
        // Escrow the host's prize pool up front.
        if (pool > 0) {
            const result = await this.economy.debit(guildId, hostId, pool, {
                type: 'game',
                description: `Game escrow (${type})`,
                reference: id,
            });
            if (!result.success)
                throw new Error('You do not have enough balance to fund the prize pool.');
        }
        const now = Date.now();
        const game = {
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
        }
        catch (error) {
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
    async joinGame(gameId, userId, username) {
        const game = await this.hydrate(gameId);
        if (!game)
            return { success: false, message: 'Game not found.' };
        if (game.status !== 'waiting')
            return { success: false, message: 'Game already started.' };
        if (game.players.has(userId))
            return { success: false, message: 'Already joined.' };
        if (game.endsAt <= Date.now())
            return { success: false, message: 'This game has already ended.' };
        if (game.entryFee > 0) {
            if (!this.economy)
                return { success: false, message: 'Economy is not available.' };
            const result = await this.economy.debit(game.guildId, userId, game.entryFee, {
                type: 'game',
                description: 'Game entry fee',
                reference: game.id,
            });
            if (!result.success)
                return { success: false, message: 'Insufficient balance for entry fee.' };
        }
        game.players.set(userId, {
            userId,
            username,
            bet: game.entryFee,
            joinedAt: Date.now(),
        });
        if (this.db) {
            try {
                await this.db.insert(schema_1.economyGamePlayers).values({
                    game_id: game.id,
                    user_id: userId,
                    username,
                    entry_fee: game.entryFee,
                    joined_at: new Date(),
                }).onConflictDoNothing().run();
            }
            catch (error) {
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
    async endGame(gameId) {
        const game = await this.hydrate(gameId);
        if (!game || game.status === 'finished')
            return { winnerId: null, winnerUsername: null, prize: 0 };
        const timer = this.timers.get(game.id);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(game.id);
        game.status = 'finished';
        const players = Array.from(game.players.values());
        let winnerId = null;
        let winnerUsername = null;
        if (players.length > 0) {
            switch (game.type) {
                case 'dice': {
                    const rolls = players.map((p) => ({ player: p, roll: (0, crypto_1.randomInt)(1, 7) }));
                    const maxRoll = Math.max(...rolls.map((r) => r.roll));
                    const winners = rolls.filter((r) => r.roll === maxRoll);
                    const winner = winners[(0, crypto_1.randomInt)(winners.length)];
                    if (winner) {
                        winnerId = winner.player.userId;
                        winnerUsername = winner.player.username;
                    }
                    game.gameData = { ...game.gameData, rolls: rolls.map((r) => ({ user: r.player.username, userId: r.player.userId, roll: r.roll })) };
                    break;
                }
                case 'coinflip': {
                    const flip = (0, crypto_1.randomInt)(0, 2) === 0 ? 'heads' : 'tails';
                    const winningPlayers = players.filter((p) => {
                        const pick = game.gameData?.picks?.[p.userId];
                        return pick === flip;
                    });
                    const chosen = winningPlayers.length > 0 ? winningPlayers[(0, crypto_1.randomInt)(winningPlayers.length)] : players[(0, crypto_1.randomInt)(players.length)];
                    if (chosen) {
                        winnerId = chosen.userId;
                        winnerUsername = chosen.username;
                    }
                    game.gameData = { ...game.gameData, flip };
                    break;
                }
                case 'lucky_number': {
                    const target = (0, crypto_1.randomInt)(1, 101);
                    let closest = null;
                    let closestDiff = Infinity;
                    for (const p of players) {
                        const pick = Number(game.gameData?.picks?.[p.userId] ?? (0, crypto_1.randomInt)(1, 101));
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
            }).catch((error) => this.logger.warn('Economy Games Service', `Prize payout failed: ${error.message}`));
        }
        else if (!winnerId) {
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
            if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
                const rolls = Array.isArray(game.gameData?.rolls)
                    ? `\n${game.gameData.rolls.map((r) => `• ${r.user}: 🎲 ${r.roll}`).join('\n')}`
                    : '';
                const outcome = winnerId
                    ? `🏆 <@${winnerId}> won **${payout}** coins (${game.type.replace('_', ' ')})!${rolls}`
                    : `🎮 ${game.type.replace('_', ' ')} ended with no winner — entry fees and the prize pool were refunded.`;
                await channel.send({ content: outcome, allowedMentions: { users: winnerId ? [winnerId] : [] } });
            }
        }
        catch { /* best-effort */ }
        return { winnerId, winnerUsername, prize: payout };
    }
    async recordPick(gameId, userId, pick) {
        const game = await this.hydrate(gameId);
        if (!game)
            return;
        game.gameData = { ...(game.gameData ?? {}), picks: { ...(game.gameData?.picks ?? {}), [userId]: pick } };
        await this.save(game);
        if (this.db) {
            await this.db.update(schema_1.economyGamePlayers)
                .set({ pick: String(pick) })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.economyGamePlayers.game_id, gameId), (0, drizzle_orm_1.eq)(schema_1.economyGamePlayers.user_id, userId)));
        }
    }
    async recordWinner(gameId, userId) {
        const game = await this.hydrate(gameId);
        if (!game)
            return;
        game.winnerId = userId;
        await this.save(game);
    }
    getGame(gameId) {
        return this.activeGames.get(gameId);
    }
    async getGameAsync(gameId) {
        return this.hydrate(gameId);
    }
    async getActiveGames(guildId) {
        if (!this.db) {
            return Array.from(this.activeGames.values()).filter((g) => g.guildId === guildId && g.status === 'waiting');
        }
        const rows = await this.db
            .select()
            .from(schema_1.economyGames)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.economyGames.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.economyGames.status, 'waiting')));
        const games = [];
        for (const row of rows) {
            games.push((await this.hydrate(row.id)) ?? rowToGame(row, []));
        }
        return games;
    }
    async shutdown() {
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        this.activeGames.clear();
        this.logger.info('Economy Games Service', 'Games service shutdown');
    }
}
exports.EconomyGamesService = EconomyGamesService;
class EconomyGamesCommands {
    constructor(service) {
        this.diceCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('dice')
                .setDescription('Roll dice - highest roll wins the prize')
                .addIntegerOption((o) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
                .addIntegerOption((o) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
                .addIntegerOption((o) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
            execute: async (interaction) => {
                return this.startGame(interaction, 'dice');
            },
        };
        this.coinflipCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('coinflip')
                .setDescription('Coin flip game - pick heads or tails')
                .addIntegerOption((o) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
                .addIntegerOption((o) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
                .addIntegerOption((o) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
            execute: async (interaction) => {
                return this.startGame(interaction, 'coinflip');
            },
        };
        this.luckyNumberCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('lucky_number')
                .setDescription('Pick a number 1-100, closest to target wins')
                .addIntegerOption((o) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
                .addIntegerOption((o) => o.setName('fee').setDescription('Entry fee in coins').setMinValue(0).setMaxValue(10000))
                .addIntegerOption((o) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(60)),
            execute: async (interaction) => {
                return this.startGame(interaction, 'lucky_number');
            },
        };
        this.giveawayGameCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('giveaway_game')
                .setDescription('Start a giveaway game - players join and one wins')
                .addIntegerOption((o) => o.setName('prize').setDescription('Prize pool in coins (funded by you)').setRequired(true).setMinValue(1))
                .addIntegerOption((o) => o.setName('minutes').setDescription('Game duration in minutes').setMinValue(1).setMaxValue(120)),
            execute: async (interaction) => {
                return this.startGame(interaction, 'reaction_race', true);
            },
        };
        this.joinCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('joingame')
                .setDescription('Join an active game')
                .addStringOption((o) => o.setName('game_id').setDescription('Game ID to join').setRequired(true)),
            execute: async (interaction) => {
                const gameId = interaction.options.getString('game_id', true);
                const game = await this.service.getGameAsync(gameId);
                if (!game) {
                    await interaction.reply({ content: 'Game not found.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const result = await this.service.joinGame(gameId, interaction.user.id, interaction.user.username);
                await interaction.reply({ content: result.message, flags: result.success ? undefined : discord_js_1.MessageFlags.Ephemeral });
            },
        };
        this.service = service;
    }
    getCommands() {
        return [this.diceCommand, this.coinflipCommand, this.luckyNumberCommand, this.giveawayGameCommand, this.joinCommand];
    }
    async startGame(interaction, type, isGiveaway = false) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const prize = interaction.options.getInteger('prize', true);
        const fee = interaction.options.getInteger('fee') ?? (isGiveaway ? 0 : 0);
        const minutes = interaction.options.getInteger('minutes') ?? (isGiveaway ? 10 : 5);
        try {
            const gameId = await this.service.createGame(guildId, interaction.channelId, interaction.user.id, type, prize, fee, minutes);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎮 ${type.replace('_', ' ').toUpperCase()} Game`)
                .setDescription(`**Prize:** ${prize} coins\n` +
                `**Entry Fee:** ${fee} coins\n` +
                `**Host:** <@${interaction.user.id}>\n` +
                `**Ends:** <t:${Math.floor(Date.now() / 1000 + minutes * 60)}:R>\n\n` +
                `Use \`/joingame ${gameId}\` to join!`)
                .setTimestamp();
            const joinButton = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                .setCustomId(`game_join:${gameId}`)
                .setLabel('Join Game')
                .setStyle(discord_js_1.ButtonStyle.Primary)
                .setEmoji('🎮'));
            await interaction.reply({ embeds: [embed], components: [joinButton] });
        }
        catch (error) {
            await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
    }
}
exports.EconomyGamesCommands = EconomyGamesCommands;
