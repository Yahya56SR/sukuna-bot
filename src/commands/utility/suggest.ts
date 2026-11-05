import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, Message } from 'discord.js';
import { Suggestion } from '../../db/models/Suggestion.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggestion system')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a suggestion')
      .addStringOption(opt => opt
        .setName('title')
        .setDescription('Suggestion title')
        .setRequired(true)
        .setMaxLength(256)
      )
      .addStringOption(opt => opt
        .setName('description')
        .setDescription('Suggestion description')
        .setRequired(true)
        .setMaxLength(4000)
      )
      .addBooleanOption(opt => opt
        .setName('anonymous')
        .setDescription('Post anonymously')
        .setRequired(false)
      )
      .addAttachmentOption(opt => opt
        .setName('attachment')
        .setDescription('Attachment to include')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List suggestions')
      .addStringOption(opt => opt
        .setName('status')
        .setDescription('Filter by status')
        .setRequired(false)
        .addChoices(
          { name: 'Pending', value: 'pending' },
          { name: 'Approved', value: 'approved' },
          { name: 'Denied', value: 'denied' },
          { name: 'Implemented', value: 'implemented' },
          { name: 'Deferred', value: 'deferred' },
        )
      )
      .addIntegerOption(opt => opt
        .setName('limit')
        .setDescription('Number to show')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
      )
    )
    .addSubcommand(sub => sub
      .setName('approve')
      .setDescription('Approve a suggestion (staff)')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Suggestion ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addStringOption(opt => opt
        .setName('reason')
        .setDescription('Reason for approval')
        .setRequired(false)
        .setMaxLength(1000)
      )
    )
    .addSubcommand(sub => sub
      .setName('deny')
      .setDescription('Deny a suggestion (staff)')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Suggestion ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addStringOption(opt => opt
        .setName('reason')
        .setDescription('Reason for denial')
        .setRequired(false)
        .setMaxLength(1000)
      )
    )
    .addSubcommand(sub => sub
      .setName('implement')
      .setDescription('Mark suggestion as implemented (staff)')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Suggestion ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a suggestion (staff/author)')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Suggestion ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: [],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'id') {
      const status = interaction.options.getString('status');
      const filter: any = { guildId: interaction.guildId };
      if (status) filter.status = status;
      const suggestions = await Suggestion.find(filter).sort({ createdAt: -1 }).limit(25).lean();
      await interaction.respond(
        suggestions
          .filter(s => String(s._id).includes(focused.value) || s.title.toLowerCase().includes(focused.value.toLowerCase()))
          .map(s => ({ name: `${s.title} (${s.status})`, value: String(s._id) }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description', true);
      const anonymous = interaction.options.getBoolean('anonymous') ?? false;
      const attachment = interaction.options.getAttachment('attachment');

      // Find suggestions channel (could be configured)
      const suggestionsChannel = guild.channels.cache.find(c => c.name.includes('suggestion')) as any;
      if (!suggestionsChannel) {
        await interaction.reply({ content: 'No suggestions channel found. Create a channel named "suggestions" or ask admin to configure.', ephemeral: true });
        return;
      }

      const suggestion = await Suggestion.create({
        guildId,
        channelId: suggestionsChannel.id,
        authorId: anonymous ? interaction.client.user.id : interaction.user.id,
        title,
        description,
        status: 'pending',
        anonymous,
        attachments: attachment ? [attachment.url] : [],
      });

      const embed = buildSuggestionEmbed(suggestion, interaction.user, anonymous);
      const buttons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId(`suggest_up:${suggestion._id}`).setLabel('👍 Upvote').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`suggest_down:${suggestion._id}`).setLabel('👎 Downvote').setStyle(ButtonStyle.Danger),
        );

      const message = await suggestionsChannel.send({ embeds: [embed], components: [buttons] });
      suggestion.messageId = message.id;
      await suggestion.save();

      await interaction.reply({ content: `✅ Suggestion submitted! Check <#${suggestionsChannel.id}>`, ephemeral: true });
      recordActivity('command', 'Suggestion created', { meta: { guildId, suggestionId: String(suggestion._id) } });
      return;
    }

    if (sub === 'list') {
      const status = interaction.options.getString('status') as any;
      const limit = interaction.options.getInteger('limit') ?? 10;

      const filter: any = { guildId };
      if (status) filter.status = status;

      const suggestions = await Suggestion.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      if (!suggestions.length) {
        await interaction.reply({ content: 'No suggestions found', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('📋 Suggestions')
        .setDescription(
          suggestions.map(s => {
            const statusEmoji = { pending: '⏳', approved: '✅', denied: '❌', implemented: '🚀', deferred: '⏸️' }[s.status] || '❓';
            const votes = s.upvotes.length - s.downvotes.length;
            return `${statusEmoji} **${s.title}** — ${votes > 0 ? '+' : ''}${votes} votes — ID: \`${s._id}\``;
          }).join('\n')
        )
        .setFooter({ text: `${suggestions.length} suggestion(s)` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'approve' || sub === 'deny' || sub === 'implement') {
      if (!interaction.memberPermissions?.has('ManageMessages')) {
        await interaction.reply({ content: 'Manage Messages permission required', ephemeral: true });
        return;
      }

      const id = interaction.options.getString('id', true);
      const reason = interaction.options.getString('reason');

      const suggestion = await Suggestion.findById(id);
      if (!suggestion || suggestion.guildId !== guildId) {
        await interaction.reply({ content: 'Suggestion not found', ephemeral: true });
        return;
      }

      const newStatus = sub === 'approve' ? 'approved' : sub === 'deny' ? 'denied' : 'implemented';
      suggestion.status = newStatus;
      suggestion.reviewedBy = interaction.user.id;
      suggestion.reviewReason = reason ?? undefined;
      suggestion.reviewedAt = new Date();
      await suggestion.save();

      // Update message
      try {
        const channel = guild.channels.cache.get(suggestion.channelId) as any;
        if (channel && suggestion.messageId) {
          const message = await channel.messages.fetch(suggestion.messageId);
          const embed = buildSuggestionEmbed(suggestion, await interaction.client.users.fetch(suggestion.authorId), suggestion.anonymous);
          await message.edit({ embeds: [embed], components: [] });
        }
      } catch {}

      // DM author
      if (!suggestion.anonymous) {
        try {
          const author = await interaction.client.users.fetch(suggestion.authorId);
          await author.send(`Your suggestion **"${suggestion.title}"** was **${newStatus}**${reason ? `: ${reason}` : ''} in **${guild.name}**`).catch(() => {});
        } catch {}
      }

      await interaction.reply({ content: `✅ Suggestion **${newStatus}**`, ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getString('id', true);
      const suggestion = await Suggestion.findById(id);
      if (!suggestion || suggestion.guildId !== guildId) {
        await interaction.reply({ content: 'Suggestion not found', ephemeral: true });
        return;
      }

      // Check permissions
      const isAuthor = suggestion.authorId === interaction.user.id;
      const isStaff = interaction.memberPermissions?.has('ManageMessages');
      if (!isAuthor && !isStaff) {
        await interaction.reply({ content: 'You can only delete your own suggestions', ephemeral: true });
        return;
      }

      // Delete message
      try {
        const channel = guild.channels.cache.get(suggestion.channelId) as any;
        if (channel && suggestion.messageId) {
          await channel.messages.delete(suggestion.messageId);
        }
      } catch {}

      await suggestion.deleteOne();
      await interaction.reply({ content: '✅ Suggestion deleted', ephemeral: true });
      return;
    }
  },
};

function buildSuggestionEmbed(suggestion: any, author: any, anonymous: boolean): EmbedBuilder {
  const statusColors: Record<string, number> = { pending: Colors.Yellow, approved: Colors.Green, denied: Colors.Red, implemented: Colors.Blue, deferred: Colors.Grey };
  const statusLabels: Record<string, string> = { pending: '⏳ Pending', approved: '✅ Approved', denied: '❌ Denied', implemented: '🚀 Implemented', deferred: '⏸️ Deferred' };
  const status = String(suggestion.status);

  const embed = new EmbedBuilder()
    .setColor(statusColors[status] || Colors.Blurple)
    .setTitle(suggestion.title)
    .setDescription(suggestion.description)
    .addFields(
      { name: 'Status', value: statusLabels[status] || status, inline: true },
      { name: 'Votes', value: `👍 ${suggestion.upvotes.length} | 👎 ${suggestion.downvotes.length}`, inline: true },
      { name: 'Author', value: anonymous ? 'Anonymous' : author?.tag || 'Unknown', inline: true },
    )
    .setFooter({ text: `ID: ${suggestion._id}` })
    .setTimestamp(suggestion.createdAt);

  if (suggestion.reviewedBy) {
    embed.addFields({ name: 'Reviewed by', value: `<@${suggestion.reviewedBy}>`, inline: true });
  }
  if (suggestion.reviewReason) {
    embed.addFields({ name: 'Reason', value: suggestion.reviewReason, inline: false });
  }
  if (suggestion.attachments.length) {
    embed.setImage(suggestion.attachments[0]);
  }

  return embed;
}

// Handle suggestion votes
export async function handleSuggestionVote(interaction: any): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('suggest_')) return;

  const [, action, suggestionId] = interaction.customId.split(':');
  if (!action || !suggestionId) return;

  const suggestion = await Suggestion.findById(suggestionId);
  if (!suggestion) return interaction.reply({ content: 'Suggestion not found', ephemeral: true });

  const userId = interaction.user.id;
  const isUpvote = action === 'up';

  // Check if already voted
  const upvoted = suggestion.upvotes.includes(userId);
  const downvoted = suggestion.downvotes.includes(userId);

  if (isUpvote) {
    if (upvoted) {
      suggestion.upvotes = suggestion.upvotes.filter((id: string) => id !== userId);
    } else {
      suggestion.upvotes.push(userId);
      suggestion.downvotes = suggestion.downvotes.filter((id: string) => id !== userId);
    }
  } else {
    if (downvoted) {
      suggestion.downvotes = suggestion.downvotes.filter((id: string) => id !== userId);
    } else {
      suggestion.downvotes.push(userId);
      suggestion.upvotes = suggestion.upvotes.filter((id: string) => id !== userId);
    }
  }

  await suggestion.save();

  // Update message
  try {
    const guild = interaction.guild!;
    const channel = guild.channels.cache.get(suggestion.channelId) as any;
    if (channel && suggestion.messageId) {
      const message = await channel.messages.fetch(suggestion.messageId);
      const author = await interaction.client.users.fetch(suggestion.authorId);
      const embed = buildSuggestionEmbed(suggestion, author, suggestion.anonymous);
      await message.edit({ embeds: [embed] });
    }
  } catch {}

  await interaction.reply({ content: isUpvote ? '👍 Upvoted!' : '👎 Downvoted!', ephemeral: true });
}