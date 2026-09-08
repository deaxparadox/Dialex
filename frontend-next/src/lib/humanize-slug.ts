// Ported from frontend/src/app/shared/pipes/humanize-slug-pipe.ts — a plain
// function, no Angular-pipe-specific behavior to translate.
export function humanizeSlug(value: string | null | undefined): string {
  if (!value) return '';
  const [first, ...rest] = value.split(/[_-]+/);
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}
