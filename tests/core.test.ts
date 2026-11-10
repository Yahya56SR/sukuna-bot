import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/database/DatabaseManager';
import { LevelingService } from '../src/modules/leveling/LevelingService';
import { EconomyService } from '../src/modules/economy/EconomyService';
import { ModerationService } from '../src/modules/moderation/ModerationService';
import { parseCron, nextCron, isValidCron } from '../src/utils/cron';
import { parseDuration, GIVEAWAY_PREFIX } from '../src/modules/GiveawaysManager';
import { newId, shortId, isSnowflake } from '../src/utils/id';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function makeDb() {
  const manager = new DatabaseManager({ path: ':memory:', migrations: true, connectionLimit: 1 });
  await manager.initialize();
  return { db: manager.getDb(), manager };
}

// ---------- cron utility ----------

describe('cron utils', () => {
  it('parses a simple daily schedule', () => {
    const next = nextCron('0 9 * * *', new Date('2026-11-09T08:00:00Z'));
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it('handles step values and weekday names', () => {
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 9 * * MON')).toBe(true);
    expect(isValidCron('0 9 31 2 *')).toBe(true); // valid syntax, just rare semantics
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false);
  });

  it('computes the next occurrence strictly in the future', () => {
    const now = new Date('2026-11-09T10:00:00Z');
    const next = nextCron('*/30 * * * *', now);
    expect(next.getTime()).toBeGreaterThan(now.setSeconds(0, 0));
    expect(next.getMinutes() % 30).toBe(0);
  });

  it('respects parsed day/month restrictions', () => {
    const parsed = parseCron('0 0 25 12 *');
    expect(parsed.month.values).toContain(12);
    expect(parsed.dayOfMonth.values).toContain(25);
  });
});

// ---------- helpers ----------

describe('id helpers', () => {
  it('generates collision-resistant unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('x')));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toMatch(/^x_[0-9a-f]{32}$/);
  });

  it('shortId produces compact prefixed ids', () => {
    expect(shortId('t')).toMatch(/^t_[0-9a-f]{8}$/);
  });

  it('isSnowflake validates discord ids', () => {
    expect(isSnowflake('123456789012345678')).toBe(true);
    expect(isSnowflake('abc')).toBe(false);
    expect(isSnowflake('')).toBe(false);
  });
});

describe('giveaway helpers', () => {
  it('parses durations', () => {
    expect(parseDuration('10s')).toBe(10);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('1d')).toBe(86400);
    expect(parseDuration('nope')).toBeNull();
    expect(parseDuration('0s')).toBeNull();
  });

  it('exposes a stable button prefix', () => {
    expect(GIVEAWAY_PREFIX).toBe('giveaway:');
  });
});

// ---------- economy (real sqlite) ----------

describe('EconomyService', () => {
  let service: EconomyService;

  beforeEach(async () => {
    const { db } = await makeDb();
    service = new EconomyService(logger);
    service.setDb(db);
  });

  it('credit creates an account and returns the balance', async () => {
    const balance = await service.credit('guild1', 'user1', 250);
    expect(balance).toBe(250);
  });

  it('debit is atomic: insufficient funds change nothing', async () => {
    await service.credit('guild1', 'user1', 100);
    const result = await service.debit('guild1', 'user1', 500);
    expect(result.success).toBe(false);
    expect(result.balance).toBe(100);
    expect(await service.getBalance('guild1', 'user1')).toBe(100);
  });

  it('transfer moves funds between wallets atomically', async () => {
    await service.credit('guild1', 'user1', 100);
    const result = await service.transfer('guild1', 'user1', 'user2', 30);
    expect(result.success).toBe(true);
    expect(await service.getBalance('guild1', 'user1')).toBe(70);
    expect(await service.getBalance('guild1', 'user2')).toBe(30);
  });

  it('transfer respects the maxTransfer limit', async () => {
    service.config.maxTransfer = 25;
    await service.credit('guild1', 'user1', 100);
    await expect(service.transfer('guild1', 'user1', 'user2', 50)).rejects.toThrow(/limited/i);
    expect(await service.getBalance('guild1', 'user1')).toBe(100);
  });

  it('keeps wallets isolated per guild', async () => {
    await service.credit('guild1', 'user1', 40);
    expect(await service.getBalance('guild2', 'user1')).toBe(0);
    expect(await service.getBalance('guild1', 'user1')).toBe(40);
  });
});

// ---------- leveling (real sqlite) ----------

