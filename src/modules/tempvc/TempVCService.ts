import {
  Client,
  VoiceChannel,
  ChannelType,
  GuildMember,
  TextChannel,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  Message,
  PermissionFlagsBits,
  Guild,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq, sql } from 'drizzle-orm';
import { tempvcConfigs, tempvcInstances } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { shortId } from '../../utils/id';
import { buildPanelPayload, panelButtonRows, type PanelButton, type PanelFeature, type PanelPayload } from '../../utils/panel';

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
/** Modals live under their own prefix so they never collide with button ids. */
const MODAL_PREFIX = 'tempvc_modal:';
const KICK_SELECT = `${PANEL_PREFIX}kick_select`;

/**
 * Row 1 — the things a room owner does while people are joining.
 * Row 2 — privacy and hand-over controls.
 * Row 3 — destructive action + admin-only panel refresh.
 */
const PANEL_BUTTONS: PanelButton[] = [
  { id: 'create', label: 'CREATE', emoji: 'voice', style: ButtonStyle.Primary },
  { id: 'rename', label: 'RENAME', emoji: 'pencil', style: ButtonStyle.Secondary },
  { id: 'limit', label: 'LIMIT', emoji: 'member', style: ButtonStyle.Secondary },
  { id: 'invite', label: 'INVITE', emoji: 'link', style: ButtonStyle.Secondary },
  { id: 'kick', label: 'KICK', emoji: 'kick', style: ButtonStyle.Danger },
  { id: 'lock', label: 'LOCK', emoji: 'lock', style: ButtonStyle.Secondary },
  { id: 'unlock', label: 'UNLOCK', emoji: 'unlock', style: ButtonStyle.Secondary },
  { id: 'hide', label: 'HIDE', emoji: 'eye', style: ButtonStyle.Secondary },
  { id: 'show', label: 'SHOW', emoji: 'eye', style: ButtonStyle.Secondary },
  { id: 'claim', label: 'CLAIM', emoji: 'check', style: ButtonStyle.Success },
  { id: 'delete', label: 'DELETE', emoji: 'trash', style: ButtonStyle.Danger },
  { id: 'refresh', label: 'PANEL', emoji: 'settings', style: ButtonStyle.Secondary },
];

