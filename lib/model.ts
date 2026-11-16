// The token launch radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// Every protocol that records no token (no market cap, no CoinGecko id, no symbol) is ranked by an
// implied launch value derived only from the snapshot's own figures:
//
//   implied = round( tvl_usd x category_multiple x momentum_factor x seasoning_factor )
//
// - category_multiple prices what a token for that kind of protocol usually captures against the
//   TVL it secures: fee-taking markets (DEXs, derivatives) high, pass-through plumbing (bridges,
//   yield wrappers) low. It is keyed by the snapshot's category string, never by a protocol's name.
// - momentum_factor reads change_7d, clamped to [-50, +100] per cent and answered with a
//   square-root response, so one wild week cannot rule the board: it runs 0.75 to 1.50, with
//   ordinary growth moving it most of the way. An unreported change is neutral.
// - seasoning_factor reads the days between listed_at and the snapshot's as_of: a protocol that has
//   run longer with no token has more launch pent up. 0.75 + 0.5 x min(days, 1460) / 1460, so it
//   runs 0.75 to 1.25 over four years. An unlisted date takes the middling 1.00.
//
// Nothing here reads the clock or a random source: the same snapshot always scores the same board.

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * What a launch usually captures against TVL, by the snapshot's category. Fee markets that keep a
 * spread price highest; wrappers and bridges, whose token would capture a thin toll on other
 * people's assets, price lowest. Any category not named here, and a null category, take the default.
 */
export const CATEGORY_MULTIPLES: Record<string, number> = {
  Dexs: 1.6,
  Derivatives: 1.5,
  Launchpad: 1.45,
  Chain: 1.4,
  Lending: 1.35,
  'Prediction Market': 1.3,
  CDP: 1.25,
  'CDP Manager': 1.25,
  CEX: 1.2,
  'Liquid Staking': 1.1,
  Restaking: 1.05,
  'Liquid Restaking': 1.05,
  RWA: 1.0,
  'Staking Pool': 1.0,
  'Risk Curators': 0.95,
  'Onchain Capital Allocator': 0.95,
  'Yield Aggregator': 0.9,
  Yield: 0.85,
  'Basis Trading': 0.8,
  Farm: 0.75,
  'Leveraged Farming': 0.75,
  Bridge: 0.7,
  'Canonical Bridge': 0.7,
  'Cross Chain Bridge': 0.7,
};

/** The multiple for a category the table does not name, or for no category at all. */
export const DEFAULT_MULTIPLE = 0.9;

/** The category multiple one protocol is scored with. */
export function categoryMultiple(category: string | null): number {
  if (category === null) return DEFAULT_MULTIPLE;
  return CATEGORY_MULTIPLES[category] ?? DEFAULT_MULTIPLE;
}

const DAY_MS = 86_400_000;

/** Whole days from listed_at to as_of, clamped at zero; null when the listing date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Round to 4 decimal places, so the factors the dashboard shows are the factors the value used. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The momentum factor: change_7d clamped to [-50, +100] and mapped onto 0.75..1.50 through a
 * square-root response, so an ordinary good week moves the factor most of the way and a freak spike
 * (the snapshot's largest is +4,448 per cent) saturates instead of ruling the board. Null is neutral.
 */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const t = Math.min(100, Math.max(-50, change7d)) / 100;
  const damped = t >= 0 ? Math.sqrt(t) : -0.5 * Math.sqrt(-t / 0.5);
  return round4(1 + damped * 0.5);
}

/** The seasoning factor: 0.75 for a brand-new listing, rising to 1.25 at four years; unknown age is 1.00. */
export function seasoningFactor(age: number | null): number {
  if (age === null) return 1;
  const days = Math.min(Math.max(age, 0), 1460);
  return round4(0.75 + 0.5 * (days / 1460));
}

/** One protocol's three factors and its implied launch value in whole dollars. */
export interface Scored {
  multiple: number;
  momentum: number;
  seasoning: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Score one protocol from the snapshot's figures alone. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string): Scored {
  const age = ageDays(asOf, p.listed_at);
  const multiple = categoryMultiple(p.category);
  const momentum = momentumFactor(p.change_7d);
  const seasoning = seasoningFactor(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * seasoning));
  return { multiple, momentum, seasoning, age_days: age, implied_value_usd: implied };
}

/** The farm-plan families: protocols are farmed by what they do, not by their names. */
export type FarmFamily = 'dex' | 'lending' | 'derivatives' | 'bridge' | 'yield' | 'staking' | 'launchpad' | 'other';

