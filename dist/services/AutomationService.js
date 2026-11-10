"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationCommands = exports.AutomationService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const cron_1 = require("../utils/cron");
const id_1 = require("../utils/id");
function rowToJob(row) {
    let config = {};
    try {
        config = row.config && typeof row.config === 'object' ? row.config : {};
    }
    catch {
        config = {};
    }
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
function toMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return n > 1e12 ? n : n * 1000;
}
const KNOWN_TYPES = new Set(['message', 'embed', 'log']);
class AutomationService {
    constructor(logger) {
        this.db = null;
        this.client = null;
        this.config = { enabled: true, maxErrors: 5 };
        this.timer = null;
        this.running = new Set();
        this.errorCounts = new Map();
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    setClient(client) {
        this.client = client;
    }
    async initialize() {
        if (this.db) {
            // Heal rows whose next_run is missing/garbage by recomputing from cron.
            const rows = await this.db.select().from(schema_1.automationJobs);
            for (const row of rows) {
                if (!row.next_run || Number.isNaN(rowToJob(row).nextRun) || rowToJob(row).nextRun < Date.now() - 30 * 24 * 3600 * 1000) {
                    try {
                        const next = (0, cron_1.nextCron)(row.cron_expression);
                        await this.db
                            .update(schema_1.automationJobs)
                            .set({ next_run: next })
                            .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, row.id));
                    }
                    catch (error) {
                        this.logger.warn('Automation Service', `Disabling job ${row.id}: ${error.message}`);
                        await this.db
                            .update(schema_1.automationJobs)
                            .set({ enabled: false, last_error: `Invalid cron: ${error.message}` })
                            .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, row.id));
                    }
                }
            }
        }
        this.logger.info('Automation Service', 'Automation system initialized');
        this.startScheduler();
    }
    startScheduler() {
        this.timer = setInterval(() => {
            void this.checkJobs().catch((error) => {
                this.logger.error('Automation Service', 'Scheduler tick failed', error);
            });
        }, 30_000);
        this.timer.unref?.();
    }
    async checkJobs() {
        if (!this.config.enabled || !this.db)
            return;
        const now = new Date();
        const rows = await this.db
            .select()
            .from(schema_1.automationJobs)
            .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.enabled, true));
        for (const row of rows) {
            const nextRun = rowToJob(row).nextRun;
            if (nextRun > now.getTime())
                continue;
            await this.runJob(row);
        }
    }
    /** Run one job now, updating state, or record the error. Never throws. */
    async runJob(row) {
        if (this.running.has(row.id))
            return;
        this.running.add(row.id);
        try {
            await this.executeJob(row);
            this.errorCounts.set(row.id, 0);
            const next = new Date((0, cron_1.nextCron)(row.cron_expression).getTime());
            await this.db
                .update(schema_1.automationJobs)
                .set({
                last_run: new Date(),
                next_run: next,
                run_count: (Number(row.run_count) || 0) + 1,
                last_error: null,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, row.id));
            this.logger.info('Automation Service', `Job ${row.id} (${row.type}) completed`);
        }
        catch (error) {
            const message = error.message;
            const count = (this.errorCounts.get(row.id) ?? 0) + 1;
            this.errorCounts.set(row.id, count);
            const next = (() => { try {
                return new Date((0, cron_1.nextCron)(row.cron_expression).getTime());
            }
            catch {
                return null;
            } })();
            const disable = count >= this.config.maxErrors;
            await this.db
                .update(schema_1.automationJobs)
                .set({
                last_error: message.slice(0, 500),
                ...(next ? { next_run: next } : {}),
                ...(disable ? { enabled: false } : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, row.id));
            if (disable) {
                this.logger.error('Automation Service', `Job ${row.id} disabled after ${count} consecutive failures: ${message}`);
            }
            else {
                this.logger.warn('Automation Service', `Job ${row.id} failed (attempt ${count}): ${message}`);
            }
        }
        finally {
            this.running.delete(row.id);
        }
    }
    async executeJob(row) {
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
    async resolveChannel(channelId) {
        if (!channelId)
            throw new Error('Job config is missing channelId');
        if (!this.client)
            throw new Error('Discord client is not connected');
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            throw new Error(`Channel ${channelId} not found or not a text channel`);
        return channel;
    }
    async sendMessage(config) {
        const channel = await this.resolveChannel(config?.channelId);
        const content = String(config?.message ?? '').trim();
        if (!content)
            throw new Error('Job config is missing "message"');
        await channel.send({ content: content.slice(0, 2000) });
    }
    async sendEmbed(config) {
        const channel = await this.resolveChannel(config?.channelId);
        const title = String(config?.title ?? '').trim();
        const description = String(config?.description ?? config?.message ?? '').trim();
        if (!title && !description)
            throw new Error('Embed job config needs "title" or "description"');
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(/^#[0-9a-f]{6}$/i.test(config?.color ?? '') ? config.color : '#5865f2')
            .setTitle(title.slice(0, 256) || null)
            .setDescription(description.slice(0, 4000) || null)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    }
    async addJob(job) {
        if (!(0, cron_1.isValidCron)(job.cronExpression)) {
            throw new Error(`Invalid cron expression "${job.cronExpression}". Example: "0 9 * * *"`);
        }
        if (!KNOWN_TYPES.has(job.type)) {
            throw new Error(`Unsupported job type "${job.type}". Supported: ${[...KNOWN_TYPES].join(', ')}`);
        }
        const id = job.id ?? (0, id_1.shortId)('job');
        const nextRun = (0, cron_1.nextCron)(job.cronExpression).getTime();
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
            await this.db.insert(schema_1.automationJobs).values(record);
        }
        return id;
    }
    async removeJob(jobId) {
        if (this.db) {
            const result = await this.db.delete(schema_1.automationJobs).where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, jobId)).run();
            return Number(result.changes ?? 0) > 0;
        }
        return false;
    }
    async setJobEnabled(jobId, enabled) {
        if (!this.db)
            return false;
        const result = await this.db
            .update(schema_1.automationJobs)
            .set({ enabled, ...(enabled ? { last_error: null } : {}) })
            .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, jobId))
            .run();
        if (enabled)
            this.errorCounts.set(jobId, 0);
        return Number(result.changes ?? 0) > 0;
    }
    async listJobs(guildId) {
        if (!this.db)
            return [];
        const rows = guildId
            ? await this.db.select().from(schema_1.automationJobs).where((0, drizzle_orm_1.eq)(schema_1.automationJobs.guild_id, guildId))
            : await this.db.select().from(schema_1.automationJobs);
        return rows.map(rowToJob).sort((a, b) => a.nextRun - b.nextRun);
    }
    async runJobNow(jobId) {
        if (!this.db)
            throw new Error('Database not connected');
        const rows = await this.db.select().from(schema_1.automationJobs).where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, jobId)).limit(1);
        if (!rows[0])
            throw new Error('Job not found');
        await this.runJob(rows[0]);
    }
    nextRunFor(cronExpression, from) {
        return (0, cron_1.nextCron)(cronExpression, from ?? new Date());
    }
    async shutdown() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running.clear();
        this.errorCounts.clear();
        this.logger.info('Automation Service', 'Automation system shutdown');
    }
}
exports.AutomationService = AutomationService;
/** Admin commands: /automation add|remove|list|run|toggle */
class AutomationCommands {
    constructor(service, logger) {
        this.automationCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('automation')
                .setDescription('Manage scheduled automation jobs')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
                .addSubcommand((sub) => sub
                .setName('add')
                .setDescription('Add a scheduled job')
                .addStringOption((o) => o.setName('type').setDescription('Job type').setRequired(true)
                .addChoices({ name: 'message', value: 'message' }, { name: 'embed', value: 'embed' }, { name: 'log', value: 'log' }))
                .addStringOption((o) => o.setName('cron').setDescription('Cron expression, e.g. "0 9 * * *"').setRequired(true))
                .addChannelOption((o) => o.setName('channel').setDescription('Target channel (required for message/embed)').addChannelTypes(discord_js_1.ChannelType.GuildText))
                .addStringOption((o) => o.setName('message').setDescription('Message content (message/log) or embed description'))
                .addStringOption((o) => o.setName('title').setDescription('Embed title (embed type)')))
                .addSubcommand((sub) => sub.setName('list').setDescription('List scheduled jobs'))
                .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a job').addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true)))
                .addSubcommand((sub) => sub.setName('run').setDescription('Run a job immediately').addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true)))
                .addSubcommand((sub) => sub.setName('toggle').setDescription('Enable or disable a job')
                .addStringOption((o) => o.setName('id').setDescription('Job id').setRequired(true))
                .addBooleanOption((o) => o.setName('enabled').setDescription('Whether the job should run').setRequired(true))),
            execute: async (interaction) => {
                const guildId = interaction.guildId;
                if (!guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
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
                            await interaction.reply({ content: 'A channel is required for message/embed jobs.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        if (type !== 'log' && !message && !title) {
                            await interaction.reply({ content: 'Provide at least a message or a title.', flags: discord_js_1.MessageFlags.Ephemeral });
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
                            embeds: [new discord_js_1.EmbedBuilder()
                                    .setColor('#22c55e')
                                    .setTitle('✅ Automation job added')
                                    .setDescription(`**Type:** ${type}\n**Schedule:** \`${cronExpression}\`\n**Next run:** <t:${Math.floor(next.getTime() / 1000)}:R>\n**Id:** \`${id}\``)],
                            flags: discord_js_1.MessageFlags.Ephemeral,
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
                            embeds: [new discord_js_1.EmbedBuilder().setColor('#5865f2').setTitle('🤖 Automation Jobs').setDescription(description)],
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    if (sub === 'remove') {
                        const id = interaction.options.getString('id', true);
                        const removed = await this.service.removeJob(id);
                        await interaction.reply({ content: removed ? `✅ Removed job \`${id}\`.` : 'Job not found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    if (sub === 'run') {
                        const id = interaction.options.getString('id', true);
                        await this.service.runJobNow(id);
                        await interaction.reply({ content: `✅ Job \`${id}\` executed.`, flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    if (sub === 'toggle') {
                        const id = interaction.options.getString('id', true);
                        const enabled = interaction.options.getBoolean('enabled', true);
                        const changed = await this.service.setJobEnabled(id, enabled);
                        await interaction.reply({ content: changed ? `✅ Job \`${id}\` ${enabled ? 'enabled' : 'disabled'}.` : 'Job not found.', flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                catch (error) {
                    this.logger.error('Automation Commands', `Failed /automation ${sub}`, error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.automationCommand];
    }
}
exports.AutomationCommands = AutomationCommands;
