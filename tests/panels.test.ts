import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPanel,
  buildPanelPayload,
  panelButtonRows,
  panelFeature,
  panelSteps,
  panelTitle,
  PANEL_MAX_BUTTONS,
} from '../src/utils/panel';
import { generatePanelBanner } from '../src/utils/panelBanner';
import { emojiRegistry, EMOJI_FALLBACKS, PANEL_EMOJI_KEYS } from '../src/utils/emoji';
import { TicketsManager, DEFAULT_TICKET_CATEGORIES } from '../src/modules/TicketsManager';
import { StaffApplications } from '../src/modules/StaffApplications';
import { buildContentPanel } from '../src/utils/liveLeaderboard';
import { progressBar } from '../src/utils/level';
import { MessageFlags } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const logger: any = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

function texts(container: any): string[] {
  return container.toJSON().components
    .filter((c: any) => c.type === 10)
    .map((c: any) => c.content as string);
}

describe('panel kit', () => {
  it('builds a titled panel with the server name', () => {
    const panel = buildPanel({ emoji: 'staff', title: 'Staff Applications', guildName: 'NGK - community' });
    expect(texts(panel)[0]).toBe(`# ${EMOJI_FALLBACKS.staff} NGK - community • Staff Applications`);
  });

  it('renders feature bullets with inline code values', () => {
    expect(panelFeature({ emoji: 'designer', label: 'Designer', value: 'Create visuals' }))
      .toBe('• ' + EMOJI_FALLBACKS.designer + ' **Designer**: `Create visuals`');
  });

  it('keeps raw values (timestamps, mentions) out of inline code', () => {
    const bullet = panelFeature({ label: 'Ends', value: '<t:1234:R>', code: false });
    expect(bullet).toContain('<t:1234:R>');
    expect(bullet).not.toContain('`<t:1234:R>`');
  });

  it('separates intro, features and note with real separators', () => {
    const panel = buildPanel({
      title: 'Panels',
      intro: 'Intro line',
      features: [{ label: 'One', value: 'first' }],
      note: 'Closing note',
    });
    const json = panel.toJSON();
    const separators = json.components.filter((c: any) => c.type === 14);
    expect(separators.length).toBeGreaterThanOrEqual(2);
    expect(separators[0].divider).toBe(true);
    const all = texts(panel).join('\n');
    expect(all).toContain('Intro line');
    expect(all).toContain('**One**');
    expect(all).toContain('Closing note');
  });

  it('shows the server icon as a thumbnail accessory', () => {
    const panel = buildPanel({
      title: 'Panels',
      guildIconUrl: 'https://cdn.discordapp.com/icons/1/abc.png',
    });
    const section = panel.toJSON().components.find((c: any) => c.type === 9);
    expect(section).toBeTruthy();
    expect(section.accessory.type).toBe(11);
    expect(section.accessory.media.url).toContain('cdn.discordapp.com');
  });

  it('numbers the steps', () => {
    expect(panelSteps(['a', 'b'])).toBe('**1.** a\n**2.** b');
  });

  it('formats the title with and without a server name', () => {
    expect(panelTitle('Server', 'Section')).toBe('Server • Section');
    expect(panelTitle(undefined, 'Section')).toBe('Section');
  });

  it('lays out buttons 5 per row and caps the total', () => {
    const rows = panelButtonRows(
      Array.from({ length: 12 }, (_, i) => ({ id: `id${i}`, label: `Button ${i}` })),
      5,
    );
    expect(rows).toHaveLength(3);
    expect((rows[0] as any).toJSON().components).toHaveLength(5);
    expect((rows[2] as any).toJSON().components).toHaveLength(2);

    const many = panelButtonRows(Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, label: `X${i}` })));
    const total = many.reduce((sum, row) => sum + (row as any).toJSON().components.length, 0);
    expect(total).toBe(PANEL_MAX_BUTTONS);
  });

  it('builds a components v2 payload', async () => {
    const payload = await buildPanelPayload({
      title: 'Tickets',
      features: [{ label: 'Pub', value: 'chat' }],
      buttons: [{ id: 'ticket:panel:create:pub', label: 'Pub', emoji: 'pub' }],
    });
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(2);
    expect(payload.components[0].toJSON().type).toBe(17);
    expect(payload.components[1].toJSON().type).toBe(1);
    expect(texts(payload.components[0]).join('\n')).toContain('Pub');
  });

  it('exposes the banner through a media gallery', async () => {
    const payload = await buildPanelPayload({
      title: 'Tickets',
      banner: { title: 'Tickets', subtitle: 'NGK' },
    });
    const gallery = payload.components[0].toJSON().components.find((c: any) => c.type === 12);
    expect(gallery).toBeTruthy();
    expect(gallery.items[0].media.url).toBe('attachment://panel-banner.png');
    expect(payload.files).toHaveLength(1);
  });
});

