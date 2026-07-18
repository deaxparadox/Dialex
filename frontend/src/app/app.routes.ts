import { Routes } from '@angular/router';
import { DebateThread } from './features/debate/debate-thread/debate-thread';
import { Login } from './features/auth/login/login';
import { Register } from './features/auth/register/register';
import { authGuard, guestGuard } from './core/auth/auth-guard';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'register', component: Register, canActivate: [guestGuard] },
  { path: '', component: DebateThread, canActivate: [authGuard] },
];
