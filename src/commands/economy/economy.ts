import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { loadLevelSettings } from '../leveling/shared.js';

export const economyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('View the server economy summary.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'economy',
  execute: async (context) => {
    const { interaction } = context;
    const config = await loadLevelSettings(context);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('💰 Server Economy')
      .addFields(
        { name: 'XP Enabled', value: config.enabled ? 'Yes' : 'No', inline: true },
        { name: 'Message XP', value: `${config.perMessageMin}-${config.perMessageMax} (random)`, inline: true },
        { name: 'Cooldown', value: `${config.cooldownSeconds}s`, inline: true },
        { name: 'Voice XP/min', value: `${config.perVoiceMinuteMin}-${config.perVoiceMinuteMax} (random)`, inline: true },
        { name: 'Ignore Bots', value: config.ignoreBots ? 'Yes' : 'No', inline: true },
        { name: 'Exclusive XP Channel', value: config.xpChannel ? `<#${config.xpChannel}>` : 'None', inline: true },
      )
      .setFooter({ text: '爱 Doctora • Economy' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};