const FAMILY_BY_CATEGORY: Record<string, FarmFamily> = {
  Dexs: 'dex',
  Lending: 'lending',
  CDP: 'lending',
  'CDP Manager': 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  'Collateral Management': 'lending',
  Derivatives: 'derivatives',
  Options: 'derivatives',
  'Options Vault': 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  Synthetics: 'derivatives',
  Bridge: 'bridge',
  'Canonical Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  'Risk Curators': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Liquidity Manager': 'yield',
  'Basis Trading': 'yield',
  Farm: 'yield',
  'Leveraged Farming': 'yield',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  Restaking: 'staking',
  'Staking Pool': 'staking',
  'Restaked BTC': 'staking',
  'Anchor BTC': 'staking',
  'Decentralized BTC': 'staking',
  Launchpad: 'launchpad',
};

/** Which farm family a category belongs to; anything unlisted is farmed as a general position. */
export function farmFamily(category: string | null): FarmFamily {
  if (category === null) return 'other';
  return FAMILY_BY_CATEGORY[category] ?? 'other';
}

/** A rough one-transaction gas figure for a chain, in the words a plan can quote. */
const GAS_BY_CHAIN: Record<string, string> = {
  Ethereum: 'about $12 of ETH gas',
  Bitcoin: 'about $3 of BTC fees',
  Solana: 'well under $0.25 of SOL fees',
  Binance: 'about $0.30 of BNB gas',
  Arbitrum: 'about $0.40 of ETH gas',
  Base: 'about $0.40 of ETH gas',
  Optimism: 'about $0.40 of ETH gas',
  Linea: 'about $0.50 of ETH gas',
  Avalanche: 'about $0.60 of AVAX gas',
  Polygon: 'about $0.05 of POL gas',
  Tron: 'about $1 of TRX fees',
  Sui: 'about $0.05 of SUI fees',
  Sonic: 'about $0.05 of S fees',
  Berachain: 'about $0.20 of BERA gas',
  Monad: 'about $0.10 of MON gas',
  'Hyperliquid L1': 'about $0.05 of HYPE fees',
};

/** The gas phrase for a chain the table does not name. */
function gasFor(chain: string): string {
  return GAS_BY_CHAIN[chain] ?? 'about $1 of gas';
}

/** The chain a plan works on: the first the protocol names, else a neutral phrase. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position runs, scaled to the protocol's own size. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 500;
  if (tvlUsd >= 250_000_000) return 250;
  if (tvlUsd >= 50_000_000) return 150;
  if (tvlUsd >= 10_000_000) return 100;
  return 50;
}

/** How long a plan holds, from the protocol's age: younger protocols need the longer window. */
function holdFor(age: number | null): string {
  if (age === null) return 'at least 8 to 12 weeks';
  if (age < 180) return 'at least 10 weeks';
  if (age < 540) return 'at least 8 weeks';
  return 'at least 6 weeks';
}

/** The family's core position: the one action that makes a wallet count as a user of the protocol. */
function coreAction(family: FarmFamily, name: string, chain: string, capital: number): string {
  switch (family) {
    case 'dex':
      return `Provide $${capital} of liquidity, split evenly between the two sides, to the highest-volume pool on ${name} on ${chain}, and leave the position in range.`;
    case 'lending':
      return `Supply $${capital} of USDC or ETH as collateral in ${name} on ${chain}, then borrow no more than 30 percent of it so the health factor stays comfortable.`;
    case 'derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small position, no larger than the deposit, closing and reopening it once a week.`;
    case 'bridge':
      return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the far side instead of bridging straight back.`;
    case 'yield':
      return `Deposit $${capital} of USDC into the main vault or strategy on ${name} on ${chain} and keep the vault shares in the same wallet.`;
    case 'staking':
      return `Stake $${capital} of the chain's asset through ${name} on ${chain} and keep the liquid staking receipt token in the wallet that staked it.`;
    case 'launchpad':
      return `Commit $${capital} across the next two sales or allocations on ${name}, following its own participation steps for each one.`;
    default:
      return `Open a $${capital} position in ${name} on ${chain} through its main app, using the product its front page leads with, and keep the position open.`;
  }
}

