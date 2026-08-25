import { Service, signal } from '@angular/core';

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
  readonly brand = signal<ThemeBrand>(this.readBrand());
  readonly mode = signal<ThemeMode | null>(this.readMode());

  constructor() {
    this.applyToDocument();
  }

  setBrand(brand: ThemeBrand): void {
    this.brand.set(brand);
    localStorage.setItem(BRAND_KEY, brand);
    this.applyToDocument();
  }

  setMode(mode: ThemeMode | null): void {
    this.mode.set(mode);
    if (mode === null) {
      localStorage.removeItem(MODE_KEY);
    } else {
      localStorage.setItem(MODE_KEY, mode);
    }
    this.applyToDocument();
  }

  private applyToDocument(): void {
    document.documentElement.setAttribute('data-brand', this.brand());
    const mode = this.mode();
    if (mode === null) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
  }

  private readBrand(): ThemeBrand {
    return localStorage.getItem(BRAND_KEY) === 'electric' ? 'electric' : 'citrus';
  }

  private readMode(): ThemeMode | null {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  }
}
