import { SlashCommandBuilder, EmbedBuilder, Colors, type SlashCommandIntegerOption } from 'discord.js';
import { GameProfile, type IGameProfile } from '../../db/models/GameProfile.js';
import { User } from '../../db/models/User.js';
import { recordActivity } from '../../core/metrics.js';
import { formatCoins, getEconomyUser, settleWager } from '../../utils/economy.js';
import type { Command } from '../../core/commands.js';

type GameKey = 'slots' | 'coinflip' | 'blackjack' | 'roulette' | 'crash';

const MAX_BET = 10_000;
const MIN_CRASH_TARGET = 1.2;
const MAX_CRASH_TARGET = 50;

const SLOTS_SYMBOLS = ['🍊', '🍇', '🍒', '🔔', '💎', '🍀', '7'] as const;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** House return for each crash target: `0.97 / target` win probability. */
const CRASH_HOUSE_RETURN = 0.97;

export const casinoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Casino games')
    .addSubcommand((sub) =>
      sub
        .setName('slots')
        .setDescription('Play slots')
        .addIntegerOption((opt) => betOption(opt)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('coinflip')
        .setDescription('Coin flip')
        .addIntegerOption((opt) => betOption(opt))
        .addStringOption((opt) =>
          opt
            .setName('choice')
            .setDescription('Heads or tails')
            .setRequired(true)
            .addChoices(
              { name: 'Heads', value: 'heads' },
              { name: 'Tails', value: 'tails' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('blackjack')
        .setDescription('Blackjack')
        .addIntegerOption((opt) => betOption(opt)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('roulette')
        .setDescription('Roulette')
        .addIntegerOption((opt) => betOption(opt))
        .addStringOption((opt) =>
          opt
            .setName('choice')
            .setDescription('Bet on color or number')
            .setRequired(true)
            .addChoices(
              { name: 'Red', value: 'red' },
              { name: 'Black', value: 'black' },
              { name: 'Green (0)', value: 'green' },
              { name: 'Odd', value: 'odd' },
              { name: 'Even', value: 'even' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('crash')
        .setDescription('Cash out before the graph crashes')
        .addIntegerOption((opt) => betOption(opt))
        .addNumberOption((opt) =>
          opt
            .setName('target')
            .setDescription('Multiplier to cash out at (higher = riskier)')
            .setMinValue(MIN_CRASH_TARGET)
            .setMaxValue(MAX_CRASH_TARGET)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName('stats').setDescription('View casino stats')),

  category: 'economy',
  cooldownSeconds: 3,

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'stats') {
      await sendStats(interaction, userId, guildId);
      return;
    }

    const bet = interaction.options.getInteger('bet', true);
    if (!Number.isInteger(bet) || bet < 1 || bet > MAX_BET) {
      await interaction.reply({ content: `❌ Bet must be between 1 and ${MAX_BET}.`, ephemeral: true });
      return;
    }

    const [profile, user] = await Promise.all([
      getProfile(userId, guildId),
      getEconomyUser(userId),
    ]);

    // A Lucky Clover softens one losing spin; read it before settling so the
    // refund and the flag clear happen with the same wager.
    const cloverArmed = user.luckyClover === true;

    const outcome = play(sub, interaction, bet);
    if (!outcome) return;

    let { winnings, description, color, extra } = outcome;
    let cloverUsed = false;
    if (cloverArmed && winnings < bet) {
      winnings = Math.floor(bet / 2);
      cloverUsed = true;
      description += '\n🍀 Your Lucky Clover refunded half the stake!';
    }

    // One atomic step: the wallet must cover the bet before the net applies, so
    // two games landing together cannot double-spend the same coins.
    const balance = await settleWager(userId, bet, winnings);
    if (balance === null) {
      await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
      return;
    }

    if (cloverUsed) {
      await User.updateOne({ userId, luckyClover: true }, { $set: { luckyClover: false } });
    }

    recordGame(profile, sub as GameKey, bet, winnings, extra);
    if (outcome.crashPoint && outcome.crashPoint > profile.casino.crash.highestMultiplier) {
      profile.casino.crash.highestMultiplier = Number(outcome.crashPoint.toFixed(2));
    }
    await profile.save();

    const net = winnings - bet;
    recordActivity('command', `${interaction.user.tag} played ${sub}`, {
      meta: { guildId, userId, game: sub, bet, net },
    });

    const embed = new EmbedBuilder()
      .setColor(color ?? (net >= 0 ? Colors.Green : Colors.Red))
      .setTitle(gameTitle(sub))
      .setDescription(description)
      .addFields(
        { name: 'Bet', value: formatCoins(bet), inline: true },
        { name: 'Won', value: formatCoins(winnings), inline: true },
        { name: 'Net', value: (net >= 0 ? '+' : '') + formatCoins(Math.abs(net)), inline: true },
        { name: 'Wallet', value: formatCoins(balance), inline: true },
      )
      .setFooter({ text: '爱 Doctora • Casino' });

    await interaction.reply({ embeds: [embed] });
  },
};

/* -------------------------------------------------------------------------- */
/* Option builders                                                            */
/* -------------------------------------------------------------------------- */

function betOption(option: SlashCommandIntegerOption): SlashCommandIntegerOption {
  return option.setMinValue(1).setMaxValue(MAX_BET).setRequired(true);
}

function gameTitle(sub: string): string {
  switch (sub) {
    case 'slots': return '🎰 Slots';
    case 'coinflip': return '🪙 Coin Flip';
    case 'blackjack': return '♠️ Blackjack';
    case 'roulette': return '🎡 Roulette';
    case 'crash': return '📈 Crash';
    default: return '🎰 Casino';
  }
}

/* -------------------------------------------------------------------------- */
/* Games — each returns the payout and a description, never touches the wallet */
/* -------------------------------------------------------------------------- */

interface GameOutcome {
  winnings: number;
  description: string;
  color?: number;
  /** Per-game stat bumps beyond played/won/lost. */
  extra?: Record<string, number>;
  /** Crash only: the multiplier the round crashed at. */
  crashPoint?: number;
}

function play(sub: string, interaction: any, bet: number): GameOutcome | null {
  switch (sub) {
    case 'slots': return playSlots(bet);
    case 'coinflip': return playCoinflip(interaction, bet);
    case 'blackjack': return playBlackjack(bet);
    case 'roulette': return playRoulette(interaction, bet);
    case 'crash': return playCrash(interaction, bet);
    default: return null;
  }
}

function playSlots(bet: number): GameOutcome {
  const roll = () => SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)];
  const result = [roll(), roll(), roll()];

  let winnings = 0;
  let message = '';
  let extra: Record<string, number> | undefined;

  if (result[0] === result[1] && result[1] === result[2]) {
    // 7 symbols → 8x keeps the house edge near 10%.
    winnings = bet * 8;
    message = '🎰 JACKPOT! All three match!';
    extra = { jackpots: 1 };
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    winnings = bet * 2;
    message = '🎰 Two match — you win!';
  } else {
    message = '🎰 No match. Better luck next time!';
  }

  return {
    winnings,
    description: `| ${result[0]} | ${result[1]} | ${result[2]} |\n\n${message}`,
    color: winnings >= bet ? Colors.Green : Colors.Red,
    extra,
  };
}

function playCoinflip(interaction: any, bet: number): GameOutcome {
  const choice = interaction.options.getString('choice', true);
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = choice === result;

  return {
    winnings: won ? bet * 2 : 0,
    description: `Result: **${result}**\nYou ${won ? 'won' : 'lost'}!`,
    color: won ? Colors.Green : Colors.Red,
  };
}

/** Draw a fresh 52-card deck and deal. */
function freshDeck(): { rank: string; suit: string }[] {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand: { rank: string }[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') { aces++; total += 11; }
    else if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function playBlackjack(bet: number): GameOutcome {
  const deck = freshDeck();
  const player = [deck.pop()!, deck.pop()!];
  const dealer = [deck.pop()!, deck.pop()!];

  // Both sides play to 17 — a real hand instead of the old two-card showdown.
  while (handValue(player) < 17) player.push(deck.pop()!);
  while (handValue(dealer) < 17) dealer.push(deck.pop()!);

  const playerScore = handValue(player);
  const dealerScore = handValue(dealer);
  const playerNatural = player.length === 2 && playerScore === 21;
  const dealerNatural = dealer.length === 2 && dealerScore === 21;

  let winnings: number;
  let resultText: string;
  const extra: Record<string, number> = {};

  if (playerScore > 21) {
    winnings = 0;
    resultText = `Bust on ${playerScore}! You lose.`;
  } else if (dealerScore > 21) {
    winnings = bet * 2;
    resultText = `Dealer busts on ${dealerScore}. You win!`;
  } else if (playerNatural && !dealerNatural) {
    // Natural blackjack pays 3:2 — computed with integers so the wallet never
    // picks up a fractional balance.
    winnings = bet + Math.floor(bet * 1.5);
    resultText = 'Blackjack! You win 3:2.';
    extra.blackjacks = 1;
  } else if (playerScore > dealerScore) {
    winnings = bet * 2;
    resultText = `You beat the dealer, ${playerScore} to ${dealerScore}.`;
  } else if (playerScore < dealerScore) {
    winnings = 0;
    resultText = `Dealer wins, ${dealerScore} to ${playerScore}.`;
  } else {
    winnings = bet;
    resultText = `Push — both sit on ${playerScore}.`;
    extra.pushed = 1;
  }

  const show = (hand: { rank: string; suit: string }[]) =>
    hand.map((c) => `${c.rank}${c.suit}`).join(' ');

  return {
    winnings,
    description: `Your cards: ${show(player)} (${playerScore})\nDealer: ${show(dealer)} (${dealerScore})\n\n${resultText}`,
    color: winnings > bet ? Colors.Green : winnings === bet ? Colors.Yellow : Colors.Red,
    extra,
  };
}

function playRoulette(interaction: any, bet: number): GameOutcome {
  const choice = interaction.options.getString('choice', true);
  const number = Math.floor(Math.random() * 37);
  const isRed = RED_NUMBERS.has(number);
  const color = number === 0 ? 'green' : isRed ? 'red' : 'black';

  let winnings = 0;
  let won = false;

  if (choice === 'green' && number === 0) { won = true; winnings = bet * 36; }
  else if (choice === color && color !== 'green') { won = true; winnings = bet * 2; }
  else if (choice === 'odd' && number % 2 === 1 && number !== 0) { won = true; winnings = bet * 2; }
  else if (choice === 'even' && number % 2 === 0 && number !== 0) { won = true; winnings = bet * 2; }

  const extra = choice === 'green' && number === 0 ? { straightWins: 1 } : undefined;

  return {
    winnings,
    description: `The ball landed on **${number}** (${color})\nYou ${won ? 'won' : 'lost'}!`,
    color: won ? Colors.Green : Colors.Red,
    extra,
  };
}

function playCrash(interaction: any, bet: number): GameOutcome {
  const target = interaction.options.getNumber('target') ?? 2;

  // `0.97 / (1 - u)` gives P(crash > x) = 0.97 / x, so cashing out at `target`
  // returns 97% of stake in expectation — a real 3% edge. The old version drew
  // the cash-out point *below* the crash point by construction, so it could
  // never lose.
  const crashPoint = Math.max(1, CRASH_HOUSE_RETURN / (1 - Math.random()));
  const cashedOut = crashPoint >= target;
  const winnings = cashedOut ? Math.floor(bet * target) : 0;

  return {
    winnings,
    description: cashedOut
      ? `Crashed at **${crashPoint.toFixed(2)}x** — you got out at **${target.toFixed(2)}x**. 🎉`
      : `Crashed at **${crashPoint.toFixed(2)}x** before your **${target.toFixed(2)}x** target. 💥`,
    color: cashedOut ? Colors.Green : Colors.Red,
    crashPoint,
  };
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Record a settled game against the profile.
 *
 * `won`/`lost` track the *net* movement, so a win is not double counted as a
 * payout plus a stake return, and a loss can never be negative (the old code
 * did `lost += bet - winnings`, which subtracted from "Total Lost" on every
 * win and made roulette count winning bets as losses).
 */
function recordGame(
  profile: IGameProfile,
  game: GameKey,
  bet: number,
  winnings: number,
  extra?: Record<string, number>,
): void {
  const net = winnings - bet;
  const casino = profile.casino;

  casino.gamesPlayed++;
  casino.wagered += bet;
  if (net > 0) {
    casino.won += net;
    if (net > casino.biggestWin) casino.biggestWin = net;
  } else if (net < 0) {
    const loss = -net;
    casino.lost += loss;
    if (loss > casino.biggestLoss) casino.biggestLoss = loss;
  }

  const stats = casino[game] as unknown as Record<string, number>;
  stats.played = (stats.played ?? 0) + 1;
  if (net > 0) stats.won = (stats.won ?? 0) + 1;
  else if (net < 0) stats.lost = (stats.lost ?? 0) + 1;

  if (game === 'coinflip') {
    const streak = net > 0 ? (stats.streak ?? 0) + 1 : 0;
    stats.streak = streak;
    stats.maxStreak = Math.max(stats.maxStreak ?? 0, streak);
  }

  for (const [key, by] of Object.entries(extra ?? {})) {
    stats[key] = (stats[key] ?? 0) + by;
  }
}

async function getProfile(userId: string, guildId: string): Promise<IGameProfile> {
  const existing = await GameProfile.findOne({ userId, guildId });
  if (existing) return existing;
  // Upsert so two first-time games cannot collide on the unique index.
  const created = await GameProfile.findOneAndUpdate(
    { userId, guildId },
    { $setOnInsert: { userId, guildId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return created!;
}

async function sendStats(interaction: any, userId: string, guildId: string): Promise<void> {
  const profile = await getProfile(userId, guildId);
  const c = profile.casino;

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🎰 Casino Stats')
    .addFields(
      { name: 'Games Played', value: c.gamesPlayed.toLocaleString(), inline: true },
      { name: 'Total Wagered', value: formatCoins(c.wagered), inline: true },
      { name: 'Net Won', value: formatCoins(c.won), inline: true },
      { name: 'Net Lost', value: formatCoins(c.lost), inline: true },
      { name: 'Biggest Win', value: formatCoins(c.biggestWin), inline: true },
      { name: 'Biggest Loss', value: formatCoins(c.biggestLoss), inline: true },
      { name: 'Slots Jackpots', value: c.slots.jackpots.toLocaleString(), inline: true },
      { name: 'Blackjacks', value: c.blackjack.blackjacks.toLocaleString(), inline: true },
      { name: 'Roulette Straights', value: c.roulette.straightWins.toLocaleString(), inline: true },
      { name: 'Best Crash', value: `${c.crash.highestMultiplier.toFixed(2)}x`, inline: true },
      { name: 'Coinflip Streak', value: `${c.coinflip.streak} (best ${c.coinflip.maxStreak})`, inline: true },
    )
    .setFooter({ text: '爱 Doctora • Casino' });

  await interaction.reply({ embeds: [embed] });
}
