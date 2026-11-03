import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} from 'discord.js';
import type { Command, CommandContext } from '../../core/commands.js';
import { loadLevelSettings, saveGuildSettings } from './shared.js';

/**
 * MEE6 parity:
 *   !xpchannel  -> /xp channel
 *   !nocxp      -> /xp nocxp
 */
export const xpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Configure how XP is earned')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Only earn XP in one channel (or allow all channels again)')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The only channel where XP is earned — leave blank to allow all')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('nocxp')
        .setDescription('Channels where members earn no XP')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Exclude a channel from XP')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel to exclude')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Allow XP in an excluded channel again')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel to re-enable')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List excluded channels')),
    ),
  category: 'leveling',
  userPermissions: ['ManageGuild'],
  execute: async (context) => {
    const { interaction } = context;
    const group = interaction.options.getSubcommandGroup(false);
    if (group === 'nocxp') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') return nocxpAdd(context);
      if (sub === 'remove') return nocxpRemove(context);
      if (sub === 'list') return nocxpList(context);
      return;
    }

    if (interaction.options.getSubcommand() === 'channel') {
      return xpChannel(context);
    }
  },
};

async function xpChannel(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const channel = interaction.options.getChannel('channel');

  await saveGuildSettings(context, { xpChannel: channel ? channel.id : '' });

  if (channel) {
    await interaction.reply({
      content: `✅ XP is now only earned in <#${channel.id}>. Use \`/xp channel\` with no channel to allow all channels again.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: '✅ XP can now be earned in every channel (no-XP channels still apply).',
      ephemeral: true,
    });
  }
}

async function nocxpAdd(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const channel = interaction.options.getChannel('channel', true);
  const current = await loadLevelSettings(context);

  if (current.noXpChannels.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is already excluded from XP.`,
      ephemeral: true,
    });
    return;
  }

  await saveGuildSettings(context, {
    disableXpChannels: [...current.noXpChannels, channel.id],
  });

  await interaction.reply({
    content: `✅ Members earn no XP in <#${channel.id}>.`,
    ephemeral: true,
  });
}

async function nocxpRemove(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const channel = interaction.options.getChannel('channel', true);
  const current = await loadLevelSettings(context);

  if (!current.noXpChannels.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is not excluded from XP.`,
      ephemeral: true,
    });
    return;
  }

  await saveGuildSettings(context, {
    disableXpChannels: current.noXpChannels.filter((id) => id !== channel.id),
  });

  await interaction.reply({
    content: `✅ Members earn XP in <#${channel.id}> again.`,
    ephemeral: true,
  });
}

async function nocxpList(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const current = await loadLevelSettings(context);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🚫 Channels without XP');

  if (current.noXpChannels.length === 0) {
    embed.setDescription('No channels are excluded — XP is earned everywhere.');
  } else {
    embed.setDescription(current.noXpChannels.map((id) => `<#${id}>`).join('\n'));
  }

  if (current.xpChannel) {
    embed.addFields({ name: 'Exclusive XP channel', value: `<#${current.xpChannel}>` });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
