import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  type Role,
} from 'discord.js';
import type { Command, CommandContext } from '../../core/commands.js';
import { canAssignRole } from '../../utils/discord.js';
import { refreshLiveLeaderboard } from '../../utils/liveLeaderboard.js';
import { loadLevelSettings, saveGuildSettings } from './shared.js';

export const levelsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('levels')
    .setDescription('Configure the XP and level system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configure XP rates and announcement channels')
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Whether members earn XP in this server'),
        )
        .addChannelOption((o) =>
          o
            .setName('announce_channel')
            .setDescription('Where level-up messages are posted (default: current channel)')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addIntegerOption((o) =>
          o
            .setName('xp_per_message')
            .setDescription('Minimum XP per message (MEE6 default 15)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName('xp_per_message_max')
            .setDescription('Maximum XP per message (MEE6 default 25)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName('cooldown_seconds')
            .setDescription('Seconds between XP-earning messages per user (MEE6 default 60)')
            .setMinValue(0)
            .setMaxValue(3600),
        )
        .addIntegerOption((o) =>
          o
            .setName('xp_per_voice_minute')
            .setDescription('Minimum XP per voice minute (MEE6 default 5)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName('xp_per_voice_minute_max')
            .setDescription('Maximum XP per voice minute (MEE6 default 8)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addBooleanOption((o) =>
          o
            .setName('ignore_bots')
            .setDescription('Bots earn no XP when true (default true)'),
        )
        .addStringOption((o) =>
          o
            .setName('announce_message')
            .setDescription(
              'Level-up text. Placeholders: {user} {username} {level} {server} {role} {xp} {xpneeded}',
            )
            .setMaxLength(2000),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('role')
        .setDescription('Manage level reward roles')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Grant a role when a user reaches a level')
            .addIntegerOption((o) =>
              o
                .setName('level')
                .setDescription('Level milestone')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to grant').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove the role reward for a level')
            .addIntegerOption((o) =>
              o
                .setName('level')
                .setDescription('Level milestone to remove')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000),
            ),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all level reward roles')),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('leaderboard')
        .setDescription('Manage the self-updating leaderboard message')
        .addSubcommand((sub) =>
          sub
            .setName('start')
            .setDescription('Post and keep a leaderboard message up to date')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel that holds the persistent leaderboard')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('interval_minutes')
                .setDescription('Refresh interval in minutes (default 10)')
                .setMinValue(1)
                .setMaxValue(1440),
            )
            .addIntegerOption((o) =>
              o
                .setName('rows')
                .setDescription('How many ranked members appear (3-25, default 25)')
                .setMinValue(3)
                .setMaxValue(25),
            )
            .addStringOption((o) =>
              o.setName('title').setDescription('Optional board title (default: server name)'),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('stop').setDescription('Stop updating the live leaderboard'),
        )
        .addSubcommand((sub) =>
          sub.setName('status').setDescription('Show the live leaderboard configuration'),
        ),
    ),
  category: 'leveling',
  userPermissions: ['ManageGuild'],
  execute: async (context) => {
    const { interaction } = context;
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'role') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') return roleAdd(context);
      if (sub === 'remove') return roleRemove(context);
      if (sub === 'list') return roleList(context);
      return;
    }

    if (group === 'leaderboard') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'start') return leaderboardStart(context);
      if (sub === 'stop') return leaderboardStop(context);
      if (sub === 'status') return leaderboardStatus(context);
      return;
    }

    return setup(context);
  },
};

