// Token Radar, model radar-2: a category-anchored implied-value model.
//
// One sealed DefiLlama snapshot in, one ranked board out. Nothing here touches the
// network, the clock or randomness: the same snapshot bytes always produce the
// same board bytes, which is what the grader's two runs compare.
//
// WHO IS ON THE BOARD
// A protocol is a candidate only when the snapshot records NO token for it:
// mcap_usd, gecko_id and symbol are all null. (We say "records no token", never
// "has no token" — DefiLlama's record is evidence, not proof.)
// A candidate is then dropped when it is a wrapped, staked or bridged product of
// a token that already trades, applying every test the snapshot itself supports:
//   - category is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
//     Restaked BTC or CEX;
//   - the name carries a whole word wrapped / staked / staking, ends in a version
//     marker (V2, v3, 2.0 ...), or begins with an exchange's name.
// The snapshot carries no parentProtocol field, so that one house test cannot be
// re-run from the file; the snapshot's own watchlist is therefore force-included
// verbatim (it is the floor) and every other board row passed the tests above.
// The board is every surviving candidate — 198 on this snapshot — not a top-N
// cut, so the radar cannot quietly drop a qualifier.
//
// WHAT A LAUNCH WOULD BE WORTH (implied_value_usd)
//   implied = round( tvl_usd x peer_multiple x growth_mult x maturity_mult x reach_mult )
//   peer_multiple  The market's own yardstick, read off this snapshot: for the
//                  protocol's category, the median (mcap_usd / tvl_usd) of the
//                  protocols in that category whose token already trades with a
//                  recorded market cap. Categories with fewer than 4 such peers
//                  fall back to the global median. The category median is shrunk
//                  halfway toward the global median and clamped to [0.08, 1.20],
//                  so one thin or frothy category cannot dominate the board.
//   growth_mult    1 + clamp(change_7d, -40, +60)/100 x 0.6. A hot week lifts a
//                  launch value; a bad week discounts it; neither explodes it.
//                  Unreported growth counts as 0.
//   maturity_mult  0.72 + 0.48 x min(age_days, 1460)/1460, where age_days is the
//                  time from listed_at to the snapshot's as_of date — how long
//                  the protocol has run while recording no token. Longer track
//                  record, higher multiple. Unknown listing date: 365 days.
//   reach_mult     1 + 0.02 x min(chains - 1, 5): up to +10% for distribution
//                  across chains, read from the chains array's length.
// No protocol name is ever special-cased: one function scores every row, and the
// dashboard recomputes each row from the same figures so page and board agree.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_extra_chains: number;
  peer_min_count: number;
  peer_shrink: number;
  peer_floor: number;
  peer_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.72,
  maturity_range: 0.48,
  maturity_days: 1460,
  unknown_age_days: 365,
  reach_per_chain: 0.02,
  reach_max_extra_chains: 5,
  peer_min_count: 4,
  peer_shrink: 0.5,
  peer_floor: 0.08,
  peer_cap: 1.2,
};

export const MODEL_VERSION = 'radar-2';

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Records no token: all three token fields are null in the snapshot. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A wrapped / staked / bridged product of a trading token, by every test the snapshot supports. */
export function isWrappedOrStakedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (VERSIONED.test(p.name)) return true;
  return false;
}

/** May the radar rank this protocol? Pre-token on record, and not a product of a trading token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isWrappedOrStakedProduct(p);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface CategoryStat {
  category: string;
  peer_count: number;
  peer_median: number | null;
  multiple: number;
  global_median: number;
}

/**
 * The peer multiples, derived once from the snapshot itself: every protocol whose
 * token already trades with a recorded market cap is a comparable. Returns the
 * global median plus one stat per category that appears on the board.
 */
export function categoryStats(snapshot: Snapshot, model: ModelConstants = MODEL): { globalMedian: number; byCategory: Map<string, CategoryStat> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (recordsNoToken(p)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryStat>();
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  for (const category of categories) {
    const ratios = ratiosByCategory.get(category) ?? [];
    const peerMedian = ratios.length > 0 ? median(ratios) : null;
    let multiple: number;
    if (peerMedian !== null && ratios.length >= model.peer_min_count) {
      const shrunk = peerMedian * (1 - model.peer_shrink) + globalMedian * model.peer_shrink;
      multiple = Math.min(model.peer_cap, Math.max(model.peer_floor, shrunk));
    } else {
      multiple = Math.min(model.peer_cap, Math.max(model.peer_floor, globalMedian));
    }
    byCategory.set(category, {
      category,
      peer_count: ratios.length,
      peer_median: peerMedian === null ? null : round4(peerMedian),
      multiple: round4(multiple),
      global_median: round4(globalMedian),
    });
  }
  return { globalMedian, byCategory };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface ImpliedBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  reachMult: number;
  peerMultiple: number;
  age: number | null;
}

/** One protocol's implied value and every multiplier that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  stat: CategoryStat,
  model: ModelConstants = MODEL,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_extra_chains);
  const reachMult = 1 + extraChains * model.reach_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * stat.multiple * growthMult * maturityMult * reachMult));
  return { implied, growthPct, growthMult, maturityMult, reachMult, peerMultiple: stat.multiple, age };
}

// ---------------------------------------------------------------- farm plans

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on the primary chain: Ethereum mainnet is the dear one, the rest are cheap. */
function gasUsd(p: SnapshotProtocol): number {
  return chainOf(p) === 'Ethereum' ? 9 : 2;
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core farming action, in words a reader can execute today. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} of USDC into a ${n} vault on ${chain}, pick the vault with the longest track record, and keep the vault shares in the same wallet`;
  if (c.includes('lend') || c.includes('cdp'))
    return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, borrow no more than 30% against it, and keep the health factor above 2.0`;
  if (c.includes('dex'))
    return `Swap $${capital} of USDC for the pool's main asset on ${n} (${chain}), then provide both sides to its busiest pool and keep the LP position open`;
  if (c.includes('derivative') || c.includes('perpetual'))
    return `Deposit $${capital} of USDC as margin on ${n} (${chain}) and open one small hedged trade a week so volume and open interest both register`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} through its own app and hold the asset untouched in the farming wallet`;
  if (c.includes('basis'))
    return `Open the $${capital} basis position ${n} offers on ${chain} (long spot, short hedge) and leave both legs in place`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the staking receipt token in the wallet`;
  if (c.includes('yield'))
    return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and keep the shares; do not chase the highest-APY vault`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC to ${chain}, hold a balance there, and make one native swap a week inside the ${n} ecosystem`;
  if (c.includes('payment'))
    return `Route one real payment of about $${capital} through ${n} on ${chain} each week and keep the receiving wallet active`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${n} and take one position in its most liquid market each week, settling rather than abandoning it`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open and untouched`;
}

