import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { Auth } from '../../../core/auth/auth';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group(
    {
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { username, email, password } = this.form.getRawValue();
    try {
      await this.auth.register(username, email, password);
      // Simpler UX than forcing a second manual login right after registering.
      await this.auth.login(username, password);
      await this.router.navigateByUrl('/');
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400) {
        const detail = Object.values(err.error ?? {}).flat().join(' ');
        this.error.set(detail || 'Could not register with these details.');
      } else {
        this.error.set('Could not register with these details.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
