import { Client, TextChannel, ChannelType, EmbedBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { automationJobs } from '../database/schema';
import type { DrizzleDb } from '../types/database';
import { nextCron, isValidCron } from '../utils/cron';
import { shortId } from '../utils/id';

export interface AutomationJob {
  id: string;
  guildId: string;
  type: string;
  cronExpression: string;
  enabled: boolean;
  config: any;
  lastRun: number | null;
  nextRun: number;
}

export interface AutomationConfig {
  enabled: boolean;
  /** Consecutive failures before a job is automatically disabled. */
  maxErrors: number;
}

interface JobRow {
  id: string;
  guild_id: string;
  type: string;
  cron_expression: string;
  enabled: boolean;
  config: any;
  last_run: Date | null;
  next_run: Date;
  last_error: string | null;
  run_count: number;
}

function rowToJob(row: JobRow): AutomationJob {
  let config: any = {};
  try {
    config = row.config && typeof row.config === 'object' ? row.config : {};
  } catch { config = {}; }
  return {
    id: row.id,
    guildId: row.guild_id,
    type: row.type,
    cronExpression: row.cron_expression,
    enabled: Boolean(row.enabled),
    config,
    lastRun: row.last_run instanceof Date ? row.last_run.getTime() : (row.last_run ? toMs(row.last_run) : null),
    nextRun: row.next_run instanceof Date ? row.next_run.getTime() : toMs(row.next_run),
  };
}

/** Timestamps may be stored as seconds (raw SQL) or milliseconds (drizzle) — normalize. */
function toMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1e12 ? n : n * 1000;
}

const KNOWN_TYPES = new Set(['message', 'embed', 'log']);

