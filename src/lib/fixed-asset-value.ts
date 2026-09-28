/**
 * Consumable fixed assets (Pooyan's decision): valued at quantity × unit cost, where purchasePrice is the unit
 * cost. A later receipt adds to the asset: the quantity grows and the unit cost becomes the weighted average,
 * so no earlier unit is revalued at the new price. Plain functions, no server imports.
 */

type Consumable = { quantity?: number | null; purchasePrice: unknown };

export function consumableValue(asset: Consumable): number {
  return (asset.quantity ?? 0) * Number(asset.purchasePrice);
}

/** The asset after `quantity` more units arrive at `unitCost` each. */
export function addToConsumable(asset: Consumable, quantity: number, unitCost: number) {
  const before = asset.quantity ?? 0;
  const total = before + quantity;
  const value = consumableValue(asset) + quantity * unitCost;
  return { quantity: total, unitCost: total > 0 ? value / total : unitCost, value };
}
