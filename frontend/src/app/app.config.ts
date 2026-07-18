import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth-interceptor';
import { Auth } from './core/auth/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Ensures the XSRF-TOKEN cookie exists before any refresh/logout call —
    // spec 0003's CsrfBootstrapView is meant to be hit once on app load —
    // then attempts a silent refresh so a valid refresh_token cookie
    // survives a hard reload instead of always forcing a fresh login
    // (found via real browser verification, not anticipated when this
    // spec was first written).
    provideAppInitializer(async () => {
      const auth = inject(Auth);
      await auth.bootstrapCsrf();
      await auth.restoreSession();
    }),
  ]
};
