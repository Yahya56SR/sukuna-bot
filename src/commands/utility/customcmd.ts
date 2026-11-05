import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { CustomCommand, type ICustomCommand } from '../../db/models/CustomCommand.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const customcmdCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Custom commands (tags)')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a custom command')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name (trigger)')
        .setRequired(true)
        .setMaxLength(100)
      )
      .addStringOption(opt => opt
        .setName('content')
        .setDescription('Response content')
        .setRequired(true)
        .setMaxLength(4000)
      )
      .addStringOption(opt => opt
        .setName('aliases')
        .setDescription('Aliases (comma-separated)')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a custom command')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addStringOption(opt => opt
        .setName('content')
        .setDescription('New content')
        .setRequired(true)
        .setMaxLength(4000)
      )
    )
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a custom command')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View a custom command')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all custom commands')
    )
    .addSubcommand(sub => sub
      .setName('alias')
      .setDescription('Add/remove alias')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addStringOption(opt => opt
        .setName('alias')
        .setDescription('Alias to add/remove')
        .setRequired(true)
      )
      .addBooleanOption(opt => opt
        .setName('remove')
        .setDescription('Remove instead of add')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('embed')
      .setDescription('Create/edit with embed')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Command name')
        .setRequired(true)
        .setAutocomplete(true)
      )
    ),

  category: 'utility',
  cooldownSeconds: 3,
  userPermissions: ['ManageMessages'],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'name') {
      const tags = await CustomCommand.find({ guildId: interaction.guildId }).lean();
      await interaction.respond(
        tags
          .filter(t => t.name.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(t => ({ name: t.name, value: t.name }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const content = interaction.options.getString('content', true);
      const aliasesStr = interaction.options.getString('aliases');
      const aliases = aliasesStr ? aliasesStr.split(',').map(a => a.trim().toLowerCase()).filter(Boolean) : [];

      // Check if exists
      const existing = await CustomCommand.findOne({ guildId, name });
      if (existing) {
        await interaction.reply({ content: 'A command with this name already exists', ephemeral: true });
        return;
      }

      // Check aliases don't conflict
      for (const alias of aliases) {
        const conflict = await CustomCommand.findOne({ guildId, $or: [{ name: alias }, { aliases: alias }] });
        if (conflict) {
          await interaction.reply({ content: `Alias "${alias}" conflicts with existing command`, ephemeral: true });
          return;
        }
      }

      const tag = await CustomCommand.create({
        guildId,
        name,
        aliases,
        content,
        creatorId: interaction.user.id,
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Custom Command Created')
        .addFields(
          { name: 'Name', value: `/${tag.name}`, inline: true },
          { name: 'Aliases', value: tag.aliases.length ? tag.aliases.map(a => `/${a}`).join(', ') : 'None', inline: true },
          { name: 'Content', value: tag.content.slice(0, 1000), inline: false },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'Custom command created', { meta: { guildId, name: tag.name } });
      return;
    }

    if (sub === 'edit') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const content = interaction.options.getString('content', true);

      const tag = await CustomCommand.findOneAndUpdate(
        { guildId, name },
        { content },
        { new: true }
      );
      if (!tag) {
        await interaction.reply({ content: 'Command not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `✅ Updated **/${tag.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await CustomCommand.findOneAndDelete({ guildId, name });
      if (!tag) {
        await interaction.reply({ content: 'Command not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `✅ Deleted **/${tag.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'info') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await CustomCommand.findOne({ guildId, name });
      if (!tag) {
        await interaction.reply({ content: 'Command not found', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle(`📝 Custom Command: /${tag.name}`)
        .addFields(
          { name: 'Content', value: tag.content.slice(0, 2000), inline: false },
          { name: 'Aliases', value: tag.aliases.length ? tag.aliases.map(a => `/${a}`).join(', ') : 'None', inline: true },
          { name: 'Uses', value: tag.uses.toString(), inline: true },
          { name: 'Creator', value: `<@${tag.creatorId}>`, inline: true },
          { name: 'Cooldown', value: `${tag.cooldown ?? 0}s`, inline: true },
          { name: 'NSFW', value: tag.nsfw ? 'Yes' : 'No', inline: true },
          { name: 'Enabled', value: tag.enabled ? 'Yes' : 'No', inline: true },
        )
        .setTimestamp(tag.createdAt);

      if (tag.embed) {
        embed.addFields({ name: 'Embed', value: 'Yes (custom)', inline: true });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const tags = await CustomCommand.find({ guildId }).sort({ name: 1 }).lean();
      if (!tags.length) {
        await interaction.reply({ content: 'No custom commands', ephemeral: true });
        return;
      }

      const chunks: string[] = [];
      let current = '';
      for (const tag of tags) {
        const line = `**/${tag.name}**${tag.aliases.length ? ` (${tag.aliases.map(a => `/${a}`).join(', ')})` : ''} — ${tag.uses} uses\n`;
        if (current.length + line.length > 4000) {
          chunks.push(current);
          current = '';
        }
        current += line;
      }
      if (current) chunks.push(current);

      const embeds = chunks.map((chunk, i) => new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle(`📋 Custom Commands (Page ${i + 1}/${chunks.length})`)
        .setDescription(chunk)
        .setFooter({ text: `${tags.length} total` })
      );

      await interaction.reply({ embeds: embeds.slice(0, 10), ephemeral: true });
      return;
    }

    if (sub === 'alias') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const alias = interaction.options.getString('alias', true).toLowerCase();
      const remove = interaction.options.getBoolean('remove') ?? false;

      const tag = await CustomCommand.findOne({ guildId, name });
      if (!tag) {
        await interaction.reply({ content: 'Command not found', ephemeral: true });
        return;
      }

      if (remove) {
        if (!tag.aliases.includes(alias)) {
          await interaction.reply({ content: 'Alias not found', ephemeral: true });
          return;
        }
        tag.aliases = tag.aliases.filter(a => a !== alias);
      } else {
        if (tag.aliases.includes(alias)) {
          await interaction.reply({ content: 'Alias already exists', ephemeral: true });
          return;
        }
        // Check conflict
        const conflict = await CustomCommand.findOne({ guildId, $or: [{ name: alias }, { aliases: alias }] });
        if (conflict) {
          await interaction.reply({ content: `Alias conflicts with existing command`, ephemeral: true });
          return;
        }
        tag.aliases.push(alias);
      }

      await tag.save();
      await interaction.reply({ content: `${remove ? 'Removed' : 'Added'} alias **/${alias}** for **/${name}**`, ephemeral: true });
      return;
    }

    if (sub === 'embed') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await CustomCommand.findOne({ guildId, name });

      const modal = new ModalBuilder()
        .setCustomId(`tag_embed:${name}`)
        .setTitle(tag ? `Edit Embed: /${name}` : `Create Embed Command: /${name}`);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setValue(tag?.embed?.title || '')
            .setMaxLength(256)
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(tag?.embed?.description || '')
            .setMaxLength(4000)
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('color')
            .setLabel('Color (hex, e.g., #ff0000)')
            .setStyle(TextInputStyle.Short)
            .setValue(tag?.embed?.color ? '#' + tag.embed.color.toString(16).padStart(6, '0') : '')
            .setMaxLength(7)
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('footer')
            .setLabel('Footer Text')
            .setStyle(TextInputStyle.Short)
            .setValue(tag?.embed?.footer || '')
            .setMaxLength(2048)
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setValue(tag?.embed?.image || '')
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }
  },
};

// Handle embed modal
export async function handleTagEmbedModal(interaction: any) {
  const [, name] = interaction.customId.split(':');
  const guildId = interaction.guildId!;

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const colorStr = interaction.fields.getTextInputValue('color');
  const footer = interaction.fields.getTextInputValue('footer');
  const image = interaction.fields.getTextInputValue('image');

  const tag = await CustomCommand.findOne({ guildId, name });
  if (!tag) return interaction.reply({ content: 'Command not found', ephemeral: true });

  const color = colorStr ? parseInt(colorStr.replace('#', ''), 16) : undefined;

  tag.embed = {
    title: title || undefined,
    description: description || undefined,
    color,
    footer: footer || undefined,
    image: image || undefined,
  };

  await tag.save();

  const { EmbedBuilder, Colors } = await import('discord.js');
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('✅ Embed Updated')
    .setDescription(`Custom command **/${name}** now has a custom embed`);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Execute custom command (called from message handler)
export async function executeCustomCommand(message: any, commandName: string, args: string[]) {
  const guildId = message.guildId;
  if (!guildId) return false;

  const tag = await CustomCommand.findOne({
    guildId,
    $or: [{ name: commandName }, { aliases: commandName }],
    enabled: true,
  });

  if (!tag) return false;

  // Check permissions
  if (tag.requiredPermissions?.length) {
    const hasPerm = tag.requiredPermissions.every(p => message.member.permissions.has(p));
    if (!hasPerm) return false;
  }
  if (tag.requiredRoles?.length) {
    const hasRole = tag.requiredRoles.some(r => message.member.roles.cache.has(r));
    if (!hasRole) return false;
  }
  if (tag.nsfw && !message.channel.nsfw) {
    return message.reply({ content: 'This command can only be used in NSFW channels', ephemeral: true });
  }

  // Check cooldown
  if ((tag.cooldown ?? 0) > 0) {
    // Implement cooldown tracking
  }

  // Increment uses
  tag.uses++;
  await tag.save();

  // Process variables in content
  let content = tag.content
    .replace(/{user}/g, message.author.toString())
    .replace(/{user.name}/g, message.author.username)
    .replace(/{user.id}/g, message.author.id)
    .replace(/{server}/g, message.guild?.name || 'DM')
    .replace(/{channel}/g, message.channel.toString())
    .replace(/{args}/g, args.join(' '))
    .replace(/{random:(\d+)}/g, (_, max) => Math.floor(Math.random() * parseInt(max)).toString());

  if (tag.embed) {
    const { EmbedBuilder, Colors } = await import('discord.js');
    const embed = new EmbedBuilder()
      .setColor(tag.embed.color || Colors.Blurple)
      .setDescription(content);

    if (tag.embed.title) embed.setTitle(tag.embed.title);
    if (tag.embed.description) embed.setDescription(tag.embed.description);
    if (tag.embed.footer) embed.setFooter({ text: tag.embed.footer });
    if (tag.embed.image) embed.setImage(tag.embed.image);
    if (tag.embed.thumbnail) embed.setThumbnail(tag.embed.thumbnail);
    if (tag.embed.author) embed.setAuthor({ name: tag.embed.author.name, iconURL: tag.embed.author.icon });
    if (tag.embed.fields) embed.addFields(tag.embed.fields);

    await message.reply({ embeds: [embed] });
  } else {
    await message.reply(content);
  }

  recordActivity('command', 'Custom command executed', { meta: { guildId, name: tag.name } });
  return true;
}