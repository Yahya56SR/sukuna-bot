import {
  SlashCommandBuilder,
  EmbedBuilder,
  Interaction,
  TextChannel,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const pollCreateCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('poll-create')
    .setDescription('Create a poll message (owner only).')
    .addStringOption((option) =>
      option.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(200),
    )
    .addStringOption((option) =>
      option.setName('options').setDescription('Comma-separated options').setRequired(true).setMaxLength(200),
    )
    .addIntegerOption((option) =>
      option.setName('duration').setDescription('Duration in minutes').setMinValue(1).setMaxValue(1440),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'utility',
  execute: async (context) => {
    const { interaction } = context;
    const question = interaction.options.getString('question', true);
    const optionsStr = interaction.options.getString('options', true);
    const duration = interaction.options.getInteger('duration') ?? 10;

    const options = optionsStr.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
    if (options.length < 2 || options.length > 10) {
      await interaction.reply({
        content: '❌ You need 2-10 options.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Must be in a guild text channel
    if (!interaction.guild || !(interaction.channel instanceof TextChannel)) {
      await interaction.reply({
        content: '❌ Polls can only be created in a server text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel as TextChannel;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Poll')
      .setDescription(`**${question}**`)
      .setFooter({ text: 'Vote with reactions' })
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] });

    // Add reactions
    const reactionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    for (let i = 0; i < options.length; i++) {
      await msg.react(reactionEmojis[i]);
    }

    // Auto-close after duration
    setTimeout(async () => {
      try {
        await msg.edit({
          embeds: [
            embed.setFooter({ text: 'Poll ended — results below' }),
          ],
        });
        const reactions = msg.reactions.cache;
        const results: Record<string, number> = {};
        for (let i = 0; i < options.length; i++) {
          const emoji = reactionEmojis[i];
          const reaction = reactions.get(emoji);
          if (reaction) {
            results[options[i]] = reaction.count - 1;
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
    }, (duration ?? 10) * 60 * 1000);

    await interaction.reply({ content: '✅ Poll created and will auto-close.', flags: MessageFlags.Ephemeral });
  },
};