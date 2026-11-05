import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { loadLevelSettings, saveGuildSettings } from './shared.js';
import { isOwner } from '../../core/owner.js';

export const levelupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('levelup')
    .setDescription('Test level-up announcement (owner only).')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'leveling',
  execute: async (context) => {
    const { interaction } = context;

    // Owner-only check
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const current = await loadLevelSettings(context);
    const { levelUpMessage, levelUpChannel } = current;

    // Send a test level-up message
    const testEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🎉 Level Up Test')
      .setDescription(
        levelUpMessage
          .replace('{user}', '@everyone')
          .replace('{username}', 'TestUser')
          .replace('{level}', '10')
          .replace('{server}', interaction.guild?.name ?? 'this server')
          .replace('{role}', '@everyone')
          .replace('{xp}', '1500')
          .replace('{xpneeded}', '500'),
      )
      .setFooter({ text: '爱 Doctora • Level Up Test' })
      .setTimestamp();

    const channel = interaction.guild?.channels.cache.get(levelUpChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [testEmbed] });
      await interaction.reply({
        content: `✅ Test level-up sent to <#${levelUpChannel}>`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: `✅ Level-up message template: "${levelUpMessage}"\n(No level-up channel configured)`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};