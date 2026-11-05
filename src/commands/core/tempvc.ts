import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type VoiceChannel,
  type CategoryChannel,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import {
  upsertTempVCConfig,
  deleteTempVCConfig,
  readTempVCConfig,
  clearTempVCConfigCache,
} from '../../db/models/TempVC.js';
import { replyError } from '../../core/respond.js';

export const tempvcCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tempvc')
    .setDescription('Join-to-create temporary voice channels.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription(
          'Set the voice channel members join to create their own temp VC (and its category).',
        )
        .addChannelOption((option) =>
          option
            .setName('create_channel')
            .setDescription(
              'The voice channel members join to create a temp VC (leave empty to disable)',
            )
            .addChannelTypes(ChannelType.GuildVoice),
        )
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('Category to create temp VCs under (default: current category)')
            .addChannelTypes(ChannelType.GuildCategory),
        ),
    )
    .addSubcommand((sub) => sub.setName('remove').setDescription('Disable the join-to-create temp VC system.'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the current temp VC configuration.'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Change a temp VC setting.')
        .addStringOption((o) =>
          o
            .setName('key')
            .setDescription('Setting to change')
            .setRequired(true)
            .addChoices(
              { name: 'name-template', value: 'nameTemplate' },
              { name: 'user-limit', value: 'userLimit' },
              { name: 'bitrate', value: 'bitrate' },
            ),
        )
        .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true)),
    ),
  category: 'utility',
  botPermissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect],
  execute: async (context) => {
    const { interaction, guild } = context;
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'setup') {
      await handleSetup(context);
      return;
    }

    if (subcommand === 'remove') {
      await handleRemove(context);
      return;
    }

    if (subcommand === 'status') {
      await handleStatus(context);
      return;
    }

    if (subcommand === 'set') {
      await handleSet(context);
      return;
    }
  },
};

async function handleSetup(context: { interaction: any; guild: Guild }) {
  const { interaction, guild } = context;

  const createChannel =
    (interaction.options.getChannel('create_channel') as VoiceChannel | null) ?? null;

  const category =
    (interaction.options.getChannel('category') as CategoryChannel | null) ?? null;

  // If no create channel is given but a category is, just update the category
  // of the existing config rather than disabling the whole system.
  if (!createChannel && category) {
    const existing = await readTempVCConfig(guild.id);
    if (!existing) {
      await interaction.reply({
        content: '❌ No temp VC system is configured yet. Run `/tempvc setup` with a create channel first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await upsertTempVCConfig(guild.id, { categoryId: category.id });
    clearTempVCConfigCache(guild.id);
    await interaction.reply({
      content: `✅ Temp VC category updated to <#${category.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // If no create channel and no category, disable the system.
  if (!createChannel) {
    await deleteTempVCConfig(guild.id);
    clearTempVCConfigCache(guild.id);
    await interaction.reply({
      content: '✅ Join-to-create temp VC disabled.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await upsertTempVCConfig(guild.id, {
    createChannelId: createChannel.id,
    categoryId: category?.id ?? undefined,
  });
  clearTempVCConfigCache(guild.id);

  const targetCategory = category ?? createChannel.parent;
  await interaction.reply({
    content:
      `✅ Temp VC system enabled. Members who join <#${createChannel.id}> will get their own ` +
      `temporary voice channel${targetCategory ? ` under **${targetCategory.name}**` : ''}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(context: { interaction: any; guild: Guild }) {
  const { interaction, guild } = context;

  await deleteTempVCConfig(guild.id);
  clearTempVCConfigCache(guild.id);

  await interaction.reply({
    content: '✅ Join-to-create temp VC system removed.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(context: { interaction: any; guild: Guild }) {
  const { interaction, guild } = context;

  const config = await readTempVCConfig(guild.id);
  if (!config) {
    await interaction.reply({
      content: '❌ Temp VC system is not configured. Use `/tempvc setup`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔊 Temp VC Configuration')
    .addFields(
      {
        name: 'Create Channel',
        value: config.createChannelId ? `<#${config.createChannelId}>` : 'None (disabled)',
        inline: true,
      },
      {
        name: 'Category',
        value: config.categoryId ? `<#${config.categoryId}>` : 'Same as create channel',
        inline: true,
      },
      {
        name: 'Name Template',
        value: config.nameTemplate,
        inline: false,
      },
      {
        name: 'User Limit',
        value: String(config.userLimit ?? 0) + (config.userLimit ? ' (0 = unlimited)' : ''),
        inline: true,
      },
      {
        name: 'Bitrate',
        value: String(config.bitrate ?? 0) + (config.bitrate ? ' kbps' : ' (default)'),
        inline: true,
      },
    )
    .setFooter({ text: '愛 Doctora • Temp VC' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSet(context: { interaction: any; guild: Guild }) {
  const { interaction, guild } = context;

  const key = interaction.options.getString('key', true);
  const value = interaction.options.getString('value', true);

  const config = await readTempVCConfig(guild.id);
  if (!config) {
    await interaction.reply({
      content: '❌ Temp VC system is not configured. Use `/tempvc setup` first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (key === 'nameTemplate') {
    if (value.length < 1 || value.length > 100) {
      await replyError(interaction, '❌ Name template must be between 1 and 100 characters.');
      return;
    }
    await upsertTempVCConfig(guild.id, { nameTemplate: value });
    clearTempVCConfigCache(guild.id);
    await interaction.reply({
      content: `✅ Temp VC name template set to \`${value}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (key === 'userLimit') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      await replyError(interaction, '❌ User limit must be an integer between 0 and 99 (0 = unlimited).');
      return;
    }
    await upsertTempVCConfig(guild.id, { userLimit: n === 0 ? undefined : n });
    clearTempVCConfigCache(guild.id);
    await interaction.reply({
      content: `✅ Temp VC user limit set to ${n === 0 ? 'unlimited' : n}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (key === 'bitrate') {
    const n = Number(value);
    const allowed = [64, 80, 96, 128, 256, 384, 512];
    if (!allowed.includes(n)) {
      await replyError(
        interaction,
        `❌ Bitrate must be one of: ${allowed.join(', ')} kbps.`,
      );
      return;
    }
    await upsertTempVCConfig(guild.id, { bitrate: n });
    clearTempVCConfigCache(guild.id);
    await interaction.reply({
      content: `✅ Temp VC bitrate set to ${n} kbps.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await replyError(interaction, '❌ Unknown setting.');
}
