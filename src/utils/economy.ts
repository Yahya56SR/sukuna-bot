import { User, type IUser } from '../db/models/User.js';

/**
 * Shared economy primitives.
 *
 * Every money movement here is a single atomic update. The commands used to
 * read a balance, mutate it in memory and `save()` the whole document, so two
 * commands landing together (a casino bet plus a `/daily` claim, for example)
 * silently dropped one of the two writes — and a balance check followed ~20
 * lines later by the debit let a member wager more than they owned.
 */

/** Coins are whole numbers; formatting is repeated across every command. */
export function formatCoins(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  return safe.toLocaleString();
}

/** Fetch-or-create a member's economy row (atomic upsert). */
export async function getEconomyUser(userId: string): Promise<IUser> {
  const user = await User.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return user!;
}

/**
 * Add a signed amount to a wallet, never letting it drop below zero.
 * Returns the resulting balance.
 */
export async function adjustBalance(userId: string, delta: number): Promise<number> {
  const change = Math.trunc(Number.isFinite(delta) ? delta : 0);
  if (change === 0) return (await getEconomyUser(userId)).balance;

  const doc = await User.findOneAndUpdate(
    { userId },
    { $inc: { balance: change }, $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const balance = Math.max(0, Math.floor(doc!.balance ?? 0));
  if (balance !== doc!.balance) {
    // An incoming negative push would otherwise leave a negative wallet.
    await User.updateOne({ userId, balance: doc!.balance }, { $set: { balance } });
  }
  return balance;
}

/**
 * Settle a wager in one atomic step: the wallet must still cover `bet` when the
 * update runs, then the net result is applied. No check-then-debit window, and
 * the balance can never go negative.
 *
 * Returns the new balance, or `null` when the wallet could not cover the bet.
 */
export async function settleWager(
  userId: string,
  bet: number,
  winnings: number,
): Promise<number | null> {
  const stake = Math.max(0, Math.trunc(bet));
  const payout = Math.max(0, Math.trunc(winnings));
  const net = payout - stake;

  const doc = await User.findOneAndUpdate(
    { userId, balance: { $gte: stake } },
    { $inc: { balance: net } },
    { new: true },
  );

  return doc ? Math.max(0, Math.floor(doc.balance)) : null;
}

export type TransferResult =
  | { ok: true; fromBalance: number }
  | { ok: false; reason: 'self' | 'bot' | 'funds' };

/**
 * Move coins between two members. The debit is conditional, and a failed credit
 * refunds the debit so money cannot disappear between the two writes.
 */
export async function transferCoins(
  fromId: string,
  toId: string,
  amount: number,
): Promise<TransferResult> {
  if (fromId === toId) return { ok: false, reason: 'self' };

  const value = Math.max(0, Math.trunc(amount));
  if (value === 0) return { ok: false, reason: 'funds' };

  const debit = await User.updateOne(
    { userId: fromId, balance: { $gte: value } },
    { $inc: { balance: -value } },
  );
  if (debit.modifiedCount !== 1) return { ok: false, reason: 'funds' };

  try {
    await User.updateOne(
      { userId: toId },
      { $inc: { balance: value }, $setOnInsert: { userId: toId } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    await User.updateOne({ userId: fromId }, { $inc: { balance: value } }).catch(() => undefined);
    throw error;
  }

  const sender = await User.findOne({ userId: fromId }).lean();
  return { ok: true, fromBalance: Math.max(0, Math.floor(sender?.balance ?? 0)) };
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export interface InventoryEntry {
  itemId: string;
  quantity: number;
}

function readInventory(doc: { inventory?: InventoryEntry[] | null } | null | undefined): InventoryEntry[] {
  return Array.isArray(doc?.inventory) ? doc.inventory : [];
}

export function hasItem(
  doc: { inventory?: InventoryEntry[] | null },
  itemId: string,
): boolean {
  return readInventory(doc).some((entry) => entry.itemId === itemId);
}

export function itemCount(
  doc: { inventory?: InventoryEntry[] | null },
  itemId: string,
): number {
  return readInventory(doc).find((entry) => entry.itemId === itemId)?.quantity ?? 0;
}

/** Atomically add (or remove, when `delta` is negative) one inventory slot. */
export async function addItem(
  userId: string,
  itemId: string,
  delta = 1,
): Promise<InventoryEntry[]> {
  const change = Math.trunc(delta);
  await getEconomyUser(userId);

  if (change > 0) {
    // Insert a new slot, or bump the existing one — never both.
    const inserted = await User.updateOne(
      { userId, 'inventory.itemId': { $ne: itemId } },
      { $push: { inventory: { itemId, quantity: change } } },
    );
    if (inserted.matchedCount === 0) {
      await User.updateOne(
        { userId, 'inventory.itemId': itemId },
        { $inc: { 'inventory.$.quantity': change } },
      );
    }
  } else if (change < 0) {
    await User.updateOne(
      { userId, 'inventory.itemId': itemId },
      { $inc: { 'inventory.$.quantity': change } },
    );
    // Drop exhausted slots so they do not linger at zero.
    await User.updateOne(
      { userId, 'inventory.itemId': itemId, 'inventory.quantity': { $lte: 0 } },
      { $pull: { inventory: { itemId } } },
    );
  }

  const fresh = await User.findOne({ userId }).lean();
  return readInventory(fresh);
}
