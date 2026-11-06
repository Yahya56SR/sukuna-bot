import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { SHOP_ITEMS } from '../../utils/shop.js';
import { formatCoins, getEconomyUser } from '../../utils/economy.js';

export const shopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse items you can buy with coins.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const user = await getEconomyUser(interaction.user.id);

    const lines = SHOP_ITEMS.map((item) => {
      const owned = user.inventory?.find((entry) => entry.itemId === item.id)?.quantity ?? 0;
      const ownedTag = owned > 0 ? ` — you own **${owned}**` : '';
      return `${item.emoji} **${item.name}** · ${formatCoins(item.price)} coins${ownedTag}\n${item.description}`;
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('🏪 Shop')
      .setDescription(
        `Your wallet: **${formatCoins(user.balance)}** coins\n\n${lines.join('\n\n')}`,
      )
      .addFields({
        name: 'How to buy',
        value: 'Use `/buy item:<name>` to purchase, then `/use item:<name>` to activate consumables. `/inventory` shows what you own.',
      })
      .setFooter({ text: '愛 Bella Star • Shop' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
