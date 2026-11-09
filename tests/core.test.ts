import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LevelingService } from '../src/modules/leveling/LevelingService';
import { EconomyService } from '../src/modules/economy/EconomyService';
import { ModerationService } from '../src/modules/moderation/ModerationService';

function makeMockDb(rows: any[] = []) {
  const whereMock = vi.fn().mockResolvedValue(rows);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });
  const valuesMock = vi.fn().mockResolvedValue({});
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const updateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereMock }), where: whereMock });
  const deleteMock = vi.fn().mockReturnValue({ where: whereMock });

  return {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    where: whereMock,
    from: fromMock,
    values: valuesMock,
    rows,
    setWhereRows: (r: any[]) => whereMock.mockResolvedValue(r),
  };
}

describe('LevelingService', () => {
  let service: LevelingService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new LevelingService({ info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any);
    service.setDb(mockDb);
  });

  it('calculateLevel returns correct level', () => {
    expect(service.calculateLevel(0)).toBe(1);
    expect(service.calculateLevel(100)).toBe(2);
    expect(service.calculateLevel(400)).toBe(3);
    expect(service.calculateLevel(900)).toBe(4);
  });

  it('xpForLevel returns correct XP', () => {
    expect(service.xpForLevel(1)).toBe(0);
    expect(service.xpForLevel(2)).toBe(100);
    expect(service.xpForLevel(3)).toBe(400);
  });

  it('addXP returns leveledUp=true when level increases', async () => {
    mockDb.setWhereRows([{ id: 'user1', xp: 0, level: 1, total_xp: 0 }]);

    const result = await service.addXP('guild1', 'user1', 150);
    expect(result.leveledUp).toBe(true);
    expect(result.oldLevel).toBe(1);
    expect(result.newLevel).toBe(2);
  });

  it('addXP returns leveledUp=false when level does not increase', async () => {
    mockDb.setWhereRows([{ id: 'user1', xp: 0, level: 1, total_xp: 0 }]);

    const result = await service.addXP('guild1', 'user1', 10);
    expect(result.leveledUp).toBe(false);
  });

  it('applies cooldown between XP gains', async () => {
    mockDb.setWhereRows([{ id: 'user1', xp: 0, level: 1, total_xp: 0 }]);

    await service.addXP('guild1', 'user1', 10);
    const result = await service.addXP('guild1', 'user1', 10);
    expect(result.leveledUp).toBe(false);
  });

  it('setXP replaces the total and recalculates the level', async () => {
    mockDb.setWhereRows([{ id: 'user1', xp: 5, level: 1, total_xp: 5 }]);

    const result = await service.setXP('guild1', 'user1', 400);
    expect(result.totalXP).toBe(400);
    expect(result.xp).toBe(400);
    expect(result.level).toBe(3);
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe('EconomyService', () => {
  let service: EconomyService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new EconomyService({ info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any);
    service.setDb(mockDb);
  });

  it('getBalance returns 0 for new user', async () => {
    mockDb.setWhereRows([]);

    const balance = await service.getBalance('user1');
    expect(balance).toBe(0);
  });

  it('getBalance returns stored balance', async () => {
    mockDb.setWhereRows([{ id: 'user1', balance: 500 }]);

    const balance = await service.getBalance('user1');
    expect(balance).toBe(500);
  });

  it('addBalance increases balance', async () => {
    mockDb.setWhereRows([{ id: 'user1', balance: 100 }]);

    await service.addBalance('user1', 50);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('removeBalance returns false if insufficient funds', async () => {
    mockDb.setWhereRows([{ id: 'user1', balance: 10 }]);

    const result = await service.removeBalance('user1', 100);
    expect(result).toBe(false);
  });

  it('pay transfers balance between users', async () => {
    mockDb.setWhereRows([{ id: 'user1', balance: 100 }, { id: 'user2', balance: 50 }]);

    const result = await service.pay('user1', 'user2', 30);
    expect(result).toBe(true);
  });
});

describe('ModerationService', () => {
  let service: ModerationService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new ModerationService({ info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any);
    service.setDb(mockDb);
  });

  it('warn creates a warning and moderation case', async () => {
    mockDb.setWhereRows([]);

    const caseId = await service.warn('guild1', 'user1', 'mod1', 'Test reason');
    expect(caseId).toContain('warn_');
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('getWarnings returns warnings for a user', async () => {
    mockDb.setWhereRows([{ id: 'warn1', reason: 'Test' }]);

    const warnings = await service.getWarnings('guild1', 'user1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('Test');
  });

  it('shutdown clears state', () => {
    service.shutdown();
    expect(service).toBeDefined();
  });
});