/** The family's second action: a different kind of activity, so the wallet reads as a real user. */
function secondAction(family: FarmFamily, name: string, chain: string): string {
  switch (family) {
    case 'dex':
      return `Make two swaps a week through ${name}'s own interface on ${chain}, one in each direction, of $25 or more each, rather than routing through an aggregator.`;
    case 'lending':
      return `Repay a slice of the borrow and redraw it once a fortnight, so the position shows both sides of ${name}'s market and not a single deposit.`;
    case 'derivatives':
      return `Place one limit order a week alongside the market trades, so ${name} records order-book activity from the wallet as well as fills.`;
    case 'bridge':
      return `Bridge a smaller $25 amount back the other way once a month, so ${name} sees round trips spread over time rather than one pass.`;
    case 'yield':
      return `Move a quarter of the deposit into a second strategy on ${name} after the first month, so the wallet holds more than one position.`;
    case 'staking':
      return `Use the receipt token once, as collateral or in a pool the protocol itself links to, so the stake shows up in a second contract.`;
    case 'launchpad':
      return `Take part in any community or allowlist task ${name} runs between sales, and keep the same wallet for it as for the commits.`;
    default:
      return `Use one more feature of ${name} beyond the first position, a vote, a claim or a second product, so the wallet's history is not a single action.`;
  }
}

/**
 * A protocol's farm plan: five steps, each a concrete action with a cost and a timeframe, generated
 * from its category family, its main chain, its size and its age. No step is a slogan, and no two
 * families share wording for the actions that matter.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdFor(age);
  const family = farmFamily(p.category);
  return [
    `Set up one wallet for ${p.name} alone and fund it on ${chain} with the position money plus a gas float. Cost: ${gas} for the first transaction. Time: about 10 minutes, once.`,
    `${coreAction(family, p.name, chain, capital)} Cost: the $${capital} position plus ${gas}. Time: about 15 minutes to open.`,
    `${secondAction(family, p.name, chain)} Cost: ${gas} each time. Time: about 10 minutes a week.`,
    `Keep the ${p.name} position open and active for ${hold}, checking it weekly and claiming rewards only from links on the protocol's own pages. Cost: no fee to check, and never pay anyone to claim. Time: 5 minutes a week.`,
    `Log every transaction hash, date and amount in a farm diary from day one, so the position can be unwound or repeated wallet by wallet. Cost: nothing. Time: 5 minutes after each action.`,
  ];
}

/** One row of the board: the gate's five fields, plus every detail the dashboard shows. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum: number;
  seasoning: number;
  ratio: number;
  watchlist: boolean;
}

/**
 * The ranked board: every protocol that records no token, scored and ordered by implied value,
 * highest first, ties broken by slug so the order never depends on input order. Ranks run 1..N and
 * implied values never rise as rank ascends, by construction.
 */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(recordsNoToken)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of) }));
  scored.sort((a, b) => b.s.implied_value_usd - a.s.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmSteps(p, s.age_days),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age_days,
    multiple: s.multiple,
    momentum: s.momentum,
    seasoning: s.seasoning,
    ratio: Math.round((s.implied_value_usd / p.tvl_usd) * 1000) / 1000,
    watchlist: watch.has(p.slug),
  }));
}

/** The headline figures the dashboard's summary strip shows. */
export interface RadarStats {
  as_of: string;
  floor_usd: number;
  protocols_total: number;
  ranked: number;
  tokenized_excluded: number;
  watchlist_size: number;
  watchlist_ranked: number;
  categories: number;
  chains: number;
  board_tvl_usd: number;
  board_implied_usd: number;
}

/** Everything the dashboard renders: the ranked rows and the summary figures behind them. */
export interface RadarData {
  stats: RadarStats;
  rows: BoardRow[];
}

/** Build the dashboard's dataset from the snapshot and its board. */
export function buildRadarData(snapshot: Snapshot, board: BoardRow[]): RadarData {
  const cats = new Set<string>();
  const chains = new Set<string>();
  for (const r of board) {
    if (r.category !== null) cats.add(r.category);
    for (const c of r.chains) chains.add(c);
  }
  return {
    stats: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocols_total: snapshot.protocols.length,
      ranked: board.length,
      tokenized_excluded: snapshot.protocols.length - board.length,
      watchlist_size: snapshot.watchlist.length,
      watchlist_ranked: board.filter((r) => r.watchlist).length,
      categories: cats.size,
      chains: chains.size,
      board_tvl_usd: board.reduce((n, r) => n + r.tvl_usd, 0),
      board_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    },
    rows: board,
  };
}

/** The data.js the dashboard loads: one assignment, no fetch and no network. */
export function dataScript(data: RadarData): string {
  return `window.RADAR_DATA=${JSON.stringify(data)};\n`;
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json carries no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json carries no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json carries no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json carries no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json carries no watchlist of slugs');
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

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}
