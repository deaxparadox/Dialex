import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { Auth } from './core/auth/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);

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
