import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, Message, TextChannel, Role } from 'discord.js';
import { ReactionRolePanel, type IReactionRolePanel, type IReactionRoleOption } from '../../db/models/ReactionRolePanel.js';
import { sendPanel, handleButtonInteraction, handleSelectMenuInteraction, initReactionRoles } from '../../handlers/reactionRoles.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

const modes = [
  { name: 'Unique (one role at a time)', value: 'unique' },
  { name: 'Verify (one-time button)', value: 'verify' },
  { name: 'Reversed (click to remove)', value: 'reversed' },
  { name: 'Binding (requires role)', value: 'binding' },
  { name: 'Temporary (time-limited)', value: 'temporary' },
  { name: 'Normal (toggle)', value: 'normal' },
] as const;

const buttonStyles = [
  { name: 'Primary (Blurple)', value: 1 },
  { name: 'Secondary (Gray)', value: 2 },
  { name: 'Success (Green)', value: 3 },
  { name: 'Danger (Red)', value: 4 },
] as const;

export const reactionroleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Button-based reaction roles')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a reaction role panel')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel to send panel')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('title')
        .setDescription('Panel title')
        .setRequired(true)
        .setMaxLength(256)
      )
      .addStringOption(opt => opt
        .setName('mode')
        .setDescription('Panel mode')
        .setRequired(true)
        .addChoices(...modes)
      )
      .addStringOption(opt => opt
        .setName('description')
        .setDescription('Panel description')
        .setRequired(false)
        .setMaxLength(4000)
      )
      .addStringOption(opt => opt
        .setName('temporary_duration')
        .setDescription('Duration for temporary roles (e.g., 1h, 30m, 1d)')
        .setRequired(false)
      )
      .addRoleOption(opt => opt
        .setName('binding_role')
        .setDescription('Required role for binding mode')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('use_buttons')
        .setDescription('Use buttons instead of select menu')
        .setRequired(false)
      )
      .addIntegerOption(opt => opt
        .setName('button_style')
        .setDescription('Button style')
        .setRequired(false)
        .addChoices(...buttonStyles)
      )
      .addStringOption(opt => opt
        .setName('color')
        .setDescription('Embed color (hex)')
        .setRequired(false)
      )
      .addStringOption(opt => opt
        .setName('thumbnail')
        .setDescription('Thumbnail URL')
        .setRequired(false)
      )
      .addStringOption(opt => opt
        .setName('image')
        .setDescription('Image URL')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('dm_user')
        .setDescription('DM user on role change')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a role to a panel')
      .addStringOption(opt => opt
        .setName('panel')
        .setDescription('Panel ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to add')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('emoji')
        .setDescription('Emoji (unicode or custom)')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('label')
        .setDescription('Button/option label')
        .setRequired(false)
        .setMaxLength(80)
      )
      .addStringOption(opt => opt
        .setName('description')
        .setDescription('Option description (for select menu)')
        .setRequired(false)
        .setMaxLength(100)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a role from a panel')
      .addStringOption(opt => opt
        .setName('panel')
        .setDescription('Panel ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to remove')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all panels')
    )
    .addSubcommand(sub => sub
      .setName('send')
      .setDescription('Send/resend a panel')
      .addStringOption(opt => opt
        .setName('panel')
        .setDescription('Panel ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel to send to (default: panel channel)')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a panel')
      .addStringOption(opt => opt
        .setName('panel')
        .setDescription('Panel ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('toggle')
      .setDescription('Enable/disable a panel')
      .addStringOption(opt => opt
        .setName('panel')
        .setDescription('Panel ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addBooleanOption(opt => opt
        .setName('enabled')
        .setDescription('Enable or disable')
        .setRequired(true)
      )
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles', 'SendMessages', 'EmbedLinks'],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'panel') {
      const panels = await ReactionRolePanel.find({ guildId: interaction.guildId }).lean();
      await interaction.respond(
        panels
          .filter(p => String(p._id).includes(focused.value) || p.title.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(p => ({ name: `${p.title} (${p.mode})`, value: String(p._id) }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description') ?? undefined;
      const mode = interaction.options.getString('mode', true) as IReactionRolePanel['mode'];
      const temporaryDurationStr = interaction.options.getString('temporary_duration');
      const bindingRole = interaction.options.getRole('binding_role');
      const useButtons = interaction.options.getBoolean('use_buttons') ?? true;
      const buttonStyle = interaction.options.getInteger('button_style') as 1 | 2 | 3 | 4 | null;
      const color = interaction.options.getString('color');
      const thumbnail = interaction.options.getString('thumbnail');
      const image = interaction.options.getString('image');
      const dmUser = interaction.options.getBoolean('dm_user') ?? false;

      // Parse temporary duration
      let temporaryDuration: number | undefined;
      if (temporaryDurationStr) {
        const match = temporaryDurationStr.match(/^(\d+)([smhd])$/);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2];
          const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
          temporaryDuration = value * (multipliers[unit] || 1);
        }
      }

      // Validate mode requirements
      if (mode === 'temporary' && !temporaryDuration) {
        await interaction.editReply({ content: 'Temporary mode requires a duration' });
        return;
      }
      if (mode === 'binding' && !bindingRole) {
        await interaction.editReply({ content: 'Binding mode requires a binding role' });
        return;
      }

      // Create panel with no options initially (will add via /rr add)
      const panel = await ReactionRolePanel.create({
        guildId,
        channelId: channel.id,
        title,
        description,
        color: color ? parseInt(color.replace('#', ''), 16) : undefined,
        thumbnail: thumbnail ?? undefined,
        image: image ?? undefined,
        mode,
        temporaryDuration,
        bindingRoleId: bindingRole?.id,
        options: [],
        useButtons,
        buttonStyle: buttonStyle ?? 2,
        dmUser,
        active: true,
      }) as IReactionRolePanel;

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Reaction Role Panel Created')
        .addFields(
          { name: 'Title', value: panel.title, inline: true },
          { name: 'Channel', value: `<#${panel.channelId}>`, inline: true },
          { name: 'Mode', value: panel.mode, inline: true },
          { name: 'ID', value: String(panel._id), inline: true },
        )
        .setFooter({ text: 'Use /reactionrole add to add roles to this panel' });

      await interaction.editReply({ embeds: [embed] });
      recordActivity('command', 'ReactionRole panel created', { meta: { guildId, panelId: String(panel._id) } });
      return;
    }

    if (sub === 'add') {
      const panelId = interaction.options.getString('panel', true);
      const role = interaction.options.getRole('role', true);
      const emoji = interaction.options.getString('emoji', true);
      const label = interaction.options.getString('label');
      const description = interaction.options.getString('description');

      const panel = await ReactionRolePanel.findOne({ _id: panelId, guildId });
      if (!panel) {
        await interaction.reply({ content: 'Panel not found', ephemeral: true });
        return;
      }

      // Check if role already exists in panel
      if (panel.options.some(o => o.roleId === role.id)) {
        await interaction.reply({ content: 'This role is already in the panel', ephemeral: true });
        return;
      }

      // Validate emoji
      if (!isValidEmoji(emoji)) {
        await interaction.reply({ content: 'Invalid emoji format', ephemeral: true });
        return;
      }

      // Check bot can manage role
      const botMember = guild.members.me;
      const targetRole = guild.roles.cache.get(role.id);
      if (!botMember || targetRole!.position >= botMember.roles.highest.position) {
        await interaction.reply({ content: 'I cannot manage this role (hierarchy)', ephemeral: true });
        return;
      }

      panel.options.push({
        roleId: role.id,
        emoji,
        label: label ?? undefined,
        description: description ?? undefined,
      });

      await panel.save();

      await interaction.reply({ content: `✅ Added **${role.name}** to panel **${panel.title}**`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const panelId = interaction.options.getString('panel', true);
      const role = interaction.options.getRole('role', true);

      const panel = await ReactionRolePanel.findOne({ _id: panelId, guildId });
      if (!panel) {
        await interaction.reply({ content: 'Panel not found', ephemeral: true });
        return;
      }

      const initialLength = panel.options.length;
      panel.options = panel.options.filter(o => o.roleId !== role.id);

      if (panel.options.length === initialLength) {
        await interaction.reply({ content: 'Role not found in panel', ephemeral: true });
        return;
      }

      await panel.save();
      await interaction.reply({ content: `✅ Removed **${role.name}** from panel **${panel.title}**`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const panels = await ReactionRolePanel.find({ guildId }).lean();
      if (!panels.length) {
        await interaction.reply({ content: 'No panels configured', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎭 Reaction Role Panels')
        .setDescription(panels.map(p =>
          `**${p.title}** (${p.mode}) — ${p.active ? '🟢' : '🔴'} — ${p.options.length} roles — <#${p.channelId}> — ID: \`${p._id}\``
        ).join('\n'))
        .setFooter({ text: `${panels.length} panel(s)` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'send') {
      await interaction.deferReply({ ephemeral: true });

      const panelId = interaction.options.getString('panel', true);
      const channel = interaction.options.getChannel('channel') as TextChannel | null;

      const panel = await ReactionRolePanel.findOne({ _id: panelId, guildId });
      if (!panel) {
        await interaction.editReply({ content: 'Panel not found' });
        return;
      }

      const targetChannel = channel || (guild.channels.cache.get(panel.channelId) as TextChannel);
      if (!targetChannel || !targetChannel.isTextBased()) {
        await interaction.editReply({ content: 'Invalid channel' });
        return;
      }

      const message = await sendPanel(panel, targetChannel);
      if (!message) {
        await interaction.editReply({ content: 'Failed to send panel' });
        return;
      }

      await interaction.editReply({ content: `✅ Panel sent to <#${targetChannel.id}>` });
      return;
    }

    if (sub === 'delete') {
      const panelId = interaction.options.getString('panel', true);
      const panel = await ReactionRolePanel.findOneAndDelete({ _id: panelId, guildId });
      if (!panel) {
        await interaction.reply({ content: 'Panel not found', ephemeral: true });
        return;
      }

      // Try to delete the message
      const ch = guild.channels.cache.get(panel.channelId) as TextChannel;
      if (ch && panel.messageId) {
        try {
          await ch.messages.delete(panel.messageId);
        } catch {}
      }

      await interaction.reply({ content: `✅ Deleted panel **${panel.title}**`, ephemeral: true });
      return;
    }

    if (sub === 'toggle') {
      const panelId = interaction.options.getString('panel', true);
      const enabled = interaction.options.getBoolean('enabled', true);

      const panel = await ReactionRolePanel.findOneAndUpdate(
        { _id: panelId, guildId },
        { active: enabled },
        { new: true }
      );
      if (!panel) {
        await interaction.reply({ content: 'Panel not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `${enabled ? '🟢 Enabled' : '🔴 Disabled'} panel **${panel.title}**`, ephemeral: true });
      return;
    }
  },
};

function isValidEmoji(emoji: string): boolean {
  // Unicode emoji
  if (emoji.match(/^[\u{1F300}-\u{1FAFF}]/u)) return true;
  // Custom Discord emoji <:name:id> or <a:name:id>
  if (emoji.match(/^<a?:[a-zA-Z0-9_]+:\d+>$/)) return true;
  // Simple text emojis
  if (emoji.length <= 4) return true;
  return false;
}

// Handle button interactions
export async function handleReactionRoleButton(interaction: any) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('rr:')) return;
  await handleButtonInteraction(interaction);
}

// Handle select menu interactions
export async function handleReactionRoleSelect(interaction: any) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith('rr_select:')) return;
  await handleSelectMenuInteraction(interaction);
}