describe('custom emoji registry', () => {
  beforeEach(() => {
    emojiRegistry.setCustomEmojis([]);
    emojiRegistry.setAliases({});
    emojiRegistry.setDirect({});
  });

  it('falls back to the bot\'s own emoji when nothing is mapped', () => {
    expect(emojiRegistry.get('ticket')).toBe(EMOJI_FALLBACKS.ticket);
    expect(EMOJI_FALLBACKS.ticket).toMatch(/^<a?:[A-Za-z0-9_]+:\d+>$/);
  });

  it('uses the custom emoji from the emoji server', () => {
    emojiRegistry.setCustomEmojis([{ id: '123', name: 'sukuna_ticket' }]);
    emojiRegistry.setAliases({ ticket: 'sukuna_ticket' });
    expect(emojiRegistry.get('ticket')).toBe('<:sukuna_ticket:123>');
  });

  it('honours direct overrides', () => {
    emojiRegistry.setDirect({ ticket: '<a:money:999>' });
    expect(emojiRegistry.get('ticket')).toBe('<a:money:999>');
  });

  it('resolves camelCase keys', () => {
    expect(emojiRegistry.get('staffTeam')).toBe(EMOJI_FALLBACKS.staffTeam);
    expect(emojiRegistry.get('STAFFTEAM')).toBe(EMOJI_FALLBACKS.staffTeam);
  });

  it('exposes every panel key', () => {
    const snapshot = emojiRegistry.snapshot();
    for (const key of PANEL_EMOJI_KEYS) {
      expect(snapshot[key]).toBeTruthy();
    }
  });
});

describe('ticket categories', () => {
  it('falls back to the default categories', () => {
    const tickets = new TicketsManager(logger, { enabled: true, category: '', supportRoles: [], closeVote: false });
    expect(tickets.getCategories()).toEqual(DEFAULT_TICKET_CATEGORIES);
    expect(tickets.getCategory('pub')?.label).toBe('Pub');
  });

  it('uses configured categories', () => {
    const tickets = new TicketsManager(logger, {
      enabled: true,
      category: '',
      supportRoles: [],
      closeVote: false,
      categories: [{ key: 'Support', label: 'Support', emoji: 'support', description: 'Ask for help' }],
    });
    expect(tickets.getCategories()).toHaveLength(1);
    expect(tickets.getCategory('support')?.description).toBe('Ask for help');
  });
});

describe('panel banner', () => {
  it('renders a PNG', async () => {
    const buffer = await generatePanelBanner({ title: 'Staff Applications', subtitle: 'NGK', emoji: '🛡️' });
    expect(buffer.length).toBeGreaterThan(1000);
    // PNG magic number
    expect(buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('dashboard script', () => {
  it('parses without a syntax error', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/web/public/js/dashboard.js'), 'utf8');
    expect(() => new vm.Script(source)).not.toThrow();
  });
});

describe('leaderboard panel', () => {
  const guild: any = { name: 'NGK - community', memberCount: 31 };
  const entries = [
    { rank: 1, userId: '1', username: 'Kaven', avatarUrl: '', level: 1, totalXp: 85, xpInLevel: 85, xpForNext: 155, percent: 85 },
    { rank: 2, userId: '2', username: 'VOID', avatarUrl: '', level: 1, totalXp: 42, xpInLevel: 42, xpForNext: 155, percent: 42 },
    { rank: 3, userId: '3', username: 'Wavezz', avatarUrl: '', level: 1, totalXp: 24, xpInLevel: 24, xpForNext: 155, percent: 24 },
  ];

  it('never leaks markdown image syntax into the text', () => {
    const panel = buildContentPanel(entries, guild, 10, '');
    const body = texts(panel).join('\n');
    expect(body).not.toContain('attachment://');
    expect(body).not.toContain('![');
  });

  it('puts the podium media ABOVE the leaderboard content', () => {
    const panel = buildContentPanel(entries, guild, 10, '', Date.now(), undefined, 'attachment://top-3.png');
    const components = panel.toJSON().components;
    const galleryIndex = components.findIndex((c: any) => c.type === 12);
    const topIndex = components.findIndex((c: any) => c.type === 10 && String(c.content).includes('Top 3'));
    expect(galleryIndex).toBeGreaterThanOrEqual(0);
    expect(topIndex).toBeGreaterThan(galleryIndex);
    expect(components[galleryIndex].items[0].media.url).toBe('attachment://top-3.png');
  });

  it('uses progress bars that every client can render', () => {
    const bar = progressBar(50, 6);
    expect(bar).toBe('███░░░');
    expect(bar).not.toMatch(/[▰▱▓]/);
  });
});

describe('staff role emoji', () => {
  it('uses the bot emoji, never the role unicode emoji', async () => {
    const service = new StaffApplications(logger, {
      enabled: true,
      staffRoles: ['1', '2', '3'],
      roleDescriptions: {},
    });
    const roles = [
      { id: '1', name: 'staff team', unicodeEmoji: '📄' },
      { id: '2', name: 'girl staff', unicodeEmoji: '✏️' },
      { id: '3', name: 'Support', unicodeEmoji: '🎀' },
    ];
    const emojis = (service as any).roleEmojis(roles) as string[];
    expect(emojis).toHaveLength(3);
    // The role's own Discord emoji is never used.
    expect(emojis).not.toContain('📄');
    expect(emojis).not.toContain('✏️');
    expect(emojis).not.toContain('🎀');
    // Every emoji resolves to one of the bot's own emoji.
    for (const emoji of emojis) {
      expect(EMOJI_FALLBACKS[emoji as keyof typeof EMOJI_FALLBACKS]).toBeTruthy();
    }
    // No duplicates.
    expect(new Set(emojis).size).toBe(3);
  });

  it('matches a role name to a meaningful emoji', () => {
    const service = new StaffApplications(logger, { enabled: true, staffRoles: ['1'], roleDescriptions: {} });
    const emojis = (service as any).roleEmojis([{ id: '1', name: 'Designer' }]) as string[];
    expect(emojis[0]).toBe('designer');
  });
});
