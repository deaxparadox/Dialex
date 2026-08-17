import { Routes } from '@angular/router';
import { DebateThread } from './features/debate/debate-thread/debate-thread';
import { DebatesList } from './features/debate/debates-list/debates-list';
import { ConsultationChat } from './features/consultation/consultation-chat/consultation-chat';
import { Login } from './features/auth/login/login';
import { Register } from './features/auth/register/register';
import { authGuard, guestGuard } from './core/auth/auth-guard';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'register', component: Register, canActivate: [guestGuard] },
  // "My debates" history list (spec 0027) — closes the gap this route
  // config's own prior comment named ("no list screen yet").
  { path: 'debates', component: DebatesList, canActivate: [authGuard] },
  { path: 'debates/:id', component: DebateThread, canActivate: [authGuard] },
  // Additive entry point (spec 0010) — a direct link/nav button.
  { path: 'consultation', component: ConsultationChat, canActivate: [authGuard] },
  { path: '', redirectTo: 'debates', pathMatch: 'full' },
];
