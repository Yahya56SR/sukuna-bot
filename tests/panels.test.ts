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

const logger: any = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

describe('panel kit', () => {
  it('builds a titled panel with the server name', () => {
    const embed = buildPanel({ emoji: 'staff', title: 'Staff Applications', guildName: 'NGK - community' });
    expect(embed.toJSON().title).toBe(EMOJI_FALLBACKS.staff + ' NGK - community • Staff Applications');
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

  it('separates intro, features and note with dividers', () => {
    const embed = buildPanel({
      title: 'Panels',
      intro: 'Intro line',
      features: [{ label: 'One', value: 'first' }],
      note: 'Closing note',
    });
    const description = embed.toJSON().description ?? '';
    expect(description.indexOf('Intro line')).toBeLessThan(description.indexOf('One'));
    expect(description.split('-'.repeat(10)).length - 1).toBeGreaterThanOrEqual(2);
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

  it('builds a payload with buttons', async () => {
    const payload = await buildPanelPayload({
      title: 'Tickets',
      features: [{ label: 'Pub', value: 'chat' }],
      buttons: [{ id: 'ticket:panel:create:pub', label: 'Pub', emoji: 'pub' }],
    });
    expect(payload.components).toHaveLength(1);
    expect(payload.embed.toJSON().description).toContain('Pub');
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
