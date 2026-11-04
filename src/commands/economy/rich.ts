import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const richCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('rich')
    .setDescription('View the richest members of the server.')
    .addIntegerOption((option) =>
      option.setName('limit').setDescription('How many top members to show').setMinValue(1).setMaxValue(10).setRequired(false),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  execute: async (context) => {
    const { interaction } = context;
    const limit = interaction.options.getInteger('limit') ?? 5;

    // Sample rich list - in a real implementation, this would query the database
    const richList = [
      { user: 'User1', xp: 50000, level: 25 },
      { user: 'User2', xp: 45000, level: 24 },
      { user: 'User3', xp: 42000, level: 23 },
      { user: 'User4', xp: 38000, level: 22 },
      { user: 'User5', xp: 35000, level: 21 },
    ];

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('💎 Richest Members')
      .setDescription(`Top ${limit} members by XP`);

    const fields = richList
      .slice(0, limit)
      .map(
        (member, i) =>
          `**#${i + 1}** <@${member.user.replace('<@', '').replace('>', '')}> — Level ${member.level} (${member.xp.toLocaleString()} XP)`
      )
      .join('\n');

    embed.addFields({ name: 'Members', value: fields || 'No data available' });
    embed.setFooter({ text: '爱 Doctora • Rich List' });
    embed.setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};