export class AutomationService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private client: Client | null = null;
  public config: AutomationConfig = { enabled: true, maxErrors: 5 };
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();
  private errorCounts = new Map<string, number>();

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
    if (this.db) {
      // Heal rows whose next_run is missing/garbage by recomputing from cron.
      const rows = await this.db.select().from(automationJobs);
      for (const row of rows as unknown as JobRow[]) {
        if (!row.next_run || Number.isNaN(rowToJob(row).nextRun) || rowToJob(row).nextRun < Date.now() - 30 * 24 * 3600 * 1000) {
          try {
            const next = nextCron(row.cron_expression);
            await this.db
              .update(automationJobs)
              .set({ next_run: next } as any)
              .where(eq(automationJobs.id, row.id));
          } catch (error) {
            this.logger.warn('Automation Service', `Disabling job ${row.id}: ${(error as Error).message}`);
            await this.db
              .update(automationJobs)
              .set({ enabled: false, last_error: `Invalid cron: ${(error as Error).message}` } as any)
              .where(eq(automationJobs.id, row.id));
          }
        }
      }
    }
    this.logger.info('Automation Service', 'Automation system initialized');
    this.startScheduler();
  }

  private startScheduler(): void {
    this.timer = setInterval(() => {
      void this.checkJobs().catch((error) => {
        this.logger.error('Automation Service', 'Scheduler tick failed', error as Error);
      });
    }, 30_000);
    this.timer.unref?.();
  }

  private async checkJobs(): Promise<void> {
    if (!this.config.enabled || !this.db) return;
    const now = new Date();
    const rows = await this.db
      .select()
      .from(automationJobs)
      .where(eq(automationJobs.enabled, true));
    for (const row of rows as unknown as JobRow[]) {
      const nextRun = rowToJob(row).nextRun;
      if (nextRun > now.getTime()) continue;
      await this.runJob(row);
    }
  }

  /** Run one job now, updating state, or record the error. Never throws. */
  private async runJob(row: JobRow): Promise<void> {
    if (this.running.has(row.id)) return;
    this.running.add(row.id);
    try {
      await this.executeJob(row);
      this.errorCounts.set(row.id, 0);
      const next = new Date(nextCron(row.cron_expression).getTime());
      await this.db!
        .update(automationJobs)
        .set({
          last_run: new Date(),
          next_run: next,
          run_count: (Number(row.run_count) || 0) + 1,
          last_error: null,
        } as any)
        .where(eq(automationJobs.id, row.id));
      this.logger.info('Automation Service', `Job ${row.id} (${row.type}) completed`);
    } catch (error) {
      const message = (error as Error).message;
      const count = (this.errorCounts.get(row.id) ?? 0) + 1;
      this.errorCounts.set(row.id, count);
      const next = (() => { try { return new Date(nextCron(row.cron_expression).getTime()); } catch { return null; } })();
      const disable = count >= this.config.maxErrors;
      await this.db!
        .update(automationJobs)
        .set({
          last_error: message.slice(0, 500),
          ...(next ? { next_run: next } : {}),
          ...(disable ? { enabled: false } : {}),
        } as any)
        .where(eq(automationJobs.id, row.id));
      if (disable) {
        this.logger.error('Automation Service', `Job ${row.id} disabled after ${count} consecutive failures: ${message}`);
      } else {
        this.logger.warn('Automation Service', `Job ${row.id} failed (attempt ${count}): ${message}`);
      }
    } finally {
      this.running.delete(row.id);
    }
  }

  private async executeJob(row: JobRow): Promise<void> {
    const config = row.config && typeof row.config === 'object' ? row.config : {};
    switch (row.type) {
      case 'message':
        await this.sendMessage(config);
        return;
      case 'embed':
        await this.sendEmbed(config);
        return;
      case 'log':
        this.logger.info('Automation Job', String(config?.message ?? `Job ${row.id} executed`));
        return;
      default:
        throw new Error(`Unknown job type "${row.type}". Supported: ${[...KNOWN_TYPES].join(', ')}`);
    }
  }

  private async resolveChannel(channelId: string | undefined): Promise<TextChannel> {
    if (!channelId) throw new Error('Job config is missing channelId');
    if (!this.client) throw new Error('Discord client is not connected');
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error(`Channel ${channelId} not found or not a text channel`);
    return channel as TextChannel;
  }

  private async sendMessage(config: any): Promise<void> {
    const channel = await this.resolveChannel(config?.channelId);
    const content = String(config?.message ?? '').trim();
    if (!content) throw new Error('Job config is missing "message"');
    await channel.send({ content: content.slice(0, 2000) });
  }

  private async sendEmbed(config: any): Promise<void> {
    const channel = await this.resolveChannel(config?.channelId);
    const title = String(config?.title ?? '').trim();
    const description = String(config?.description ?? config?.message ?? '').trim();
    if (!title && !description) throw new Error('Embed job config needs "title" or "description"');
    const embed = new EmbedBuilder()
      .setColor(/^#[0-9a-f]{6}$/i.test(config?.color ?? '') ? config.color : '#5865f2')
      .setTitle(title.slice(0, 256) || null)
      .setDescription(description.slice(0, 4000) || null)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  }

  public async addJob(job: Omit<AutomationJob, 'id' | 'lastRun' | 'nextRun'> & { id?: string }): Promise<string> {
    if (!isValidCron(job.cronExpression)) {
      throw new Error(`Invalid cron expression "${job.cronExpression}". Example: "0 9 * * *"`);
    }
    if (!KNOWN_TYPES.has(job.type)) {
      throw new Error(`Unsupported job type "${job.type}". Supported: ${[...KNOWN_TYPES].join(', ')}`);
    }
    const id = job.id ?? shortId('job');
    const nextRun = nextCron(job.cronExpression).getTime();
    const record = {
      id,
      guild_id: job.guildId,
      type: job.type,
      cron_expression: job.cronExpression,
      enabled: job.enabled,
      config: job.config ?? {},
      next_run: new Date(nextRun),
    };
    if (this.db) {
      await this.db.insert(automationJobs).values(record as any);
    }
    return id;
  }

  public async removeJob(jobId: string): Promise<boolean> {
    if (this.db) {
      const result = await this.db.delete(automationJobs).where(eq(automationJobs.id, jobId)).run();
      return Number((result as { changes?: number }).changes ?? 0) > 0;
    }
    return false;
  }

  public async setJobEnabled(jobId: string, enabled: boolean): Promise<boolean> {
    if (!this.db) return false;
    const result = await this.db
      .update(automationJobs)
      .set({ enabled, ...(enabled ? { last_error: null } : {}) } as any)
      .where(eq(automationJobs.id, jobId))
      .run();
    if (enabled) this.errorCounts.set(jobId, 0);
    return Number((result as { changes?: number }).changes ?? 0) > 0;
  }

  public async listJobs(guildId?: string): Promise<AutomationJob[]> {
    if (!this.db) return [];
    const rows = guildId
      ? await this.db.select().from(automationJobs).where(eq(automationJobs.guild_id, guildId))
      : await this.db.select().from(automationJobs);
    return (rows as unknown as JobRow[]).map(rowToJob).sort((a, b) => a.nextRun - b.nextRun);
  }

  public async runJobNow(jobId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    const rows = await this.db.select().from(automationJobs).where(eq(automationJobs.id, jobId)).limit(1);
    if (!rows[0]) throw new Error('Job not found');
    await this.runJob(rows[0] as unknown as JobRow);
  }

  public nextRunFor(cronExpression: string, from?: Date): Date {
    return nextCron(cronExpression, from ?? new Date());
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running.clear();
    this.errorCounts.clear();
    this.logger.info('Automation Service', 'Automation system shutdown');
  }
}

