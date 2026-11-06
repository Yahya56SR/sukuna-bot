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
import { recordActivity } from '../../core/metrics.js';

/** Coins added to the bank ceiling each time the limit is raised. */
const LIMIT_STEP = 10_000;
const LIMIT_UPGRADE_COST = 5_000;
const MAX_LIMIT = 1_000_000;

export const bankCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Move coins between your wallet and bank.')
    .addSubcommand((sub) =>
      sub
        .setName('deposit')
        .setDescription('Deposit coins into your bank.')
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Coins to deposit').setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('withdraw')
        .setDescription('Withdraw coins from your bank.')
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Coins to withdraw').setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('all').setDescription('Deposit everything you are carrying.'),
    )
    .addSubcommand((sub) =>
      sub.setName('upgrade').setDescription(`Raise your bank limit by ${LIMIT_STEP.toLocaleString()} for ${LIMIT_UPGRADE_COST.toLocaleString()} coins.`),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show your bank details.')),
  category: 'economy',
  userPermissions: [PermissionFlagsBits.SendMessages],
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'status') {
      const user = await getEconomyUser(userId);
      await interaction.reply({ embeds: [statusEmbed(interaction.user.tag, user)], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'upgrade') {
      const user = await getEconomyUser(userId);
      const nextLimit = Math.min(MAX_LIMIT, (user.bankLimit ?? 0) + LIMIT_STEP);
      if (nextLimit <= (user.bankLimit ?? 0)) {
        await interaction.reply({ content: '❌ Your bank is already at the maximum limit.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Conditional: only charge while the limit has not already been raised.
      // NOTE: `$inc` + `$min` on the same path is a conflicting-operators
      // error in MongoDB, so clamp with an aggregation pipeline instead.
      let upgraded: any = null;
      try {
        upgraded = await User.findOneAndUpdate(
          { userId, bankLimit: { $lt: MAX_LIMIT }, balance: { $gte: LIMIT_UPGRADE_COST } },
          [
            {
              $set: {
                balance: { $subtract: ['$balance', LIMIT_UPGRADE_COST] },
                bankLimit: {
                  $min: [{ $add: [{ $ifNull: ['$bankLimit', 0] }, LIMIT_STEP] }, MAX_LIMIT],
                },
              },
            },
          ],
          { new: true },
        );
      } catch (err) {
        await interaction.reply({
          content: '❌ Upgrade failed due to a database error. Please try again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!upgraded) {
        await interaction.reply({
          content: `❌ You need **${formatCoins(LIMIT_UPGRADE_COST)}** coins to upgrade.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      recordActivity('command', `${interaction.user.tag} upgraded their bank`, {
        meta: { guildId: interaction.guildId, userId, bankLimit: upgraded.bankLimit },
      });

      await interaction.reply({
        content: `🏦 Bank limit raised to **${formatCoins(upgraded.bankLimit)}**.`,
      });
      return;
    }

    const user = await getEconomyUser(userId);
    const requested = sub === 'all' ? user.balance : interaction.options.getInteger('amount', true);

    if (sub === 'deposit' || sub === 'all') {
      if (requested <= 0) {
        await interaction.reply({ content: '❌ Your wallet is empty.', flags: MessageFlags.Ephemeral });
        return;
      }

      const updated = await User.findOneAndUpdate(
        { userId, balance: { $gte: requested } },
        { $inc: { balance: -requested, bank: requested } },
        { new: true },
      );
      if (!updated) {
        await interaction.reply({ content: '❌ You do not have that many coins.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (updated.bank > updated.bankLimit) {
        // Over the ceiling — push the excess straight back to the wallet.
        // Conditional on bank still holding at least the overflow so a
        // concurrent withdraw cannot drive the bank negative.
        const overflow = Math.max(0, Math.min(updated.bank - updated.bankLimit, updated.bank));
        if (overflow > 0) {
          await User.updateOne(
            { userId, bank: { $gte: overflow } },
            { $inc: { bank: -overflow, balance: overflow } },
          );
        }
        const deposited = Math.max(0, requested - overflow);
        await interaction.reply({
          content: `🏦 Deposited **${formatCoins(deposited)}** (your bank holds **${formatCoins(updated.bankLimit)}** at most).`,
        });
        return;
      }

      await interaction.reply({ content: `🏦 Deposited **${formatCoins(requested)}** coins.` });
      return;
    }

    const updated = await User.findOneAndUpdate(
      { userId, bank: { $gte: requested } },
      { $inc: { bank: -requested, balance: requested } },
      { new: true },
    );
    if (!updated) {
      await interaction.reply({
        content: '❌ You do not have that many coins in the bank.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ content: `💵 Withdrew **${formatCoins(requested)}** coins.` });
  },
};

function statusEmbed(tag: string, user: { balance: number; bank: number; bankLimit: number }): EmbedBuilder {
  const used = user.bankLimit > 0 ? (user.bank / user.bankLimit) * 100 : 0;
  return new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(`🏦 ${tag}'s Bank`)
    .addFields(
      { name: '💵 Wallet', value: formatCoins(user.balance), inline: true },
      { name: '🏦 Bank', value: formatCoins(user.bank), inline: true },
      { name: '📏 Limit', value: formatCoins(user.bankLimit), inline: true },
      {
        name: 'Usage',
        value: `${used.toFixed(1)}% — \`${Math.max(0, user.bankLimit - user.bank).toLocaleString()}\` capacity left`,
        inline: false,
      },
    )
    .setFooter({ text: '愛 Bella Star • Bank' });
}
