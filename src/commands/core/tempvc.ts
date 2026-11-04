import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
  type VoiceChannel,
  type CategoryChannel,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import {
  upsertTempVCConfig,
  deleteTempVCConfig,
  readTempVCConfig,
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
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Disable the join-to-create temp VC system.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show the current temp VC configuration.'),
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
  },
};

async function handleSetup(context: { interaction: any; guild: Guild }) {
  const { interaction, guild } = context;

  const createChannel =
    (interaction.options.getChannel('create_channel') as VoiceChannel | null) ?? null;

  const category =
    (interaction.options.getChannel('category') as CategoryChannel | null) ?? null;

  // If no create channel given, disable the system.
  if (!createChannel) {
    await deleteTempVCConfig(guild.id);
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
        value: config.createChannelId
          ? `<#${config.createChannelId}>`
          : 'None (disabled)',
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
    )
    .setFooter({ text: '愛 Doctora • Temp VC' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
