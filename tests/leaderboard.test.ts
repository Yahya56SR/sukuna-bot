import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseManager } from '../src/database/DatabaseManager';
import { LevelingService, normalizeTrack } from '../src/modules/leveling/LevelingService';
import {
  BOARD_DEFINITIONS,
  LeaderboardService,
  normalizeBoard,
} from '../src/modules/leveling/LeaderboardService';
import { buildContentPanel } from '../src/utils/liveLeaderboard';
import { sql } from 'drizzle-orm';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function makeDb() {
  const manager = new DatabaseManager({ path: ':memory:', migrations: true, connectionLimit: 1 });
  await manager.initialize();
  return { db: manager.getDb(), manager };
}

function makeMember(id: string, opts: { staff?: boolean } = {}) {
  const roles = new Map<string, unknown>();
  return {
    id,
    user: {
      id,
      username: `user_${id}`,
      globalName: `user_${id}`,
      tag: `user_${id}#0001`,
      bot: false,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    displayName: `user_${id}`,
    roles: { cache: roles },
    permissions: { has: () => Boolean(opts.staff) },
  };
}

function makeGuild(members: any[] = []) {
  const memberCache = new Map<string, any>(members.map((m) => [m.id, m]));
  return {
    id: 'g1',
    name: 'NGK - community',
    memberCount: 42,
    members: {
      cache: memberCache,
      fetch: async (id: string) => memberCache.get(id) ?? null,
    },
    roles: { cache: new Map() },
  };
}

describe('leaderboard tracks', () => {
  let service: LevelingService;
  let db: any;

  beforeEach(async () => {
    ({ db } = await makeDb());
    service = new LevelingService(logger);
    service.setDb(db);
    const guild = makeGuild([makeMember('staff1', { staff: true }), makeMember('member1')]);
    service.setClient({
      guilds: { cache: new Map([['g1', guild]]) },
      users: { cache: new Map(), fetch: async () => null },
    } as any);
  });

  it('stores the staff track when the member has moderation permissions', async () => {
    await service.addXP('g1', 'staff1', 500, 'manual');
    await service.addXP('g1', 'member1', 300, 'manual');

    expect(await service.getTrack('g1', 'staff1')).toBe('staff');
    expect(await service.getTrack('g1', 'member1')).toBe('member');
  });

  it('keeps the two boards apart', async () => {
    await service.addXP('g1', 'staff1', 500, 'manual');
    await service.addXP('g1', 'member1', 300, 'manual');

    const staff = await service.getLeaderboard('g1', 10, 'staff');
    const members = await service.getLeaderboard('g1', 10, 'member');

    expect(staff.map((r: any) => r.id)).toEqual(['staff1']);
    expect(members.map((r: any) => r.id)).toEqual(['member1']);
    // The boards never overlap.
    const ids = new Set([...staff, ...members].map((r: any) => r.id));
    expect(ids.size).toBe(2);
  });

  it('ranks inside a board, not across boards', async () => {
    const guild = makeGuild([
      makeMember('staff1', { staff: true }),
      makeMember('staff2', { staff: true }),
      makeMember('member1'),
    ]);
    (service as any).client.guilds.cache.set('g1', guild);
    await service.addXP('g1', 'staff1', 500, 'manual');
    await service.addXP('g1', 'staff2', 900, 'manual');
    await service.addXP('g1', 'member1', 300, 'manual');

    // member1 has less XP than both staff members but is #1 on the member board.
    expect(await service.getRankPosition('g1', 'member1', 'member')).toBe(1);
    expect(await service.getRankPosition('g1', 'member1', 'staff')).toBe(0);
    expect(await service.getRankPosition('g1', 'staff2', 'staff')).toBe(1);
    expect(await service.getRankPosition('g1', 'staff1', 'staff')).toBe(2);
  });

  it('counts the members of each board', async () => {
    await service.addXP('g1', 'staff1', 500, 'manual');
    await service.addXP('g1', 'member1', 300, 'manual');
    await service.addXP('g1', 'member2', 100, 'manual');

    expect(await service.countRanked('g1', 'staff')).toBe(1);
    expect(await service.countRanked('g1', 'member')).toBe(2);
    expect(await service.countRanked('g1')).toBe(3);
  });

  it('moves a profile to the other board when the member is promoted', async () => {
    await service.addXP('g1', 'member1', 300, 'manual');
    expect(await service.getTrack('g1', 'member1')).toBe('member');

    const guild = makeGuild([makeMember('member1', { staff: true })]);
    (service as any).client.guilds.cache.set('g1', guild);
    await service.syncMemberTrack('g1', guild.members.cache.get('member1'));

    expect(await service.getTrack('g1', 'member1')).toBe('staff');
    const staff = await service.getLeaderboard('g1', 10, 'staff');
    expect(staff.map((r: any) => r.id)).toEqual(['member1']);
  });

  it('refreshGuildTracks re-checks every ranked member', async () => {
    await service.addXP('g1', 'staff1', 500, 'manual');
    await service.addXP('g1', 'member1', 300, 'manual');
    // Pretend member1 was promoted while the bot was offline.
    await service.setTrack('g1', 'member1', 'member');
    await db.run(sql`UPDATE leveling_profiles SET track = 'member' WHERE guild_id = 'g1' AND user_id = 'member1'`);

    const guild = makeGuild([makeMember('staff1', { staff: true }), makeMember('member1', { staff: true })]);
    (service as any).client.guilds.cache.set('g1', guild);
    const counts = await service.refreshGuildTracks('g1');

    expect(counts.staff).toBe(2);
    expect(await service.getTrack('g1', 'member1')).toBe('staff');
  });

  it('returns an empty board when nobody is ranked yet', async () => {
    expect(await service.getLeaderboard('g1', 10, 'staff')).toEqual([]);
    expect(await service.getLeaderboard('g1', 10, 'member')).toEqual([]);
  });
});

describe('board definitions', () => {
  it('normalises the board names', () => {
    expect(normalizeBoard('members')).toBe('members');
    expect(normalizeBoard('member')).toBe('members');
    expect(normalizeBoard('staff')).toBe('staff');
    expect(normalizeBoard('STAFF')).toBe('staff');
    expect(normalizeBoard('nonsense')).toBeNull();
  });

  it('normalises the track names', () => {
    expect(normalizeTrack('staff')).toBe('staff');
    expect(normalizeTrack('members')).toBe('member');
    expect(normalizeTrack('member')).toBe('member');
    expect(normalizeTrack('nonsense')).toBeNull();
  });

  it('gives each board its own look', () => {
    expect(BOARD_DEFINITIONS.members.title).toBe('Members Leaderboard');
    expect(BOARD_DEFINITIONS.staff.title).toBe('Staff Leaderboard');
    expect(BOARD_DEFINITIONS.members.theme.accentColor).not.toBe(BOARD_DEFINITIONS.staff.theme.accentColor);
    expect(BOARD_DEFINITIONS.members.track).toBe('member');
    expect(BOARD_DEFINITIONS.staff.track).toBe('staff');
  });
});

describe('leaderboard panels', () => {
  const guild: any = { name: 'NGK - community', memberCount: 42 };
  const entries = [
    { rank: 1, userId: '1', username: 'Kaven', avatarUrl: '', level: 4, totalXp: 1200, xpInLevel: 100, xpForNext: 500, percent: 60 },
    { rank: 2, userId: '2', username: 'VOID', avatarUrl: '', level: 3, totalXp: 900, xpInLevel: 100, xpForNext: 400, percent: 50 },
    { rank: 3, userId: '3', username: 'Wavezz', avatarUrl: '', level: 2, totalXp: 400, xpInLevel: 100, xpForNext: 300, percent: 40 },
    { rank: 4, userId: '4', username: 'Kite', avatarUrl: '', level: 2, totalXp: 300, xpInLevel: 100, xpForNext: 300, percent: 30 },
  ];

  function texts(container: any): string {
    return container.toJSON().components
      .filter((c: any) => c.type === 10)
      .map((c: any) => c.content as string)
      .join('\n');
  }

  it('renders the members board with the trophy title', () => {
    const panel = buildContentPanel({
      entries,
      guild,
      rows: 10,
      title: `${guild.name} • ${BOARD_DEFINITIONS.members.title}`,
      theme: BOARD_DEFINITIONS.members.theme,
    });
    const body = texts(panel);
    expect(body).toContain('Members Leaderboard');
    expect(body).toContain('42');
    expect(body).toContain('members');
  });

  it('renders the staff board with its own title and wording', () => {
    const panel = buildContentPanel({
      entries,
      guild,
      rows: 10,
      title: `${guild.name} • ${BOARD_DEFINITIONS.staff.title}`,
      theme: BOARD_DEFINITIONS.staff.theme,
    });
    const body = texts(panel);
    expect(body).toContain('Staff Leaderboard');
    expect(body).toContain('staff team');
    // The member count of the guild is not shown on the staff board.
    expect(body).not.toContain('42');
  });

  it('uses a plain ranking on the short staff board', () => {
    const panel = buildContentPanel({
      entries,
      guild,
      rows: 10,
      title: 'Staff',
      theme: BOARD_DEFINITIONS.staff.theme,
    });
    const body = texts(panel);
    expect(body).toContain('Full ranking');
    expect(body).not.toContain('Diamond Zone');
  });

  it('keeps the zone layout on the long members board', () => {
    const panel = buildContentPanel({
      entries,
      guild,
      rows: 10,
      title: 'Members',
      theme: BOARD_DEFINITIONS.members.theme,
    });
    expect(texts(panel)).toContain('Diamond Zone');
  });

  it('gives the two boards different accent colours', () => {
    const members = buildContentPanel({ entries, guild, theme: BOARD_DEFINITIONS.members.theme });
    const staff = buildContentPanel({ entries, guild, theme: BOARD_DEFINITIONS.staff.theme });
    expect(members.toJSON().accent_color).not.toBe(staff.toJSON().accent_color);
  });
});

describe('live leaderboard boards', () => {
  let service: LeaderboardService;
  let leveling: LevelingService;
  let db: any;

  beforeEach(async () => {
    ({ db } = await makeDb());
    leveling = new LevelingService(logger);
    leveling.setDb(db);
    service = new LeaderboardService(logger, leveling, { refreshMinutes: 5, defaultRows: 25 });
    service.setDb(db);
  });

  it('remembers a published board', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.run(sql`
      INSERT INTO leaderboard_boards (id, guild_id, board, channel_id, message_id, rows, enabled, created_at, updated_at)
      VALUES ('lbl_1', 'g1', 'members', 'c1', 'm1', 10, 1, ${now}, ${now})
    `);

    const boards = await service.listBoards('g1');
    expect(boards).toHaveLength(1);
    expect(boards[0].board).toBe('members');
    expect(boards[0].channelId).toBe('c1');
    expect(boards[0].rows).toBe(10);
    expect(boards[0].enabled).toBe(true);
  });

  it('keeps one board per guild and track', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.run(sql`
      INSERT INTO leaderboard_boards (id, guild_id, board, channel_id, message_id, rows, enabled, created_at, updated_at)
      VALUES ('lbl_1', 'g1', 'members', 'c1', 'm1', 10, 1, ${now}, ${now})
    `);
    await db.run(sql`
      INSERT INTO leaderboard_boards (id, guild_id, board, channel_id, message_id, rows, enabled, created_at, updated_at)
      VALUES ('lbl_2', 'g1', 'staff', 'c2', 'm2', 5, 1, ${now}, ${now})
      ON CONFLICT(guild_id, board) DO UPDATE SET channel_id = excluded.channel_id
    `);

    const boards = await service.listBoards('g1');
    expect(boards).toHaveLength(2);
    expect(boards.map((b) => b.board).sort()).toEqual(['members', 'staff']);
  });

  it('removes a board', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.run(sql`
      INSERT INTO leaderboard_boards (id, guild_id, board, channel_id, message_id, rows, enabled, created_at, updated_at)
      VALUES ('lbl_1', 'g1', 'staff', 'c1', 'm1', 10, 1, ${now}, ${now})
    `);
    expect(await service.removeBoard('g1', 'staff', false)).toBe(true);
    expect(await service.listBoards('g1')).toHaveLength(0);
    expect(await service.removeBoard('g1', 'staff', false)).toBe(false);
  });
});
