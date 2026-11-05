import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { AutoModRule, type IAutoModRule } from '../../db/models/AutoModRule.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

const automodTypes = [
  { name: 'Spam', value: 'spam', description: 'Limit messages per time window' },
  { name: 'Links/Invites', value: 'links', description: 'Block unauthorized links and Discord invites' },
  { name: 'Banned Words', value: 'words', description: 'Block messages containing banned words/phrases' },
  { name: 'Excessive Caps', value: 'caps', description: 'Block messages with too many capital letters' },
  { name: 'Excessive Mentions', value: 'mentions', description: 'Block messages with too many mentions' },
  { name: 'Attachments', value: 'attachments', description: 'Block messages with banned file types' },
  { name: 'Excessive Newlines', value: 'newlines', description: 'Block messages with too many newlines' },
  { name: 'Excessive Emojis', value: 'emojis', description: 'Block messages with too many emojis' },
  { name: 'Repeated Messages', value: 'repeated', description: 'Block users sending the same message repeatedly' },
] as const;

const automodActions = [
  { name: 'Delete Message', value: 'delete' },
  { name: 'Warn User', value: 'warn' },
  { name: 'Timeout User', value: 'timeout' },
  { name: 'Ban User', value: 'ban' },
  { name: 'Log Only', value: 'log' },
] as const;

const configKeys = [
  'maxMessages',
  'windowSeconds',
  'minLength',
  'maxCapsPercent',
  'maxMentions',
  'maxNewlines',
  'maxEmojis',
  'maxRepeated',
  'allowedDomains',
  'bannedWords',
  'regexPatterns',
  'blockedExtensions',
] as const;

type ConfigKey = typeof configKeys[number];

export const automodCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Auto-moderation system')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add an auto-mod rule')
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Rule type')
        .setRequired(true)
        .addChoices(...automodTypes)
      )
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Rule name')
        .setRequired(true)
        .setMaxLength(100)
      )
      .addStringOption(opt => opt
        .setName('actions')
        .setDescription('Actions to take (comma-separated)')
        .setRequired(true)
        .addChoices(...automodActions)
      )
      .addStringOption(opt => opt
        .setName('ignore_channels')
        .setDescription('Channels to ignore (comma-separated IDs)')
        .setRequired(false)
      )
      .addStringOption(opt => opt
        .setName('ignore_roles')
        .setDescription('Roles to ignore (comma-separated IDs)')
        .setRequired(false)
      )
      .addStringOption(opt => opt
        .setName('log_channel')
        .setDescription('Channel to log triggers')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove an auto-mod rule')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Rule ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all auto-mod rules')
    )
    .addSubcommand(sub => sub
      .setName('toggle')
      .setDescription('Enable/disable a rule')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Rule ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addBooleanOption(opt => opt
        .setName('enabled')
        .setDescription('Enable or disable')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure rule-specific settings')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Rule ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    ),

  category: 'moderation',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['ManageMessages', 'ModerateMembers', 'BanMembers'],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'id') {
      const rules = await AutoModRule.find({ guildId: interaction.guildId }).lean();
      await interaction.respond(
        rules
          .filter(r => String(r._id).includes(focused.value) || r.name.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(r => ({ name: `${r.name} (${r.type})`, value: String(r._id) }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const type = interaction.options.getString('type', true) as IAutoModRule['type'];
      const name = interaction.options.getString('name', true);
      const actionsStr = interaction.options.getString('actions', true);
      const actions = actionsStr.split(',').map(a => a.trim()) as IAutoModRule['actions'];
      const ignoreChannels = interaction.options.getString('ignore_channels')?.split(',').map(c => c.trim()) || [];
      const ignoreRoles = interaction.options.getString('ignore_roles')?.split(',').map(r => r.trim()) || [];
      const logChannel = interaction.options.getString('log_channel') ?? undefined;

      // Validate actions
      const validActions = ['delete', 'warn', 'timeout', 'ban', 'log'];
      for (const action of actions) {
        if (!validActions.includes(action)) {
          await interaction.reply({ content: `Invalid action: ${action}. Valid: ${validActions.join(', ')}`, ephemeral: true });
          return;
        }
      }

      // Create rule with default config
      const defaultConfig = getDefaultConfig(type);
      const rule = await AutoModRule.create({
        guildId,
        name,
        type,
        enabled: true,
        actions,
        ignoreChannels,
        ignoreRoles,
        logChannel,
        config: defaultConfig,
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Auto-Mod Rule Created')
        .addFields(
          { name: 'Name', value: rule.name, inline: true },
          { name: 'Type', value: rule.type, inline: true },
          { name: 'Actions', value: rule.actions.join(', '), inline: true },
          { name: 'ID', value: String(rule._id), inline: true },
        )
        .setFooter({ text: 'Use /automod config to adjust rule-specific settings' });

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'AutoMod rule added', { meta: { guildId, ruleId: String(rule._id), type } });
      return;
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      const rule = await AutoModRule.findOneAndDelete({ _id: id, guildId });
      if (!rule) {
        await interaction.reply({ content: 'Rule not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `✅ Deleted rule: **${rule.name}**`, ephemeral: true });
      recordActivity('command', 'AutoMod rule removed', { meta: { guildId, ruleId: id } });
      return;
    }

    if (sub === 'list') {
      const rules = await AutoModRule.find({ guildId }).lean();
      if (!rules.length) {
        await interaction.reply({ content: 'No auto-mod rules configured', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🛡️ Auto-Mod Rules')
        .setDescription(rules.map(r =>
          `**${r.name}** (${r.type}) — ${r.enabled ? '🟢' : '🔴'} — Actions: ${r.actions.join(', ')} — ID: \`${r._id}\``
        ).join('\n'))
        .setFooter({ text: `${rules.length} rule(s)` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'toggle') {
      const id = interaction.options.getString('id', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      const rule = await AutoModRule.findOneAndUpdate({ _id: id, guildId }, { enabled }, { new: true });
      if (!rule) {
        await interaction.reply({ content: 'Rule not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `${enabled ? '🟢 Enabled' : '🔴 Disabled'} **${rule.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'config') {
      const id = interaction.options.getString('id', true);
      const rule = await AutoModRule.findOne({ _id: id, guildId }).lean();
      if (!rule) {
        await interaction.reply({ content: 'Rule not found', ephemeral: true });
        return;
      }

      // Show config modal based on rule type
      const modal = buildConfigModal(rule);
      await interaction.showModal(modal);
      return;
    }
  },
};

function getDefaultConfig(type: IAutoModRule['type']): IAutoModRule['config'] {
  const defaults: Record<string, IAutoModRule['config']> = {
    spam: { maxMessages: 5, windowSeconds: 10 },
    links: { allowedDomains: [] },
    invites: { allowedDomains: [] },
    words: { bannedWords: [], regexPatterns: [] },
    caps: { minLength: 10, maxCapsPercent: 70 },
    mentions: { maxMentions: 5 },
    attachments: { blockedExtensions: ['exe', 'bat', 'cmd', 'scr', 'pif', 'com', 'jar', 'msi'] },
    newlines: { maxNewlines: 20 },
    emojis: { maxEmojis: 20 },
    repeated: { maxRepeated: 3 },
  };
  return defaults[type] || {};
}

function buildConfigModal(rule: IAutoModRule) {
  const modal = new ModalBuilder()
    .setCustomId(`automod_config:${rule._id}`)
    .setTitle(`Configure: ${rule.name}`);

  const config = rule.config;

  switch (rule.type) {
    case 'spam': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxMessages')
            .setLabel('Max Messages')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxMessages ?? 5))
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('windowSeconds')
            .setLabel('Time Window (seconds)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.windowSeconds ?? 10))
            .setRequired(true)
        )
      );
      break;
    }
    case 'links':
    case 'invites': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('allowedDomains')
            .setLabel('Allowed Domains (comma-separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(config.allowedDomains?.join(', ') || '')
            .setRequired(false)
            .setPlaceholder('example.com, discord.gg')
        )
      );
      break;
    }
    case 'words': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('bannedWords')
            .setLabel('Banned Words (comma-separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(config.bannedWords?.join(', ') || '')
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('regexPatterns')
            .setLabel('Regex Patterns (one per line)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(config.regexPatterns?.join('\n') || '')
            .setRequired(false)
            .setPlaceholder('(?i)badword\n^spam$')
        )
      );
      break;
    }
    case 'caps': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('minLength')
            .setLabel('Min Message Length')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.minLength ?? 10))
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxCapsPercent')
            .setLabel('Max Caps Percentage')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxCapsPercent ?? 70))
            .setRequired(true)
        )
      );
      break;
    }
    case 'mentions': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxMentions')
            .setLabel('Max Mentions Per Message')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxMentions ?? 5))
            .setRequired(true)
        )
      );
      break;
    }
    case 'attachments': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('blockedExtensions')
            .setLabel('Blocked Extensions (comma-separated)')
            .setStyle(TextInputStyle.Short)
            .setValue(config.blockedExtensions?.join(', ') || 'exe,bat,cmd,scr')
            .setRequired(true)
        )
      );
      break;
    }
    case 'newlines': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxNewlines')
            .setLabel('Max Newlines')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxNewlines ?? 20))
            .setRequired(true)
        )
      );
      break;
    }
    case 'emojis': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxEmojis')
            .setLabel('Max Emojis')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxEmojis ?? 20))
            .setRequired(true)
        )
      );
      break;
    }
    case 'repeated': {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('maxRepeated')
            .setLabel('Max Repeated Messages')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.maxRepeated ?? 3))
            .setRequired(true)
        )
      );
      break;
    }
  }

  return modal;
}

