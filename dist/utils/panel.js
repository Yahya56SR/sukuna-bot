"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PANEL_MAX_BUTTONS = exports.PANEL_DIVIDER = void 0;
exports.panelDivider = panelDivider;
exports.panelFeature = panelFeature;
exports.panelSteps = panelSteps;
exports.panelLink = panelLink;
exports.panelTitle = panelTitle;
exports.buildPanel = buildPanel;
exports.setPanelBannerEnabled = setPanelBannerEnabled;
exports.isPanelBannerEnabled = isPanelBannerEnabled;
exports.setPanelAccent = setPanelAccent;
exports.getPanelAccent = getPanelAccent;
exports.panelButtonRows = panelButtonRows;
exports.attachPanelBanner = attachPanelBanner;
exports.buildPanelPayload = buildPanelPayload;
const discord_js_1 = require("discord.js");
const embed_1 = require("./embed");
const emoji_1 = require("./emoji");
const panelBanner_1 = require("./panelBanner");
/**
 * Sukuna Bot panel kit — one place that builds the big, branded Discord
 * panels used by staff applications, tickets, temporary voice and giveaways.
 *
 * The layout mirrors the "large panel" style popular on Discord:
 *
 *   <emoji> <Server> • <Section>            ← big bold title
 *   <intro paragraph, optional link>        ← description
 *   ──────────────────────────────          ← thin divider
 *   • <emoji> **Label**: `value`            ← feature bullets
 *   ──────────────────────────────
 *   • <emoji> <closing note>
 *   [big banner artwork]                    ← generated image
 *   [button grid]                           ← up to 5 buttons per row
 */
exports.PANEL_DIVIDER = '----------------------------------------';
/** Discord renders a line made only of dashes as a thin separator. */
function panelDivider() {
    return exports.PANEL_DIVIDER;
}
/** `• 🛠️ **Staff Team**: `Moderate and assist members`` */
function panelFeature(feature) {
    const icon = feature.emoji ? `${(0, emoji_1.resolveEmoji)(feature.emoji)} ` : '';
    const raw = String(feature.value ?? '');
    // Backticks would break the inline code block, so they are stripped.
    const value = !raw ? '' : feature.code === false ? `: ${raw}` : `: \`${raw.replace(/`/g, '')}\``;
    const suffix = feature.suffix ? ` ${feature.suffix}` : '';
    return `• ${icon}**${feature.label}**${value}${suffix}`;
}
/** `**1.** Do the thing` — a numbered list inside a description or field. */
function panelSteps(steps) {
    return steps.map((step, i) => `**${i + 1}.** ${step}`).join('\n');
}
/** `[Rules](https://discord.gg/xxxx)` — the underlined link style. */
function panelLink(label, url) {
    return `[${label}](${url})`;
}
function panelTitle(guildName, title, icon) {
    const core = guildName ? `${guildName} • ${title}` : title;
    return icon ? `${(0, emoji_1.resolveEmoji)(icon)} ${core}` : core;
}
function clamp(value, max) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}
/**
 * Builds the panel embed. The description is assembled top to bottom:
 * intro → divider → bullets/steps → divider → note.
 */
function buildPanel(opts) {
    const embed = new discord_js_1.EmbedBuilder();
    embed.setColor(opts.color ?? embed_1.BRAND.red);
    embed.setTitle(clamp(panelTitle(opts.guildName, opts.title, opts.emoji), 256));
    const blocks = [];
    if (opts.intro)
        blocks.push(opts.intro);
    if (opts.features?.length) {
        if (blocks.length)
            blocks.push('');
        blocks.push(exports.PANEL_DIVIDER, '');
        blocks.push(opts.features.map(panelFeature).join('\n'));
    }
    if (opts.steps?.length) {
        if (blocks.length)
            blocks.push('');
        blocks.push(exports.PANEL_DIVIDER, '');
        blocks.push(panelSteps(opts.steps));
    }
    if (opts.note) {
        if (blocks.length)
            blocks.push('');
        blocks.push(exports.PANEL_DIVIDER, '');
        blocks.push(`• ${opts.note}`);
    }
    const description = blocks.join('\n').trim();
    if (description)
        embed.setDescription(clamp(description, 4096));
    for (const section of (opts.sections ?? []).slice(0, 24)) {
        embed.addFields({
            name: clamp(section.title, 256),
            value: clamp(section.lines.join('\n'), 1024),
            inline: section.inline ?? true,
        });
    }
    if (opts.bannerUrl)
        embed.setImage(opts.bannerUrl);
    if (opts.guildIconUrl)
        embed.setThumbnail(opts.guildIconUrl);
    embed.setFooter({ text: clamp(opts.footer ?? 'Sukuna Bot', 2048) });
    if (opts.timestamp !== null) {
        embed.setTimestamp(opts.timestamp === undefined ? undefined : opts.timestamp);
    }
    return embed;
}
/** Discord allows 5 buttons per row and 25 buttons per message. */
exports.PANEL_MAX_BUTTONS = 25;
/* --------------------------------------------------------------------------
 * Global panel look — set by the panel service from the dashboard config.
 * ------------------------------------------------------------------------ */
let bannerEnabled = true;
let globalAccent = '';
/** Master switch for the generated banner artwork. */
function setPanelBannerEnabled(enabled) {
    bannerEnabled = enabled !== false;
}
function isPanelBannerEnabled() {
    return bannerEnabled;
}
/** Overrides the accent colour of every generated banner. */
function setPanelAccent(accent) {
    globalAccent = String(accent ?? '').trim();
}
function getPanelAccent() {
    return globalAccent;
}
function panelButtonRows(buttons, perRow = 5) {
    const rows = [];
    const size = Math.max(1, Math.min(5, perRow));
    const usable = buttons.slice(0, exports.PANEL_MAX_BUTTONS);
    for (let i = 0; i < usable.length; i += size) {
        const row = new discord_js_1.ActionRowBuilder();
        for (const button of usable.slice(i, i + size)) {
            const builder = new discord_js_1.ButtonBuilder()
                .setLabel(clamp(button.label, 80))
                .setStyle(button.style ?? discord_js_1.ButtonStyle.Secondary);
            if (button.emoji)
                builder.setEmoji((0, emoji_1.resolveEmoji)(button.emoji));
            if (button.url)
                builder.setURL(button.url);
            else
                builder.setCustomId(clamp(button.id, 100));
            if (button.disabled)
                builder.setDisabled(true);
            row.addComponents(builder);
        }
        rows.push(row);
    }
    return rows;
}
/**
 * Attaches the generated banner artwork to a panel. The banner is what makes
 * a panel feel "big" — it renders as a full-width image under the embed.
 * Falls back silently when canvas is unavailable.
 */
async function attachPanelBanner(embed, banner) {
    if (!banner || !bannerEnabled)
        return [];
    try {
        const buffer = await (0, panelBanner_1.generatePanelBanner)({
            ...banner,
            // A global accent overrides the primary colour but keeps the gradient.
            accent: globalAccent || banner.accent,
        });
        embed.setImage('attachment://panel-banner.png');
        return [new discord_js_1.AttachmentBuilder(buffer, { name: 'panel-banner.png' })];
    }
    catch {
        return [];
    }
}
/** Convenience wrapper: build the embed, wire the banner and the buttons. */
async function buildPanelPayload(opts) {
    const embed = buildPanel(opts);
    const files = opts.banner ? await attachPanelBanner(embed, opts.banner) : [];
    const components = panelButtonRows(opts.buttons ?? [], opts.perRow ?? 5);
    return { embed, components, files };
}
