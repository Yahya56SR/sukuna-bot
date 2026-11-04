import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const pollCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll with reactions.')
    .addStringOption((option) =>
      option.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('options')
        .setDescription('Comma-separated list of options (max 10)')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addIntegerOption((option) =>
      option.setName('duration').setDescription('Duration in minutes (default 10)').setMinValue(1).setMaxValue(1440),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  execute: async (context) => {
    const { interaction } = context;
    const question = interaction.options.getString('question', true);
    const optionsStr = interaction.options.getString('options', true);
    const duration = interaction.options.getInteger('duration') ?? 10;

    const options = optionsStr.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
    if (options.length < 2) {
      await interaction.reply({
        content: '❌ You need at least 2 options.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (options.length > 10) {
      await interaction.reply({
        content: '❌ Maximum 10 options allowed.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Poll')
      .setDescription(`**${question}**`)
      .setFooter({ text: 'Vote with reactions' })
      .setTimestamp();

    const msg = await interaction.reply({
      embeds: [embed],
      fetchReply: true,
    });

    // Add reactions for each option (using number emojis for 1-9, then A, B, C, D for 10+)
    const reactionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    for (let i = 0; i < options.length; i++) {
      const emoji = reactionEmojis[i];
      if (emoji) {
        await msg.react(emoji);
      }
    }

    // Auto-close after duration
    setTimeout(async () => {
      try {
        await msg.edit({
          embeds: [
            embed.setFooter({ text: 'Poll ended — results below' }),
          ],
        });
        // Count votes
        const reactions = msg.reactions.cache;
        const results: Record<string, number> = {};
        for (let i = 0; i < options.length; i++) {
          const emoji = reactionEmojis[i];
          const reaction = reactions.get(emoji);
          if (reaction) {
            results[options[i]] = reaction.count - 1; // -1 for the bot's own addition if any
          } else {
            results[options[i]] = 0;
          }
        }

        const resultDesc = Object.entries(results)
          .map(([opt, count], idx) => `**${reactionEmojis[idx] ?? '❓'} ${opt}**: ${count} vote(s)`)
          .join('\n');

        await msg.channel.send({
          content: `📊 **Poll Results:**\n${resultDesc}`,
        });
      } catch (error) {
        console.error('Poll auto-close failed:', error);
      }
    }, duration * 60 * 1000);
  },
};