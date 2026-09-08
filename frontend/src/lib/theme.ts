// Ported from frontend/src/app/core/theme/theme.ts (ADR 0011). No reactive
// wrapper yet (no toggle UI consumes this until Phase 2's nav) — plain
// functions operating on <html>'s attributes + localStorage, same shape as
// the pre-paint bootstrap script in layout.tsx.
export type ThemeBrand = 'citrus' | 'electric';
export type ThemeMode = 'light' | 'dark';

const BRAND_KEY = 'dialex-theme-brand';
const MODE_KEY = 'dialex-theme-mode';

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // localStorage can throw (Safari private browsing, storage disabled by
    // policy) — a missing preference is a valid default, not an error.
    return null;
  }
}

export function readBrand(): ThemeBrand {
  return safeGetItem(BRAND_KEY) === 'electric' ? 'electric' : 'citrus';
}

export function readMode(): ThemeMode | null {
  const stored = safeGetItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

export function effectiveMode(): ThemeMode {
  return readMode() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyToDocument(brand: ThemeBrand, mode: ThemeMode | null): void {
  document.documentElement.setAttribute('data-brand', brand);
  if (mode === null) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
}

export function setBrand(brand: ThemeBrand): void {
  try {
    localStorage.setItem(BRAND_KEY, brand);
  } catch {
    // Deliberate no-op — see safeGetItem above.
  }
  applyToDocument(brand, readMode());
}

export function setMode(mode: ThemeMode | null): void {
  try {
    if (mode === null) {
      localStorage.removeItem(MODE_KEY);
    } else {
      localStorage.setItem(MODE_KEY, mode);
    }
  } catch {
    // Deliberate no-op — see safeGetItem above.
  }
  applyToDocument(readBrand(), mode);
}
