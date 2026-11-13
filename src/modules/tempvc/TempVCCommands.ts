import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, SlashCommandBuilder, VoiceChannel, CategoryChannel, TextChannel, ChannelType } from 'discord.js';
import { TempVCService } from './TempVCService';

export class TempVCCommands {
  private service: TempVCService;

  constructor(service: TempVCService) {
    this.service = service;
  }

  public getCommands(): any[] {
    return [this.setupCommand];
  }

  private setupCommand: any = {
    data: new SlashCommandBuilder()
      .setName('tempvc')
      .setDescription('Manage join-to-create temporary voice channels')
      .setDefaultMemberPermissions(0n)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Set the join-to-create channel and category')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Voice channel members join to create a temp VC')
              .addChannelTypes(ChannelType.GuildVoice)
              .setRequired(true),
          )
          .addChannelOption((o) =>
            o
              .setName('category')
              .setDescription('Category where temp VCs are created')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('panel')
          .setDescription('Post the temp VC control panel in a channel')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to post the control panel in')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('limit').setDescription('Set your temp VC user limit')
          .addIntegerOption((o) => o.setName('limit').setDescription('User limit (0 = unlimited)').setRequired(true).setMinValue(0).setMaxValue(99)),
      )
      .addSubcommand((sub) =>
        sub.setName('name').setDescription('Set your temp VC name')
          .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(100)),
      )
      .addSubcommand((sub) =>
        sub.setName('kick').setDescription('Kick a member from your temp VC')
          .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub.setName('config').setDescription('View temp VC config'),
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'setup': return this.setup(interaction);
        case 'panel': return this.panel(interaction);
        case 'limit': return this.setLimit(interaction);
        case 'name': return this.setName(interaction);
        case 'kick': return this.kick(interaction);
        case 'config': return this.config(interaction);
        default: return;
      }
    },
  };

  private async setup(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.options.getChannel('channel', true) as VoiceChannel;
    const category = interaction.options.getChannel('category', true) as CategoryChannel;

    await this.service.setup(channel.id, category.id, interaction.guildId ?? undefined);
    await interaction.reply({
      content: `✅ Temp VC setup: join <#${channel.id}> to create a channel in <#${category.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async panel(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    const cfg = this.service.getConfig(interaction.guildId ?? undefined);
    if (!cfg || !cfg.createChannelId || !cfg.categoryId) {
      await interaction.reply({ content: 'Set up temp VC first with `/tempvc setup`.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = interaction.guild ?? null;
    const panel = await this.service.buildPanel(cfg, guild);

    const existingMessageId = cfg.panelMessageId;
    let message: any = null;

    if (existingMessageId) {
      try {
        message = await channel.messages.fetch(existingMessageId).catch(() => null);
      } catch {
        message = null;
      }
    }

    if (message) {
      await message.edit({ components: panel.components, files: panel.files, flags: panel.flags });
    } else {
      message = await channel.send({ components: panel.components, files: panel.files, flags: panel.flags });
    }

    await this.service.setPanel(channel.id, message.id, interaction.guildId ?? undefined);
    await interaction.reply({ content: `✅ Temp VC panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  }

  private async config(interaction: ChatInputCommandInteraction): Promise<void> {
    const cfg = this.service.getConfig(interaction.guildId ?? undefined);
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🔊 Temporary Voice Config');

    if (!cfg || !cfg.createChannelId || !cfg.categoryId) {
      embed.setDescription('No temp VC configured. Use `/tempvc setup`.');
    } else {
      embed.setDescription(
        `Create channel: <#${cfg.createChannelId}>\n` +
        `Category: <#${cfg.categoryId}>\n` +
        `Panel channel: ${cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : 'not set'}\n` +
        `Panel message: ${cfg.panelMessageId || 'not posted'}`,
      );
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  private async setLimit(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as any;
    const channelId = member.voice?.channel?.id;
    if (!channelId) {
      await interaction.reply({ content: 'You must be in a voice channel to set its limit.', flags: MessageFlags.Ephemeral });
      return;
    }

    const temp = this.service.getTempVC(channelId);
    if (!temp || temp.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You only can change limits on a temp VC you own.', flags: MessageFlags.Ephemeral });
      return;
    }

    const limit = interaction.options.getInteger('limit', true);
    const channel = interaction.guild!.channels.cache.get(channelId) as VoiceChannel | undefined;
    if (!channel) {
      await interaction.reply({ content: 'Channel not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await channel.edit({ userLimit: limit === 0 ? 0 : limit });
      await interaction.reply({ content: `✅ Temp VC user limit set to ${limit === 0 ? 'unlimited' : limit}.`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      await interaction.reply({ content: `Failed to set limit: ${err instanceof Error ? err.message : String(err)}`, flags: MessageFlags.Ephemeral });
    }
  }

  private async setName(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as any;
    const channelId = member.voice?.channel?.id;
    if (!channelId) {
      await interaction.reply({ content: 'You must be in a voice channel to rename it.', flags: MessageFlags.Ephemeral });
      return;
    }

    const temp = this.service.getTempVC(channelId);
    if (!temp || temp.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You only can rename a temp VC you own.', flags: MessageFlags.Ephemeral });
      return;
    }

    const name = interaction.options.getString('name', true);
    const channel = interaction.guild!.channels.cache.get(channelId);
    if (!channel || !('edit' in channel)) {
      await interaction.reply({ content: 'Channel not editable.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await (channel as any).edit({ name });
      await interaction.reply({ content: `✅ Temp VC renamed to **${name}**.`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      await interaction.reply({ content: `Failed to rename: ${err instanceof Error ? err.message : String(err)}`, flags: MessageFlags.Ephemeral });
    }
  }

  private async kick(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as any;
    const channelId = member.voice?.channel?.id;
    if (!channelId) {
      await interaction.reply({ content: 'You must be in a voice channel to kick someone.', flags: MessageFlags.Ephemeral });
      return;
    }

    const temp = this.service.getTempVC(channelId);
    if (!temp || temp.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You only can kick from a temp VC you own.', flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getMember('member') as any;
    if (!target) {
      await interaction.reply({ content: 'Member not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!target.voice.channel || target.voice.channel.id !== channelId) {
      await interaction.reply({ content: 'That member is not in your temp VC.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await target.voice.setChannel(null);
      await interaction.reply({ content: `✅ Kicked ${target.user.username} from your temp VC.`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      await interaction.reply({ content: `Failed to kick: ${err instanceof Error ? err.message : String(err)}`, flags: MessageFlags.Ephemeral });
    }
  }
}
