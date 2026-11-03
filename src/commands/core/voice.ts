import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getSukunaConfig } from '../../config/index.js';
import type { Command } from '../../core/commands.js';
import { connectVoice, disconnectVoice, speakInVoice, voiceStatus } from '../../voice/manager.js';
import { resolveVoiceName } from '../../voice/speech.js';

export const voiceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Make 爱 Doctora join a voice channel and talk there.')
    .addSubcommand((sub) =>
      sub.setName('join').setDescription('Join your voice channel: hear members and answer out loud'),
    )
    .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the voice channel'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the voice connection and speech queue'))
    .addSubcommand((sub) =>
      sub
        .setName('say')
        .setDescription('Speak a line right now (TTS mode only)')
        .addStringOption((option) =>
          option.setName('text').setDescription('What to say').setRequired(true).setMaxLength(500),
        ),
    ),
  category: 'utility',
  botPermissions: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
  execute: async (context) => {
    const { interaction, guild, member } = context;
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'join') {
      const channel = member.voice.channel;
      if (!channel) {
        await interaction.reply({
          content: '❌ Join a voice channel first, then run `/voice join`.',
          flags: 64,
        });
        return;
      }

      const me = guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      if (permissions && !permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        await interaction.reply({
          content: `❌ I need **Connect** and **Speak** in ${channel}.`,
          flags: 64,
        });
        return;
      }

      await interaction.deferReply({ flags: 64 });

      let status;
      try {
        status = await connectVoice(guild, channel.id);
      } catch (error) {
        await interaction.editReply({
          content: '❌ ' + (error instanceof Error ? error.message : 'Could not join that channel.'),
        });
        return;
      }

      const modeLine =
        status.mode === 'duplex'
          ? 'I can hear you now — talk to me.'
          : 'Live conversation is unavailable, so I will read my text replies out loud.';
      await interaction.editReply({
        content: `🔊 Connected to **${channel.name}**. ${modeLine}`,
      });
      return;
    }

    if (subcommand === 'leave') {
      const left = disconnectVoice(guild.id);
      await interaction.reply({
        content: left ? '👋 Left the voice channel.' : 'I am not in a voice channel.',
        flags: 64,
      });
      return;
    }

    if (subcommand === 'status') {
      const status = voiceStatus(guild.id);
      if (!status.connected) {
        await interaction.reply({
          content: 'Not connected. Use `/voice join` from a voice channel.',
          flags: 64,
        });
        return;
      }

      const channel = status.channelId ? guild.channels.cache.get(status.channelId) : null;
      const mode = status.mode === 'duplex' ? 'live conversation' : 'reading replies';
      await interaction.reply({
        content:
          `🔊 **${channel?.name ?? 'unknown channel'}** · ${mode} · ` +
          `${status.listening} member(s) heard · ${status.speaking ? 'speaking' : 'idle'}` +
          (status.queued > 0 ? ` · ${status.queued} queued` : ''),
        flags: 64,
      });
      return;
    }

    // Manual speech: it competes with the conversation for the player, so it is
    // only offered in TTS mode.
    const current = voiceStatus(guild.id);
    if (!current.connected) {
      await interaction.reply({
        content: '❌ Join a voice channel with `/voice join` first.',
        flags: 64,
      });
      return;
    }

    if (current.mode !== 'tts') {
      await interaction.reply({
        content:
          '🎙️ I am in live conversation mode: I answer out loud by myself, so there is nothing to read. ' +
          'Just talk, or use `/voice leave` to stop.',
        flags: 64,
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      await interaction.reply({
        content: '❌ `GEMINI_API_KEY` is not configured on the bot host.',
        flags: 64,
      });
      return;
    }

    const text = interaction.options.getString('text', true);
    speakInVoice(guild.id, text, {
      apiKey,
      model: getSukunaConfig().model,
      voiceName: resolveVoiceName(),
      timeoutMs: 30_000,
    });

    await interaction.reply({ content: '🗣️ Speaking that now.', flags: 64 });
  },
};
