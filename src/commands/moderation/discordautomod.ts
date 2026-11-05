import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, PermissionFlagsBits, Collection } from 'discord.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const discordautomodCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('discordautomod')
    .setDescription('Manage Discord native AutoMod rules')
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all Discord AutoMod rules')
    )
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a Discord AutoMod rule')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Rule name')
        .setRequired(true)
        .setMaxLength(100)
      )
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Rule type')
        .setRequired(true)
        .addChoices(
          { name: 'Keyword', value: 'keyword' },
          { name: 'Spam', value: 'spam' },
          { name: 'Keyword Preset', value: 'keyword_preset' },
        )
      )
      .addStringOption(opt => opt
        .setName('keyword')
        .setDescription('Keywords to match (comma-separated)')
        .setRequired(false)
      )
      .addStringOption(opt => opt
        .setName('preset')
        .setDescription('Keyword preset')
        .setRequired(false)
        .addChoices(
          { name: 'Profanity', value: 'profanity' },
          { name: 'Sexual Content', value: 'sexual_content' },
          { name: 'Slurs', value: 'slurs' },
        )
      )
      .addStringOption(opt => opt
        .setName('action')
        .setDescription('Action to take')
        .setRequired(true)
        .addChoices(
          { name: 'Block Message', value: 'block_message' },
          { name: 'Send Alert', value: 'send_alert' },
          { name: 'Timeout', value: 'timeout' },
        )
      )
      .addChannelOption(opt => opt
        .setName('alert_channel')
        .setDescription('Channel for alerts (required for send_alert action)')
        .setRequired(false)
      )
      .addIntegerOption(opt => opt
        .setName('timeout_duration')
        .setDescription('Timeout duration in seconds (for timeout action)')
        .setRequired(false)
        .setMinValue(60)
        .setMaxValue(2419200)
      )
      .addBooleanOption(opt => opt
        .setName('enabled')
        .setDescription('Enable rule immediately')
        .setRequired(false)
      )
      .addChannelOption(opt => opt
        .setName('exempt_channel')
        .setDescription('Channel to exempt from rule')
        .setRequired(false)
      )
      .addRoleOption(opt => opt
        .setName('exempt_role')
        .setDescription('Role to exempt from rule')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a Discord AutoMod rule')
      .addStringOption(opt => opt
        .setName('rule_id')
        .setDescription('Rule ID to delete')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('toggle')
      .setDescription('Enable/disable a Discord AutoMod rule')
      .addStringOption(opt => opt
        .setName('rule_id')
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
      .setName('info')
      .setDescription('View details of a Discord AutoMod rule')
      .addStringOption(opt => opt
        .setName('rule_id')
        .setDescription('Rule ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    ),

  category: 'moderation',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['ManageGuild'],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'rule_id') {
      try {
        const rules = await interaction.guild?.autoModerationRules.fetch();
        if (rules) {
          const rulesArray = Array.from(rules.values());
          await interaction.respond(
            rulesArray
              .filter(r => r.id.includes(focused.value) || r.name.toLowerCase().includes(focused.value.toLowerCase()))
              .slice(0, 25)
              .map(r => ({ name: `${r.name} (${r.id})`, value: r.id }))
          );
        }
      } catch (error) {
        console.error('Failed to fetch Discord AutoMod rules:', error);
      }
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      try {
        const rules = await guild.autoModerationRules.fetch();

        if (!rules.size) {
          await interaction.reply({ content: 'No Discord AutoMod rules configured', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle('🤖 Discord Native AutoMod Rules')
          .setDescription(
            Array.from(rules.values()).map(r =>
              `**${r.name}** (${r.id})\n` +
              `Type: ${r.triggerType} | Action: ${r.actions.map(a => a.type).join(', ')}\n` +
              `Status: ${r.enabled ? '🟢 Enabled' : '🔴 Disabled'} | Exempt: ${r.exemptChannels.size} channels, ${r.exemptRoles.size} roles`
            ).join('\n\n')
          )
          .setFooter({ text: `${rules.size} rule(s)` });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        await interaction.reply({ content: `Failed to fetch rules: ${error}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const type = interaction.options.getString('type', true) as 'keyword' | 'spam' | 'keyword_preset';
      const action = interaction.options.getString('action', true) as 'block_message' | 'send_alert' | 'timeout';
      const keyword = interaction.options.getString('keyword');
      const preset = interaction.options.getString('preset') as 'profanity' | 'sexual_content' | 'slurs' | null;
      const alertChannel = interaction.options.getChannel('alert_channel');
      const timeoutDuration = interaction.options.getInteger('timeout_duration');
      const enabled = interaction.options.getBoolean('enabled') ?? true;
      const exemptChannel = interaction.options.getChannel('exempt_channel');
      const exemptRole = interaction.options.getRole('exempt_role');

      // Validate
      if (type === 'keyword' && !keyword) {
        await interaction.reply({ content: 'Keyword is required for keyword type', ephemeral: true });
        return;
      }
      if (type === 'keyword_preset' && !preset) {
        await interaction.reply({ content: 'Preset is required for keyword_preset type', ephemeral: true });
        return;
      }
      if (action === 'send_alert' && !alertChannel) {
        await interaction.reply({ content: 'Alert channel is required for send_alert action', ephemeral: true });
        return;
      }
      if (action === 'timeout' && !timeoutDuration) {
        await interaction.reply({ content: 'Timeout duration is required for timeout action', ephemeral: true });
        return;
      }

      try {
        // Build trigger metadata
        let triggerMetadata: any = {};
        if (type === 'keyword') {
          triggerMetadata.keywordFilter = keyword!.split(',').map(k => k.trim());
        } else if (type === 'keyword_preset') {
          triggerMetadata.presets = [preset!];
        } else if (type === 'spam') {
          triggerMetadata.mentionTotalLimit = 5;
          triggerMetadata.mentionRaidProtectionEnabled = true;
        }

        // Build actions
        const actions: any[] = [];
        if (action === 'block_message') {
          actions.push({ type: 1 }); // BlockMessage
        }
        if (action === 'send_alert') {
          actions.push({ type: 2, channelId: alertChannel!.id }); // SendAlert
        }
        if (action === 'timeout') {
          actions.push({ type: 3, durationSeconds: timeoutDuration! }); // Timeout
        }

        // Build exemptions
        const exemptChannels = exemptChannel ? [exemptChannel.id] : [];
        const exemptRoles = exemptRole ? [exemptRole.id] : [];

        const rule = await guild.autoModerationRules.create({
          name,
          eventType: 1, // MessageSend
          triggerType: type === 'keyword' ? 1 : type === 'spam' ? 4 : 5, // Keyword, Spam, KeywordPreset
          triggerMetadata,
          actions,
          enabled,
          exemptChannels,
          exemptRoles,
        });

        const embed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle('✅ Discord AutoMod Rule Created')
          .addFields(
            { name: 'Name', value: rule.name, inline: true },
            { name: 'ID', value: rule.id, inline: true },
            { name: 'Type', value: rule.triggerType.toString(), inline: true },
            { name: 'Enabled', value: rule.enabled ? 'Yes' : 'No', inline: true },
          );

        await interaction.reply({ embeds: [embed] });
        recordActivity('command', 'Discord AutoMod rule created', { meta: { guildId, ruleId: rule.id, type } });
      } catch (error) {
        await interaction.reply({ content: `Failed to create rule: ${error}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'delete') {
      const ruleId = interaction.options.getString('rule_id', true);

      try {
        const rule = await guild.autoModerationRules.fetch(ruleId);
        if (!rule) {
          await interaction.reply({ content: 'Rule not found', ephemeral: true });
          return;
        }

        await rule.delete();
        await interaction.reply({ content: `✅ Deleted Discord AutoMod rule: **${rule.name}**`, ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: `Failed to delete rule: ${error}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'toggle') {
      const ruleId = interaction.options.getString('rule_id', true);
      const enabled = interaction.options.getBoolean('enabled', true);

      try {
        const rule = await guild.autoModerationRules.fetch(ruleId);
        if (!rule) {
          await interaction.reply({ content: 'Rule not found', ephemeral: true });
          return;
        }

        await rule.edit({ enabled });
        await interaction.reply({ content: `${enabled ? '🟢 Enabled' : '🔴 Disabled'} Discord AutoMod rule **${rule.name}**`, ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: `Failed to toggle rule: ${error}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'info') {
      const ruleId = interaction.options.getString('rule_id', true);

      try {
        const rule = await guild.autoModerationRules.fetch(ruleId);
        if (!rule) {
          await interaction.reply({ content: 'Rule not found', ephemeral: true });
          return;
        }

        const triggerTypeNames: Record<number, string> = {
          1: 'Keyword',
          4: 'Spam',
          5: 'Keyword Preset',
        };
        const actionTypeNames: Record<number, string> = {
          1: 'Block Message',
          2: 'Send Alert',
          3: 'Timeout',
        };

        const embed = new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle(`🤖 Discord AutoMod Rule: ${rule.name}`)
          .addFields(
            { name: 'ID', value: rule.id, inline: true },
            { name: 'Enabled', value: rule.enabled ? '🟢 Yes' : '🔴 No', inline: true },
            { name: 'Trigger Type', value: triggerTypeNames[rule.triggerType] || 'Unknown', inline: true },
            { name: 'Actions', value: rule.actions.map(a => actionTypeNames[a.type] || 'Unknown').join(', '), inline: true },
            { name: 'Exempt Channels', value: rule.exemptChannels.size.toString(), inline: true },
            { name: 'Exempt Roles', value: rule.exemptRoles.size.toString(), inline: true },
            { name: 'Creator', value: `<@${rule.creatorId}>`, inline: true },
          );

        if (rule.triggerMetadata.keywordFilter?.length) {
          embed.addFields({ name: 'Keywords', value: rule.triggerMetadata.keywordFilter.join(', '), inline: false });
        }
        if (rule.triggerMetadata.presets?.length) {
          embed.addFields({ name: 'Presets', value: rule.triggerMetadata.presets.join(', '), inline: false });
        }

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        await interaction.reply({ content: `Failed to fetch rule: ${error}`, ephemeral: true });
      }
      return;
    }
  },
};