import { COSTS, RESOURCES, type Cards, type GameEvent, type Resource } from './types';

/**
 * colonist.io class names carry a build hash suffix (e.g. "feedMessage-O8TLknGe"),
 * so match on the stable prefix.
 */
export const SELECTORS = {
  /** The game log (not chat). It is a virtual list: only on-screen lines are in the DOM. */
  logContainer: '[class*="gameFeedsContainer-"]',
  /** One log line; carries data-index = its position in the whole log. */
  logEntry: '[data-index]',
  message: '[class*="messagePart-"]',
} as const;

/**
 * A log line is reduced to a template: player names become "@", each run of
 * resource cards becomes "#", other icons are dropped, text is kept.
 * e.g. "Bob gave bank 🐑🐑🐑 and took 🧱" → "@ gave bank # and took #".
 */
interface Line {
  template: string;
  names: string[];
  groups: Cards[];
}

type Rule = { match: RegExp; events: (l: Line, m: RegExpMatchArray) => GameEvent[] };

const BUILDS: Record<string, Cards> = {
  Road: COSTS.road,
  Settlement: COSTS.settlement,
  City: COSTS.city,
};

const RULES: Rule[] = [
  { match: /^@ got #$/, events: (l) => [{ kind: 'gain', player: l.names[0], cards: l.groups[0] }] },
  {
    match: /^@ gave bank # and took #$/,
    events: (l) => [{ kind: 'bankTrade', player: l.names[0], give: l.groups[0], get: l.groups[1] }],
  },
  {
    match: /^@ built a (Road|Settlement|City)$/,
    events: (l, m) => [{ kind: 'spend', player: l.names[0], cards: BUILDS[m[1]] }],
  },
];

/** Lines that are understood and have no effect on hands. */
const NOOPS: RegExp[] = [/^Longest Road passed from @ to @/];

export function parseEntry(el: Element, localPlayer?: string): GameEvent[] {
  const line = readLine(el, localPlayer);
  if (!line) return [];
  for (const rule of RULES) {
    const m = line.template.match(rule.match);
    if (m) return rule.events(line, m);
  }
  return [];
}

export function isKnownNoop(el: Element): boolean {
  const line = readLine(el);
  return !!line && NOOPS.some((re) => re.test(line.template));
}

export function entryPlayerColors(el: Element): Record<string, string> {
  const colors: Record<string, string> = {};
  const msg = el.querySelector(SELECTORS.message);
  if (!msg) return colors;
  for (const span of msg.querySelectorAll<HTMLElement>('span')) {
    if (isName(span) && span.style.color) colors[span.textContent!.trim()] = nameColor(span);
  }
  return colors;
}

function readLine(el: Element, localPlayer?: string): Line | null {
  const msg = el.querySelector(SELECTORS.message);
  if (!msg) return null;
  const parts: string[] = [];
  const names: string[] = [];
  const groups: Cards[] = [];
  let inGroup = false;

  for (const node of msg.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent!.trim();
      if (text) {
        parts.push(text);
        inGroup = false;
      }
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    if (node.tagName === 'IMG') {
      const r = resourceOf(node as HTMLImageElement);
      if (!r) continue;
      if (!inGroup) {
        groups.push({});
        parts.push('#');
        inGroup = true;
      }
      const g = groups[groups.length - 1];
      g[r] = (g[r] ?? 0) + 1;
      continue;
    }
    if (isName(node)) {
      const n = node.textContent!.trim();
      names.push(n === 'You' && localPlayer ? localPlayer : n);
      parts.push('@');
      inGroup = false;
      continue;
    }
    const text = node.textContent!.trim();
    if (text) {
      parts.push(text);
      inGroup = false;
    }
  }
  return { template: parts.join(' '), names, groups };
}

/** Player names are bold, coloured inline spans. */
function isName(el: HTMLElement): boolean {
  return el.tagName === 'SPAN' && /font-weight:\s*600/.test(el.getAttribute('style') ?? '');
}

/** The colour exactly as written in the markup (e.g. "#228103"). */
function nameColor(span: HTMLElement): string {
  const m = (span.getAttribute('style') ?? '').match(/color:\s*([^;]+)/);
  return m ? m[1].trim() : span.style.color;
}

function resourceOf(img: HTMLImageElement): Resource | null {
  const src = img.getAttribute('src') ?? '';
  const fromSrc = src.match(/card_([a-z]+)\./)?.[1];
  const candidate = (fromSrc ?? img.alt ?? '').toLowerCase();
  return (RESOURCES as readonly string[]).includes(candidate) ? (candidate as Resource) : null;
}
