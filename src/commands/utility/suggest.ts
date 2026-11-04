import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggest a feature or idea for the bot.')
    .addStringOption((option) =>
      option.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(500),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'utility',
  execute: async (context) => {
    const { interaction } = context;
    const suggestion = interaction.options.getString('suggestion', true);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('💡 Suggestion')
      .setDescription(`**${suggestion}**`)
      .setFooter({ text: '爱 Doctora • Suggestion submitted' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // Log to a suggestions channel if configured
    const cfg = interaction.client.guilds.cache.values().next().value;
    // In a real implementation, we'd check for a suggestions channel config
    console.log(`[Suggestion] From ${interaction.user.tag}: ${suggestion}`);
  },
};