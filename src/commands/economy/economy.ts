import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { User } from '../../db/models/User.js';
import { formatCoins, getEconomyUser } from '../../utils/economy.js';
import { SHOP_ITEMS } from '../../utils/shop.js';

export const economyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('View the server economy summary.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  cooldownSeconds: 15,
  execute: async (context) => {
    const { interaction } = context;

    const [totals, richest, you] = await Promise.all([
      User.aggregate<{ wallets: number; banks: number; holders: number }>([
        {
          $group: {
            _id: null,
            wallets: { $sum: '$balance' },
            banks: { $sum: '$bank' },
            holders: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
          },
        },
      ]),
      User.findOne({ balance: { $gt: 0 } }).sort({ balance: -1 }).lean(),
      getEconomyUser(interaction.user.id),
    ]);

    const summary = totals[0] ?? { wallets: 0, banks: 0, holders: 0 };
    const circulation = summary.wallets + summary.banks;
    const yourShare = circulation > 0 ? ((you.balance + you.bank) / circulation) * 100 : 0;

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle('💰 Economy Summary')
      .addFields(
        { name: 'Coins in wallets', value: formatCoins(summary.wallets), inline: true },
        { name: 'Coins in banks', value: formatCoins(summary.banks), inline: true },
        { name: 'Total circulation', value: formatCoins(circulation), inline: true },
        { name: 'Members with coins', value: summary.holders.toLocaleString(), inline: true },
        {
          name: 'Richest member',
          value: richest ? `<@${richest.userId}> — ${formatCoins(richest.balance)}` : '—',
          inline: true,
        },
        { name: 'Your share', value: `${yourShare.toFixed(2)}%`, inline: true },
        {
          name: 'Shop',
          value: `${SHOP_ITEMS.length} items (largest ${formatCoins(Math.max(...SHOP_ITEMS.map((i) => i.price)))} coins) — \`/shop\``,
          inline: true,
        },
      )
      .setFooter({ text: '爱 Doctora • Economy' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
