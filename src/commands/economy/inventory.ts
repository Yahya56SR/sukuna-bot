import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { SHOP_ITEMS } from '../../utils/shop.js';
import { formatCoins, getEconomyUser, itemCount } from '../../utils/economy.js';

export const inventoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your coins, bank and owned items.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Whose inventory to inspect').setRequired(false),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const user = await getEconomyUser(target.id);

    const owned = SHOP_ITEMS.map((item) => ({ item, quantity: itemCount(user, item.id) }))
      .filter((entry) => entry.quantity > 0);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(`🎒 ${target.tag}'s Inventory`)
      .addFields(
        { name: '💵 Wallet', value: formatCoins(user.balance), inline: true },
        {
          name: '🏦 Bank',
          value: `${formatCoins(user.bank)} / ${formatCoins(user.bankLimit)}`,
          inline: true,
        },
        { name: '🔥 Daily streak', value: (user.dailyStreak ?? 0).toLocaleString(), inline: true },
      );

    if (owned.length > 0) {
      embed.addFields({
        name: '🎁 Owned items',
        value: owned
          .map(({ item, quantity }) => `${item.emoji} **${item.name}** ×${quantity}`)
          .join('\n'),
      });
    } else {
      embed.addFields({ name: '🎁 Owned items', value: 'Nothing yet — visit `/shop`.' });
    }

    const flags: string[] = [];
    if (user.streakFreeze) flags.push('🧊 Streak Freeze armed');
    if (user.luckyClover) flags.push('🍀 Lucky Clover active');
    if (flags.length) embed.addFields({ name: '✨ Active effects', value: flags.join('\n') });

    embed.setFooter({ text: '爱 Doctora • Inventory' }).setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
