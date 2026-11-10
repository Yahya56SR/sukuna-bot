import { Client, VoiceChannel, ChannelType, GuildMember, TextChannel, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, Message, PermissionFlagsBits } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq, sql } from 'drizzle-orm';
import { tempvcConfigs, tempvcInstances } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { shortId } from '../../utils/id';

export interface TempVCConfig {
  enabled: boolean;
  createChannelId: string;
  categoryId: string;
  panelChannelId: string;
  panelMessageId: string;
}

export interface TempVCInstance {
  channelId: string;
  ownerId: string;
  categoryId: string;
  guildId: string;
  createdAt: number;
}

/** Config rows are keyed by guild; the dashboard's legacy single config lives in 'global'. */
const GLOBAL_GUILD = 'global';

const PANEL_PREFIX = 'tempvc:';
const PANEL_BUTTONS = [
  { id: 'rename', label: 'RENAME', emoji: '✏️', style: ButtonStyle.Secondary },
  { id: 'limit', label: 'LIMIT', emoji: '👥', style: ButtonStyle.Secondary },
  { id: 'lock', label: 'LOCK', emoji: '🔒', style: ButtonStyle.Secondary },
  { id: 'unlock', label: 'UNLOCK', emoji: '🔓', style: ButtonStyle.Secondary },
  { id: 'invite', label: 'INVITE', emoji: '✉️', style: ButtonStyle.Secondary },
  { id: 'delete', label: 'DELETE', emoji: '🗑️', style: ButtonStyle.Danger },
  { id: 'hide', label: 'HIDE', emoji: '👁️', style: ButtonStyle.Secondary },
  { id: 'show', label: 'SHOW', emoji: '👁️', style: ButtonStyle.Secondary },
  { id: 'claim', label: 'CLAIM', emoji: '✅', style: ButtonStyle.Success },
  { id: 'kick', label: 'KICK', emoji: '👢', style: ButtonStyle.Danger },
];

function rowToConfig(row: any): TempVCConfig {
  return {
    enabled: Boolean(row.enabled),
    createChannelId: row.create_channel_id ?? '',
    categoryId: row.category_id ?? '',
    panelChannelId: row.panel_channel_id ?? '',
    panelMessageId: row.panel_message_id ?? '',
  };
}

