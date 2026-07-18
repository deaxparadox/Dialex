import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';

import { Auth } from '../../../core/auth/auth';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { username, password } = this.form.getRawValue();
    try {
      await this.auth.login(username, password);
      const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/';
      await this.router.navigateByUrl(redirect);
    } catch {
      this.error.set('Incorrect username or password.');
    } finally {
      this.submitting.set(false);
    }
  }
}