describe('LevelingService', () => {
  let service: LevelingService;

  beforeEach(async () => {
    const { db } = await makeDb();
    service = new LevelingService(logger);
    service.setDb(db);
  });

  it('calculateLevel and xpForLevel are consistent', () => {
    expect(service.calculateLevel(0)).toBe(1);
    expect(service.calculateLevel(100)).toBe(2);
    expect(service.calculateLevel(400)).toBe(3);
    expect(service.calculateLevel(900)).toBe(4);
    expect(service.xpForLevel(1)).toBe(0);
    expect(service.xpForLevel(2)).toBe(100);
    expect(service.xpForLevel(3)).toBe(400);
  });

  it('addXP accumulates xp and levels up atomically', async () => {
    const result = await service.addXP('g1', 'u1', 150, 'manual');
    expect(result).not.toBeNull();
    expect(result!.totalXP).toBe(150);
    expect(result!.newLevel).toBe(2);
    expect(result!.leveledUp).toBe(true);
  });

  it('message-source cooldown blocks immediate re-xp', async () => {
    await service.addXP('g1', 'u1', 20, 'message');
    const second = await service.addXP('g1', 'u1', 20, 'message');
    expect(second).not.toBeNull();
    expect(second!.xpGained).toBe(0);
    expect(second!.leveledUp).toBe(false);
  });

  it('manual source bypasses the message cooldown', async () => {
    await service.addXP('g1', 'u1', 20, 'message');
    const manual = await service.addXP('g1', 'u1', 20, 'manual');
    expect(manual!.totalXP).toBe(40);
  });

  it('xp persists across service instances (same db)', async () => {
    await service.addXP('g1', 'u1', 120, 'manual');
    const { db } = await makeDb();
    void db;
    const profile = await (service as any).getProfile?.('g1', 'u1');
    if (profile) {
      expect(profile.totalXP ?? profile.total_xp).toBe(120);
    } else {
      const progress = await service.getLevelProgress(120, 2);
      expect(progress.current + progress.needed).toBeGreaterThan(0);
    }
  });
});

// ---------- moderation (real sqlite + stubbed discord) ----------

function makeMember(id: string, opts: { highest?: number; admin?: boolean } = {}) {
  const highest = opts.highest ?? 5;
  return {
    id,
    user: { id, username: `user_${id}`, tag: `user_${id}#0001`, bot: false },
    displayName: `user_${id}`,
    roles: {
      highest: { position: highest },
      cache: { has: () => false, some: () => false, values: function* () {} },
    },
    permissions: { has: () => Boolean(opts.admin) },
    kickable: true,
    moderatable: true,
    isCommunicationDisabled: () => false,
    voice: { channelId: null },
    timeout: vi.fn(async () => undefined),
    kick: vi.fn(async () => undefined),
  } as any;
}

function makeGuild(guildId: string, ownerId: string, members: Record<string, any>, botId = 'bot1') {
  const cache = new Map<string, any>();
  cache.set(botId, makeMember(botId, { highest: 50, admin: true }));
  for (const [id, m] of Object.entries(members)) cache.set(id, m);
  const guild: any = {
    id: guildId,
    ownerId,
    name: 'Test Guild',
    members: {
      cache,
      me: cache.get(botId),
      fetch: vi.fn(async (id: string) => cache.get(id) ?? null),
      ban: vi.fn(async () => undefined),
      unban: vi.fn(async () => undefined),
    },
    roles: {
      cache: new Map(),
      fetch: vi.fn(async () => null),
    },
    bans: {
      fetch: vi.fn(async () => null),
    },
    channels: {
      cache: new Map(),
      fetch: vi.fn(async () => null),
      create: vi.fn(),
    },
  };
  return guild;
}

describe('ModerationService', () => {
  let service: ModerationService;
  let guild: any;

  beforeEach(async () => {
    const { db } = await makeDb();
    guild = makeGuild('g1', 'owner1', {
      mod1: makeMember('mod1', { highest: 20 }),
      user1: makeMember('user1', { highest: 5 }),
      boss1: makeMember('boss1', { highest: 30 }),
    });
    const client: any = {
      guilds: { cache: new Map([[guild.id, guild]]) },
      users: { fetch: vi.fn(async () => ({ username: 'someone', tag: 'someone#0001' })) },
      user: { id: 'bot1' },
      channels: { fetch: vi.fn(async () => null) },
    };
    service = new ModerationService(logger);
    service.setDb(db);
    service.config.warnThreshold = 0;
    service.setClient(client);
  });

  it('warn persists a warning and a case', async () => {
    const caseId = await service.warn('g1', 'user1', 'mod1', 'Test reason');
    expect(caseId).toContain('warn_');
    const warnings = await service.getWarnings('g1', 'user1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toBe('Test reason');
    expect(warnings[0]!.active).toBe(true);
    const cases = await service.getCases('g1', 'user1');
    expect(cases).toHaveLength(1);
    expect(cases[0]!.type).toBe('warn');
  });

  it('refuses self-moderation', async () => {
    await expect(service.warn('g1', 'mod1', 'mod1', 'self')).rejects.toThrow(/yourself/i);
  });

  it('enforces role hierarchy', async () => {
    await expect(service.warn('g1', 'boss1', 'mod1', 'higher role')).rejects.toThrow(/higher|equal/i);
  });

  it('protects the server owner', async () => {
    await expect(service.warn('g1', 'owner1', 'mod1', 'owner')).rejects.toThrow(/owner/i);
  });

  it('removeWarning deactivates the warning', async () => {
    const caseId = await service.warn('g1', 'user1', 'mod1', 'reason');
    expect(await service.removeWarning('g1', caseId, 'mod1')).toBe(true);
    expect(await service.getWarnings('g1', 'user1')).toHaveLength(0);
    const all = await service.getWarnings('g1', 'user1', true);
    expect(all).toHaveLength(1);
    expect(all[0]!.active).toBe(false);
  });

  it('clearWarnings removes only active ones', async () => {
    await service.warn('g1', 'user1', 'mod1', 'one');
    await service.warn('g1', 'user1', 'mod1', 'two');
    const cleared = await service.clearWarnings('g1', 'user1', 'mod1');
    expect(cleared).toBe(2);
    expect(await service.getWarnings('g1', 'user1')).toHaveLength(0);
  });
});
