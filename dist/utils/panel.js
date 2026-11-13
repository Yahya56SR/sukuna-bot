"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PANEL_MAX_BUTTONS = void 0;
exports.panelFeature = panelFeature;
exports.panelSteps = panelSteps;
exports.panelLink = panelLink;
exports.panelTitle = panelTitle;
exports.buildPanel = buildPanel;
exports.panelButtonRows = panelButtonRows;
exports.setPanelBannerEnabled = setPanelBannerEnabled;
exports.isPanelBannerEnabled = isPanelBannerEnabled;
exports.setPanelAccent = setPanelAccent;
exports.getPanelAccent = getPanelAccent;
exports.attachPanelBanner = attachPanelBanner;
exports.buildPanelPayload = buildPanelPayload;
const discord_js_1 = require("discord.js");
const embed_1 = require("./embed");
const emoji_1 = require("./emoji");
const panelBanner_1 = require("./panelBanner");
/** `• 🛠️ **Staff Team**: `Moderate and assist members`` */
function panelFeature(feature) {
    const icon = feature.emoji ? `${(0, emoji_1.resolveEmoji)(feature.emoji)} ` : '';
    const raw = String(feature.value ?? '');
    // Backticks would break the inline code block, so they are stripped.
    const value = !raw ? '' : feature.code === false ? `: ${raw}` : `: \`${raw.replace(/`/g, '')}\``;
    const suffix = feature.suffix ? ` ${feature.suffix}` : '';
    return `• ${icon}**${feature.label}**${value}${suffix}`;
}
/** `**1.** Do the thing` — a numbered list. */
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
 * Builds the panel container: title (with the server icon), intro, feature
 * bullets, closing note — separated by real separator components.
 */
function buildPanel(opts) {
    const container = new discord_js_1.ContainerBuilder();
    // Container accents are plain RGB integers (0x000000 – 0xFFFFFF).
    container.setAccentColor((0, discord_js_1.resolveColor)(opts.color ?? embed_1.BRAND.red));
    // Header — a Section so the server icon can sit next to the title.
    const heading = `# ${panelTitle(opts.guildName, opts.title, opts.emoji)}`;
    if (opts.guildIconUrl) {
        container.addSectionComponents(new discord_js_1.SectionBuilder()
            .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(heading))
            .setThumbnailAccessory(new discord_js_1.ThumbnailBuilder().setURL(opts.guildIconUrl)));
    }
    else {
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(heading));
    }
    if (opts.intro) {
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(opts.intro, 4000)));
    }
    if (opts.features?.length) {
        container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(opts.features.map(panelFeature).join('\n'), 4000)));
    }
    if (opts.steps?.length) {
        container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(panelSteps(opts.steps), 4000)));
    }
    for (const section of (opts.sections ?? []).slice(0, 10)) {
        container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(`**${section.title}**\n${section.lines.join('\n')}`, 4000)));
    }
    if (opts.note) {
        container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(`• ${opts.note}`, 4000)));
    }
    if (opts.footer) {
        container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(clamp(`-# ${opts.footer}`, 4000)));
    }
    return container;
}
/** Discord allows 5 buttons per row and 25 buttons per message. */
exports.PANEL_MAX_BUTTONS = 25;
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
/**
 * Adds the generated banner artwork to a panel.
 *
 * Components v2 messages do not show attachments on their own — the artwork
 * has to be exposed through a media gallery, which also renders it above the
 * text. Falls back silently when canvas is unavailable.
 */
async function attachPanelBanner(container, banner) {
    if (!banner || !bannerEnabled)
        return [];
    try {
        const buffer = await (0, panelBanner_1.generatePanelBanner)({
            ...banner,
            // A global accent overrides the primary colour but keeps the gradient.
            accent: globalAccent || banner.accent,
        });
        container.addMediaGalleryComponents(new discord_js_1.MediaGalleryBuilder().addItems(new discord_js_1.MediaGalleryItemBuilder()
            .setURL('attachment://panel-banner.png')
            .setDescription(banner.title)));
        return [new discord_js_1.AttachmentBuilder(buffer, { name: 'panel-banner.png' })];
    }
    catch {
        return [];
    }
}
/** Convenience wrapper: build the container, wire the banner and the buttons. */
async function buildPanelPayload(opts) {
    const container = buildPanel(opts);
    const files = opts.banner ? await attachPanelBanner(container, opts.banner) : [];
    const components = [container, ...panelButtonRows(opts.buttons ?? [], opts.perRow ?? 5)];
    return { components, files, flags: discord_js_1.MessageFlags.IsComponentsV2 };
}
