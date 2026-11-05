import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { GameProfile } from '../../db/models/GameProfile.js';
import { User } from '../../db/models/User.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const casinoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Casino games')
    .addSubcommand(sub => sub
      .setName('slots')
      .setDescription('Play slots')
      .addIntegerOption(opt => opt
        .setName('bet')
        .setDescription('Bet amount')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
      )
    )
    .addSubcommand(sub => sub
      .setName('coinflip')
      .setDescription('Coin flip')
      .addIntegerOption(opt => opt
        .setName('bet')
        .setDescription('Bet amount')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
      )
      .addStringOption(opt => opt
        .setName('choice')
        .setDescription('Heads or tails')
        .setRequired(true)
        .addChoices(
          { name: 'Heads', value: 'heads' },
          { name: 'Tails', value: 'tails' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('blackjack')
      .setDescription('Blackjack')
      .addIntegerOption(opt => opt
        .setName('bet')
        .setDescription('Bet amount')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
      )
    )
    .addSubcommand(sub => sub
      .setName('roulette')
      .setDescription('Roulette')
      .addIntegerOption(opt => opt
        .setName('bet')
        .setDescription('Bet amount')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
      )
      .addStringOption(opt => opt
        .setName('choice')
        .setDescription('Bet on color or number')
        .setRequired(true)
        .addChoices(
          { name: 'Red', value: 'red' },
          { name: 'Black', value: 'black' },
          { name: 'Green (0)', value: 'green' },
          { name: 'Odd', value: 'odd' },
          { name: 'Even', value: 'even' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('crash')
      .setDescription('Crash game')
      .addIntegerOption(opt => opt
        .setName('bet')
        .setDescription('Bet amount')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
      )
    )
    .addSubcommand(sub => sub
      .setName('stats')
      .setDescription('View casino stats')
    ),

  category: 'economy',
  cooldownSeconds: 3,

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    let profile = await GameProfile.findOne({ userId, guildId });
    if (!profile) {
      profile = await GameProfile.create({ userId, guildId });
    }

    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId });
    }

    if (sub === 'slots') {
      const bet = interaction.options.getInteger('bet', true);

      if (user.balance < bet) {
        await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
        return;
      }

      const symbols = ['🍎', '🍊', '🍇', '🍒', '7', '⭐'];
      const result = [symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)]];

      let winnings = 0;
      let message = '';
      if (result[0] === result[1] && result[1] === result[2]) {
        winnings = bet * 10;
        message = '🎰 JACKPOT! All three match!';
      } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
        winnings = bet * 2;
        message = '🎰 Two match! You win!';
      } else {
        message = '🎰 No match. Better luck next time!';
      }

      user.balance -= bet;
      user.balance += winnings;
      await user.save();

      profile.casino.gamesPlayed++;
      profile.casino.wagered += bet;
      profile.casino.won += winnings;
      profile.casino.lost += bet - winnings;
      if (winnings > bet) profile.casino.slots.won++;
      else profile.casino.slots.lost++;
      profile.casino.slots.played++;
      if (winnings >= bet * 10) profile.casino.slots.jackpots++;
      await profile.save();

      const embed = new EmbedBuilder()
        .setColor(winnings >= bet ? Colors.Green : Colors.Red)
        .setTitle('🎰 Slots')
        .setDescription(`| ${result[0]} | ${result[1]} | ${result[2]} |\n\n${message}`)
        .addFields(
          { name: 'Bet', value: bet.toString(), inline: true },
          { name: 'Won', value: winnings.toString(), inline: true },
          { name: 'Net', value: (winnings - bet).toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'coinflip') {
      const bet = interaction.options.getInteger('bet', true);
      const choice = interaction.options.getString('choice', true);

      if (user.balance < bet) {
        await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
        return;
      }

      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = choice === result;
      const winnings = won ? bet * 2 : 0;

      user.balance -= bet;
      user.balance += winnings;
      await user.save();

      profile.casino.gamesPlayed++;
      profile.casino.wagered += bet;
      profile.casino.won += winnings;
      profile.casino.lost += bet - winnings;
      profile.casino.coinflip.played++;
      if (won) profile.casino.coinflip.won++;
      else profile.casino.coinflip.lost++;
      await profile.save();

      const embed = new EmbedBuilder()
        .setColor(won ? Colors.Green : Colors.Red)
        .setTitle('🪙 Coin Flip')
        .setDescription(`Result: **${result}**\nYou ${won ? 'won' : 'lost'}!`)
        .addFields(
          { name: 'Bet', value: bet.toString(), inline: true },
          { name: 'Your choice', value: choice, inline: true },
          { name: 'Result', value: result, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'blackjack') {
      const bet = interaction.options.getInteger('bet', true);

      if (user.balance < bet) {
        await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
        return;
      }

      const drawCard = () => {
        const cards = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        return cards[Math.floor(Math.random() * cards.length)];
      };

      const cardValue = (card: string) => {
        if (card === 'A') return 11;
        if (['J', 'Q', 'K'].includes(card)) return 10;
        return parseInt(card);
      };

      const playerCards = [drawCard(), drawCard()];
      const dealerCards = [drawCard(), drawCard()];

      const playerScore = playerCards.reduce((sum, c) => sum + cardValue(c), 0);
      const dealerScore = dealerCards.reduce((sum, c) => sum + cardValue(c), 0);

      let resultText = '';
      let winnings = 0;

      if (playerScore === 21 && dealerScore !== 21) {
        resultText = 'Blackjack! You win!';
        winnings = bet * 2.5;
      } else if (playerScore > 21) {
        resultText = 'Bust! You lose.';
      } else if (dealerScore > 21 || playerScore > dealerScore) {
        resultText = 'You win!';
        winnings = bet * 2;
      } else if (playerScore < dealerScore) {
        resultText = 'Dealer wins.';
      } else {
        resultText = 'Push (tie).';
        winnings = bet;
      }

      user.balance -= bet;
      user.balance += winnings;
      await user.save();

      profile.casino.gamesPlayed++;
      profile.casino.wagered += bet;
      profile.casino.won += winnings;
      profile.casino.lost += bet - winnings;
      profile.casino.blackjack.played++;
      if (winnings === bet * 2.5) profile.casino.blackjack.blackjacks++;
      else if (winnings > bet) profile.casino.blackjack.won++;
      else if (winnings === bet) profile.casino.blackjack.pushed++;
      else profile.casino.blackjack.lost++;
      await profile.save();

      const embed = new EmbedBuilder()
        .setColor(winnings >= bet ? Colors.Green : Colors.Red)
        .setTitle('♠️ Blackjack')
        .setDescription(`Your cards: ${playerCards.join(' ')} (${playerScore})\nDealer: ${dealerCards.join(' ')} (${dealerScore})\n\n${resultText}`)
        .addFields(
          { name: 'Bet', value: bet.toString(), inline: true },
          { name: 'Won', value: winnings.toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'roulette') {
      const bet = interaction.options.getInteger('bet', true);
      const choice = interaction.options.getString('choice', true);

      if (user.balance < bet) {
        await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
        return;
      }

      const number = Math.floor(Math.random() * 37);
      const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
      const isRed = redNumbers.includes(number);
      const color = number === 0 ? 'green' : isRed ? 'red' : 'black';

      let won = false;
      let multiplier = 0;
      if (choice === 'green' && number === 0) {
        won = true;
        multiplier = 36;
      } else if (choice === color && color !== 'green') {
        won = true;
        multiplier = 2;
      } else if (choice === 'odd' && number % 2 === 1 && number !== 0) {
        won = true;
        multiplier = 2;
      } else if (choice === 'even' && number % 2 === 0 && number !== 0) {
        won = true;
        multiplier = 2;
      }

      const winnings = won ? bet * multiplier : 0;

      user.balance -= bet;
      user.balance += winnings;
      await user.save();

      profile.casino.gamesPlayed++;
      profile.casino.wagered += bet;
      profile.casino.won += winnings;
      profile.casino.lost += bet - winnings;
      profile.casino.roulette.played++;
      if (won) profile.casino.roulette.won++;
      if (choice === 'green' && number === 0) profile.casino.roulette.straightWins++;
      else profile.casino.roulette.lost++;
      await profile.save();

      const embed = new EmbedBuilder()
        .setColor(won ? Colors.Green : Colors.Red)
        .setTitle('🎡 Roulette')
        .setDescription(`The ball landed on **${number}** (${color})\nYou ${won ? 'won' : 'lost'}!`)
        .addFields(
          { name: 'Bet', value: bet.toString(), inline: true },
          { name: 'Your choice', value: choice, inline: true },
          { name: 'Result', value: `${number} (${color})`, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'crash') {
      const bet = interaction.options.getInteger('bet', true);

      if (user.balance < bet) {
        await interaction.reply({ content: '❌ Insufficient balance.', ephemeral: true });
        return;
      }

      // Simulate crash - random crash point between 1.0 and 10.0
      const crashPoint = 1 + Math.random() * 9;
      // Player auto-cashes at random point between 1.0 and crashPoint
      const cashOut = 1 + Math.random() * Math.min(crashPoint - 1, 5);

      const won = cashOut < crashPoint;
      const winnings = won ? Math.floor(bet * cashOut) : 0;

      user.balance -= bet;
      user.balance += winnings;
      await user.save();

      profile.casino.gamesPlayed++;
      profile.casino.wagered += bet;
      profile.casino.won += winnings;
      profile.casino.lost += bet - winnings;
      profile.casino.crash.played++;
      if (won) profile.casino.crash.won++;
      else profile.casino.crash.lost++;
      if (cashOut > profile.casino.crash.highestMultiplier) profile.casino.crash.highestMultiplier = cashOut;
      await profile.save();

      const embed = new EmbedBuilder()
        .setColor(won ? Colors.Green : Colors.Red)
        .setTitle('📈 Crash')
        .setDescription(`Crash point: ${crashPoint.toFixed(2)}x\nYou cashed out at ${cashOut.toFixed(2)}x\nYou ${won ? 'won' : 'lost'}!`)
        .addFields(
          { name: 'Bet', value: bet.toString(), inline: true },
          { name: 'Won', value: winnings.toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'stats') {
      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎰 Casino Stats')
        .addFields(
          { name: 'Games Played', value: profile.casino.gamesPlayed.toString(), inline: true },
          { name: 'Total Wagered', value: profile.casino.wagered.toString(), inline: true },
          { name: 'Total Won', value: profile.casino.won.toString(), inline: true },
          { name: 'Total Lost', value: profile.casino.lost.toString(), inline: true },
          { name: 'Biggest Win', value: profile.casino.biggestWin.toString(), inline: true },
          { name: 'Slots Jackpots', value: profile.casino.slots.jackpots.toString(), inline: true },
          { name: 'Blackjacks', value: profile.casino.blackjack.blackjacks.toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};