function rowToInstance(row: any): TempVCInstance {
  return {
    channelId: row.channel_id,
    ownerId: row.owner_id,
    categoryId: row.category_id,
    guildId: row.guild_id ?? GLOBAL_GUILD,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

export class TempVCService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private client: Client | null = null;
  private configs: Map<string, TempVCConfig> = new Map();
  private instances: Map<string, TempVCInstance> = new Map();
  /** Channels currently being deleted — guards against double-delete races. */
  private deleting: Set<string> = new Set();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(): Promise<void> {
    if (!this.db) return;

    this.configs.clear();
    const configRows = await this.db.select().from(tempvcConfigs);
    for (const row of configRows) {
      this.configs.set(row.guild_id || GLOBAL_GUILD, rowToConfig(row));
    }

    // Load existing temp VC instances and prune ones whose channel is gone.
    this.instances.clear();
    const instanceRows = await this.db.select().from(tempvcInstances);
    let pruned = 0;
    for (const row of instanceRows) {
      const instance = rowToInstance(row);
      const channel = this.client ? await this.client.channels.fetch(instance.channelId).catch(() => null) : null;
      if (this.client && !channel) {
        await this.db.delete(tempvcInstances).where(eq(tempvcInstances.channel_id, instance.channelId));
        pruned += 1;
        continue;
      }
      this.instances.set(instance.channelId, instance);
    }

    this.logger.info('TempVC Service', `Temp VC system initialized with ${this.instances.size} active instance(s)${pruned ? ` (pruned ${pruned} stale)` : ''}`);
  }

  /**
   * Config resolution: the guild-specific row wins; otherwise the legacy
   * 'global' row is used. Pass no argument (dashboard) to get the global row.
   */
  public getConfig(guildId?: string): TempVCConfig | null {
    if (guildId) {
      return this.configs.get(guildId) ?? this.configs.get(GLOBAL_GUILD) ?? null;
    }
    return this.configs.get(GLOBAL_GUILD)
      ?? Array.from(this.configs.values())[0]
      ?? null;
  }

  /** Dashboard setter — applies to the legacy global row for backwards compatibility. */
  public setConfig(config: TempVCConfig): void {
    this.configs.set(GLOBAL_GUILD, config);
    if (this.db) {
      void this.persistConfig(GLOBAL_GUILD, config).catch((error) => {
        this.logger.warn('TempVC Service', `Could not persist tempvc config: ${(error as Error).message}`);
      });
    }
  }

  public getGuildConfig(guildId: string): TempVCConfig | null {
    return this.getConfig(guildId);
  }

  private async persistConfig(guildId: string, config: TempVCConfig): Promise<void> {
    if (!this.db) return;
    const now = Math.floor(Date.now() / 1000);
    await this.db.run(sql`
      INSERT INTO tempvc_configs (id, guild_id, create_channel_id, category_id, panel_channel_id, panel_message_id, enabled, created_at)
      VALUES (${`tempvc_${guildId}`}, ${guildId}, ${config.createChannelId}, ${config.categoryId}, ${config.panelChannelId}, ${config.panelMessageId}, ${config.enabled ? 1 : 0}, ${now})
      ON CONFLICT(id) DO UPDATE SET
        create_channel_id = excluded.create_channel_id,
        category_id = excluded.category_id,
        panel_channel_id = excluded.panel_channel_id,
        panel_message_id = excluded.panel_message_id,
        enabled = excluded.enabled
    `);
  }

  public async setup(createChannelId: string, categoryId: string, guildId?: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    const target = guildId ?? GLOBAL_GUILD;

    const config: TempVCConfig = {
      enabled: true,
      createChannelId,
      categoryId,
      panelChannelId: this.configs.get(target)?.panelChannelId ?? '',
      panelMessageId: this.configs.get(target)?.panelMessageId ?? '',
    };
    await this.persistConfig(target, config);
    this.configs.set(target, config);

    this.logger.info('TempVC Service', `Temp VC setup (${target}): createChannel=${createChannelId}, category=${categoryId}`);
  }

  public async setPanel(channelId: string, messageId: string, guildId?: string): Promise<void> {
    if (!this.db) return;
    const target = guildId ?? GLOBAL_GUILD;
    const config = this.getConfig(target) ?? {
      enabled: true,
      createChannelId: '',
      categoryId: '',
      panelChannelId: '',
      panelMessageId: '',
    };
    config.panelChannelId = channelId;
    config.panelMessageId = messageId;
    this.configs.set(target, config);
    await this.persistConfig(target, config);
  }

  public async createTempVC(member: GuildMember): Promise<string | null> {
    const guildId = member.guild.id;
    const config = this.getConfig(guildId);
    if (!config || !config.enabled || !this.client) return null;

    const category = member.guild.channels.cache.get(config.categoryId)
      ?? await member.guild.channels.fetch(config.categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return null;

    try {
      const vc = await member.guild.channels.create({
        name: `${member.user.username}'s VC`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: 'Join-to-create temp VC',
        permissionOverwrites: [
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.Stream,
              PermissionFlagsBits.ManageChannels,
            ],
          },
          {
            id: member.guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream],
          },
        ],
      });

      await member.voice.setChannel(vc);

      const instance: TempVCInstance = {
        channelId: vc.id,
        ownerId: member.id,
        categoryId: config.categoryId,
        guildId,
        createdAt: Date.now(),
      };

      await this.db?.insert(tempvcInstances).values({
        id: shortId('vc'),
        guild_id: guildId,
        channel_id: vc.id,
        owner_id: member.id,
        category_id: config.categoryId,
        created_at: new Date(),
      } as any);

      this.instances.set(vc.id, instance);
      this.logger.info('TempVC Service', `Created temp VC ${vc.id} for ${member.user.tag}`);
      return vc.id;
    } catch (err) {
      this.logger.error('TempVC Service', 'Failed to create temp VC', err as Error);
      return null;
    }
  }

  public async deleteTempVC(channelId: string): Promise<void> {
    if (!this.client) return;
    if (this.deleting.has(channelId)) return;
    this.deleting.add(channelId);
    try {
      const channel = await this.client.channels.fetch(channelId).catch(() => null) as VoiceChannel | null;
      if (channel) {
        await channel.delete('Temp VC cleanup').catch(() => undefined);
      }
      await this.db?.delete(tempvcInstances).where(eq(tempvcInstances.channel_id, channelId));
      this.instances.delete(channelId);
    } finally {
      this.deleting.delete(channelId);
    }
  }

  public isTempVC(channelId: string): boolean {
    return this.instances.has(channelId);
  }

  public getTempVC(channelId: string): TempVCInstance | undefined {
    return this.instances.get(channelId);
  }

  public getPanelButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < PANEL_BUTTONS.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const btn of PANEL_BUTTONS.slice(i, i + 5)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`${PANEL_PREFIX}${btn.id}`)
            .setLabel(btn.label)
            .setEmoji(btn.emoji)
            .setStyle(btn.style),
        );
      }
      rows.push(row);
    }
    return rows;
  }

  private async resolveMember(interaction: any): Promise<GuildMember | null> {
    const member = interaction.member;
    if (member && 'voice' in member) return member as GuildMember;
    if (!interaction.guildId || !interaction.user?.id) return null;
    const guild = interaction.guild ?? this.client?.guilds.cache.get(interaction.guildId);
    return guild ? guild.members.fetch(interaction.user.id).catch(() => null) : null;
  }

  public async handlePanelButton(interaction: any): Promise<boolean> {
    const customId = interaction.customId;
    if (!customId.startsWith(PANEL_PREFIX)) return false;

    const action = customId.slice(PANEL_PREFIX.length);
    const member = await this.resolveMember(interaction);
    if (!member) {
      await interaction.reply({ content: 'Could not resolve your membership in this server.', ephemeral: true }).catch(() => undefined);
      return true;
    }

    const vcChannelId = member.voice?.channel?.id;
    if (!vcChannelId) {
      await interaction.reply({ content: 'You must be in a voice channel to use these controls.', ephemeral: true }).catch(() => undefined);
      return true;
    }

    const temp = this.getTempVC(vcChannelId);
    if (!temp) {
      await interaction.reply({ content: 'This is not a temporary voice channel.', ephemeral: true }).catch(() => undefined);
      return true;
    }

    const isOwner = temp.ownerId === member.id;
    const guild = member.guild;

    switch (action) {
      case 'rename':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can rename it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        await interaction.reply({ content: 'Use `/tempvc name <name>` to rename your VC.', ephemeral: true }).catch(() => undefined);
        return true;

      case 'limit':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can set the limit.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        await interaction.reply({ content: 'Use `/tempvc limit <number>` to set the user limit.', ephemeral: true }).catch(() => undefined);
        return true;

      case 'lock':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can lock it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        try {
          await member.voice.channel?.permissionOverwrites.edit(guild.id, { Connect: false });
          await interaction.reply({ content: '🔒 VC locked.', ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `Failed to lock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
        return true;

      case 'unlock':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can unlock it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        try {
          await member.voice.channel?.permissionOverwrites.edit(guild.id, { Connect: null });
          await interaction.reply({ content: '🔓 VC unlocked.', ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `Failed to unlock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
        return true;

      case 'invite':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can invite.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        await interaction.reply({ content: `Invite someone: <#${vcChannelId}>`, ephemeral: true }).catch(() => undefined);
        return true;

      case 'delete':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can delete it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        try {
          await this.deleteTempVC(vcChannelId);
          await interaction.reply({ content: '🗑️ VC deleted.', ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
        return true;

      case 'hide':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can hide it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        try {
          await member.voice.channel?.permissionOverwrites.edit(guild.id, { ViewChannel: false });
          await interaction.reply({ content: '👁️‍🗨️ VC hidden.', ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `Failed to hide: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
        return true;

      case 'show':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can show it.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        try {
          await member.voice.channel?.permissionOverwrites.edit(guild.id, { ViewChannel: null });
          await interaction.reply({ content: '👁️ VC shown.', ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `Failed to show: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
        return true;

      case 'claim': {
        if (isOwner) {
          await interaction.reply({ content: 'You already own this VC.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        // The owner must be genuinely gone (left the room) — not just offline in cache.
        const ownerVoice = guild.members.cache.get(temp.ownerId)?.voice.channelId
          ?? (await guild.members.fetch(temp.ownerId).catch(() => null))?.voice.channelId;
        if (ownerVoice === vcChannelId) {
          await interaction.reply({ content: 'This VC already has an owner in the channel.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        const channel = member.voice.channel;
        await this.transferOwnership(temp, member.id, channel as VoiceChannel);
        await interaction.reply({ content: '📥 VC claimed. You are now the owner.', ephemeral: true }).catch(() => undefined);
        return true;
      }

      case 'kick':
        if (!isOwner) {
          await interaction.reply({ content: 'Only the VC owner can kick members.', ephemeral: true }).catch(() => undefined);
          return true;
        }
        await interaction.reply({ content: 'Use `/tempvc kick <member>` to kick from your VC.', ephemeral: true }).catch(() => undefined);
        return true;

      default:
        return false;
    }
  }

  private async transferOwnership(temp: TempVCInstance, newOwnerId: string, channel: VoiceChannel | null): Promise<void> {
    const oldOwnerId = temp.ownerId;
    temp.ownerId = newOwnerId;
    this.instances.set(temp.channelId, temp);
    if (this.db) {
      await this.db.update(tempvcInstances)
        .set({ owner_id: newOwnerId })
        .where(eq(tempvcInstances.channel_id, temp.channelId));
    }
    if (channel) {
      try {
        await channel.permissionOverwrites.edit(newOwnerId, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          Stream: true,
          ManageChannels: true,
        });
        // Remove manage rights from the previous owner.
        if (oldOwnerId && oldOwnerId !== newOwnerId) {
          await channel.permissionOverwrites.edit(oldOwnerId, { ManageChannels: null });
        }
      } catch (error) {
        this.logger.warn('TempVC Service', `Could not transfer overwrites: ${(error as Error).message}`);
      }
    }
    this.logger.info('TempVC Service', `Temp VC ${temp.channelId} ownership transferred ${oldOwnerId} → ${newOwnerId}`);
  }

  public async handleVoiceStateUpdate(oldChannelId: string | null, newChannelId: string | null, member: GuildMember): Promise<boolean> {
    const guildId = member.guild.id;
    const config = this.getConfig(guildId);
    if (!config || !config.enabled) return false;

    // If they joined the create channel, spawn a temp VC
    if (newChannelId === config.createChannelId && oldChannelId !== newChannelId && !member.user.bot) {
      // Serialize create per guild+user to avoid duplicate rooms on rapid joins.
      const existing = Array.from(this.instances.values()).find(
        (i) => i.guildId === guildId && i.ownerId === member.id
      );
      if (existing) {
        const channel = await this.client?.channels.fetch(existing.channelId).catch(() => null);
        if (channel) return false;
        // Stale row — clean it and continue to create.
        await this.deleteTempVC(existing.channelId);
      }
      return (await this.createTempVC(member)) !== null;
    }

    // If they left a temp VC and it's now empty, delete it
    if (oldChannelId && oldChannelId !== newChannelId) {
      const temp = this.getTempVC(oldChannelId);
      if (temp) {
        const channel = this.client ? await this.client.channels.fetch(oldChannelId).catch(() => null) as VoiceChannel | null : null;
        if (channel && channel.members.size === 0) {
          await this.deleteTempVC(oldChannelId);
          return true;
        }
      }
    }

    return false;
  }

  public async postPanel(channel: TextChannel, guildId?: string): Promise<Message | null> {
    const target = guildId ?? GLOBAL_GUILD;
    const config = this.getConfig(target);
    if (!config) return null;

    const createMention = config.createChannelId ? `<#${config.createChannelId}>` : '`Create VC`';
    const categoryMention = config.categoryId ? `<#${config.categoryId}>` : 'a category';

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔊 Temporary Voice — Sukuna')
      .setDescription(
        `Join ${createMention} and a private room opens for you instantly.\n\n` +
        'Use the buttons below while you are inside your room to rename it, set a limit, lock/hide it, or delete it. Only the room owner (or whoever claims an abandoned room) can manage it.'
      )
      .addFields(
        { name: '✨ How it works', value: `1. Join ${createMention}\n2. Your room appears in ${categoryMention}\n3. Manage it with the buttons (or \`/tempvc\` commands)`, inline: true },
        { name: '🎛️ Controls', value: 'Rename • Limit • Lock/Unlock\nHide/Show • Invite • Kick\nClaim (if abandoned) • Delete', inline: true },
        { name: '💡 Tips', value: 'Empty rooms auto-delete.\nCreate is instant — no queue.\nOwners can set a member limit.', inline: true },
      )
      .setFooter({ text: 'Sukuna Bot • TempVC' })
      .setTimestamp();

    const rows = this.getPanelButtons();

    let message: Message | null = null;
    try {
      message = await channel.send({ embeds: [embed], components: rows });
      await this.setPanel(channel.id, message.id, target);
      return message;
    } catch (err) {
      this.logger.error('TempVC Service', 'Failed to post panel', err as Error);
      return null;
    }
  }

  public async shutdown(): Promise<void> {
    this.instances.clear();
    this.configs.clear();
    this.deleting.clear();
    this.logger.info('TempVC Service', 'Temp VC system shutdown');
  }
}
