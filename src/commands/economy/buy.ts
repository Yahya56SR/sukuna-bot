import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { findShopItem, shopItemChoices } from '../../utils/shop.js';
import { addItem, formatCoins, getEconomyUser, settleWager } from '../../utils/economy.js';
import { recordActivity } from '../../core/metrics.js';

export const buyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the shop.')
    .addStringOption((option) =>
      option
        .setName('item')
        .setDescription('The item to buy')
        .setRequired(true)
        .addChoices(...shopItemChoices()),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const item = findShopItem(interaction.options.getString('item', true));

    if (!item) {
      await interaction.reply({ content: '❌ That item is not in the shop.', flags: MessageFlags.Ephemeral });
      return;
    }

    const user = await getEconomyUser(interaction.user.id);

    // Permanent unlocks are one-time purchases no matter how often they are bought.
    if (item.kind === 'permanent' && user.inventory?.some((entry) => entry.itemId === item.id)) {
      await interaction.reply({
        content: `❌ You already own the **${item.emoji} ${item.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Atomic: the wallet must still cover the price at the moment it is debited.
    const balance = await settleWager(interaction.user.id, item.price, 0);
    if (balance === null) {
      await interaction.reply({
        content: `❌ You need **${formatCoins(item.price)}** coins for that (you have **${formatCoins(user.balance)}**).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addItem(interaction.user.id, item.id, 1);

    recordActivity('command', `${interaction.user.tag} bought ${item.name}`, {
      meta: { guildId: interaction.guildId, userId: interaction.user.id, itemId: item.id, price: item.price },
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`${item.emoji} Purchased ${item.name}`)
      .setDescription(
        item.kind === 'consumable'
          ? `Activate it with \`/use item:${item.id}\`.`
          : 'It is yours to keep.',
      )
      .addFields(
        { name: 'Paid', value: formatCoins(item.price), inline: true },
        { name: 'Wallet left', value: formatCoins(balance), inline: true },
      )
      .setFooter({ text: '爱 Doctora • Shop' });

    await interaction.reply({ embeds: [embed] });
  },
};
