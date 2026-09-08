# Spec 0040 — Next.js Phase 6: notifications, read path

Implements Phase 6 of ADR 0012/spec 0033 — the read-path scope only, matching spec 0032 Phase 4a exactly (live push is Phase 4b there, explicitly out of scope here unless separately requested). Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- `apps/notifications/models.py`'s `Notification` already exists (scaffold time, spec 0002): `user` (FK), `type`, `message`, `related_case`/`related_debate` (nullable FKs), `read` (bool, default `False`), `created_at`, `Meta.ordering = ["-created_at"]`. No serializer/URL exists; `views.py` is still the untouched Django-generated stub.
- No lifecycle code creates `Notification` rows anywhere in the codebase (grepped — zero writes). This phase is read-path-only per spec 0032 Phase 4a's own scope, so this is expected, not a gap to fix: verification will need manually-seeded rows, same as Phase 2's status-bucket verification needed a seeded user.
- `config/urls.py` (root urlconf) wires each app's URLs at a top-level prefix (`api/cases/`, `api/debates/`, a standalone `api/case-type-configs/`) — needs a 5th entry, `api/notifications/`.
- Design already fully decided in spec 0032 Phase 4a (not re-litigated here): `GET /api/notifications/` (ownership-scoped, `-created_at` — the model's own `Meta.ordering` already does this) and `PATCH /api/notifications/{id}/` (mark read, ownership-checked). Frontend: a bell icon in the nav opens a drawer of recent notifications (unread first), each linking to its `related_debate`/`related_case`; a "view all" link opens `/notifications` (the same list data, full archive). No live badge — populated on load/navigation only, honestly not claiming real-time (spec 0032's own wording).

## Fix

### 1. Backend: `apps/notifications/serializers.py` (new)

```python
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "type", "message", "related_case", "related_debate", "read", "created_at")
        read_only_fields = ("id", "type", "message", "related_case", "related_debate", "created_at")
```
Only `read` is ever client-writable (via the `PATCH`) — everything else is server-authored.

### 2. Backend: `apps/notifications/views.py`

`NotificationListView(generics.ListAPIView)` — `get_queryset` filters `Notification.objects.filter(user=self.request.user)` (ownership-scoped, same pattern every other list view uses; ordering already comes from the model's `Meta`). `NotificationUpdateView(generics.UpdateAPIView)` — `get_queryset` the same filter (so a non-owned notification 404s, not a 403 leaking existence), `http_method_names` restricted to `patch` only (no full replace needed for a single boolean flip).

### 3. Backend: wire it up

`apps/notifications/urls.py` (new): `path("", NotificationListView.as_view())`, `path("<int:pk>/", NotificationUpdateView.as_view())`. `config/urls.py` gains `path('api/notifications/', include('apps.notifications.urls'))`.

### 4. Frontend: data layer

`frontend-next/src/lib/notifications-api.ts` (new) — `ApiNotification` interface, `useNotificationsApi()` (`listNotifications()`, `markRead(id)` — a Django `PATCH`, needs `credentials: 'include'` explicitly like spec 0039's `submitReview`).

### 5. Frontend: bell + drawer + archive

A bell icon added to `(protected)/layout.tsx`'s nav (the first entry in ADR 0011's "utility cluster" this migration builds — no theme picker yet, that's still deferred). Clicking it opens a drawer (a simple absolutely-positioned panel, no new UI library) listing notifications, unread-first, each row linking to `/debates/{related_debate}` when present and marking itself read on click. A "View all" link/the bell's own "view all" opens `/notifications` — the same list, rendered as a full page instead of a drawer, no new backend shape.

## Explicitly out of scope

Live push (Phase 4b in spec 0032's own numbering) — the bell has no live unread badge, populated on load/navigation only, matching spec 0032's explicit wording. Any lifecycle code that actually creates `Notification` rows — that's the orchestrator-side publish work Phase 4b would need, not read-path work. Cutover (deleting Angular) — Phase 7, separate.

## Verification plan

Seed a handful of `Notification` rows directly (mixed read/unread, at least one with a `related_debate`) for a real test user — no lifecycle code creates them yet, so this is the only way to get real data. Confirm the bell drawer lists them unread-first; clicking one with a `related_debate` navigates there and marks it read (confirm via a reload that the read state persisted, not just local UI state); confirm `/notifications` shows the full archive matching the same data. Confirm ownership scoping: a notification belonging to another user isn't visible and a direct `PATCH` against it 404s. Confirm `frontend/` (Angular) unaffected, its tests still pass.

## Branch

`migration/nextjs-frontend` (continuing).