/** Admin commands: /automation add|remove|list|run|toggle */
export class AutomationCommands {
  private service: AutomationService;
  private logger: Logger;

  constructor(service: AutomationService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.automationCommand];
  }

  private automationCommand: any = {
    data: new SlashCommandBuilder()
      .setName('automation')
      .setDescription('Manage scheduled automation jobs')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a scheduled job')
          .addStringOption((o) =>
            o.setName('type').setDescription('Job type').setRequired(true)
              .addChoices({ name: 'message', value: 'message' }, { name: 'embed', value: 'embed' }, { name: 'log', value: 'log' }),
          )
          .addStringOption((o) => o.setName('cron').setDescription('Cron expression, e.g. "0 9 * * *"').setRequired(true))
          .addChannelOption((o) => o.setName('channel').setDescription('Target channel (required for message/embed)').addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName('message').setDescription('Message content (message/log) or embed description'))
          .addStringOption((o) => o.setName('title').setDescription('Embed title (embed type)'))
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List scheduled jobs'))
      .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a job').addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true)))
      .addSubcommand((sub) => sub.setName('run').setDescription('Run a job immediately').addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true)))
      .addSubcommand((sub) =>
        sub.setName('toggle').setDescription('Enable or disable a job')
          .addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true))
          .addBooleanOption((o) => o.setName('enabled').setDescription('Whether the job should run').setRequired(true)),
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const sub = interaction.options.getSubcommand();
      try {
        if (sub === 'add') {
          const type = interaction.options.getString('type', true);
          const cronExpression = interaction.options.getString('cron', true);
          const channel = interaction.options.getChannel('channel');
          const message = interaction.options.getString('message') ?? '';
          const title = interaction.options.getString('title') ?? '';

          if (type !== 'log' && !channel) {
            await interaction.reply({ content: 'A channel is required for message/embed jobs.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (type !== 'log' && !message && !title) {
            await interaction.reply({ content: 'Provide at least a message or a title.', flags: MessageFlags.Ephemeral });
            return;
          }

          const id = await this.service.addJob({
            guildId,
            type,
            cronExpression,
            enabled: true,
            config: {
              ...(channel ? { channelId: channel.id } : {}),
              ...(message ? { message, description: message } : {}),
              ...(title ? { title } : {}),
            },
          });
          const next = this.service.nextRunFor(cronExpression);
          await interaction.reply({
            embeds: [new EmbedBuilder()
              .setColor('#22c55e')
              .setTitle('✅ Automation job added')
              .setDescription(`**Type:** ${type}\n**Schedule:** \`${cronExpression}\`\n**Next run:** <t:${Math.floor(next.getTime() / 1000)}:R>\n**Id:** \`${id}\``)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'list') {
          const jobs = await this.service.listJobs(guildId);
          const description = jobs.length
            ? jobs.map((j) => {
                const state = j.enabled ? '🟢' : '🔴';
                const last = j.lastRun ? `<t:${Math.floor(j.lastRun / 1000)}:R>` : 'never';
                return `${state} \`${j.id}\` — **${j.type}** \`${j.cronExpression}\`\n  last: ${last} • next: <t:${Math.floor(j.nextRun / 1000)}:R>`;
              }).join('\n')
            : 'No jobs scheduled.';
          await interaction.reply({
            embeds: [new EmbedBuilder().setColor('#5865f2').setTitle('🤖 Automation Jobs').setDescription(description)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'remove') {
          const id = interaction.options.getString('id', true);
          const removed = await this.service.removeJob(id);
          await interaction.reply({ content: removed ? `✅ Removed job \`${id}\`.` : 'Job not found.', flags: MessageFlags.Ephemeral });
          return;
        }

        if (sub === 'run') {
          const id = interaction.options.getString('id', true);
          await this.service.runJobNow(id);
          await interaction.reply({ content: `✅ Job \`${id}\` executed.`, flags: MessageFlags.Ephemeral });
          return;
        }

        if (sub === 'toggle') {
          const id = interaction.options.getString('id', true);
          const enabled = interaction.options.getBoolean('enabled', true);
          const changed = await this.service.setJobEnabled(id, enabled);
          await interaction.reply({ content: changed ? `✅ Job \`${id}\` ${enabled ? 'enabled' : 'disabled'}.` : 'Job not found.', flags: MessageFlags.Ephemeral });
        }
      } catch (error) {
        this.logger.error('Automation Commands', `Failed /automation ${sub}`, error as Error);
        await interaction.reply({ content: `❌ ${(error as Error).message}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    },
  };
}
