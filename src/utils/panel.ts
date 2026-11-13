import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  resolveColor,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { BRAND } from './embed';
import { resolveEmoji } from './emoji';
import { generatePanelBanner, type PanelBannerOptions } from './panelBanner';

/**
 * Sukuna Bot panel kit — one place that builds the big, branded Discord
 * panels used by staff applications, tickets, temporary voice and giveaways.
 *
 * Built on **Components v2** (`MessageFlags.IsComponentsV2`):
 *
 *   ┌ Container (accent colour) ───────────────────────┐
 *   │ # <emoji> <Server> • <Section>        [icon]     │
 *   │ <intro paragraph, optional link>                │
 *   │ ───────────────────────────────────              │
 *   │ • <emoji> **Label**: `value`                     │
 *   │ ───────────────────────────────────              │
 *   │ • <emoji> <closing note>                         │
 *   │ [banner artwork]                                 │
 *   └──────────────────────────────────────────────────┘
 *   [button grid — 5 per row]
 *
 * Components v2 messages carry no embeds and no content, so the title,
 * dividers and artwork are real components instead of markdown hacks.
 */

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

/** `**1.** Do the thing` — a numbered list. */
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
  /** Emoji prefix shown in the panel title. */
  emoji?: string | undefined;
  /** Section name, e.g. `Staff Applications`. */
  title: string;
  /** Server name — the title becomes `<Server> • <Section>`. */
  guildName?: string | undefined;
  /** Server icon shown next to the title. */
  guildIconUrl?: string | undefined;
  color?: ColorResolvable | undefined;
  /** Opening paragraph. May contain markdown/links. */
  intro?: string | undefined;
  /** Feature bullets rendered under a divider. */
  features?: PanelFeature[] | undefined;
  /** Numbered steps rendered under a divider. */
  steps?: string[] | undefined;
  /** Extra info blocks rendered after the bullets. */
  sections?: PanelSection[] | undefined;
  /** Closing line rendered under the last divider. */
  note?: string | undefined;
  /** Footer line rendered at the very bottom. */
  footer?: string | undefined;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Builds the panel container: title (with the server icon), intro, feature
 * bullets, closing note and the button grid — separated by real separator
 * components.
 */
export function buildPanel(opts: PanelOptions): ContainerBuilder {
  const container = new ContainerBuilder();
  // Container accents are plain RGB integers (0x000000 – 0xFFFFFF).
  container.setAccentColor(resolveColor(opts.color ?? BRAND.red));

  // Header — a Section so the server icon can sit next to the title.
  const heading = `# ${panelTitle(opts.guildName, opts.title, opts.emoji)}`;
  if (opts.guildIconUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents((textDisplay) => textDisplay.setContent(heading))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.guildIconUrl)),
    );
  } else {
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(heading));
  }

  if (opts.intro) {
    const intro = clamp(opts.intro, 4000);
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(intro));
  }

  const features = opts.features;
  if (features?.length) {
    const body = clamp(features.map(panelFeature).join('\n'), 4000);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(body));
  }

  const steps = opts.steps;
  if (steps?.length) {
    const body = clamp(panelSteps(steps), 4000);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(body));
  }

  for (const section of (opts.sections ?? []).slice(0, 10)) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(clamp(`**${section.title}**\n${section.lines.join('\n')}`, 4000)),
    );
  }

  if (opts.note) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(clamp(`• ${opts.note}`, 4000)),
    );
  }

  if (opts.footer) {
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(clamp(`-# ${opts.footer}`, 4000)),
    );
  }

  return container;
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

/**
 * Adds the generated banner artwork to a panel.
 *
 * Components v2 messages do not show attachments on their own — the artwork
 * has to be exposed through a media gallery, which also renders it above the
 * text. Falls back silently when canvas is unavailable.
 */
export async function attachPanelBanner(
  container: ContainerBuilder,
  banner: PanelBannerOptions | null,
): Promise<AttachmentBuilder[]> {
  if (!banner || !bannerEnabled) return [];
  try {
    const buffer = await generatePanelBanner({
      ...banner,
      // A global accent overrides the primary colour but keeps the gradient.
      accent: globalAccent || banner.accent,
    });
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://panel-banner.png')
          .setDescription(banner.title),
      ),
    );
    return [new AttachmentBuilder(buffer, { name: 'panel-banner.png' })];
  } catch {
    return [];
  }
}

export interface PanelPayload {
  /** Components v2 payload — send with `flags: MessageFlags.IsComponentsV2`. */
  components: any[];
  files: AttachmentBuilder[];
  flags: MessageFlags.IsComponentsV2;
}

/**
 * Convenience wrapper: build the container, wire the banner and the buttons.
 *
 * The button grid lives INSIDE the container so the whole panel reads as one
 * box — title, artwork and buttons share the same accent colour.
 */
export async function buildPanelPayload(
  opts: PanelOptions & { buttons?: PanelButton[] | undefined; banner?: PanelBannerOptions | null | undefined; perRow?: number | undefined },
): Promise<PanelPayload> {
  const container = buildPanel(opts);
  const files = opts.banner ? await attachPanelBanner(container, opts.banner) : [];

  const rows = panelButtonRows(opts.buttons ?? [], opts.perRow ?? 5);
  if (rows.length) container.addActionRowComponents(...rows);

  return { components: [container], files, flags: MessageFlags.IsComponentsV2 };
}