// Handle modal submit
export async function handleAutomodConfigModal(interaction: any) {
  const [, ruleId] = interaction.customId.split(':');
  const rule = await AutoModRule.findById(ruleId);
  if (!rule) return interaction.reply({ content: 'Rule not found', ephemeral: true });

  const config: Record<string, unknown> = { ...rule.config };
  const fields = interaction.fields.fields;

  for (const [key, value] of fields) {
    if (configKeys.includes(key as ConfigKey)) {
      switch (key) {
        case 'maxMessages':
        case 'windowSeconds':
        case 'minLength':
        case 'maxCapsPercent':
        case 'maxMentions':
        case 'maxNewlines':
        case 'maxEmojis':
        case 'maxRepeated':
          config[key] = parseInt(value, 10);
          break;
        case 'allowedDomains':
          config[key] = value.split(',').map((d: string) => d.trim()).filter(Boolean);
          break;
        case 'bannedWords':
          config[key] = value.split(',').map((w: string) => w.trim()).filter(Boolean);
          break;
        case 'regexPatterns':
          config[key] = value.split('\n').map((p: string) => p.trim()).filter(Boolean);
          break;
        case 'blockedExtensions':
          config[key] = value.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
          break;
      }
    }
  }

  rule.config = config;
  await rule.save();

  await interaction.reply({ content: '✅ Configuration saved', ephemeral: true });
}

export async function handleTagEmbedModal(interaction: any) {
  const [, name] = interaction.customId.split(':');
  const guildId = interaction.guildId!;

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const colorStr = interaction.fields.getTextInputValue('color');
  const footer = interaction.fields.getTextInputValue('footer');
  const image = interaction.fields.getTextInputValue('image');

  // Import here to avoid circular dependency
  const { CustomCommand } = await import('../../db/models/CustomCommand.js');
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