/** Turns unknown thrown values into a one-line message for ephemeral replies. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rowToConfig(row: any): TempVCConfig {  return {
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
  /** Guild+user pairs currently having a room created — guards duplicate joins. */
  private creating: Set<string> = new Set();

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

    if (!config.categoryId) {
      this.logger.warn('TempVC Service', `Cannot create VC for ${member.user.tag}: no category configured (run /tempvc setup or the dashboard)`);
      return null;
    }

    const category = member.guild.channels.cache.get(config.categoryId)
      ?? await member.guild.channels.fetch(config.categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      this.logger.warn('TempVC Service', `Cannot create VC for ${member.user.tag}: category ${config.categoryId} not found or not a category`);
      return null;
    }

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

      if (!member.voice) {
        this.logger.warn('TempVC Service', `Created ${vc.id} but ${member.user.tag} has no cached voice state — cannot move them (is the GuildVoiceStates intent enabled?)`);
      } else {
        await member.voice.setChannel(vc).catch((error) => {
          this.logger.warn('TempVC Service', `Created ${vc.id} but could not move ${member.user.tag} into it: ${(error as Error).message}`);
        });
      }

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
    return panelButtonRows(
      PANEL_BUTTONS.map((button) => ({ ...button, id: `${PANEL_PREFIX}${button.id}` })),
      5,
    );
  }

  /**
   * Builds the temp VC control panel: intro, a bullet per control,
   * the current setup, banner artwork and the control buttons.
   */
  public async buildPanel(cfg: TempVCConfig, guild?: Guild | null): Promise<PanelPayload> {
    const createMention = cfg.createChannelId ? `<#${cfg.createChannelId}>` : '`Create VC`';
    const categoryMention = cfg.categoryId ? `<#${cfg.categoryId}>` : 'a category';
    const rooms = guild
      ? Array.from(this.instances.values()).filter((instance) => instance.guildId === guild.id)
      : [];

    const features: PanelFeature[] = [
      { emoji: 'voice', label: 'Create', value: `Join ${createMention.replace(/`/g, '')} or press Create`, code: false },
      { emoji: 'pencil', label: 'Rename', value: 'Give your room any name you like' },
      { emoji: 'member', label: 'Limit', value: 'Set how many people can join' },
      { emoji: 'link', label: 'Invite', value: 'Get a shareable invite link for your room' },
      { emoji: 'kick', label: 'Kick', value: 'Remove a member from your room' },
      { emoji: 'lock', label: 'Lock / Unlock', value: 'Control who can join your room' },
      { emoji: 'eye', label: 'Hide / Show', value: 'Control who can see your room' },
      { emoji: 'check', label: 'Claim', value: 'Take over an abandoned room' },
      { emoji: 'trash', label: 'Delete', value: 'Remove the room for good' },
    ];

    const sections = [
      {
        title: 'Setup',
        lines: [
          `Create channel: ${cfg.createChannelId ? `<#${cfg.createChannelId}>` : 'not set'}`,
          `Category: ${cfg.categoryId ? `<#${cfg.categoryId}>` : 'not set'}`,
          `Active rooms: **${rooms.length}**`,
        ],
      },
    ];

    const configured = Boolean(cfg.createChannelId && cfg.categoryId);

    return buildPanelPayload({
      emoji: 'tempvc',
      title: 'Temporary Voice',
      guildName: guild?.name,
      guildIconUrl: guild?.iconURL({ extension: 'png', size: 256 }) ?? undefined,
      color: 0xef4444,
      intro: `Join ${createMention} and a private room opens for you instantly in ${categoryMention}. Every control below works on the room you are currently sitting in — no commands needed.`,
      features,
      sections,
      note: configured
        ? 'Only the room owner (or staff with Manage Server) can rename, lock, hide, kick or delete. Use PANEL to refresh the room count after changes.'
        : '⚠️ No create channel or category is configured yet. Ask an admin to run `/tempvc setup` or set it from the dashboard, then press PANEL to refresh.',
      banner: {
        title: 'Temporary Voice',
        subtitle: guild?.name,
        emoji: '🔊',
        accent: '#ef4444',
        accentSecondary: '#f97316',
      },
      buttons: PANEL_BUTTONS.map((button) => ({ ...button, id: `${PANEL_PREFIX}${button.id}` })),
      footer: `${guild?.name ?? 'Sukuna Bot'} • Temporary Voice`,
    });
  }

  private async resolveMember(interaction: any): Promise<GuildMember | null> {
    const member = interaction.member;
    if (member && 'voice' in member) return member as GuildMember;
    if (!interaction.guildId || !interaction.user?.id) return null;
    const guild = interaction.guild ?? this.client?.guilds.cache.get(interaction.guildId);
    return guild ? guild.members.fetch(interaction.user.id).catch(() => null) : null;
  }

  public async handlePanelButton(interaction: any): Promise<boolean> {
    const customId = String(interaction.customId);
    if (!customId.startsWith(PANEL_PREFIX)) return false;

    const action = customId.slice(PANEL_PREFIX.length);
    const member = await this.resolveMember(interaction);
    if (!member) {
      await this.reply(interaction, 'Could not resolve your membership in this server.');
      return true;
    }

    const guild = member.guild;
    const config = this.getConfig(guild.id);
    const isManager = member.permissions.has(PermissionFlagsBits.ManageGuild);

    // Panel-wide actions come first — they don't need a room.
    if (action === 'refresh') {
      if (!isManager) {
        await this.reply(interaction, 'Only staff with **Manage Server** can refresh the panel.');
        return true;
      }
      if (!config) {
        await this.reply(interaction, 'Temporary voice is not configured yet.');
        return true;
      }
      const payload = await this.buildPanel(config, guild);
      await interaction
        .update({ components: payload.components, files: payload.files })
        .catch(() => undefined);
      return true;
    }

    if (action === 'create') {
      await this.createFromPanel(interaction, member, config);
      return true;
    }

    const voiceChannel = (member.voice?.channel ?? null) as VoiceChannel | null;
    const temp = voiceChannel ? this.getTempVC(voiceChannel.id) : undefined;
    if (!voiceChannel || !temp) {
      await this.reply(
        interaction,
        config?.createChannelId
          ? `You are not inside a temporary room. Join <#${config.createChannelId}> or press **CREATE** to open one.`
          : 'You are not inside a temporary room, and no create channel is configured yet.',
      );
      return true;
    }

    const isOwner = temp.ownerId === member.id;
    const allowed = isOwner || isManager;
    const denied = async (what: string): Promise<true> => { await this.reply(interaction, `Only the room owner can ${what}.`); return true; };

    switch (action) {
      case 'rename': {
        if (!allowed) return denied('rename it');
        const modal = new ModalBuilder()
          .setCustomId(`${MODAL_PREFIX}rename`)
          .setTitle('Rename your room')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Room name')
              .setDescription('2–100 characters, shown in the channel list')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId('name')
                  .setStyle(TextInputStyle.Short)
                  .setValue(voiceChannel.name)
                  .setMinLength(2)
                  .setMaxLength(100)
                  .setRequired(true),
              ),
          );
        await interaction.showModal(modal).catch(() => undefined);
        return true;
      }

      case 'limit': {
        if (!allowed) return denied('change its limit');
        const modal = new ModalBuilder()
          .setCustomId(`${MODAL_PREFIX}limit`)
          .setTitle('Set a user limit')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('User limit')
              .setDescription('Between 0 and 99 — 0 means unlimited')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId('limit')
                  .setStyle(TextInputStyle.Short)
                  .setValue(String(voiceChannel.userLimit ?? 0))
                  .setMinLength(1)
                  .setMaxLength(2)
                  .setRequired(true),
              ),
          );
        await interaction.showModal(modal).catch(() => undefined);
        return true;
      }

      case 'invite': {
        if (!allowed) return denied('invite people');
        try {
          const invite = await voiceChannel.createInvite({
            maxAge: 3600,
            maxUses: 0,
            unique: true,
            reason: `Temp VC invite for ${voiceChannel.name}`,
          });
          await this.reply(interaction, `🔗 Share this link (valid for 1 hour):\n${invite.url}`);
        } catch (err) {
          await this.reply(interaction, `Could not create an invite: ${errorText(err)}. Check my **Create Invite** permission.`);
        }
        return true;
      }

      case 'kick': {
        if (!allowed) return denied('kick members');
        const targets = voiceChannel.members.filter((target) => !target.user.bot && target.id !== member.id);
        if (!targets.size) {
          await this.reply(interaction, 'There is nobody else in your room to kick.');
          return true;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`${KICK_SELECT}:${voiceChannel.id}`)
          .setPlaceholder('Choose a member to remove')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            targets.first(25).map((target) => ({
              label: target.displayName.slice(0, 100),
              value: target.id,
              description: target.user.tag.slice(0, 100),
            })),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
        await interaction
          .reply({
            content: `Choose who to remove from **${voiceChannel.name}**:`,
            components: [row],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
        return true;
      }

      case 'lock': {
        if (!allowed) return denied('lock it');
        try {
          await voiceChannel.permissionOverwrites.edit(guild.id, { Connect: false });
          await this.reply(interaction, '🔒 Room locked — new members cannot connect.');
        } catch (err) {
          await this.reply(interaction, `Failed to lock: ${errorText(err)}`);
        }
        return true;
      }

      case 'unlock': {
        if (!allowed) return denied('unlock it');
        try {
          await voiceChannel.permissionOverwrites.edit(guild.id, { Connect: null });
          await this.reply(interaction, '🔓 Room unlocked — everyone can connect again.');
        } catch (err) {
          await this.reply(interaction, `Failed to unlock: ${errorText(err)}`);
        }
        return true;
      }

      case 'hide': {
        if (!allowed) return denied('hide it');
        try {
          await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
          await this.reply(interaction, '👁️‍🗨️ Room hidden from members.');
        } catch (err) {
          await this.reply(interaction, `Failed to hide: ${errorText(err)}`);
        }
        return true;
      }

      case 'show': {
        if (!allowed) return denied('show it');
        try {
          await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
          await this.reply(interaction, '👁️ Room visible to members again.');
        } catch (err) {
          await this.reply(interaction, `Failed to show: ${errorText(err)}`);
        }
        return true;
      }

      case 'delete': {
        if (!allowed) return denied('delete it');
        try {
          await this.deleteTempVC(voiceChannel.id);
          await this.reply(interaction, '🗑️ Room deleted.');
        } catch (err) {
          await this.reply(interaction, `Failed to delete: ${errorText(err)}`);
        }
        return true;
      }

      case 'claim': {
        if (isOwner) {
          await this.reply(interaction, 'You already own this room.');
          return true;
        }
        // The owner must be genuinely gone (left the room) — not just offline in cache.
        const ownerVoice = guild.members.cache.get(temp.ownerId)?.voice.channelId
          ?? (await guild.members.fetch(temp.ownerId).catch(() => null))?.voice.channelId;
        if (ownerVoice === voiceChannel.id) {
          await this.reply(interaction, 'This room already has an owner in the channel.');
          return true;
        }
        await this.transferOwnership(temp, member.id, voiceChannel);
        await this.reply(interaction, '📥 Room claimed — you are now the owner.');
        return true;
      }

      default:
        return false;
    }
  }

  /** CREATE button — opens a room directly, or moves the owner back into theirs. */
  private async createFromPanel(interaction: any, member: GuildMember, config: TempVCConfig | null): Promise<void> {
    if (!config || !config.enabled) {
      await this.reply(interaction, 'Temporary voice is disabled right now.');
      return;
    }
    if (!member.voice?.channelId) {
      await this.reply(interaction, 'Join any voice channel first, then press **CREATE** again.');
      return;
    }

    const existing = Array.from(this.instances.values()).find(
      (instance) => instance.guildId === member.guild.id && instance.ownerId === member.id,
    );
    if (existing) {
      const channel = await this.client?.channels.fetch(existing.channelId).catch(() => null);
      if (channel) {
        if (member.voice.channelId === existing.channelId) {
          await this.reply(interaction, `You are already in your room: <#${existing.channelId}>.`);
          return;
        }
        try {
          await member.voice.setChannel(existing.channelId, 'Moved to own temp VC');
          await this.reply(interaction, `➡️ Moved you into your room <#${existing.channelId}>.`);
        } catch (err) {
          await this.reply(interaction, `Could not move you: ${errorText(err)}`);
        }
        return;
      }
      // Stale instance — clear it before creating a fresh room.
      await this.deleteTempVC(existing.channelId);
    }

    const id = await this.createTempVC(member);
    if (id) await this.reply(interaction, `🔊 Your room is ready: <#${id}>.`);
    else await this.reply(interaction, 'Could not create a room — the category is missing or I lack **Manage Channels**. Check the bot log.');
  }

  /** Handles the rename/limit modals opened from the panel. */
  public async handleModalSubmit(interaction: any): Promise<boolean> {
    const customId = String(interaction.customId);
    if (!customId.startsWith(MODAL_PREFIX)) return false;

    const action = customId.slice(MODAL_PREFIX.length);
    const member = await this.resolveMember(interaction);
    if (!member) {
      await this.reply(interaction, 'Could not resolve your membership in this server.');
      return true;
    }

    const voiceChannel = (member.voice?.channel ?? null) as VoiceChannel | null;
    const temp = voiceChannel ? this.getTempVC(voiceChannel.id) : undefined;
    if (!voiceChannel || !temp) {
      await this.reply(interaction, 'You are no longer inside your temporary room.');
      return true;
    }
    if (temp.ownerId !== member.id && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await this.reply(interaction, 'Only the room owner can change it.');
      return true;
    }

    try {
      if (action === 'rename') {
        const name = String(interaction.fields.getTextInputValue('name') ?? '').trim().replace(/\s+/g, ' ');
        if (name.length < 2) {
          await this.reply(interaction, 'Please pick a name with at least 2 characters.');
          return true;
        }
        await voiceChannel.edit({ name, reason: 'Temp VC renamed by owner' });
        await this.reply(interaction, `✅ Renamed your room to **${name}**.`);
        return true;
      }

      if (action === 'limit') {
        const raw = String(interaction.fields.getTextInputValue('limit') ?? '').trim();
        if (!/^\d{1,2}$/.test(raw)) {
          await this.reply(interaction, 'The limit must be a whole number between 0 and 99.');
          return true;
        }
        const limit = Number(raw);
        await voiceChannel.edit({ userLimit: limit, reason: 'Temp VC limit changed by owner' });
        await this.reply(interaction, `✅ User limit set to **${limit === 0 ? 'unlimited' : limit}**.`);
        return true;
      }
    } catch (err) {
      await this.reply(interaction, `Failed to update the room: ${errorText(err)}`);
      return true;
    }

    return false;
  }

  /** Handles the member picker opened by the KICK button. */
  public async handleSelectMenu(interaction: any): Promise<boolean> {
    const customId = String(interaction.customId);
    if (!customId.startsWith(`${KICK_SELECT}:`)) return false;

    const channelId = customId.slice(KICK_SELECT.length + 1);
    const member = await this.resolveMember(interaction);
    if (!member) {
      await this.reply(interaction, 'Could not resolve your membership in this server.');
      return true;
    }

    const temp = this.getTempVC(channelId);
    if (!temp) {
      await interaction.update({ content: 'That room no longer exists.', components: [] }).catch(() => undefined);
      return true;
    }
    if (temp.ownerId !== member.id && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await this.reply(interaction, 'Only the room owner can kick members.');
      return true;
    }

    const targetId = String(interaction.values?.[0] ?? '');
    if (!targetId) return true;

    const channel = await member.guild.channels.fetch(channelId).catch(() => null) as VoiceChannel | null;
    const target = channel?.members.get(targetId)
      ?? await member.guild.members.fetch(targetId).catch(() => null);
    if (!target?.voice || target.voice.channelId !== channelId) {
      await interaction.update({ content: 'That member already left the room.', components: [] }).catch(() => undefined);
      return true;
    }

    try {
      await target.voice.disconnect('Kicked from a temp VC');
      await interaction
        .update({ content: `👢 Removed **${target.user.username}** from the room.`, components: [] })
        .catch(() => undefined);
    } catch (err) {
      await this.reply(interaction, `Failed to kick: ${errorText(err)}`);
    }
    return true;
  }

  private async reply(interaction: any, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
      const lockKey = `${guildId}-${member.id}`;
      if (this.creating.has(lockKey)) return false;
      this.creating.add(lockKey);
      try {
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
      } finally {
        this.creating.delete(lockKey);
      }
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

    const guild = guildId ? this.client?.guilds.cache.get(guildId) : null;
    const panel = await this.buildPanel(config, guild);

    let message: Message | null = null;
    try {
      message = await channel.send({
        components: panel.components,
        files: panel.files,
        flags: panel.flags,
      });
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
    this.creating.clear();
    this.logger.info('TempVC Service', 'Temp VC system shutdown');
  }
}
