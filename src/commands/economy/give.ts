import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const giveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give coins to another member.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to give coins to').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Amount of coins to give').setMinValue(1).setRequired(true),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  execute: async (context) => {
    const { interaction } = context;
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('💸 Coin Transfer')
      .addFields(
        { name: 'From', value: interaction.user.tag, inline: true },
        { name: 'To', value: targetUser.tag, inline: true },
        { name: 'Amount', value: `${amount} coins`, inline: true },
      )
      .setFooter({ text: '爱 Doctora • Coin Transfer' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};