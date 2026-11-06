import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

const eightBallAnswers = [
  'As I see it, yes.',
  'It is certain.',
  'It is decidedly so.',
  'Most likely.',
  'Outlook good.',
  'Signs point to yes.',
  'Yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
];

export const eightBallEnhancedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question.')
    .addStringOption((option) =>
      option.setName('question').setDescription('Your question').setRequired(true).setMaxLength(500),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  execute: async (context) => {
    const { interaction } = context;
    const question = interaction.options.getString('question', true);

    const answer = eightBallAnswers[Math.floor(Math.random() * eightBallAnswers.length)];

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔮 Magic 8-Ball')
      .addFields(
        { name: 'Question', value: question, inline: false },
        { name: 'Answer', value: answer, inline: false },
      )
      .setFooter({ text: '愛 Bella Star • 8-Ball' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};