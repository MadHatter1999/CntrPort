# CntrPort integration tests

Read-only smoke tests that hit a running wrapper and verify it forwards
to Counterpoint correctly. Safe to run against a live install
(BishopsCellar etc.) - no POST/PUT/PATCH/DELETE.

## Running on the VM

After scp'ing the repo and starting Flask (`py app.py`):

```bash
py -m pip install -r requirements-dev.txt
py -m pytest tests/ -v
```

Tests auto-discover what's configured:

| Test file               | Skips when                                      |
| ----------------------- | ----------------------------------------------- |
| `test_health.py`        | never - always runs                             |
| `test_manifest.py`      | never                                           |
| `test_typed_routes.py`  | never (probes are low-impact GETs)              |
| `test_mirror.py`        | never                                           |
| `test_auth.py`          | individual cases skip per mode (key set or not) |
| `test_sql_extensions.py`| `/api/health` reports `sql.ok=false`            |
| `test_direct_mode.py`   | `CP_ALLOW_DIRECT_MODE=false` in `.env`          |

## Config

Tests read from env vars and `.env`. Override only if the wrapper isn't
on localhost or the test key differs from `CNTRPORT_API_KEY`:

| Env var               | Default                                | Purpose |
| --------------------- | -------------------------------------- | ------- |
| `TEST_BASE_URL`       | `http://localhost:5000`                | Where the wrapper is listening |
| `TEST_API_KEY`        | `CNTRPORT_API_KEY` from `.env`         | Key sent in the auth header |
| `TEST_API_KEY_HEADER` | `CNTRPORT_API_KEY_HEADER`, else `X-API-Key` | Auth header name |

If the wrapper isn't reachable at `TEST_BASE_URL`, pytest exits with a
clear message instead of firing a wall of connection errors.

## What's covered

- **Health** - `/api/health` shape, CP reachability, SQL status.
- **Auth gate** - exempt paths, missing/wrong/correct key, no-auth mode.
- **Manifest** - `/api/cp` shape, known endpoints listed, direct-mode block.
- **Typed routes** - drop-in and `/api/cp/` mount both reach CP; same status.
- **Mirror** - `/api/cp/<unknown>` forwards; query strings preserved.
- **SQL extensions** - categories, subcategories, items, kits, item detail 404.
- **Direct mode** - `?_direct=1` and `X-CntrP-Mode: direct` both opt in;
  response header marks direct responses; flag stripped before upstream.

## What's NOT covered

Writes. The probe set is GET-only by design. If you want to verify a
write path (`POST /Document`, `PATCH /Customer/...`), add a dedicated
test that uses a known dev/test record and clean up after itself - don't
mix it into this suite.
