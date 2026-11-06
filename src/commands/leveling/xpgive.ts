import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { addXp, getUserXp } from '../../db/index.js';
import { handleLevelUp, syncLevelRoles } from '../../handlers/levelUp.js';
import { readLevelSettings } from '../../utils/levelSettings.js';
import { isOwner } from '../../core/owner.js';

export const xpgiveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('xpgive')
    .setDescription('Give XP to a member (owner only).')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to give XP to').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Amount of XP to give')
        .setMinValue(1)
        .setMaxValue(10000)
        .setRequired(true),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'leveling',
  execute: async (context) => {
    const { interaction, guild } = context;
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    // Owner-only check
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await addXp(targetUser.id, amount, 'admin', 0);

    // Re-derive level from the new total and grant roles / announce so an XP
    // grant can never leave a member stuck below a tier they've reached.
    // Use the guild's real settings — `{}` grants nothing.
    if (guild) {
      const member = guild.members.cache.get(targetUser.id) ?? (await guild.members.fetch(targetUser.id).catch(() => null));
      const settings = readLevelSettings((context as any).settings ?? {});
      if (member) {
        await syncLevelRoles(guild, member, result.newLevel, settings.levelRoles).catch(() => undefined);
        if (result.leveledUp) {
          await handleLevelUp(guild, targetUser, result.newLevel, result.oldLevel, undefined, settings).catch(() => undefined);
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ XP Given')
      .addFields(
        { name: 'User', value: targetUser.tag, inline: true },
        { name: 'XP Given', value: `${amount}`, inline: true },
      )
      .setFooter({ text: '愛 Bella Star • XP Given' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
