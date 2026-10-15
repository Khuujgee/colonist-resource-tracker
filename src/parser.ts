import { COSTS, RESOURCES, type Cards, type GameEvent, type Resource } from './types';

/**
 * colonist.io class names carry a build hash suffix (e.g. "feedMessage-O8TLknGe"),
 * so match on the stable prefix.
 */
export const SELECTORS = {
  /** Holds the game log and, inside it, the chat. */
  logContainer: '[class*="gameFeedsContainer-"]',
  /** One line; data-index = its position in its own list (log and chat number separately). */
  logEntry: '[data-index]',
  /** The chat list, which sits inside logContainer and must be skipped. */
  chat: '[class*="chatContainer-"]',
  /** A chat line's "Name:" button. */
  chatAuthor: '[class*="username-"]',
  avatar: '[class*="avatar-"]',
  /** The local player's name in their own player panel. */
  localPlayer: '[class*="currentUser-"] [class*="usernameLarge-"]',
} as const;

/**
 * A log line is reduced to a template: player names become "@", each run of
 * resource cards becomes "#", other icons become "[alt]", text is kept.
 * e.g. "Bob gave bank 🐑🐑🐑 and took 🧱" → "@ gave bank # and took #".
 * The local player appears as plain text "You" / "you".
 */
interface Line {
  template: string;
  names: string[];
  groups: Cards[];
}

type Rule = { match: RegExp; events: (l: Line, m: RegExpMatchArray, me: string) => GameEvent[] };

const BUILDS: Record<string, Cards> = {
  Road: COSTS.road,
  Settlement: COSTS.settlement,
  City: COSTS.city,
};

/** The single resource in a one-card group. */
const one = (g: Cards): Resource => Object.keys(g)[0] as Resource;

const RULES: Rule[] = [
  { match: /^@ got #$/, events: (l) => [{ kind: 'gain', player: l.names[0], cards: l.groups[0] }] },
  {
    match: /^@ received starting resources #$/,
    events: (l) => [{ kind: 'gain', player: l.names[0], cards: l.groups[0] }],
  },
  { match: /^@ discarded #$/, events: (l) => [{ kind: 'spend', player: l.names[0], cards: l.groups[0] }] },
  {
    match: /^@ built a (Road|Settlement|City)\b/,
    events: (l, m) => [{ kind: 'spend', player: l.names[0], cards: BUILDS[m[1]] }],
  },
  {
    match: /^@ bought \[Development Card\]$/,
    events: (l) => [{ kind: 'spend', player: l.names[0], cards: COSTS.devCard }],
  },
  {
    match: /^@ gave bank # and took #$/,
    events: (l) => [{ kind: 'bankTrade', player: l.names[0], give: l.groups[0], get: l.groups[1] }],
  },
  {
    match: /^@ gave # and got # from @$/,
    events: (l) => [{ kind: 'trade', a: l.names[0], b: l.names[1], aGives: l.groups[0], bGives: l.groups[1] }],
  },
  {
    match: /^@ stole \[Resource Card\] from @$/,
    events: (l) => [{ kind: 'steal', thief: l.names[0], victim: l.names[1], resource: null }],
  },
  {
    match: /^@ stole # from you$/,
    events: (l, _m, me) => [{ kind: 'steal', thief: l.names[0], victim: me, resource: one(l.groups[0]) }],
  },
  {
    match: /^You stole # from @$/,
    events: (l, _m, me) => [{ kind: 'steal', thief: me, victim: l.names[0], resource: one(l.groups[0]) }],
  },
  // Not yet seen in a real log; best guesses at colonist.io's wording.
  {
    match: /^@ took from bank #$/,
    events: (l) => [{ kind: 'gain', player: l.names[0], cards: l.groups[0] }],
  },
  {
    match: /^@ stole (\d+) #$/,
    events: (l, m) => [{ kind: 'monopoly', player: l.names[0], resource: one(l.groups[0]), count: Number(m[1]) }],
  },
];

/** Lines that are understood and have no effect on hands. */
const NOOPS: RegExp[] = [
  /^$/, // turn separator (<hr>)
  /^Happy settling!/,
  /^@ rolled\b/,
  /^@ placed a\b/,
  /^@ wants to give\b/,
  /^@ moved Robber\b/,
  /\bis blocked by the Robber\b/,
  /^@ used\b/,
  /^@ received (Longest Road|Largest Army)\b/,
  /^Longest Road\b.*\bpassed from @ to @/,
  /^Largest Army\b.*\bpassed from @ to @/,
  /\bhas (dis|re)connected\b/,
];

/** The local player's name as shown in their own player panel, if present. */
export function findLocalPlayer(doc: Document): string | undefined {
  return doc.querySelector(SELECTORS.localPlayer)?.textContent?.trim() || undefined;
}

/** "You" in the log is the local player; without a known name it stays "You". */
export function parseEntry(el: Element, localPlayer = 'You'): GameEvent[] {
  const line = readLine(el, localPlayer);
  if (!line) return [];
  for (const rule of RULES) {
    const m = line.template.match(rule.match);
    if (m) return rule.events(line, m, localPlayer);
  }
  return [];
}

export function isKnownNoop(el: Element): boolean {
  if (isChat(el)) return true;
  const line = readLine(el);
  return !!line && NOOPS.some((re) => re.test(line.template));
}

/** The line's template, for diagnostics. */
export function describeEntry(el: Element): string {
  return readLine(el)?.template ?? '(chat)';
}

export function entryPlayerColors(el: Element): Record<string, string> {
  const colors: Record<string, string> = {};
  if (isChat(el)) return colors;
  for (const span of el.querySelectorAll<HTMLElement>('span')) {
    if (isName(span) && span.style.color) colors[span.textContent!.trim()] = nameColor(span);
  }
  return colors;
}

function isChat(el: Element): boolean {
  return !!el.querySelector(SELECTORS.chatAuthor);
}

function readLine(el: Element, localPlayer = 'You'): Line | null {
  if (isChat(el)) return null;
  const parts: string[] = [];
  const names: string[] = [];
  const groups: Cards[] = [];
  let inGroup = false;

  const text = (t: string) => {
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return;
    parts.push(t);
    inGroup = false;
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) return text(node.textContent!);
    if (!(node instanceof Element)) return;
    if (node.matches(SELECTORS.avatar)) return;
    if (node.tagName === 'IMG') {
      const img = node as HTMLImageElement;
      const r = resourceOf(img);
      if (!r) {
        if (img.alt && !/^bot$/i.test(img.alt)) text(`[${img.alt}]`);
        return;
      }
      if (!inGroup) {
        groups.push({});
        parts.push('#');
        inGroup = true;
      }
      const g = groups[groups.length - 1];
      g[r] = (g[r] ?? 0) + 1;
      return;
    }
    if (node instanceof HTMLElement && isName(node)) {
      const n = node.textContent!.trim();
      names.push(n === 'You' ? localPlayer : n);
      parts.push('@');
      inGroup = false;
      return;
    }
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
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
