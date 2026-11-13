import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  EmbedBuilder,
} from 'discord.js';
import { BRAND } from './embed';
import { resolveEmoji } from './emoji';
import { generatePanelBanner, type PanelBannerOptions } from './panelBanner';

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

export const PANEL_DIVIDER = '----------------------------------------';

/** Discord renders a line made only of dashes as a thin separator. */
export function panelDivider(): string {
  return PANEL_DIVIDER;
}

export interface PanelFeature {
  emoji?: string | undefined;
  label: string;
  value?: string | undefined;
  suffix?: string | undefined;
  /**
   * Wraps the value in inline code (default). Turn it off for values that
   * Discord has to render itself — timestamps, mentions and links.
   */
  code?: boolean | undefined;
}

/** `• 🛠️ **Staff Team**: `Moderate and assist members`` */
export function panelFeature(feature: PanelFeature): string {
  const icon = feature.emoji ? `${resolveEmoji(feature.emoji)} ` : '';
  const raw = String(feature.value ?? '');
  // Backticks would break the inline code block, so they are stripped.
  const value = !raw ? '' : feature.code === false ? `: ${raw}` : `: \`${raw.replace(/`/g, '')}\``;
  const suffix = feature.suffix ? ` ${feature.suffix}` : '';
  return `• ${icon}**${feature.label}**${value}${suffix}`;
}

export interface PanelSection {
  title: string;
  lines: string[];
  inline?: boolean | undefined;
}

/** `**1.** Do the thing` — a numbered list inside a description or field. */
export function panelSteps(steps: string[]): string {
  return steps.map((step, i) => `**${i + 1}.** ${step}`).join('\n');
}

/** `[Rules](https://discord.gg/xxxx)` — the underlined link style. */
export function panelLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

export function panelTitle(guildName: string | undefined, title: string, icon?: string): string {
  const core = guildName ? `${guildName} • ${title}` : title;
  return icon ? `${resolveEmoji(icon)} ${core}` : core;
}

