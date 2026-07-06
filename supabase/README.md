# Supabase admin operations

Runbook for the service-side pieces. See `migrations/` for schema and
`functions/` for the Edge Functions.

## Device limits

Each account may bind up to N devices. The limit resolves as:

1. **Per-account override** — a row in `device_limits` for that `user_id`.
2. **Global default** — the `DEVICE_LIMIT_DEFAULT` env var on the
   `claim-device` function (defaults to `1` if unset/invalid).

Devices bind on first login (`claim-device` → `claim_device()` SQL). Once the
limit is reached, further devices get `denied` until a slot is freed.

`device_bindings` and `device_limits` are reachable only via `service_role`
(RLS revokes `anon`/`authenticated`), so run the SQL below in the Supabase
dashboard **SQL editor** or with the service key — not from the app.

### Everyone gets N

Set `DEVICE_LIMIT_DEFAULT` in the dashboard (Edge Functions → `claim-device` →
env vars). No redeploy needed — it's read per request.

### One customer gets a different limit (e.g. 3)

Insert/update a per-account override. Straight quotes only — the dashboard
sometimes pastes curly quotes (`‘ ’`), which Postgres rejects.

By user id:

```sql
insert into device_limits (user_id, device_limit)
values ('<uid>', 3)
on conflict (user_id) do update set device_limit = excluded.device_limit;
```

By email (resolves the uid from `auth.users`):

```sql
insert into device_limits (user_id, device_limit)
select id, 3 from auth.users where lower(email) = lower('<email>')
on conflict (user_id) do update set device_limit = excluded.device_limit;
```

### Free a slot (unbind a device)

Deletes one binding so a new device can claim it.

By user id:

```sql
delete from device_bindings
where user_id = '<uid>' and device_id = '<id>';
```

By email:

```sql
delete from device_bindings
where user_id = (select id from auth.users where lower(email) = lower('<email>'))
  and device_id = '<id>';
```

List a user's bound devices to find the `device_id`:

```sql
-- by uid
select device_id, platform, label, bound_at, last_seen_at
from device_bindings
where user_id = '<uid>'
order by last_seen_at desc nulls last;

-- by email
select b.device_id, b.platform, b.label, b.bound_at, b.last_seen_at
from device_bindings b
join auth.users u on u.id = b.user_id
where lower(u.email) = lower('<email>')
order by b.last_seen_at desc nulls last;
```

To look up a uid from an email once (then reuse it above):

```sql
select id, email from auth.users where lower(email) = lower('<email>');
```
