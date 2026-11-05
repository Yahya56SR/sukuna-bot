export type ShopItemKind = 'consumable' | 'permanent';

export interface ShopItem {
  /** Stable identifier stored in the member's inventory. */
  id: string;
  name: string;
  emoji: string;
  description: string;
  price: number;
  /**
   * `consumable` items are consumed by `/use`; `permanent` items are kept as a
   * one-time unlock no matter how many times they are bought.
   */
  kind: ShopItemKind;
}

/**
 * The purchasable catalogue.
 *
 * Coins previously had no sink at all — `/shop` rendered a hardcoded list,
 * `/buy` did not exist, and `/inventory` ignored the database — so balances
 * only ever grew. Every item here does something real when used.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: 'xp_potion',
    name: 'XP Potion',
    emoji: '🧪',
    description: 'Down it for an instant 1,000 XP.',
    price: 2_500,
    kind: 'consumable',
  },
  {
    id: 'coin_pouch',
    name: 'Coin Pouch',
    emoji: '🧧',
    description: 'Crack it open for somewhere between 500 and 2,000 coins.',
    price: 1_200,
    kind: 'consumable',
  },
  {
    id: 'streak_freeze',
    name: 'Streak Freeze',
    emoji: '🧊',
    description: 'Protects your daily streak across one missed day.',
    price: 3_000,
    kind: 'consumable',
  },
  {
    id: 'lucky_clover',
    name: 'Lucky Clover',
    emoji: '🍀',
    description: 'A charm that softens your next casino loss by half.',
    price: 4_000,
    kind: 'consumable',
  },
  {
    id: 'gold_plated_card',
    name: 'Gold-Plated Card',
    emoji: '💳',
    description: 'A permanent keepsake shown on your /balance.',
    price: 7_500,
    kind: 'permanent',
  },
  {
    id: 'veteran_badge',
    name: 'Veteran Badge',
    emoji: '🎖️',
    description: 'A permanent mark of a well-stocked wallet.',
    price: 15_000,
    kind: 'permanent',
  },
];

const BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));

/** Look an item up by id, exact name, or case-insensitive name prefix. */
export function findShopItem(idOrName: string): ShopItem | undefined {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    BY_ID.get(needle) ??
    SHOP_ITEMS.find((item) => item.name.toLowerCase() === needle) ??
    SHOP_ITEMS.find((item) => item.name.toLowerCase().startsWith(needle))
  );
}

/** Choice list for slash-command option choices. */
export function shopItemChoices(): { name: string; value: string }[] {
  return SHOP_ITEMS.map((item) => ({
    name: `${item.emoji} ${item.name} — ${item.price.toLocaleString()}`,
    value: item.id,
  }));
}
