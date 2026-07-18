import { Routes } from '@angular/router';
import { DebateThread } from './features/debate/debate-thread/debate-thread';
import { Login } from './features/auth/login/login';
import { Register } from './features/auth/register/register';
import { authGuard, guestGuard } from './core/auth/auth-guard';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'register', component: Register, canActivate: [guestGuard] },
  // No "browse my debates" list screen yet (spec 0008) — bare '' shows
  // DebateThread's own empty state (no :id param) rather than either
  // blocking this milestone on a list screen or pointing '' at nothing.
  { path: 'debates/:id', component: DebateThread, canActivate: [authGuard] },
  { path: '', component: DebateThread, canActivate: [authGuard] },
];
