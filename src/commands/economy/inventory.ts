import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const inventoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your personal inventory and balance.')
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  execute: async (context) => {
    const { interaction } = context;

    // Sample user data - in a real implementation, this would come from the database
    const userBalance = 1250;
    const userBank = 5000;
    const bankLimit = 10000;
    const ownedItems = ['rank_card_theme', 'special_role'];

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎒 Your Inventory')
      .addFields(
        { name: '💵 Balance', value: `${userBalance} coins`, inline: true },
        { name: '🏦 Bank', value: `${userBank}/${bankLimit} coins`, inline: true },
      );

    if (ownedItems.length > 0) {
      embed.addFields({
        name: '🎁 Owned Items',
        value: ownedItems.map((item) => `• ${item}`).join('\n'),
      });
    } else {
      embed.addFields({ name: '🎁 Owned Items', value: 'Nothing yet' });
    }

    embed.setFooter({ text: '爱 Doctora • Inventory' });
    embed.setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};