export interface PanelOptions {
  /** Emoji prefix shown in the embed title. */
  emoji?: string | undefined;
  /** Section name, e.g. `Staff Applications`. */
  title: string;
  /** Server name — the title becomes `<Server> • <Section>`. */
  guildName?: string | undefined;
  /** Server icon shown as the embed thumbnail. */
  guildIconUrl?: string | undefined;
  color?: ColorResolvable | undefined;
  /** Opening paragraph. May contain markdown/links. */
  intro?: string | undefined;
  /** Feature bullets rendered under a divider. */
  features?: PanelFeature[] | undefined;
  /** Numbered steps rendered under a divider. */
  steps?: string[] | undefined;
  /** Side-by-side info fields rendered under the description. */
  sections?: PanelSection[] | undefined;
  /** Closing line rendered under the last divider. */
  note?: string | undefined;
  /** Remote banner image (overrides the generated artwork). */
  bannerUrl?: string | undefined;
  /** Footer text. */
  footer?: string | undefined;
  /** Timestamp — pass `null` to hide it. */
  timestamp?: number | Date | null | undefined;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Builds the panel embed. The description is assembled top to bottom:
 * intro → divider → bullets/steps → divider → note.
 */
export function buildPanel(opts: PanelOptions): EmbedBuilder {
  const embed = new EmbedBuilder();
  embed.setColor(opts.color ?? BRAND.red);
  embed.setTitle(clamp(panelTitle(opts.guildName, opts.title, opts.emoji), 256));

  const blocks: string[] = [];
  if (opts.intro) blocks.push(opts.intro);

  if (opts.features?.length) {
    if (blocks.length) blocks.push('');
    blocks.push(PANEL_DIVIDER, '');
    blocks.push(opts.features.map(panelFeature).join('\n'));
  }

  if (opts.steps?.length) {
    if (blocks.length) blocks.push('');
    blocks.push(PANEL_DIVIDER, '');
    blocks.push(panelSteps(opts.steps));
  }

  if (opts.note) {
    if (blocks.length) blocks.push('');
    blocks.push(PANEL_DIVIDER, '');
    blocks.push(`• ${opts.note}`);
  }

  const description = blocks.join('\n').trim();
  if (description) embed.setDescription(clamp(description, 4096));

  for (const section of (opts.sections ?? []).slice(0, 24)) {
    embed.addFields({
      name: clamp(section.title, 256),
      value: clamp(section.lines.join('\n'), 1024),
      inline: section.inline ?? true,
    });
  }

  if (opts.bannerUrl) embed.setImage(opts.bannerUrl);
  if (opts.guildIconUrl) embed.setThumbnail(opts.guildIconUrl);

  embed.setFooter({ text: clamp(opts.footer ?? 'Sukuna Bot', 2048) });
  if (opts.timestamp !== null) {
    embed.setTimestamp(opts.timestamp === undefined ? undefined : opts.timestamp);
  }
  return embed;
}

export interface PanelButton {
  /** Custom id (ignored when `url` is set). */
  id: string;
  label: string;
  emoji?: string | undefined;
  style?: ButtonStyle | undefined;
  url?: string | undefined;
  disabled?: boolean | undefined;
}

/** Discord allows 5 buttons per row and 25 buttons per message. */
export const PANEL_MAX_BUTTONS = 25;

/* --------------------------------------------------------------------------
 * Global panel look — set by the panel service from the dashboard config.
 * ------------------------------------------------------------------------ */

let bannerEnabled = true;
let globalAccent = '';

/** Master switch for the generated banner artwork. */
export function setPanelBannerEnabled(enabled: boolean): void {
  bannerEnabled = enabled !== false;
}

export function isPanelBannerEnabled(): boolean {
  return bannerEnabled;
}

/** Overrides the accent colour of every generated banner. */
export function setPanelAccent(accent: string): void {
  globalAccent = String(accent ?? '').trim();
}

export function getPanelAccent(): string {
  return globalAccent;
}

export function panelButtonRows(buttons: PanelButton[], perRow = 5): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const size = Math.max(1, Math.min(5, perRow));
  const usable = buttons.slice(0, PANEL_MAX_BUTTONS);
  for (let i = 0; i < usable.length; i += size) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const button of usable.slice(i, i + size)) {
      const builder = new ButtonBuilder()
        .setLabel(clamp(button.label, 80))
        .setStyle(button.style ?? ButtonStyle.Secondary);
      if (button.emoji) builder.setEmoji(resolveEmoji(button.emoji));
      if (button.url) builder.setURL(button.url);
      else builder.setCustomId(clamp(button.id, 100));
      if (button.disabled) builder.setDisabled(true);
      row.addComponents(builder);
    }
    rows.push(row);
  }
  return rows;
}

export interface PanelPayload {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
  files: AttachmentBuilder[];
}

/**
 * Attaches the generated banner artwork to a panel. The banner is what makes
 * a panel feel "big" — it renders as a full-width image under the embed.
 * Falls back silently when canvas is unavailable.
 */
export async function attachPanelBanner(
  embed: EmbedBuilder,
  banner: PanelBannerOptions | null,
): Promise<AttachmentBuilder[]> {
  if (!banner || !bannerEnabled) return [];
  try {
    const buffer = await generatePanelBanner({
      ...banner,
      // A global accent overrides the primary colour but keeps the gradient.
      accent: globalAccent || banner.accent,
    });
    embed.setImage('attachment://panel-banner.png');
    return [new AttachmentBuilder(buffer, { name: 'panel-banner.png' })];
  } catch {
    return [];
  }
}

/** Convenience wrapper: build the embed, wire the banner and the buttons. */
export async function buildPanelPayload(
  opts: PanelOptions & { buttons?: PanelButton[] | undefined; banner?: PanelBannerOptions | null | undefined; perRow?: number | undefined },
): Promise<PanelPayload> {
  const embed = buildPanel(opts);
  const files = opts.banner ? await attachPanelBanner(embed, opts.banner) : [];
  const components = panelButtonRows(opts.buttons ?? [], opts.perRow ?? 5);
  return { embed, components, files };
}
