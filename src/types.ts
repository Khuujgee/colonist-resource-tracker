export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Cards = Partial<Record<Resource, number>>;

export const COSTS: Record<'road' | 'settlement' | 'city' | 'devCard', Cards> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  devCard: { wool: 1, grain: 1, ore: 1 },
};

export type GameEvent =
  | { kind: 'gain'; player: string; cards: Cards }
  | { kind: 'spend'; player: string; cards: Cards }
  | { kind: 'bankTrade'; player: string; give: Cards; get: Cards }
  | { kind: 'trade'; a: string; b: string; aGives: Cards; bGives: Cards }
  | { kind: 'steal'; thief: string; victim: string; resource: Resource | null }
  | { kind: 'monopoly'; player: string; resource: Resource; count: number };

export interface HandView {
  player: string;
  total: number;
  certain: Record<Resource, number>;
  unknown: number;
  /** Resources the unknown cards could be, in RESOURCES order. */
  possible: Resource[];
}
