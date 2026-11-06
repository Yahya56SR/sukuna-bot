import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const rpsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play Rock-Paper-Scissors against the bot.')
    .addStringOption((option) =>
      option.setName('choice').setDescription('Rock, Paper, or Scissors').setRequired(true).addChoices(
        { name: 'Rock', value: 'rock' },
        { name: 'Paper', value: 'paper' },
        { name: 'Scissors', value: 'scissors' },
      ),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const userChoice = interaction.options.getString('choice', true).toLowerCase();

    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    const winConditions: Record<string, string> = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper',
    };

    let result: string;
    if (userChoice === botChoice) {
      result = 'tie';
    } else if (winConditions[userChoice] === botChoice) {
      result = 'win';
    } else {
      result = 'lose';
    }

    const resultEmoji: Record<string, string> = { win: '🥇', lose: '🥈', tie: '🤝' };
    const resultColor: Record<string, number> = { win: 0x22c55e, lose: 0xe03e3e, tie: 0xf59e0b };

    const embed = new EmbedBuilder()
      .setColor(resultColor[result as keyof typeof resultColor])
      .setTitle(`🎮 Rock-Paper-Scissors`)
      .addFields(
        { name: 'Your choice', value: userChoice.charAt(0).toUpperCase() + userChoice.slice(1), inline: true },
        { name: 'Bot\'s choice', value: botChoice.charAt(0).toUpperCase() + botChoice.slice(1), inline: true },
      )
      .setFooter({ text: `${resultEmoji[result as keyof typeof resultEmoji]} You ${result === 'win' ? 'win!' : result === 'lose' ? 'lose!' : 'tie!'}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};