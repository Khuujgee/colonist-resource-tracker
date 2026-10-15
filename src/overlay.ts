import { RESOURCES, type HandView, type Resource } from './types';

export interface OverlayState {
  views: HandView[];
  colors: Record<string, string>;
  outOfSync: boolean;
  overLimit: boolean;
  /** Diagnostic text shown under the out-of-sync warning. */
  detail?: string;
}

const EMOJI: Record<Resource, string> = {
  brick: '🧱',
  lumber: '🌲',
  wool: '🐑',
  grain: '🌾',
  ore: '🪨',
};

const STORAGE_KEY = 'overlayPos';

const STYLE = `
  .box { position: fixed; z-index: 2147483647; min-width: 220px; max-width: 420px;
    background: rgba(20, 22, 28, 0.92); color: #eee; border-radius: 8px;
    font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  .header { display: flex; align-items: center; gap: 6px; padding: 4px 8px;
    cursor: move; user-select: none; border-bottom: 1px solid rgba(255,255,255,.12); }
  .title { flex: 1; font-weight: 600; }
  button { background: none; border: 1px solid rgba(255,255,255,.25); color: inherit;
    border-radius: 4px; font: inherit; padding: 0 6px; cursor: pointer; }
  .body { padding: 6px 8px; }
  .collapsed .body { display: none; }
  [data-row] { white-space: nowrap; }
  [data-warning] { color: #ffb347; font-size: 12px; }
`;

/** One player's row, e.g. "Alice (7)  🧱1 🐑1 🌾2  + 3 of {🌲, 🪨}". */
export function formatRow(v: HandView): string {
  let s = `${v.player} (${v.total})`;
  const cards = RESOURCES.filter((r) => v.certain[r] > 0)
    .map((r) => `${EMOJI[r]}${v.certain[r]}`)
    .join(' ');
  if (cards) s += `  ${cards}`;
  if (v.unknown > 0) s += `  + ${v.unknown} of {${v.possible.map((r) => EMOJI[r]).join(', ')}}`;
  return s;
}

export class Overlay {
  private host = document.createElement('div');
  private box!: HTMLDivElement;
  private body!: HTMLDivElement;

  constructor(private readonly onReset: () => void) {}

  mount(parent: HTMLElement = document.body): void {
    const root = this.host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="box" style="top: 80px; right: 16px;">
        <div class="header">
          <span class="title">Resources</span>
          <button data-action="reset" title="Forget everything and start over">Reset</button>
          <button data-action="collapse" title="Collapse">–</button>
        </div>
        <div class="body"></div>
      </div>`;
    this.box = root.querySelector('.box')!;
    this.body = root.querySelector('.body')!;
    root.querySelector('[data-action="reset"]')!.addEventListener('click', () => this.onReset());
    root.querySelector('[data-action="collapse"]')!.addEventListener('click', () => {
      this.box.classList.toggle('collapsed');
      this.save();
    });
    this.enableDrag(root.querySelector('.header')!);
    parent.appendChild(this.host);
    this.restore();
  }

  render(state: OverlayState): void {
    this.body.replaceChildren();
    if (state.outOfSync) this.body.append(warning('outOfSync', '⚠ Out of sync: a log line was missed or misread. Press Reset at the start of the next game.'));
    if (state.outOfSync && state.detail) this.body.append(warning('detail', state.detail));
    if (state.overLimit) this.body.append(warning('overLimit', '⚠ Too many possibilities to track precisely.'));
    for (const v of state.views) {
      const row = document.createElement('div');
      row.dataset.row = '';
      row.textContent = formatRow(v);
      const color = state.colors[v.player];
      if (color) row.style.color = color;
      this.body.append(row);
    }
  }

  private enableDrag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (down: PointerEvent) => {
      if ((down.target as HTMLElement).closest('button')) return;
      const rect = this.box.getBoundingClientRect();
      const dx = down.clientX - rect.left;
      const dy = down.clientY - rect.top;
      const move = (e: PointerEvent) => this.place(e.clientX - dx, e.clientY - dy);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.save();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  private place(x: number, y: number): void {
    const maxX = Math.max(0, window.innerWidth - 40);
    const maxY = Math.max(0, window.innerHeight - 30);
    this.box.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    this.box.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
    this.box.style.right = 'auto';
  }

  private save(): void {
    if (!hasStorage()) return;
    const rect = this.box.getBoundingClientRect();
    void chrome.storage.local.set({
      [STORAGE_KEY]: { x: rect.left, y: rect.top, collapsed: this.box.classList.contains('collapsed') },
    });
  }

  private restore(): void {
    if (!hasStorage()) return;
    void chrome.storage.local.get(STORAGE_KEY).then((data) => {
      const pos = data[STORAGE_KEY] as { x: number; y: number; collapsed: boolean } | undefined;
      if (!pos) return;
      this.place(pos.x, pos.y);
      this.box.classList.toggle('collapsed', pos.collapsed);
    });
  }
}

function warning(kind: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.warning = kind;
  el.textContent = text;
  return el;
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}
