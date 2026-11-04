import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import {
  createVcPanel,
  updateVcPanelById,
  readVcPanel,
  deleteVcPanelById,
} from '../../db/models/Vc.js';
import { replyError } from '../../core/respond.js';

export const vcCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('vc')
    .setDescription(
      'One-tap voice: post a panel that lets members summon 愛 Doctora to their own voice channel.',
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Post a one-tap VC panel in a channel (works for all voice channels).')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to post the panel (default: current channel)')
            .addChannelTypes(0),
        )
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Panel embed title')
            .setMaxLength(256),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Panel embed description')
            .setMaxLength(1024),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a previously posted one-tap VC panel.')
        .addStringOption((option) =>
          option
            .setName('message_id')
            .setDescription('ID of the panel message to remove')
            .setRequired(true),
        ),
    ),
  category: 'utility',
  botPermissions: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
  execute: async (context) => {
    const { interaction } = context;
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'setup') {
      await handleSetup(context);
      return;
    }

    if (subcommand === 'remove') {
      await handleRemove(context);
      return;
    }
  },
};

async function handleSetup(context: {
  interaction: any;
  guild: Guild;
  member: any;
}) {
  const { interaction, guild } = context;

  const targetChannel =
    (interaction.options.getChannel('channel') as TextChannel | null) ??
    (interaction.channel as TextChannel);

  const title = interaction.options.getString('title') ?? '🔊 One Tap Voice';
  const description =
    interaction.options.getString('description') ??
    'Click **Join VC** below to have 愛 Doctora join **your** voice channel.\n\n' +
    'Make sure you are in a voice channel before tapping. Works for any voice channel in this server.';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(guild.iconURL())
    .setFooter({ text: '愛 Doctora • One Tap VC' })
    .setTimestamp();

  // Create the panel record first so we have a stable _id for the button customId.
  // messageId is filled in after the message is sent.
  const panel = await createVcPanel({
    guildId: guild.id,
    channelId: targetChannel.id,
    embedTitle: title,
    embedDescription: description,
    embedColor: 0x5865f2,
    embedFooter: '愛 Doctora • One Tap VC',
  });

  const panelId = panel._id.toString();

  const joinButton = new ButtonBuilder()
    .setCustomId(`vc_join:${panelId}`)
    .setLabel('Join VC')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔊');

  const row = new ActionRowBuilder().addComponents(joinButton);

  let message;
  try {
    message = await targetChannel.send({
      embeds: [embed],
      components: [row.toJSON()],
    });
  } catch {
    await replyError(interaction, '❌ I cannot post in that channel.');
    await deleteVcPanelById(panelId);
    return;
  }

  await updateVcPanelById(panelId, { messageId: message.id });

  await interaction.reply({
    content: `✅ One-tap VC panel posted in ${targetChannel}. Members can tap **Join VC** from any voice channel to summon 愛 Doctora.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(context: {
  interaction: any;
  guild: Guild;
}) {
  const { interaction, guild } = context;

  const messageId = interaction.options.getString('message_id', true);

  const panel = await readVcPanel(guild.id, messageId);
  if (!panel) {
    await replyError(interaction, '❌ No one-tap VC panel found with that message ID.');
    return;
  }

  const channel = guild.channels.cache.get(panel.channelId) as TextChannel | undefined;
  if (channel?.isTextBased()) {
    try {
      await channel.messages.delete(messageId);
    } catch {
      /* message may already be gone */
    }
  }

  await deleteVcPanelById(panel._id.toString());

  await interaction.reply({
    content: '✅ One-tap VC panel removed.',
    flags: MessageFlags.Ephemeral,
  });
}
