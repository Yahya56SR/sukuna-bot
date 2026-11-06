import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { formatCoins, getEconomyUser, transferCoins } from '../../utils/economy.js';
import { recordActivity } from '../../core/metrics.js';

const MAX_TRANSFER = 1_000_000;

export const giveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give coins to another member.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to give coins to').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Amount of coins to give')
        .setMinValue(1)
        .setMaxValue(MAX_TRANSFER)
        .setRequired(true),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    if (target.id === interaction.user.id) {
      await interaction.reply({ content: '❌ You cannot give coins to yourself.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: '❌ Bots cannot hold coins.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Make sure both rows exist before the transfer so the debit has something
    // to match against and the credit never creates a half-initialised row.
    await getEconomyUser(interaction.user.id);
    await getEconomyUser(target.id);

    const result = await transferCoins(interaction.user.id, target.id, amount);

    if (!result.ok) {
      const reason =
        result.reason === 'self'
          ? 'You cannot give coins to yourself.'
          : result.reason === 'bot'
            ? 'Bots cannot hold coins.'
            : '❌ You do not have that many coins.';
      await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
      return;
    }

    recordActivity('command', `${interaction.user.tag} gave ${amount} coins to ${target.tag}`, {
      meta: { guildId: interaction.guildId, from: interaction.user.id, to: target.id, amount },
    });

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('💸 Coin Transfer')
      .addFields(
        { name: 'From', value: interaction.user.tag, inline: true },
        { name: 'To', value: target.tag, inline: true },
        { name: 'Amount', value: formatCoins(amount), inline: true },
        { name: 'Your wallet after', value: formatCoins(result.fromBalance), inline: true },
      )
      .setFooter({ text: '愛 Bella Star • Coin Transfer' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
