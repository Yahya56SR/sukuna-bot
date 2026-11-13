"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffApplicationsCommands = exports.StaffApplications = exports.DEFAULT_STAFFAPP_CONFIG = exports.STAFFAPP_PREFIX = void 0;
exports.getDefaultStaffAppConfig = getDefaultStaffAppConfig;
exports.isAdminMember = isAdminMember;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const embed_1 = require("../utils/embed");
const panel_1 = require("../utils/panel");
const schema_1 = require("../database/schema");
const id_1 = require("../utils/id");
exports.STAFFAPP_PREFIX = 'staffapp:';
exports.DEFAULT_STAFFAPP_CONFIG = {
    enabled: true,
    panelChannelId: '',
    reviewChannelId: '',
    staffRoles: [],
    approverRoleIds: [],
    questions: [
        'Why do you want to join the staff team?',
        'How active are you on Discord?',
        'Have you been staff elsewhere before?',
        'What would you do if two members are arguing?',
        'Anything else we should know?',
    ],
    maxQuestionLength: 1000,
    roleDescriptions: {},
};
/** Semantic emoji keys for staff roles that do not carry their own unicode emoji. */
const ROLE_EMOJI_FALLBACK = ['staffTeam', 'designer', 'developer', 'eventHost', 'partnership', 'settings', 'role', 'member'];
function getDefaultStaffAppConfig() {
    return JSON.parse(JSON.stringify(exports.DEFAULT_STAFFAPP_CONFIG));
}
/**
 * Only real authorization counts: the guild's Administrator permission, or a
 * role listed in `approverRoleIds`. (The previous version treated any role
 * literally named "admin" as an approver role, which let anyone with a
 * self-createable or unrelated "Admin" role approve applications.)
 */
