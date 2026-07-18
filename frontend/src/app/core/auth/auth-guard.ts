import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

/** Keeps a logged-in user off /login and /register — redirected to '' instead. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.isAuthenticated() ? router.createUrlTree(['/']) : true;
};
