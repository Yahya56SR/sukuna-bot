import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const shopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View the server shop and purchase items.')
    .addStringOption((option) =>
      option.setName('item').setDescription('Item to buy').setRequired(false),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  execute: async (context) => {
    const { interaction } = context;

    // Sample shop inventory - in a real implementation, this would come from a database
    const shopItems = [
      { id: 'rank_card', name: 'Rank Card Theme', cost: 500, description: 'Custom rank card design' },
      { id: 'discord_nitro', name: 'Discord Nitro', cost: 1000, description: 'Boost your Discord presence' },
      { id: 'special_role', name: 'Special Role', cost: 1500, description: 'A unique role' },
      { id: 'voice_boost', name: 'Voice Boost', cost: 750, description: 'Priority in voice queue' },
    ];

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏪 Server Shop')
      .setDescription('Use `/balance` to check your coins, then `/buy` to purchase items.')
      .setFooter({ text: '爱 Doctora • Shop' })
      .setTimestamp();

    // Add shop items as fields
    let fields = '';
    for (const item of shopItems) {
      fields += `• **${item.name}** — ${item.cost} coins: ${item.description}\n`;
    }

    embed.addFields({ name: 'Available Items', value: fields || 'No items available' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};