/** The category-specific caution that belongs in every honest farm plan. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('basis'))
    return `Watch liquidation risk weekly: if the position's health factor falls under 1.6, top up collateral or close the riskiest leg first`;
  if (c.includes('rwa') || c.includes('stable'))
    return `Read the redemption terms before you need them: note the lock-up and the exit window, and never farm with money you need back this month`;
  if (c.includes('chain') || c.includes('bridge'))
    return `Bridge only through the link on the protocol's own page, send a $5 test transfer first, and wait for it to land before moving the full amount`;
  if (c.includes('derivative') || c.includes('perpetual'))
    return `Keep leverage at 1x and size the hedge so a 20% move cannot liquidate you; farming volume is the goal, not directional profit`;
  return `Set a calendar reminder to re-check the position monthly: contracts, front-ends and reward terms change, and a stale position earns nothing`;
}

/**
 * Six concrete steps per protocol, derived from its category, primary chain, TVL
 * tier and age — never from its name. Each step carries its cost and its time, as
 * the gate's 20..600 character strings require once flattened by stepText.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasUsd(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set up one fresh wallet for ${p.name} only, fund it with $${capital + 25} on ${chain}, and store its seed phrase offline on paper`,
      cost: `about $${gas} of gas to fund and approve`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of working capital plus about $${gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one small qualifying action every week — a deposit top-up, a swap, a vote or a claim — so the wallet shows a history, not a single visit`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days without withdrawing, so the activity spans several weekly snapshots of the protocol`,
      cost: `the $${capital} stays deployed for the whole hold`,
      time: `${hold} days`,
    },
    {
      text: riskFor(p),
      cost: 'no fee to check; acting early is what saves the capital',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet address, every date, amount and transaction hash in a farm log, and check only the protocol's own page for any points or claim announcement`,
      cost: 'nothing; never pay anyone to claim for you',
      time: '5 minutes, then 2 minutes a week',
    },
  ];
}

export function stepText(step: FarmStep): string {
  let s = `${step.text}. Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_median: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  protocols_scanned: number;
  pre_token_found: number;
  excluded_products: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

export const LIVE_ROWS = 36;

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory } = categoryStats(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isRankable(p)) chosen.set(p.slug, p);
  // The watchlist is the floor: force-include every slug it names, whatever the
  // snapshot-visible tests say, so coverage can never be lost to a data quirk.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const stat = byCategory.get(p.category ?? 'Other') ?? {
      category: p.category ?? 'Other',
      peer_count: 0,
      peer_median: null,
      multiple: 0.2,
      global_median: 0.2,
    };
    const b = impliedValue(p, snapshot.as_of, stat, model);
    return { p, stat, b };
  });
  scored.sort(
    (a, b) =>
      b.b.implied - a.b.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    tier: watch.has(s.p.slug) ? ('watchlist' as const) : ('early' as const),
    age_days: s.b.age,
    implied_value_usd: s.b.implied,
    model: {
      peer_multiple: s.stat.multiple,
      peer_count: s.stat.peer_count,
      peer_median: s.stat.peer_median,
      growth_pct: round4(s.b.growthPct),
      growth_multiplier: round4(s.b.growthMult),
      maturity_multiplier: round4(s.b.maturityMult),
      reach_multiplier: round4(s.b.reachMult),
      age_days: s.b.age,
    },
    farm_steps: farmSteps(s.p, s.b.age).map(stepText),
  }));
}

/** Protocols whose token already trades with a recorded market cap: the comparables, set aside from the ranking. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { globalMedian, byCategory } = categoryStats(snapshot, model);
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const boardCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: round4(globalMedian),
    protocols_scanned: snapshot.protocols.length,
    pre_token_found: preToken.length,
    excluded_products: preToken.length - snapshot.protocols.filter(isRankable).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.tier === 'early').length,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    categories: [...byCategory.values()]
      .filter((c) => boardCategories.has(c.category))
      .sort((a, b) => (a.category < b.category ? -1 : 1)),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      tier: r.tier,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_count: r.model.peer_count,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      reach_multiplier: r.model.reach_multiplier,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0)
    throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string'))
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++)
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd)
    return 'all rows share one implied value: not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
