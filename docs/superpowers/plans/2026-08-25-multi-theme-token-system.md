# Multi-Theme Token System (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend's single neutral color palette with a dual-brand, persisted theme system (Sunlit Citrus / Electric Contrast, each with light + dark) driven by one global `Theme` service, and retire the debate-thread page's own local, unpersisted light/dark toggle in favor of it.

**Architecture:** Two independent attributes on `<html>` — `data-brand` (`citrus` default | `electric`) and `data-theme` (`light` | `dark` | absent = follow `prefers-color-scheme`) — select one of four CSS custom-property token sets in `styles.css` via compound attribute selectors, ranked by CSS specificity so an explicit choice always wins over the media-query fallback regardless of source order. A new root-scoped `Theme` service (mirroring the existing `Auth` service's `@Service()` pattern) owns both signals, persists them to `localStorage` (a personal display preference, never sent to the backend — same precedent as the theme choice spec 0007 already made "local, not shareable"), and writes the attributes. Temporary functional controls (a brand `<select>`, a mode toggle button) go into the existing flat nav so this phase ships something a real user can actually try — the full nav redesign (utility cluster, a proper sliding switch) is Phase 2's job, not this one.

**Tech Stack:** Angular 22 (standalone components, zoneless, Signals, `@Service()`), Vitest, plain CSS custom properties — no new dependencies.

**Spec:** [docs/specs/0032-product-shell-dashboard-review-and-multi-theme.md](../../specs/0032-product-shell-dashboard-review-and-multi-theme.md) (Phase 1 only) and [docs/adr/0011-product-shell-and-multi-theme-system.md](../../adr/0011-product-shell-and-multi-theme-system.md) (Decision 3).

## Global Constraints

- No new npm dependencies (spec 0032 constraint; this is pure Angular + CSS).
- Theme/brand preference is `localStorage`-only, never a backend field — matches spec 0007's existing "theme is local, not shared" precedent, now extended to brand.
- `data-brand` must always be written explicitly by the `Theme` service on construction — there is no OS-level signal for brand the way there is for light/dark, so a CSS-only default is not sufcient (ADR 0011 Decision 3).
- Status colors (`--status-action`/`--status-live`/`--status-done`) must never alias `--divergence`/`--convergence` — those remain per-argument leaning colors only (ADR 0011 Decision 2).
- `debate-thread`'s Minimal/Detail toggle is unaffected by this plan — only its light/dark toggle is removed.
- Every step that touches `.ts`/`.html`/`.css` under `frontend/` must leave `npm test` passing before its commit.

---

## Task 1: `Theme` core service

**Files:**
- Create: `frontend/src/app/core/theme/theme.ts`
- Test: `frontend/src/app/core/theme/theme.spec.ts`

**Interfaces:**
- Produces: `Theme` (`@Service()`, root-scoped), `ThemeBrand = 'citrus' | 'electric'`, `ThemeMode = 'light' | 'dark'`. Public API: `brand: Signal<ThemeBrand>`, `mode: Signal<ThemeMode | null>` (`null` = follow system), `setBrand(brand: ThemeBrand): void`, `setMode(mode: ThemeMode | null): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/app/core/theme/theme.spec.ts
import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

describe('Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
  });

  it('defaults to citrus brand and no explicit mode', () => {
    const service = TestBed.inject(Theme);
    expect(service.brand()).toBe('citrus');
    expect(service.mode()).toBeNull();
  });

  it('applies the default brand to the document on construction', () => {
    TestBed.inject(Theme);
    expect(document.documentElement.getAttribute('data-brand')).toBe('citrus');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('setBrand updates the signal, the DOM, and persists to localStorage', () => {
    const service = TestBed.inject(Theme);
    service.setBrand('electric');
    expect(service.brand()).toBe('electric');
    expect(document.documentElement.getAttribute('data-brand')).toBe('electric');
    expect(localStorage.getItem('dialex-theme-brand')).toBe('electric');
  });

  it('setMode updates the signal, the DOM, and persists to localStorage', () => {
    const service = TestBed.inject(Theme);
    service.setMode('dark');
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('dialex-theme-mode')).toBe('dark');
  });

  it('setMode(null) clears the explicit override', () => {
    const service = TestBed.inject(Theme);
    service.setMode('dark');
    service.setMode(null);
    expect(service.mode()).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('dialex-theme-mode')).toBeNull();
  });

  it('reads a persisted brand/mode back on construction', () => {
    localStorage.setItem('dialex-theme-brand', 'electric');
    localStorage.setItem('dialex-theme-mode', 'dark');
    const service = TestBed.inject(Theme);
    expect(service.brand()).toBe('electric');
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-brand')).toBe('electric');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/app/core/theme/theme.spec.ts`
Expected: FAIL — `Cannot find module './theme'` (the service doesn't exist yet).

- [ ] **Step 3: Write the `Theme` service**

```ts
// frontend/src/app/core/theme/theme.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/core/theme/theme.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/theme/theme.ts frontend/src/app/core/theme/theme.spec.ts
git commit -m "feat: add global Theme service for brand/mode preference"
```

---

## Task 2: Multi-theme token system in `styles.css`

**Files:**
- Modify: `frontend/src/styles.css:1-90` (the entire current `:root`/media-query/explicit-override token block — everything from the top of the file through the closing `}` of the current `:root[data-theme="light"]` rule; the rest of the file, starting at `* { box-sizing: border-box; }`, is unchanged)

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: `--page`, `--ground`, `--ink`, `--ink-muted`, `--ink-faint`, `--line`, `--divergence`, `--convergence`, `--judge`, `--agent-a`, `--agent-a-bg`, `--agent-b`, `--agent-b-bg` (unchanged names, new values per brand/mode), plus new `--status-action`, `--status-action-bg`, `--status-live`, `--status-live-bg`, `--status-done`, `--status-done-bg`. `--font-display`/`--font-body`/`--font-mono`/`--panel-shadow`/`--transition-fast`/`--transition-base` are unchanged and brand-independent.

**A note on exact values:** the four brand/mode combinations' anchor colors (page/panel/chrome/ink/one or two status chips) were confirmed with the user via the brainstorming visual companion. The remaining tokens this file also needs (`--ink-faint`, `--line`, `--agent-a`/`--agent-b`, `--divergence`/`--convergence`, `--judge`) were never individually mocked — they're filled in here as a consistent extrapolation within each approved brand's hue family, not separately re-confirmed. Flag any that read wrong during Step 3's real-browser check; a follow-up polish pass (this repo's own precedent — e.g. spec 0012's "round two" after living with round one) is the normal way to correct that, not a blocker to shipping this phase.

- [ ] **Step 1: Replace the token block**

Replace lines 1-90 of `frontend/src/styles.css` with:

```css
/* Global design tokens — see docs/adr/0001-frontend-architecture.md and
   docs/adr/0011-product-shell-and-multi-theme-system.md. Every feature
   shares this token system; Angular's view encapsulation scopes
   selectors, not custom-property names, so these cascade into every
   component by design, not by accident.

   Two independent axes, both driven by attributes core/theme/theme.ts
   sets on <html> (never left to a CSS-only default, since there is no
   OS-level signal for "brand" the way there is for light/dark):
   data-brand ("citrus" | "electric", default citrus) and data-theme
   ("light" | "dark" | absent-follows-system, unchanged from ADR 0001). */

:root, :root[data-brand="citrus"] {
  /* --page: the outer gutter/background the panels float on.
     --ground: the panel/card surface itself — deliberately distinct from --page
     (a la Spotify's near-black panels sitting on a true-black page), not the
     same tone, so panels read as actual separated containers. */
  --page: #FFFDF8;
  --ground: #FFF7EE;
  --ink: #241A0D;
  --ink-muted: #8A6A4B;
  --ink-faint: #C4AF8E;
  --line: #FFDCC0;
  --divergence: #D9502E;
  --convergence: #1FA97E;
  --judge: #7B4FFF;
  /* Per-agent identity (spec 0019) — a separate "who" signal from
     divergence/convergence's "how they lean," distinct hues on purpose. */
  --agent-a: #2E6FB0;
  --agent-a-bg: #E7F0FA;
  --agent-b: #C24B7C;
  --agent-b-bg: #FBEAF1;
  /* Case/debate status (ADR 0011 decision 2) — its own namespace,
     deliberately never aliased to --divergence/--convergence above, which
     mean "this one argument's leaning," a different scope entirely. */
  --status-action: #FF6B35;
  --status-action-bg: #FFE7DA;
  --status-live: #1FA97E;
  --status-live-bg: #DFF5EC;
  --status-done: #8A6A4B;
  --status-done-bg: #F0E9DD;

  --font-display: "Iowan Old Style", "Palatino Linotype", "Georgia", ui-serif, serif;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", Consolas, ui-monospace, monospace;

  /* Shared "floating panel" depth — every card/panel/navbar uses this one
     value so the whole app reads as one consistent visual language, not
     independently-guessed shadows per screen (spec 0012). */
  --panel-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.28), 0 2px 8px -2px rgba(0, 0, 0, 0.16);

  /* Shared motion tokens (ADR 0009/spec 0026) — same "one value app-wide"
     reasoning as --panel-shadow, not a per-component guessed duration. */
  --transition-fast: 150ms ease;
  --transition-base: 220ms ease;
}

:root[data-brand="electric"] {
  --page: #FFFFFF;
  --ground: #F7F9FF;
  --ink: #0B1E3D;
  --ink-muted: #5A6B8C;
  --ink-faint: #9BAAC7;
  --line: #DCE4F7;
  --divergence: #E0405F;
  --convergence: #00A876;
  --judge: #5C6FE0;
  --agent-a: #2F5CFF;
  --agent-a-bg: #E9EEFF;
  --agent-b: #FF3D9A;
  --agent-b-bg: #FFE7F3;
  --status-action: #FFC845;
  --status-action-bg: #FFF3D6;
  --status-live: #00E28A;
  --status-live-bg: #DAFBEC;
  --status-done: #5A6B8C;
  --status-done-bg: #E4E7EF;
}

@media (prefers-color-scheme: dark) {
  /* System prefers dark and no explicit data-theme override. Reuses the
     bare :root selector at the same specificity as the light default
     above — CSS resolves the tie by source order, so this later block
     correctly wins whenever the media query matches. */
  :root {
    --page: #1C140B;
    --ground: #241A0F;
    --ink: #F3EAD8;
    --ink-muted: #B39A78;
    --ink-faint: #6E5A3C;
    --line: #3D3220;
    --divergence: #E8734F;
    --convergence: #3FCB9A;
    --judge: #9B7BFF;
    --agent-a: #5FA3E0;
    --agent-a-bg: #16222E;
    --agent-b: #E07AA8;
    --agent-b-bg: #2A1620;
    --status-action: #FF8A5C;
    --status-action-bg: #3D2A18;
    --status-live: #3FCB9A;
    --status-live-bg: #123028;
    --status-done: #B39A78;
    --status-done-bg: #2E2716;
  }

  :root[data-brand="electric"] {
    --page: #060B18;
    --ground: #0F1830;
    --ink: #EAF0FF;
    --ink-muted: #7E8FB8;
    --ink-faint: #47547A;
    --line: #1A2740;
    --divergence: #FF5C79;
    --convergence: #00E28A;
    --judge: #8B9BFF;
    --agent-a: #5C86FF;
    --agent-a-bg: #16223D;
    --agent-b: #FF6BB5;
    --agent-b-bg: #331226;
    --status-action: #FFC845;
    --status-action-bg: #3D2B00;
    --status-live: #00E28A;
    --status-live-bg: #00301C;
    --status-done: #7E8FB8;
    --status-done-bg: #16203A;
  }
}

/* Explicit dark — set by core/theme/theme.ts. An attribute selector
   always outranks a bare :root by specificity, regardless of source
   order or which media query matched, so this correctly wins over both
   the light default and the media-query fallback above. */
:root[data-theme="dark"] {
  --page: #1C140B;
  --ground: #241A0F;
  --ink: #F3EAD8;
  --ink-muted: #B39A78;
  --ink-faint: #6E5A3C;
  --line: #3D3220;
  --divergence: #E8734F;
  --convergence: #3FCB9A;
  --judge: #9B7BFF;
  --agent-a: #5FA3E0;
  --agent-a-bg: #16222E;
  --agent-b: #E07AA8;
  --agent-b-bg: #2A1620;
  --status-action: #FF8A5C;
  --status-action-bg: #3D2A18;
  --status-live: #3FCB9A;
  --status-live-bg: #123028;
  --status-done: #B39A78;
  --status-done-bg: #2E2716;
}

/* Two attribute selectors outrank the single-attribute rule above,
   so this correctly wins whenever brand=electric AND theme=dark. */
:root[data-brand="electric"][data-theme="dark"] {
  --page: #060B18;
  --ground: #0F1830;
  --ink: #EAF0FF;
  --ink-muted: #7E8FB8;
  --ink-faint: #47547A;
  --line: #1A2740;
  --divergence: #FF5C79;
  --convergence: #00E28A;
  --judge: #8B9BFF;
  --agent-a: #5C86FF;
  --agent-a-bg: #16223D;
  --agent-b: #FF6BB5;
  --agent-b-bg: #331226;
  --status-action: #FFC845;
  --status-action-bg: #3D2B00;
  --status-live: #00E28A;
  --status-live-bg: #00301C;
  --status-done: #7E8FB8;
  --status-done-bg: #16203A;
}

/* Explicit light — wins over an OS dark preference the same way. */
:root[data-theme="light"] {
  --page: #FFFDF8;
  --ground: #FFF7EE;
  --ink: #241A0D;
  --ink-muted: #8A6A4B;
  --ink-faint: #C4AF8E;
  --line: #FFDCC0;
  --divergence: #D9502E;
  --convergence: #1FA97E;
  --judge: #7B4FFF;
  --agent-a: #2E6FB0;
  --agent-a-bg: #E7F0FA;
  --agent-b: #C24B7C;
  --agent-b-bg: #FBEAF1;
  --status-action: #FF6B35;
  --status-action-bg: #FFE7DA;
  --status-live: #1FA97E;
  --status-live-bg: #DFF5EC;
  --status-done: #8A6A4B;
  --status-done-bg: #F0E9DD;
}

:root[data-brand="electric"][data-theme="light"] {
  --page: #FFFFFF;
  --ground: #F7F9FF;
  --ink: #0B1E3D;
  --ink-muted: #5A6B8C;
  --ink-faint: #9BAAC7;
  --line: #DCE4F7;
  --divergence: #E0405F;
  --convergence: #00A876;
  --judge: #5C6FE0;
  --agent-a: #2F5CFF;
  --agent-a-bg: #E9EEFF;
  --agent-b: #FF3D9A;
  --agent-b-bg: #FFE7F3;
  --status-action: #FFC845;
  --status-action-bg: #FFF3D6;
  --status-live: #00E28A;
  --status-live-bg: #DAFBEC;
  --status-done: #5A6B8C;
  --status-done-bg: #E4E7EF;
}
```

- [ ] **Step 2: Confirm the build still compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (pure CSS change — this step exists to catch a typo/syntax error, not to test the design).

- [ ] **Step 3: Real-browser verification (deferred to Task 3 — no controls exist yet to trigger `data-brand`/`data-theme` from the UI)**

Skip actual browser verification here; it happens as part of Task 3's Step 6 once real controls exist. Proceed to commit.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat: rewrite styles.css as a 4-way brand/mode token matrix"
```

---

## Task 3: Temporary brand + mode controls in the nav

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.css`

**Interfaces:**
- Consumes: `Theme` (Task 1) — `theme.brand()`, `theme.mode()`, `theme.setBrand(brand)`, `theme.setMode(mode)`.
- Produces: nothing new consumed by later tasks in this plan (Phase 2 will replace this markup, not build on it).

**Scoping note:** these controls are placed in the existing authenticated `.topbar-nav` (visible only when logged in, matching where the app's only chrome exists today) using a plain `<select>` and a plain toggle button — not the styled utility cluster / sliding switch mocked during brainstorming. That's Phase 2's nav rebuild. This step's only job is making Task 1/2's work real and testable for a user today.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/app/app.spec.ts — add this test to the existing describe block
import { Theme } from './core/theme/theme';

// ... inside describe('App', ...), alongside the existing two tests:
it('renders theme controls when authenticated', async () => {
  localStorage.clear();
  const fixture = TestBed.createComponent(App);
  const app = fixture.componentInstance as any;
  app.auth._accessToken.set('fake-token'); // isAuthenticated() becomes true
  await fixture.whenStable();
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  const select = compiled.querySelector('select.theme-brand-select') as HTMLSelectElement;
  expect(select).toBeTruthy();
  expect(compiled.querySelector('button.theme-mode-toggle')).toBeTruthy();

  const theme = TestBed.inject(Theme);
  select.value = 'electric';
  select.dispatchEvent(new Event('change'));
  expect(theme.brand()).toBe('electric');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/app/app.spec.ts`
Expected: FAIL — `select.theme-brand-select` not found (markup doesn't exist yet).

- [ ] **Step 3: Add the controls to `app.ts`**

Modify `frontend/src/app/app.ts`:

```ts
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { Auth } from './core/auth/auth';
import { Theme, ThemeBrand } from './core/theme/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly theme = inject(Theme);

  onBrandChange(value: string): void {
    this.theme.setBrand(value as ThemeBrand);
  }

  toggleMode(): void {
    const current = this.theme.mode();
    // Toggling from "follow system" flips whatever's currently showing,
    // not a hardcoded starting point.
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentlyDark = current === 'dark' || (current === null && systemPrefersDark);
    this.theme.setMode(currentlyDark ? 'light' : 'dark');
  }

  async logout(): Promise<void> {
    // Auth.logout() clears client-side session state in its own `finally`
    // regardless of whether the server call succeeds — the navigation
    // should be unconditional too, or a failed request strands the user on
    // a half-logged-out page with no way back (found via real browser
    // verification: this used to leave the "Log out" button gone but the
    // URL unchanged, with no error shown).
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }
}
```

- [ ] **Step 4: Add the controls to `app.html`**

Modify `frontend/src/app/app.html` — replace the `.topbar-nav` block:

```html
<div class="app-shell">
  @if (auth.isAuthenticated()) {
    <div class="topbar">
      <a class="brand" routerLink="/">
        <img src="dialex-logo.svg" alt="" class="brand-logo" />
        <span class="brand-name">Dialex</span>
      </a>
      <div class="topbar-nav">
        <a routerLink="/debates">My debates</a>
        <a routerLink="/consultation">New case</a>
        <select
          class="theme-brand-select"
          [value]="theme.brand()"
          (change)="onBrandChange($any($event.target).value)"
          aria-label="Color theme"
        >
          <option value="citrus">Citrus</option>
          <option value="electric">Electric</option>
        </select>
        <button
          type="button"
          class="theme-mode-toggle"
          (click)="toggleMode()"
          [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          {{ theme.mode() === 'dark' ? '☾' : '☀' }}
        </button>
        <button type="button" (click)="logout()">Log out</button>
      </div>
    </div>
  }
  <div class="content">
    <router-outlet />
  </div>
</div>
```

- [ ] **Step 5: Add minimal styling to `app.css`**

Append to `frontend/src/app/app.css`:

```css
.theme-brand-select {
  background: var(--page);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 5px 10px;
  color: var(--ink-muted);
  font-size: 13px;
  cursor: pointer;
}

.theme-mode-toggle {
  font-size: 13px;
  line-height: 1;
  padding: 6px 10px;
}
```

- [ ] **Step 6: Run the test to verify it passes, then verify in a real browser**

Run: `cd frontend && npx vitest run src/app/app.spec.ts`
Expected: PASS (3 tests).

Then: `cd frontend && npm start`, log in as a real user, and confirm in the browser:
- The brand `<select>` and mode button appear in the topbar.
- Switching the select between Citrus/Electric changes the page's colors immediately, on every screen (login page unaffected since chrome only renders when authenticated, but its own background/ink still come from the same tokens — confirm it also re-colors).
- Clicking the mode button toggles light/dark for whichever brand is selected, cycling correctly through all 4 combinations.
- Reload the page: the chosen brand and mode both persist (confirms `localStorage` read-back on construction).
- Open devtools, inspect `<html>`: confirm `data-brand` is always present, `data-theme` is present only after an explicit toggle click.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/app.ts frontend/src/app/app.html frontend/src/app/app.css frontend/src/app/app.spec.ts
git commit -m "feat: add temporary brand/mode controls to the nav"
```

---

## Task 4: Retire `debate-thread`'s local light/dark toggle

**Files:**
- Modify: `frontend/src/app/features/debate/debate-thread/debate-thread.ts:94-97,340-343`
- Modify: `frontend/src/app/features/debate/debate-thread/debate-thread.html:9-12`
- Modify: `frontend/src/app/features/debate/debate-thread/debate-thread.css:34-63`

**Interfaces:**
- Consumes: nothing new (this task only removes code).
- Produces: nothing new (the page's color now comes entirely from the global `Theme` service via CSS custom properties, with no page-local state).

- [ ] **Step 1: Confirm no existing test depends on the code being removed**

Run: `cd frontend && grep -n "theme\|setTheme" src/app/features/debate/debate-thread/debate-thread.spec.ts`
Expected: no output (confirmed already — no test in this file references `theme`/`setTheme`, so this is a safe removal with no test to update first).

- [ ] **Step 2: Remove the toggle markup from `debate-thread.html`**

Delete these 4 lines (the `.toggle` block, immediately before `<div class="mode-toggle">`):

```html
        <div class="toggle">
          <button [class.active]="theme() === 'light'" (click)="setTheme('light')">Light</button>
          <button [class.active]="theme() === 'dark'" (click)="setTheme('dark')">Dark</button>
        </div>
```

- [ ] **Step 3: Remove the `theme` signal and `setTheme` method from `debate-thread.ts`**

Delete:

```ts
  // Theme deliberately stays local, not a query param (spec 0007) — it's a
  // personal display preference, not "which view of this debate," and a
  // shared link shouldn't force the sharer's theme on whoever opens it.
  readonly theme = signal<'light' | 'dark'>('light');
```

and:

```ts
  setTheme(mode: 'light' | 'dark') {
    this.theme.set(mode);
    document.documentElement.setAttribute('data-theme', mode);
  }
```

- [ ] **Step 4: Clean up the now-dead `.toggle` CSS selectors in `debate-thread.css`**

Replace this block:

```css
.toggle,
.mode-toggle {
  display: flex;
  gap: 3px;
}
.toggle button,
.mode-toggle button {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-faint);
  font-size: 12px;
  padding: 5px 11px;
  cursor: pointer;
  font-family: var(--font-body);
  transition: color var(--transition-fast), background var(--transition-fast);
}
.toggle button:first-child,
.mode-toggle button:first-child {
  border-radius: 4px 0 0 4px;
}
.toggle button:last-child,
.mode-toggle button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.toggle button.active,
.mode-toggle button.active {
  color: var(--ink);
  background: var(--line);
}
```

with:

```css
.mode-toggle {
  display: flex;
  gap: 3px;
}
.mode-toggle button {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-faint);
  font-size: 12px;
  padding: 5px 11px;
  cursor: pointer;
  font-family: var(--font-body);
  transition: color var(--transition-fast), background var(--transition-fast);
}
.mode-toggle button:first-child {
  border-radius: 4px 0 0 4px;
}
.mode-toggle button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.mode-toggle button.active {
  color: var(--ink);
  background: var(--line);
}
```

- [ ] **Step 5: Run the full suite**

Run: `cd frontend && npm test`
Expected: PASS, same total test count as before minus nothing removed (no test targeted the deleted code) — confirms this removal broke nothing.

- [ ] **Step 6: Real-browser verification**

`cd frontend && npm start`, open a real debate (`/debates/:id`): confirm the page no longer shows a Light/Dark toggle in its header (only Minimal/Detail remains), and confirm the page's colors still correctly follow the nav's global brand/mode controls added in Task 3 across all 4 combinations.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/features/debate/debate-thread/debate-thread.ts frontend/src/app/features/debate/debate-thread/debate-thread.html frontend/src/app/features/debate/debate-thread/debate-thread.css
git commit -m "refactor: retire debate-thread's local theme toggle for the global Theme service"
```

---

## Task 5: Close the loop (TODO.md, CHANGELOG.md)

**Files:**
- Modify: `TODO.md`
- Modify: `CHANGELOG.md`

Per this repo's CLAUDE.md: every milestone closes in the same commit as the code, marking the tracking entry done and updating the changelog. `docs/FLOWS.md` is not touched by this phase — no user-facing flow's status (✅/⚠️/🚧/❌) changes; this is additive color infrastructure underneath existing flows, not a new or changed flow.

- [ ] **Step 1: Update `TODO.md`**

Move the "Whole-product IA redesign..." entry (added when spec 0032 was written) — do not mark it fully done yet, since only Phase 1 of 5 is complete. Instead, append a progress note to that same open entry:

```markdown
  - **Phase 1 done** (2026-08-25): multi-theme token system shipped — `core/theme/theme.ts` (persisted brand+mode preference), `styles.css` rewritten as a 4-way Citrus/Electric × light/dark token matrix, temporary nav controls to try it, `debate-thread`'s old local/unpersisted light-dark toggle retired in its favor. Phases 2-5 (nav shell + dashboard, Human Review, Notifications) remain.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Check `CHANGELOG.md`'s existing format first (`head -30 CHANGELOG.md`) and add an entry in the same style under the current unreleased/latest section, e.g.:

```markdown
### Added
- Dual-brand multi-theme color system (Sunlit Citrus / Electric Contrast, each with light + dark) — Phase 1 of the product shell redesign (spec 0032, ADR 0011).
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md CHANGELOG.md
git commit -m "docs: close out Phase 1 of the multi-theme redesign"
```
