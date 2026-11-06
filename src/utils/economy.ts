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

  // Single aggregation-pipeline update: clamp at zero in the same atomic step
  // so a negative balance is never visible and never persists if we crash
  // between two writes (the old $inc-then-clamp was two round trips).
  // Defaults for the rest of the row are seeded in-pipeline so an upsert
  // creates a complete document (setDefaultsOnInsert does not apply to
  // pipeline updates in the same way).
  const doc = await User.findOneAndUpdate(
    { userId },
    [
      {
        $set: {
          balance: {
            $max: [0, { $add: [{ $ifNull: ['$balance', 0] }, change] }],
          },
          userId: { $ifNull: ['$userId', userId] },
          bank: { $ifNull: ['$bank', 0] },
          bankLimit: { $ifNull: ['$bankLimit', 0] },
        },
      },
    ],
    { upsert: true, new: true },
  );

  return Math.max(0, Math.floor(doc!.balance ?? 0));
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
  // Reject non-finite / non-positive stakes explicitly: clamping a negative
  // bet to 0 previously turned `settleWager(id, -1000, 500)` into a free
  // payout of 500, and NaN propagated into a `$inc: { balance: NaN }`.
  if (!Number.isFinite(bet) || !Number.isFinite(winnings)) return null;
  const stake = Math.trunc(bet);
  if (stake < 1) return null;
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
  return readInventory(doc).some((entry) => entry.itemId === itemId && entry.quantity > 0);
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
    // Guard against underflow: only decrement when the slot has enough.
    // Without this, `addItem(id, -5)` with qty 1 drove quantity to -4.
    await User.updateOne(
      { userId, 'inventory.itemId': itemId, 'inventory.quantity': { $gte: -change } },
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