async function setup(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const announce = interaction.options.getChannel('announce_channel');
  const enabled = interaction.options.getBoolean('enabled');
  const xpPerMessage = interaction.options.getInteger('xp_per_message');
  const xpPerMessageMax = interaction.options.getInteger('xp_per_message_max');
  const cooldown = interaction.options.getInteger('cooldown_seconds');
  const xpPerVoice = interaction.options.getInteger('xp_per_voice_minute');
  const xpPerVoiceMax = interaction.options.getInteger('xp_per_voice_minute_max');
  const ignoreBots = interaction.options.getBoolean('ignore_bots');
  const announceMessage = interaction.options.getString('announce_message');

  if (
    enabled === null &&
    !announce &&
    xpPerMessage === null &&
    xpPerMessageMax === null &&
    cooldown === null &&
    xpPerVoice === null &&
    xpPerVoiceMax === null &&
    ignoreBots === null &&
    !announceMessage
  ) {
    await interaction.reply({
      content:
        'Nothing to change. Pass at least one option, e.g. `xp_per_message: 15` or `announce_channel: #levels`.',
      ephemeral: true,
    });
    return;
  }

  const current = await loadLevelSettings(context);
  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  if (enabled !== null) {
    updates.xpEnabled = enabled;
    changes.push(`XP ${enabled ? 'enabled' : 'disabled'}`);
  }
  if (announce) {
    updates.levelUpChannel = announce.id;
    changes.push(`Level-up channel → <#${announce.id}>`);
  }

  let nextMin = current.perMessageMin;
  let nextMax = current.perMessageMax;
  if (xpPerMessage !== null) {
    nextMin = xpPerMessage;
    updates.xpMin = xpPerMessage;
    changes.push(`XP per message → **${xpPerMessage}**`);
  }
  if (xpPerMessageMax !== null) {
    nextMax = xpPerMessageMax;
    updates.xpMax = xpPerMessageMax;
    changes.push(`Max XP per message → **${xpPerMessageMax}**`);
  }
  // A lone min above the current max would leave an inverted range, which
  // `randomXp` can only resolve by ignoring the max entirely.
  if (nextMin > nextMax) {
    updates.xpMin = nextMax;
    updates.xpMax = nextMin;
    changes.push(`Range normalised to **${nextMax}-${nextMin}**`);
  }

  if (cooldown !== null) {
    updates.xpCooldown = cooldown;
    changes.push(`Message cooldown → **${cooldown}s**`);
  }

  let nextVoiceMin = current.perVoiceMinuteMin;
  let nextVoiceMax = current.perVoiceMinuteMax;
  if (xpPerVoice !== null) {
    nextVoiceMin = xpPerVoice;
    updates.xpVoiceMin = xpPerVoice;
    changes.push(`Voice XP per minute → **${xpPerVoice}**`);
  }
  if (xpPerVoiceMax !== null) {
    nextVoiceMax = xpPerVoiceMax;
    updates.xpVoiceMax = xpPerVoiceMax;
    changes.push(`Max voice XP per minute → **${xpPerVoiceMax}**`);
  }
  if (nextVoiceMin > nextVoiceMax) {
    updates.xpVoiceMin = nextVoiceMax;
    updates.xpVoiceMax = nextVoiceMin;
    changes.push(`Voice range normalised to **${nextVoiceMax}-${nextVoiceMin}**`);
  }

  if (ignoreBots !== null) {
    updates.xpIgnoreBots = ignoreBots;
    changes.push(
      `Ignore bots for XP → ${ignoreBots ? 'yes (bots earn no XP)' : 'no (bots can earn XP)'}`,
    );
  }
  if (announceMessage) {
    updates.levelUpMessage = announceMessage;
    changes.push('Level-up message template updated');
  }

  const cfg = await saveGuildSettings(context, updates);

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('✅ Level system updated')
    .setDescription(changes.map((change) => `• ${change}`).join('\n'))
    .addFields(
      {
        name: 'XP per message',
        value:
          cfg.perMessageMin === cfg.perMessageMax
            ? `${cfg.perMessageMin}`
            : `${cfg.perMessageMin}-${cfg.perMessageMax} (random)`,
        inline: true,
      },
      { name: 'Cooldown', value: `${cfg.cooldownSeconds}s`, inline: true },
      {
        name: 'Voice XP/min',
        value:
          cfg.perVoiceMinuteMin === cfg.perVoiceMinuteMax
            ? `${cfg.perVoiceMinuteMin}`
            : `${cfg.perVoiceMinuteMin}-${cfg.perVoiceMinuteMax} (random)`,
        inline: true,
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function roleAdd(context: CommandContext): Promise<void> {
  const { interaction, guild } = context;
  const level = interaction.options.getInteger('level', true);
  const role = interaction.options.getRole('role', true) as Role;

  // @everyone has no position to compare against, so it would otherwise pass
  // the hierarchy check and fail at grant time.
  if (role.id === guild.id) {
    await interaction.reply({
      content: 'You cannot use **@everyone** as a level reward — pick a real role.',
      ephemeral: true,
    });
    return;
  }

  const permissionError = canAssignRole(guild, role);
  if (permissionError) {
    await interaction.reply({ content: permissionError, ephemeral: true });
    return;
  }

  const current = await loadLevelSettings(context);
  const previous = current.levelRoles[String(level)];
  const levelRoles = { ...current.levelRoles, [String(level)]: role.id };
  await saveGuildSettings(context, { levelRoles });

  await interaction.reply({
    content: `✅ Level **${level}** now grants <@&${role.id}>.${
      previous && previous !== role.id ? `\n(Replaced <@&${previous}>.)` : ''
    }\nExisting members receive it the next time they level up (or on rejoin).`,
    ephemeral: true,
  });
}

async function roleRemove(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const level = interaction.options.getInteger('level', true);
  const current = await loadLevelSettings(context);
  const existing = current.levelRoles[String(level)];

  if (!existing) {
    await interaction.reply({
      content: `No role is configured for level ${level}.`,
      ephemeral: true,
    });
    return;
  }

  const levelRoles = { ...current.levelRoles };
  delete levelRoles[String(level)];
  await saveGuildSettings(context, { levelRoles });

  await interaction.reply({
    content: `✅ Removed the role reward for level ${level} (was <@&${existing}>).`,
    ephemeral: true,
  });
}

async function roleList(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const current = await loadLevelSettings(context);
  const entries = Object.entries(current.levelRoles).sort((a, b) => Number(a[0]) - Number(b[0]));

  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('🏅 Level reward roles');

  if (entries.length === 0) {
    embed.setDescription('No level roles configured. Add one with `/levels role add`.');
  } else {
    embed.setDescription(
      entries.map(([level, roleId]) => `Level **${level}** → <@&${roleId}>`).join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function leaderboardStart(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const channel = interaction.options.getChannel('channel', true);
  const interval = interaction.options.getInteger('interval_minutes');
  const rows = interaction.options.getInteger('rows');
  const title = interaction.options.getString('title');
  const current = await loadLevelSettings(context);

  await interaction.deferReply({ ephemeral: true });
  await saveGuildSettings(context, {
    liveLeaderboard: {
      ...current.liveLeaderboard,
      enabled: true,
      channelId: channel.id,
      messageId: '',
      intervalMinutes: interval ?? current.liveLeaderboard.intervalMinutes,
      rows: rows ?? current.liveLeaderboard.rows,
      title: title ?? current.liveLeaderboard.title,
    },
  });

  const result = await refreshLiveLeaderboard(context.client, context.guild.id, { force: true });

  const labels: Record<string, string> = {
    created: `✅ Live leaderboard posted in <#${channel.id}>.`,
    updated: '✅ Live leaderboard updated.',
    empty: '⚠️ The leaderboard is set up, but nobody has earned XP yet.',
    'no-channel': '⚠️ I could not access that channel. Check my permissions.',
    'no-guild': '⚠️ I could not resolve this server.',
    error: '⚠️ The leaderboard is configured, but publishing the message failed.',
    disabled: '✅ Live leaderboard enabled.',
    unchanged: '✅ Live leaderboard unchanged.',
  };

  await interaction.editReply({
    content:
      (labels[result.status] ?? '✅ Live leaderboard enabled.') +
      `\nIt refreshes every **${interval ?? current.liveLeaderboard.intervalMinutes}** minute(s).`,
  });
}

async function leaderboardStop(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const current = await loadLevelSettings(context);

  await saveGuildSettings(context, {
    liveLeaderboard: { ...current.liveLeaderboard, enabled: false },
  });

  await interaction.reply({
    content:
      '✅ The live leaderboard is no longer updated. The existing message stays where it is.',
    ephemeral: true,
  });
}

async function leaderboardStatus(context: CommandContext): Promise<void> {
  const { interaction } = context;
  const settings = (await loadLevelSettings(context)).liveLeaderboard;

  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? 0x22c55e : 0x6b7280)
    .setTitle('🏆 Live leaderboard')
    .addFields(
      { name: 'Status', value: settings.enabled ? 'Enabled' : 'Disabled', inline: true },
      {
        name: 'Channel',
        value: settings.channelId ? `<#${settings.channelId}>` : 'Not set',
        inline: true,
      },
      { name: 'Interval', value: `${settings.intervalMinutes} min`, inline: true },
      { name: 'Rows', value: String(settings.rows), inline: true },
      { name: 'Title', value: settings.title || 'Server name', inline: true },
      {
        name: 'Message',
        value: settings.messageId ? `\`${settings.messageId}\`` : 'Not posted yet',
        inline: true,
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
