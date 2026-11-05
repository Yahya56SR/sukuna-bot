import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const musicCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music player system')
    .addSubcommand(sub => sub
      .setName('play')
      .setDescription('Play a song or search for music')
      .addStringOption(opt => opt
        .setName('query')
        .setDescription('Song name, URL, or search query')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('queue')
      .setDescription('Show the current music queue')
    )
    .addSubcommand(sub => sub
      .setName('skip')
      .setDescription('Skip the current song')
    )
    .addSubcommand(sub => sub
      .setName('pause')
      .setDescription('Pause the current song')
    )
    .addSubcommand(sub => sub
      .setName('resume')
      .setDescription('Resume the paused song')
    )
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Stop music and disconnect')
    )
    .addSubcommand(sub => sub
      .setName('loop')
      .setDescription('Set loop mode')
      .addStringOption(opt => opt
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('volume')
      .setDescription('Set the volume')
      .addIntegerOption(opt => opt
        .setName('level')
        .setDescription('Volume level (0-200)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200)
      )
    )
    .addSubcommand(sub => sub
      .setName('nowplaying')
      .setDescription('Show the currently playing song')
    )
    .addSubcommand(sub => sub
      .setName('seek')
      .setDescription('Seek to a position in the song')
      .addStringOption(opt => opt
        .setName('time')
        .setDescription('Time to seek to (e.g., 1:30, 90s)')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('shuffle')
      .setDescription('Shuffle the queue')
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a song from the queue')
      .addIntegerOption(opt => opt
        .setName('position')
        .setDescription('Position in queue')
        .setRequired(true)
        .setMinValue(1)
      )
    )
    .addSubcommand(sub => sub
      .setName('lyrics')
      .setDescription('Show lyrics for the current song')
      .addStringOption(opt => opt
        .setName('query')
        .setDescription('Song name to search lyrics for')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('filter')
      .setDescription('Apply audio filters')
      .addStringOption(opt => opt
        .setName('filter')
        .setDescription('Filter to apply')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Bassboost', value: 'bassboost' },
          { name: 'Nightcore', value: 'nightcore' },
          { name: 'Vaporwave', value: 'vaporwave' },
          { name: '8D', value: '8d' },
          { name: 'Vibrato', value: 'vibrato' },
          { name: 'Tremolo', value: 'tremolo' },
          { name: 'Reverse', value: 'reverse' },
          { name: 'Treble', value: 'treble' },
          { name: 'Normalizer', value: 'normalizer' },
          { name: 'Surrounding', value: 'surrounding' },
          { name: 'Phaser', value: 'phaser' },
          { name: 'Compressor', value: 'compressor' },
          { name: 'Karaoke', value: 'karaoke' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('247')
      .setDescription('Enable/disable 24/7 mode')
      .addBooleanOption(opt => opt
        .setName('enabled')
        .setDescription('Enable or disable 24/7')
        .setRequired(true)
      )
    ),

  category: 'music',
  cooldownSeconds: 3,
  botPermissions: ['Connect', 'Speak', 'UseVAD'],

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    // Check if music/Lavalink is available
    const lavalink = (interaction.client as any).lavalink;
    if (!lavalink) {
      await interaction.reply({ content: '❌ Music system is not available on this instance.', ephemeral: true });
      return;
    }

    if (sub === 'play') {
      const query = interaction.options.getString('query', true);
      const member = interaction.member as any;
      const voiceChannel = member.voice?.channel;

      if (!voiceChannel) {
        await interaction.reply({ content: '❌ You need to be in a voice channel to play music.', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      try {
        const player = await lavalink.join({
          guildId,
          channelId: voiceChannel.id,
          deaf: true,
        });

        const search = await lavalink.search(query, interaction.user);
        if (!search || !search.tracks.length) {
          await interaction.editReply({ content: '❌ No tracks found for that query.' });
          return;
        }

        if (search.loadType === 'TRACK_LOADED' || search.loadType === 'SEARCH_RESULT') {
          await player.queue.add(search.tracks[0]);
          if (!player.playing) {
            await player.play();
          }

          const track = search.tracks[0];
          const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('▶️ Added to Queue')
            .setDescription(`[${track.title}](${track.uri})`)
            .addFields(
              { name: 'Author', value: track.author, inline: true },
              { name: 'Duration', value: new Date(track.duration).toISOString().substr(11, 8), inline: true },
              { name: 'Requested by', value: interaction.user.tag, inline: true },
            )
            .setThumbnail(track.thumbnail ?? '');

          await interaction.editReply({ embeds: [embed] });
          recordActivity('command', 'Music play', { meta: { guildId, track: track.title } });
        } else if (search.loadType === 'PLAYLIST_LOADED') {
          for (const track of search.tracks) {
            await player.queue.add(track);
          }
          if (!player.playing) {
            await player.play();
          }

          const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('📋 Playlist Added')
            .setDescription(`${search.playlist.name} - ${search.tracks.length} tracks added to queue`)
            .addFields(
              { name: 'Requested by', value: interaction.user.tag, inline: true },
            );

          await interaction.editReply({ embeds: [embed] });
          recordActivity('command', 'Music playlist', { meta: { guildId, tracks: search.tracks.length } });
        }
      } catch (error) {
        await interaction.editReply({ content: `❌ Failed to play music: ${error}` });
      }
      return;
    }

    if (sub === 'queue') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.queue.size) {
        await interaction.reply({ content: '❌ The queue is empty.', ephemeral: true });
        return;
      }

      const current = player.current;
      const queue = player.queue.toArray();

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎵 Music Queue')
        .addFields(
          {
            name: 'Current',
            value: current ? `[${current.title}](${current.uri})` : 'Nothing',
            inline: false,
          },
        )
        .setFooter({ text: `${queue.length} track(s) in queue` });

      if (queue.length > 0) {
        embed.addFields({
          name: 'Up Next',
          value: queue.slice(0, 10).map((t: any, i: number) => `**${i + 1}.** [${t.title}](${t.uri})`).join('\n'),
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'skip') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.playing) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      await player.stop();
      await interaction.reply({ content: '⏭️ Skipped the current song.' });
      recordActivity('command', 'Music skip', { meta: { guildId } });
      return;
    }

    if (sub === 'pause') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.playing) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      await player.pause(true);
      await interaction.reply({ content: '⏸️ Paused the music.' });
      return;
    }

    if (sub === 'resume') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.paused) {
        await interaction.reply({ content: '❌ Nothing is paused.', ephemeral: true });
        return;
      }

      await player.pause(false);
      await interaction.reply({ content: '▶️ Resumed the music.' });
      return;
    }

    if (sub === 'stop') {
      const player = lavalink.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: '❌ I am not in a voice channel.', ephemeral: true });
        return;
      }

      await player.destroy();
      await interaction.reply({ content: '⏹️ Stopped the music and disconnected.' });
      recordActivity('command', 'Music stop', { meta: { guildId } });
      return;
    }

    if (sub === 'loop') {
      const mode = interaction.options.getString('mode', true);
      const player = lavalink.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      const loopMode = mode === 'track' ? 1 : mode === 'queue' ? 2 : 0;
      await player.setLoop(loopMode);
      await interaction.reply({ content: `🔁 Loop mode set to: **${mode}**` });
      return;
    }

    if (sub === 'volume') {
      const level = interaction.options.getInteger('level', true);
      const player = lavalink.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      await player.setVolume(level);
      await interaction.reply({ content: `🔊 Volume set to: **${level}%**` });
      return;
    }

    if (sub === 'nowplaying') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.current) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      const track = player.current;
      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎶 Now Playing')
        .setDescription(`[${track.title}](${track.uri})`)
        .addFields(
          { name: 'Author', value: track.author, inline: true },
          { name: 'Duration', value: new Date(track.duration).toISOString().substr(11, 8), inline: true },
          { name: 'Requested by', value: track.requester?.tag ?? 'Unknown', inline: true },
          { name: 'Volume', value: `${player.volume}%`, inline: true },
        )
        .setThumbnail(track.thumbnail ?? '');

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'seek') {
      const timeStr = interaction.options.getString('time', true);
      const player = lavalink.players.get(guildId);
      if (!player || !player.current) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      // Parse time (e.g., 1:30, 90s)
      let ms = 0;
      const parts = timeStr.split(':');
      if (parts.length === 2) {
        ms = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
      } else if (timeStr.endsWith('s')) {
        ms = parseInt(timeStr) * 1000;
      } else {
        ms = parseInt(timeStr) * 1000;
      }

      await player.seek(ms);
      await interaction.reply({ content: `⏩ Seeked to ${timeStr}.` });
      return;
    }

    if (sub === 'shuffle') {
      const player = lavalink.players.get(guildId);
      if (!player || !player.queue.size) {
        await interaction.reply({ content: '❌ The queue is empty.', ephemeral: true });
        return;
      }

      await player.queue.shuffle();
      await interaction.reply({ content: '🔀 Shuffled the queue.' });
      return;
    }

    if (sub === 'remove') {
      const position = interaction.options.getInteger('position', true);
      const player = lavalink.players.get(guildId);
      if (!player || !player.queue.size) {
        await interaction.reply({ content: '❌ The queue is empty.', ephemeral: true });
        return;
      }

      if (position > player.queue.size) {
        await interaction.reply({ content: `❌ Position out of range. Queue has ${player.queue.size} track(s).`, ephemeral: true });
        return;
      }

      const track = player.queue.remove(position - 1);
      await interaction.reply({ content: `❌ Removed **[${track.title}](${track.uri})** from the queue.` });
      return;
    }

    if (sub === 'lyrics') {
      const query = interaction.options.getString('query');
      await interaction.reply({ content: '🎵 Lyrics feature coming soon!', ephemeral: true });
      return;
    }

    if (sub === 'filter') {
      const filter = interaction.options.getString('filter', true);
      const player = lavalink.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `🔧 Audio filter "${filter}" applied (simulated).` });
      return;
    }

    if (sub === '247') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await interaction.reply({ content: `${enabled ? '✅' : '❌'} 24/7 mode ${enabled ? 'enabled' : 'disabled'}.` });
      return;
    }
  },
};