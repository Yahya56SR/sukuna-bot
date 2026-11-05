import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { findShopItem, shopItemChoices, type ShopItem } from '../../utils/shop.js';
import { adjustBalance, formatCoins, getEconomyUser, itemCount } from '../../utils/economy.js';
import { User } from '../../db/models/User.js';
import { addXp } from '../../db/utils.js';
import { handleLevelUp } from '../../handlers/levelUp.js';
import { readLevelSettings } from '../../utils/levelSettings.js';
import { recordActivity } from '../../core/metrics.js';

const COIN_POUCH_MIN = 500;
const COIN_POUCH_MAX = 2_000;
const XP_POTION_XP = 1_000;

export const useCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Activate an item from your inventory.')
    .addStringOption((option) =>
      option
        .setName('item')
        .setDescription('The item to use')
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
      await interaction.reply({ content: '❌ You do not have that item.', flags: MessageFlags.Ephemeral });
      return;
    }

    const user = await getEconomyUser(interaction.user.id);
    if (itemCount(user, item.id) < 1) {
      await interaction.reply({
        content: `❌ You do not own a **${item.emoji} ${item.name}**. Buy one with \`/buy\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (item.kind === 'permanent') {
      await interaction.reply({
        content: `The **${item.emoji} ${item.name}** is a permanent keepsake — it is already applied.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await consume(item, context);

    if (result.error) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
      return;
    }

    recordActivity('command', `${interaction.user.tag} used ${item.name}`, {
      meta: { guildId: interaction.guildId, userId: interaction.user.id, itemId: item.id },
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`${item.emoji} Used ${item.name}`)
      .setDescription(result.description!)
      .setFooter({ text: '爱 Doctora • Inventory' });

    await interaction.reply({ embeds: [embed] });
  },
};

interface ConsumeResult {
  description?: string;
  error?: string;
}

async function consume(
  item: ShopItem,
  context: { interaction: any; client: any; guild: any; settings?: any },
): Promise<ConsumeResult> {
  const { interaction, guild } = context;
  const userId = interaction.user.id;

  switch (item.id) {
    case 'xp_potion': {
      // Consume first so a failure mid-flight cannot duplicate the XP.
      await consumeOne(userId, item.id);
      const result = await addXp(userId, XP_POTION_XP, 'other');
      if (result.leveledUp) {
        await handleLevelUp(
          guild,
          interaction.user,
          result.newLevel,
          result.oldLevel,
          interaction.channel,
          readLevelSettings(context.settings ?? {}),
        ).catch(() => undefined);
      }
      return {
        description: `You gained **${XP_POTION_XP.toLocaleString()}** XP and reached **level ${result.newLevel}**.`,
      };
    }

    case 'coin_pouch': {
      await consumeOne(userId, item.id);
      const amount = Math.floor(Math.random() * (COIN_POUCH_MAX - COIN_POUCH_MIN + 1)) + COIN_POUCH_MIN;
      const balance = await adjustBalance(userId, amount);
      return {
        description: `It held **${formatCoins(amount)}** coins. Your wallet is now **${formatCoins(balance)}**.`,
      };
    }

    case 'streak_freeze': {
      if ((await getEconomyUser(userId)).streakFreeze) {
        return { error: 'You already have a Streak Freeze armed.' };
      }
      await consumeOne(userId, item.id);
      await User.updateOne({ userId }, { $set: { streakFreeze: true } });
      return { description: 'Your next missed daily will not break your streak.' };
    }

    case 'lucky_clover': {
      if ((await getEconomyUser(userId)).luckyClover) {
        return { error: 'You already have a Lucky Clover active.' };
      }
      await consumeOne(userId, item.id);
      await User.updateOne({ userId }, { $set: { luckyClover: true } });
      return { description: 'Your next casino loss refunds half the stake.' };
    }

    default:
      return { error: 'That item cannot be used.' };
  }
}

/** Drop one unit of the item from the inventory. */
async function consumeOne(userId: string, itemId: string): Promise<void> {
  await User.updateOne(
    { userId, 'inventory.itemId': itemId, 'inventory.quantity': { $gt: 0 } },
    { $inc: { 'inventory.$.quantity': -1 } },
  );
  await User.updateOne(
    { userId, 'inventory.itemId': itemId, 'inventory.quantity': { $lte: 0 } },
    { $pull: { inventory: { itemId } } },
  );
}
