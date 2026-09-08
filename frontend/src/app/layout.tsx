import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dialex',
};

// Pre-paint theme bootstrap — ported from frontend/src/index.html. Runs
// synchronously before first paint (a plain <script>, not next/script,
// which defers past hydration); duplicates lib/theme.ts's key names rather
// than importing it, since an inline script can't import a module.
const themeBootstrapScript = `
(function () {
  try {
    var brand = localStorage.getItem('dialex-theme-brand');
    var mode = localStorage.getItem('dialex-theme-mode');
    if (brand === 'electric') document.documentElement.setAttribute('data-brand', brand);
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
  } catch (e) {
    // localStorage unavailable — the CSS media-query fallback handles it.
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: the bootstrap script below sets data-brand/
    // data-theme on this element before React hydrates — an intentional,
    // expected mismatch (found via real verification), not a bug to fix.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