function isAdminMember(member, approverRoleIds) {
    if (!member)
        return false;
    if (approverRoleIds.length > 0) {
        return approverRoleIds.some((rid) => rid && member.roles.cache.has(rid));
    }
    try {
        return Boolean(member.permissions?.has?.(discord_js_1.PermissionFlagsBits.Administrator));
    }
    catch {
        return false;
    }
}
function toApplication(row) {
    const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
    const reviewedAt = row.reviewed_at instanceof Date ? row.reviewed_at.getTime() : row.reviewed_at ? Number(row.reviewed_at) : undefined;
    const answers = Array.isArray(row.answers) ? row.answers : [];
    return {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        roleId: row.role_id,
        answers,
        status: row.status === 'approved' || row.status === 'denied' ? row.status : 'pending',
        createdAt,
        messageId: row.message_id ?? undefined,
        reviewChannelId: row.review_channel_id ?? undefined,
        reviewerId: row.reviewer_id ?? undefined,
        reviewReason: row.review_reason ?? undefined,
        ...(reviewedAt !== undefined ? { reviewedAt } : {}),
    };
}
class StaffApplications {
    constructor(logger, config) {
        this.client = null;
        this.config = getDefaultStaffAppConfig();
        this.db = null;
        // Pending modal flow: userId -> { roleId, guildId, partialAnswers, chunkIndex }
        this.pending = new Map();
        this.logger = logger;
        this.config = { ...getDefaultStaffAppConfig(), ...(config ?? {}) };
        this.normalize();
    }
    setDb(db) {
        this.db = db;
    }
    normalize() {
        if (typeof this.config.staffRoles === 'string') {
            try {
                this.config.staffRoles = JSON.parse(this.config.staffRoles);
            }
            catch {
                this.config.staffRoles = [];
            }
        }
        if (!Array.isArray(this.config.staffRoles))
            this.config.staffRoles = [];
        if (!Array.isArray(this.config.approverRoleIds))
            this.config.approverRoleIds = [];
        if (!Array.isArray(this.config.questions))
            this.config.questions = [];
        // Discord modal: max 5 inputs per modal, label max 45 chars
        this.config.questions = this.config.questions.map((q) => String(q || '').trim().slice(0, 45)).filter(Boolean);
        if (!this.config.roleDescriptions || typeof this.config.roleDescriptions !== 'object') {
            this.config.roleDescriptions = {};
        }
    }
    setConfig(next) {
        const merged = { ...this.config, ...(next ?? {}) };
        this.config = merged;
        this.normalize();
        this.logger.info('Staff Applications', 'Config updated');
        return this.config;
    }
    getConfig() {
        return this.config;
    }
    async initialize(client) {
        this.client = client;
        // Warm the pending applications so approve/deny works after a restart.
        if (this.db) {
            try {
                const rows = await this.db.select().from(schema_1.staffApplications).where((0, drizzle_orm_1.eq)(schema_1.staffApplications.status, 'pending')).limit(500);
                this.logger.info('Staff Applications', `Loaded ${rows.length} pending application(s) from database`);
            }
            catch (error) {
                this.logger.warn('Staff Applications', `Could not preload applications: ${error.message}`);
            }
        }
        this.logger.info('Staff Applications', `Initialized (staff roles: ${this.config.staffRoles.length}, questions: ${this.config.questions.length})`);
    }
    async shutdown() {
        this.pending.clear();
        this.logger.info('Staff Applications', 'Shutdown');
    }
    reviewChannelId() {
        return this.config.reviewChannelId || this.config.panelChannelId || '';
    }
    // ---------- Panel ----------
    /** Emoji shown for a staff role — roles may carry their own unicode emoji. */
    roleEmoji(role, index) {
        if (role?.unicodeEmoji)
            return String(role.unicodeEmoji);
        return ROLE_EMOJI_FALLBACK[index % ROLE_EMOJI_FALLBACK.length] ?? 'staff';
    }
    /**
     * Builds the big staff application panel: rich description, a feature line
     * per open role, banner artwork and one apply button per role.
     */
    async buildPanel(guild) {
        const cfg = this.config;
        const roles = cfg.staffRoles
            .map((rid) => guild.roles.cache.get(rid))
            .filter(Boolean);
        const features = roles.map((role, index) => ({
            emoji: this.roleEmoji(role, index),
            label: role.name,
            value: String(cfg.roleDescriptions?.[role.id] ?? '').trim() || `Join the ${role.name} team`,
        }));
        const buttons = roles.map((role, index) => ({
            id: `${exports.STAFFAPP_PREFIX}apply:${role.id}`,
            label: role.name,
            emoji: this.roleEmoji(role, index),
            style: discord_js_1.ButtonStyle.Primary,
        }));
        if (buttons.length === 0) {
            buttons.push({ id: `${exports.STAFFAPP_PREFIX}apply`, label: 'Apply now', emoji: 'staff', style: discord_js_1.ButtonStyle.Primary });
        }
        const invite = guild.vanityURLCode
            ? ` ${(0, panel_1.panelLink)('Join the server', `https://discord.gg/${guild.vanityURLCode}`)}.`
            : '';
        return (0, panel_1.buildPanelPayload)({
            emoji: 'staff',
            title: 'Staff Applications',
            guildName: guild.name,
            guildIconUrl: guild.iconURL({ extension: 'png', size: 256 }) ?? undefined,
            color: embed_1.BRAND.gold,
            intro: `We're looking for active and dedicated members to join our team and help our community grow!${invite}`,
            features,
            note: 'Click the button below to submit your application. Serious applicants only!',
            banner: {
                title: 'Staff Applications',
                subtitle: guild.name,
                emoji: '🛡️',
                accent: '#ffd700',
                accentSecondary: '#f97316',
            },
            buttons,
            footer: `${guild.name} • Staff Applications`,
        });
    }
    // ---------- Role selection step ----------
    async promptRoleSelection(interaction) {
        if (!this.config.enabled) {
            await interaction.reply({ content: 'Staff applications are disabled.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const guild = interaction.guild ?? this.client?.guilds.cache.get(interaction.guildId);
        if (!guild) {
            await interaction.reply({ content: 'Server not found.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const roles = this.config.staffRoles
            .map((rid) => guild.roles.cache.get(rid))
            .filter(Boolean);
        if (roles.length === 0) {
            await interaction.reply({
                content: 'No staff roles are open for applications yet. An admin needs to configure them in the dashboard (Staff Applications).',
                flags: discord_js_1.MessageFlags.Ephemeral,
            }).catch(() => undefined);
            return;
        }
        if (roles.length === 1) {
            // Only one choice → skip select, go straight to questions
            await this.promptQuestions(interaction, guild.id, roles[0].id).catch(() => undefined);
            return;
        }
        const menu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`${exports.STAFFAPP_PREFIX}role-select:${guild.id}`)
            .setPlaceholder('Select the staff role you want…')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(roles.slice(0, 25).map((r) => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel(r.name.slice(0, 25) || 'Staff role')
            .setDescription(`Apply for ${r.name}`.slice(0, 100))
            .setValue(r.id)));
        const row = new discord_js_1.ActionRowBuilder().addComponents(menu);
        await interaction.reply({ content: '🛡️ Which staff role are you applying for?', components: [row], flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
    }
    /**
     * Starts an application for one specific role — used by the per-role
     * buttons on the panel (no select menu needed).
     */
    async promptApplyForRole(interaction, roleId) {
        if (!this.config.enabled) {
            await interaction.reply({ content: 'Staff applications are disabled.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const guild = interaction.guild ?? this.client?.guilds.cache.get(interaction.guildId);
        if (!guild) {
            await interaction.reply({ content: 'Server not found.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        if (!roleId || !this.config.staffRoles.includes(roleId)) {
            await interaction.reply({ content: 'That role is no longer open for applications.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = guild.members.cache.get(interaction.user.id)
            ?? await guild.members.fetch(interaction.user.id).catch(() => null);
        if (member?.roles.cache.has(roleId)) {
            await interaction.reply({ content: `You already have <@&${roleId}>.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await this.promptQuestions(interaction, guild.id, roleId).catch(() => undefined);
    }
    // ---------- Questions modal (chunked: 5 per modal) ----------
    async promptQuestions(interaction, guildId, roleId, partialAnswers = [], chunk = 0) {
        const questions = this.config.questions.length ? this.config.questions : ['Why do you want to join the staff team?'];
        const chunkSize = 5;
        const slice = questions.slice(chunk * chunkSize, chunk * chunkSize + chunkSize);
        if (slice.length === 0) {
            // All chunks done — finalize
            await this.finalizeApplication(interaction, guildId, roleId, partialAnswers);
            return;
        }
        // Remember pending state (keyed by user so a second modal can continue)
        this.pending.set(`${interaction.user.id}:${guildId}`, { roleId, guildId, answers: [...partialAnswers], chunk });
        const modal = new discord_js_1.ModalBuilder()
            .setCustomId(`${exports.STAFFAPP_PREFIX}questions:${guildId}:${roleId}:${chunk}`)
            .setTitle(`Staff application (${chunk * chunkSize + 1}–${chunk * chunkSize + slice.length}/${questions.length})`);
        slice.forEach((q, i) => {
            const input = new discord_js_1.TextInputBuilder()
                .setCustomId(`answer_${i}`)
                .setLabel(q.slice(0, 45) || `Question ${i + 1}`)
                .setStyle(discord_js_1.TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(Math.min(4000, Math.max(1, this.config.maxQuestionLength || 1000)));
            modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(input));
        });
        if (interaction.isModalSubmit?.() || interaction.deferred || interaction.replied) {
            // Can't show a modal after defer/reply — fall back to an ephemeral notice
            await interaction.reply({ content: 'Your answers were received. Staff will review shortly! ✅', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await interaction.showModal(modal).catch(() => undefined);
    }
    async handleQuestionsSubmit(interaction) {
        const m = String(interaction.customId).match(/^staffapp:questions:(\d+):(\d+):(\d+)$/);
        if (!m)
            return false;
        const [, guildId, roleId, chunkStr] = m;
        const chunk = parseInt(chunkStr ?? '0', 10);
        const key = `${interaction.user.id}:${guildId}`;
        const pendingAtStart = this.pending.get(key);
        const prior = pendingAtStart?.answers ?? [];
        const questions = this.config.questions.length ? this.config.questions : ['Why do you want to join the staff team?'];
        const slice = questions.slice(chunk * 5, chunk * 5 + 5);
        const newAnswers = [];
        slice.forEach((q, i) => {
            try {
                const val = interaction.fields?.getTextInputValue?.(`answer_${i}`) ?? '';
                newAnswers.push({ question: q, answer: String(val || '').trim() });
            }
            catch {
                newAnswers.push({ question: q, answer: '' });
            }
        });
        const all = [...prior, ...newAnswers];
        const nextChunk = chunk + 1;
        if ((nextChunk * 5) < questions.length) {
            // More pages: show the NEXT modal immediately without deferring
            // (showModal is only allowed on a fresh, undeferred interaction).
            this.pending.set(key, { roleId: roleId, guildId: guildId, answers: all, chunk: nextChunk });
            await this.promptQuestions(interaction, guildId, roleId, all, nextChunk);
            return true;
        }
        this.pending.delete(key);
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        await this.finalizeApplication(interaction, guildId, roleId, all);
        return true;
    }
    async persist(app) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.staffApplications).values({
            id: app.id,
            guild_id: app.guildId,
            user_id: app.userId,
            role_id: app.roleId,
            answers: app.answers,
            status: app.status,
            review_channel_id: app.reviewChannelId ?? null,
            message_id: app.messageId ?? null,
            created_at: new Date(app.createdAt),
        });
    }
    async save(app) {
        if (!this.db)
            return;
        await this.db
            .update(schema_1.staffApplications)
            .set({
            status: app.status,
            reviewer_id: app.reviewerId ?? null,
            review_reason: app.reviewReason ?? null,
            review_channel_id: app.reviewChannelId ?? null,
            message_id: app.messageId ?? null,
            reviewed_at: app.reviewedAt ? new Date(app.reviewedAt) : null,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.staffApplications.id, app.id));
    }
    async getById(id) {
        if (!this.db)
            return null;
        const rows = await this.db.select().from(schema_1.staffApplications).where((0, drizzle_orm_1.eq)(schema_1.staffApplications.id, id)).limit(1);
        return rows[0] ? toApplication(rows[0]) : null;
    }
    async findPending(guildId, userId, roleId) {
        if (!this.db)
            return null;
        const rows = await this.db
            .select()
            .from(schema_1.staffApplications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.staffApplications.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.staffApplications.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.staffApplications.role_id, roleId), (0, drizzle_orm_1.eq)(schema_1.staffApplications.status, 'pending')))
            .limit(1);
        return rows[0] ? toApplication(rows[0]) : null;
    }
    async finalizeApplication(originInteraction, guildId, roleId, answers) {
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild) {
            if (originInteraction.deferred)
                await originInteraction.editReply('Server not found.').catch(() => undefined);
            return;
        }
        // One pending application per user per role
        const existing = await this.findPending(guildId, originInteraction.user.id, roleId);
        if (existing) {
            const msg = 'You already have a pending application for this role.';
            if (originInteraction.deferred)
                await originInteraction.editReply(msg).catch(() => undefined);
            else
                await originInteraction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const id = (0, id_1.shortId)('a');
        const role = guild.roles.cache.get(roleId);
        const member = guild.members.cache.get(originInteraction.user.id);
        const displayName = member?.displayName ?? originInteraction.user.username;
        const app = {
            id,
            guildId,
            userId: originInteraction.user.id,
            roleId,
            answers,
            status: 'pending',
            createdAt: Date.now(),
        };
        // Persist first so the review message only exists for real applications.
        try {
            await this.persist(app);
        }
        catch (error) {
            this.logger.error('Staff Applications', 'Failed to persist application', error);
            const msg = 'Something went wrong saving your application. Please try again.';
            if (originInteraction.deferred)
                await originInteraction.editReply(msg).catch(() => undefined);
            else
                await originInteraction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const reviewId = this.reviewChannelId();
        let messageId;
        let reviewChannelId = reviewId;
        if (reviewId) {
            try {
                const channel = await this.client?.channels.fetch(reviewId).catch(() => null);
                if (channel) {
                    reviewChannelId = channel.id;
                    const embed = this.applicationEmbed(app, guild, role?.name ?? roleId, displayName);
                    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFFAPP_PREFIX}approve:${id}`).setLabel('Approve').setEmoji('✅').setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFFAPP_PREFIX}deny:${id}`).setLabel('Deny').setEmoji('❌').setStyle(discord_js_1.ButtonStyle.Danger));
                    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { users: [app.userId] } }).catch(() => null);
                    if (sent)
                        messageId = sent.id;
                }
            }
            catch (err) {
                this.logger.warn('Staff Applications', 'Failed to post review message', err);
            }
        }
        app.messageId = messageId;
        app.reviewChannelId = reviewChannelId;
        await this.save(app);
        const done = `✅ Application submitted for ${role ? `<@&${role.id}>` : `role ${roleId}`}. Staff will review it soon. You will be notified here.`;
        if (originInteraction.deferred)
            await originInteraction.editReply(done).catch(() => undefined);
        else if (!originInteraction.replied)
            await originInteraction.reply({ content: done, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        this.logger.info('Staff Applications', `New application ${id} from ${originInteraction.user.id} for role ${roleId}`);
    }
    applicationEmbed(app, guild, roleName, applicantName) {
        const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.gold)
            .setTitle('🛡️ New Staff Application')
            .setDescription(`**${applicantName}** (<@${app.userId}>) applied for <@&${app.roleId}>`)
            .addFields({ name: 'Application', value: `\`${app.id}\``, inline: true }, { name: 'Role', value: `<@&${app.roleId}> (${roleName})`, inline: true }, { name: 'Submitted', value: `<t:${Math.floor(app.createdAt / 1000)}:R>`, inline: true }, ...app.answers.slice(0, 10).map((a) => ({
            name: a.question.slice(0, 256) || 'Answer',
            value: (a.answer || '—').slice(0, 900),
        })))
            .setFooter({ text: `${guild.name} • Staff Applications` })
            .setTimestamp();
        return embed;
    }
    // ---------- Approve / Deny ----------
    /**
     * Approve/deny an application outside of an interaction (e.g. from the
     * dashboard). Returns a result object instead of replying to Discord.
     */
    async reviewApplication(applicationId, reviewerId, action, reason = '') {
        const app = await this.getById(applicationId);
        if (!app)
            return { ok: false, message: 'Application not found.' };
        if (app.status !== 'pending')
            return { ok: false, message: `This application is already ${app.status}.` };
        const guild = this.client?.guilds.cache.get(app.guildId);
        if (!guild)
            return { ok: false, message: 'That server is not available right now.' };
        if (action === 'approve') {
            const target = await guild.members.fetch(app.userId).catch(() => null);
            if (!target)
                return { ok: false, message: 'The applicant is no longer in the server.' };
            const added = await target.roles
                .add(app.roleId, `Staff application approved by ${reviewerId} (dashboard)`)
                .then(() => true)
                .catch((error) => {
                this.logger.warn('Staff Applications', `Could not add role ${app.roleId}: ${error.message}`);
                return false;
            });
            if (!added) {
                return { ok: false, message: `Could not add <@&${app.roleId}> to the applicant (missing permissions?).` };
            }
        }
        app.status = action === 'approve' ? 'approved' : 'denied';
        app.reviewerId = reviewerId;
        app.reviewedAt = Date.now();
        if (reason)
            app.reviewReason = reason.slice(0, 900);
        await this.save(app);
        this.logger.info('Staff Applications', `${action === 'approve' ? 'Approved' : 'Denied'} ${app.id} (${app.userId}) by ${reviewerId} from dashboard`);
        // Update the review card in place (best effort).
        const channelId = app.reviewChannelId || this.reviewChannelId();
        if (channelId && app.messageId) {
            try {
                const channel = await this.client?.channels.fetch(channelId).catch(() => null);
                const msg = await channel?.messages.fetch(app.messageId).catch(() => null);
                if (msg) {
                    const role = guild.roles.cache.get(app.roleId);
                    const who = guild.members.cache.get(app.userId)?.displayName ?? app.userId;
                    const updated = action === 'approve'
                        ? (0, embed_1.brandedEmbed)(embed_1.BRAND.green).setTitle('✅ Application Approved').setDescription(`<@${app.userId}> (${who}) was approved for ${role ? `<@&${role.id}>` : `role ${app.roleId}`} by <@${reviewerId}>.`)
                        : (0, embed_1.brandedEmbed)(embed_1.BRAND.red).setTitle('❌ Application Denied').setDescription(`<@${app.userId}> (${who}) was denied by <@${reviewerId}>.`);
                    if (reason)
                        updated.addFields({ name: 'Reason', value: reason.slice(0, 900) });
                    await msg.edit({ embeds: [updated], components: [] }).catch(() => undefined);
                }
            }
            catch { /* best effort */ }
        }
        // DM the applicant (best effort).
        try {
            const user = await this.client?.users.fetch(app.userId).catch(() => null);
            if (user) {
                await user.send(action === 'approve'
                    ? `✅ **${guild.name}** — Your staff application was **approved**! You now have <@&${app.roleId}>. Welcome to the team!`
                    : `❌ **${guild.name}** — Your staff application was reviewed and **not approved** this time.${reason ? `\n\nReason: ${reason}` : ''}`).catch(() => undefined);
            }
        }
        catch { /* best effort */ }
        return { ok: true, message: action === 'approve' ? 'Application approved.' : 'Application denied.' };
    }
    async handleApplicationButton(interaction) {
        const m = String(interaction.customId).match(/^staffapp:(approve|deny):([a-zA-Z0-9]+)$/);
        if (!m)
            return false;
        const [, action, id] = m;
        const app = await this.getById(id ?? '');
        if (!app) {
            await interaction.reply({ content: 'Application not found.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const guild = interaction.guild ?? this.client?.guilds.cache.get(app.guildId);
        const member = guild?.members.cache.get(interaction.user.id) ?? (await guild?.members.fetch(interaction.user.id).catch(() => null));
        if (!isAdminMember(member, this.config.approverRoleIds)) {
            await interaction.reply({
                content: '⛔ Only administrators can review applications. (Members with the Administrator permission or a configured approver role.)',
                flags: discord_js_1.MessageFlags.Ephemeral,
            }).catch(() => undefined);
            return true;
        }
        if (app.status !== 'pending') {
            await interaction.reply({ content: `This application is already **${app.status}**.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        try {
            if (action === 'approve') {
                app.status = 'approved';
                const target = await guild?.members.fetch(app.userId).catch(() => null);
                if (target && guild) {
                    const added = await target.roles.add(app.roleId, `Staff application approved (${interaction.user.username})`).then(() => true).catch((error) => {
                        this.logger.warn('Staff Applications', `Could not add role ${app.roleId}: ${error.message}`);
                        return false;
                    });
                    if (!added) {
                        // Roll the status back so the application isn't lost in a broken state.
                        app.status = 'pending';
                        await interaction.reply({
                            content: `❌ I couldn't add <@&${app.roleId}> to the applicant (missing permissions?). The application stays pending.`,
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        }).catch(() => undefined);
                        return true;
                    }
                }
                this.logger.info('Staff Applications', `Approved ${app.id} (${app.userId} → ${app.roleId}) by ${interaction.user.id}`);
            }
            else {
                app.status = 'denied';
                this.logger.info('Staff Applications', `Denied ${app.id} (${app.userId}) by ${interaction.user.id}`);
            }
            app.reviewerId = interaction.user.id;
            app.reviewedAt = Date.now();
            await this.save(app);
            // Update the review message in place
            const channelId = app.reviewChannelId || this.reviewChannelId();
            if (channelId && app.messageId) {
                try {
                    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
                    const msg = await channel?.messages.fetch(app.messageId).catch(() => null);
                    if (msg) {
                        const role = guild?.roles.cache.get(app.roleId);
                        const who = guild?.members.cache.get(app.userId)?.displayName ?? app.userId;
                        const updated = app.status === 'approved'
                            ? (0, embed_1.brandedEmbed)(embed_1.BRAND.green).setTitle('✅ Application Approved').setDescription(`<@${app.userId}> (${who}) was approved for ${role ? `<@&${role.id}>` : `role ${app.roleId}`} by <@${interaction.user.id}>.`)
                            : (0, embed_1.brandedEmbed)(embed_1.BRAND.red).setTitle('❌ Application Denied').setDescription(`<@${app.userId}> (${who}) was denied by <@${interaction.user.id}>.`);
                        await msg.edit({ embeds: [updated], components: [] }).catch(() => undefined);
                    }
                }
                catch { /* best-effort */ }
            }
            // DM the applicant (best-effort)
            try {
                const user = await this.client?.users.fetch(app.userId).catch(() => null);
                if (user) {
                    const role = guild?.roles.cache.get(app.roleId);
                    await user.send(app.status === 'approved'
                        ? `✅ **${guild?.name}** — Your staff application was **approved**! You now have <@&${app.roleId}> (${role?.name ?? ''}). Welcome to the team!`
                        : `❌ **${guild?.name}** — Your staff application was reviewed and **not approved** this time. You are welcome to apply again later.`).catch(() => undefined);
                }
            }
            catch { /* ignore */ }
            await interaction.reply({
                embeds: [(0, embed_1.brandedEmbed)(app.status === 'approved' ? embed_1.BRAND.green : embed_1.BRAND.red)
                        .setTitle(app.status === 'approved' ? '✅ Application approved' : '❌ Application denied')
                        .setDescription(`Application \`${app.id}\` for <@${app.userId}> (${guild?.roles.cache.get(app.roleId)?.name ?? app.roleId}).`)],
                flags: discord_js_1.MessageFlags.Ephemeral,
            }).catch(() => undefined);
        }
        catch (err) {
            await interaction.reply({ content: `❌ Failed: ${err?.message || 'error'}`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
    async getApplications(guildId, limit = 100) {
        if (!this.db)
            return [];
        const safeLimit = Math.max(1, Math.min(500, limit));
        const base = this.db.select().from(schema_1.staffApplications);
        const filtered = guildId ? base.where((0, drizzle_orm_1.eq)(schema_1.staffApplications.guild_id, guildId)) : base;
        const rows = await filtered.orderBy((0, drizzle_orm_1.desc)(schema_1.staffApplications.created_at)).limit(safeLimit);
        return rows.map(toApplication);
    }
}
exports.StaffApplications = StaffApplications;
/** Slash commands: /apply + /staffapp panel */
class StaffApplicationsCommands {
    constructor(service, logger) {
        this.applyCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('apply')
                .setDescription('Apply to join the staff team')
                .addRoleOption((o) => o.setName('role').setDescription('Staff role you want (leave empty to pick from a list)').setRequired(false)),
            execute: async (interaction) => {
                const { MessageFlags } = require('discord.js');
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    return;
                }
                const picked = interaction.options.getRole('role');
                const cfg = this.service.getConfig();
                if (!cfg.enabled) {
                    await interaction.reply({ content: 'Staff applications are disabled.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    return;
                }
                if (picked) {
                    if (!cfg.staffRoles.includes(picked.id)) {
                        await interaction.reply({ content: `That role is not open for applications. Open roles: ${cfg.staffRoles.map((r) => `<@&${r}>`).join(', ') || 'none yet'}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                        return;
                    }
                    if (interaction.member?.roles.cache.has(picked.id)) {
                        await interaction.reply({ content: `You already have <@&${picked.id}>.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                        return;
                    }
                    await this.service.promptQuestions(interaction, interaction.guildId, picked.id);
                    return;
                }
                await this.service.promptRoleSelection(interaction);
            },
        };
        this.panelCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('staffapp')
                .setDescription('Staff application panel')
                .addSubcommand((sub) => sub.setName('panel').setDescription('Post the staff application panel')
                .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').setRequired(true).addChannelTypes(discord_js_1.ChannelType.GuildText)))
                .addSubcommand((sub) => sub.setName('pending').setDescription('List pending applications')),
            execute: async (interaction) => {
                const { MessageFlags } = require('discord.js');
                const sub = interaction.options.getSubcommand();
                const guild = interaction.guild;
                if (!guild) {
                    await interaction.reply({ content: 'In a server only.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    return;
                }
                try {
                    if (sub === 'panel') {
                        const cfg = this.service.getConfig();
                        if (cfg.staffRoles.length === 0) {
                            await interaction.reply({ content: 'Configure at least one staff role in the dashboard first (Staff Applications).', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                            return;
                        }
                        const channel = interaction.options.getChannel('channel', true);
                        const panel = await this.service.buildPanel(guild);
                        await channel.send({
                            embeds: [panel.embed],
                            components: panel.components,
                            files: panel.files,
                        }).catch(() => undefined);
                        // Save the panel channel so /apply buttons keep working after restart config
                        this.service.setConfig({ panelChannelId: channel.id, reviewChannelId: this.service.getConfig().reviewChannelId || channel.id });
                        await interaction.reply({ content: `✅ Staff panel posted in ${channel}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    }
                    else if (sub === 'pending') {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        const pending = (await this.service.getApplications(guild.id, 100)).filter((a) => a.status === 'pending');
                        const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.gold).setTitle('🛡️ Pending applications');
                        embed.setDescription(pending.length
                            ? pending.map((a) => `• <@${a.userId}> → <@&${a.roleId}> (\`${a.id}\`)\n  ${a.answers.map((x) => `**${x.question}** — ${x.answer}`).join('\n  ')}`).join('\n\n').slice(0, 3800)
                            : 'No pending applications. 🎉');
                        await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
                    }
                }
                catch (err) {
                    this.logger.error('StaffApplications Commands', `Failed /staffapp ${sub}`, err);
                    const msg = `❌ ${err?.message || 'Failed.'}`;
                    if (interaction.deferred || interaction.replied)
                        await interaction.editReply({ content: msg }).catch(() => undefined);
                    else
                        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.applyCommand, this.panelCommand];
    }
}
exports.StaffApplicationsCommands = StaffApplicationsCommands;
