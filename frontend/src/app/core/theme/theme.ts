import { Service, computed, signal } from '@angular/core';

export type ThemeBrand = 'citrus' | 'electric';
export type ThemeMode = 'light' | 'dark';

const BRAND_KEY = 'dialex-theme-brand';
const MODE_KEY = 'dialex-theme-mode';

/** App-wide color identity (ADR 0011): two independent axes — which brand
 * palette (`data-brand`) and which mode (`data-theme`, absent = follow
 * `prefers-color-scheme`, matching the light/dark behavior spec 0007
 * already established). Both are personal display preferences, not shared
 * state (spec 0007), so they live in `localStorage`, never sent to the
 * backend. Replaces `debate-thread`'s previous page-local, unpersisted
 * theme signal with one global, persisted source of truth. */
@Service()
export class Theme {
  private readonly _brand = signal<ThemeBrand>(this.readBrand());
  private readonly _mode = signal<ThemeMode | null>(this.readMode());

  readonly brand = this._brand.asReadonly();
  readonly mode = this._mode.asReadonly();

  /** The mode actually rendered right now, resolving `mode() === null`
   * ("follow system") down to the concrete 'light'/'dark' the CSS cascade
   * is currently showing. UI that displays or reasons about "which mode is
   * showing" (e.g. the mode-toggle button's label) must read this, not the
   * raw `mode()` signal — otherwise a user with no explicit override on a
   * dark-preferring OS sees a label that disagrees with the page. */
  readonly effectiveMode = computed<ThemeMode>(() =>
    this._mode() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  constructor() {
    this.applyToDocument();
  }

  setBrand(brand: ThemeBrand): void {
    this._brand.set(brand);
    localStorage.setItem(BRAND_KEY, brand);
    this.applyToDocument();
  }

  setMode(mode: ThemeMode | null): void {
    this._mode.set(mode);
    if (mode === null) {
      localStorage.removeItem(MODE_KEY);
    } else {
      localStorage.setItem(MODE_KEY, mode);
    }
    this.applyToDocument();
  }

  private applyToDocument(): void {
    document.documentElement.setAttribute('data-brand', this._brand());
    const mode = this._mode();
    if (mode === null) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
  }

  private readBrand(): ThemeBrand {
    let stored: string | null;
    try {
      stored = localStorage.getItem(BRAND_KEY);
    } catch {
      // Deliberate fallback: localStorage can throw (e.g. Safari private
      // browsing, storage disabled by policy). This runs in a field
      // initializer during Theme's construction, which happens during
      // App's construction — an uncaught throw here would blank the whole
      // page for what should just be a display-preference default.
      stored = null;
    }
    // Any value other than 'electric' — including no stored value, or a
    // corrupted/garbage string — deliberately falls back to the 'citrus'
    // default, not an error.
    return stored === 'electric' ? 'electric' : 'citrus';
  }

  private readMode(): ThemeMode | null {
    let stored: string | null;
    try {
      stored = localStorage.getItem(MODE_KEY);
    } catch {
      // Deliberate fallback — see readBrand() above for why this must not throw.
      stored = null;
    }
    return stored === 'light' || stored === 'dark' ? stored : null;
  }
}
