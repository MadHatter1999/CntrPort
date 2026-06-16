<p align="center">
  <img src="https://raw.githubusercontent.com/MadHatter1999/CntrPort/refs/heads/main/cntrport_icon_transparent_bg.png" alt="CntrPort" width="220">
</p>

# Counterpoint API Wrapper Framework

A Flask wrapper around the NCR Counterpoint REST API. Every endpoint in the
[official API Guide](https://github.com/NCRCounterpointAPI/APIGuide) is
exposed as a typed route with **pre / during / post hooks**, so you can
extend, intercept, cache, or reshape Counterpoint without forking NCR's code.

No UI on the wrapper itself. Run it next to the Counterpoint API service
(usually the same host), and your integrations only have to swap ports. The
paths match. (An optional storefront PWA lives in
[`webstore/`](webstore/) - see [Web store](#web-store-webstore).)

> The folder is named `counterpoint-order-entry/` for historical reasons. The
> content is no longer order-entry-specific.

> **License notice:** © 2026 [Anthony Healy](https://anthony-healy.web.app/contact). Free for personal, educational,
> testing, and **small-scale internal business** use. **Commercial, enterprise,
> multi-location, hosted, SaaS, resale, or large-scale retail use requires
> prior written notice to [Anthony Healy](https://anthony-healy.web.app/contact).** See [License](#license) below.

---

## Table of contents

- [License](#license)
- [What it is](#what-it-is)
- [Why it exists](#why-it-exists)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Setup (Windows)](#setup-windows)
- [Configuration (.env)](#configuration-env)
- [Routing model](#routing-model)
- [Direct mode (per-request hook bypass)](#direct-mode-per-request-hook-bypass)
- [Endpoint registry](#endpoint-registry)
- [Hook system](#hook-system)
- [Extension recipes](#extension-recipes)
- [Built-in SQL extensions](#built-in-sql-extensions)
- [SQL helper utilities](#sql-helper-utilities)
- [Generic mirror (forward compatibility)](#generic-mirror-forward-compatibility)
- [Discovery: `/api/cp` manifest](#discovery-apicp-manifest)
- [Health check](#health-check)
- [Web store (`webstore/`)](#web-store-webstore)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Out of scope](#out-of-scope)

> **New:** Optional wrapper API-key auth. Set `CNTRPORT_API_KEY` in `.env`
> and callers must send `X-API-Key: <value>` on every request. See
> [Security model](#security-model).

---

## License

Copyright (c) 2026 [Anthony Healy](https://anthony-healy.web.app/contact).

This project is publicly available for learning, review, experimentation, and small-scale use.

Permission is granted, free of charge, to use, copy, and modify this software for personal, educational, testing, or small-scale internal business purposes, provided that the original copyright notice and project credit remain intact.

### Commercial, Enterprise, and Large-Scale Retail Use

Use of this software in a large-scale retail, enterprise, multi-location, hosted, SaaS, resale, or commercial deployment requires prior written notice to [Anthony Healy](https://anthony-healy.web.app/contact).

For large-scale or commercial use, [Anthony Healy](https://anthony-healy.web.app/contact) asks that users provide visible credit, notify him of the deployment, and consider a donation or contribution to support continued development.

[Anthony Healy](https://anthony-healy.web.app/contact) reserves the right to deny, restrict, or revoke permission for use of this software in cases where the software is being used in a way that is abusive, misleading, competitive without credit, non-compliant with this license, or contrary to the intended spirit of the project.

If permission is denied or revoked, the user or organization must stop using, copying, modifying, deploying, distributing, or relying on this software after receiving written notice.

Continued unauthorized use after written notice may result in legal action, including takedown requests, injunctive relief, damages, and recovery of applicable legal costs where permitted by law.

### No Warranty

This software is provided "as is", without warranty of any kind, express or implied. [Anthony Healy](https://anthony-healy.web.app/contact) is not liable for any damages, losses, business interruption, data loss, or other issues arising from the use of this software.

---

## What it is

- A 1:1 typed wrapper around the NCR Counterpoint API. Every guide endpoint
  is a named Flask route with stable identifiers that **never change**, even
  if NCR renames paths.
- A Flask-style hook system (`pre` / `during` / `post`) so integrators can
  modify requests, swap the upstream call, or rewrite responses **without
  forking app.py**.
- A drop-in proxy: routes are mounted at both `/api/cp/<path>` and at
  `/<path>` so existing integrations only need to change the port number to
  point at this wrapper instead of the Counterpoint API directly.
- A generic mirror at `/api/cp/<path>` catches any endpoint NCR adds before
  the registry is updated, so the wrapper never blocks forward compatibility.
- Optional read-only SQL helpers for building extensions that surface data
  NCR's API doesn't expose (kit components, schema-tolerant queries, etc).

---

## Why it exists

NCR Voyix ships Counterpoint API updates infrequently and without much
partner visibility. Integrators routinely need to:

- Stamp every outbound document with a tenant-specific field.
- Strip or redact sensitive fields from responses before returning them.
- Cache idempotent lookups (item, customer, store) to reduce API load.
- Mock the API entirely in staging.
- Add endpoints that don't exist upstream (catalog browsing, kit explosion).

Patching NCR's binary isn't an option, and forking the API client per
integration turns into a maintenance pit. This wrapper gives every endpoint
a stable name, a typed route, and three hook points, so each of those use
cases is a 5–20 line module instead of a fork.

---

## Architecture

```
Caller (any HTTP client - POS, eCom, integration code)
   |
   |  GET /Items/MAIN           ← drop-in mode (same path as NCR)
   |  GET /api/cp/Items/MAIN    ← explicit-prefix mode
   v
Flask wrapper  (app.py + cp_endpoints.py)
   |
   |── pre hooks       ─ mutate request, short-circuit if desired
   |── during hook     ─ optional: replace the upstream call entirely
   |── upstream call   ─ HTTPS to NCR's API with Basic + APIKey injected
   |── post hooks      ─ mutate the response before returning
   |
   `── (optional) pyodbc → SQL Server, read-only, for SQL extensions
```

The caller never sees Counterpoint credentials. All auth is injected
server-side from `.env`.

---

## Project layout

```
counterpoint-order-entry/
  app.py                # Flask app, dispatcher, hook execution, mirror
  cp_endpoints.py       # Endpoint registry + pre/during/post decorators
  __CntrPHooks__.py     # YOUR custom hooks - auto-loaded by app.py at startup
  requirements.txt
  .env.example          # Copy to .env and fill in
  .gitignore
  README.md             # This file
```

`__CntrPHooks__.py` ships as a starter with commented templates for each
hook type. Edit it in place, no other wiring. Delete it and the wrapper
still runs (just without custom hooks).

If your extensions outgrow one file, a common convention is:

```
  extensions/           # Your custom Flask routes (SQL-backed, etc.)
```

---

## Setup (Windows)

PowerShell:

```powershell
cd counterpoint-order-entry
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# edit .env: set CP_API_PASSWORD, CP_API_KEY, CP_SQL_PASSWORD (if using SQL)
python app.py
```

Service listens on `http://0.0.0.0:5000` by default. Point integrations at
this port - the paths match NCR's API exactly.

### Prerequisites

- Python 3.10+
- A reachable NCR Counterpoint API endpoint (default `https://localhost:52000`)
- A Counterpoint user with API permissions and a generated API key
- (Optional) Microsoft ODBC Driver 17 or 18 for SQL Server, if you want to
  use the SQL helpers / extensions

---

## Configuration (.env)

All settings come from environment variables loaded by `python-dotenv`.

| Variable                | Required | Purpose                                                                 |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `CP_API_BASE_URL`       | yes      | Counterpoint API base URL, e.g. `https://localhost:52000`               |
| `CP_COMPANY_ALIAS`      | yes      | Company alias prefix for Basic Auth (`Alias.User`)                      |
| `CP_API_USERNAME`       | yes      | Counterpoint user name (the part after the dot in Basic Auth)           |
| `CP_API_PASSWORD`       | yes      | Password for that user                                                  |
| `CP_API_KEY`            | yes      | API key value                                                           |
| `CP_API_KEY_HEADER`     | no       | Header name for the API key. Default `APIKey`.                          |
| `CP_API_VERIFY_SSL`     | no       | `false` to accept self-signed certs on local installs. Default `true`.  |
| `CP_ALLOW_DIRECT_MODE`  | no       | `true` lets callers opt out of hooks per-request. Default `false`. See [Direct mode](#direct-mode-per-request-hook-bypass). |
| `CNTRPORT_API_KEY`      | no       | Wrapper-level API key callers must send. Blank = no auth (legacy). See [Security model](#security-model). |
| `CNTRPORT_API_KEY_HEADER` | no     | Header name callers send the wrapper key in. Default `X-API-Key`.       |
| `CNTRPORT_AUTH_EXEMPT_PATHS` | no  | Comma-separated paths that skip the key check. Default `/api/health`.   |
| `CP_SQL_SERVER`         | sql only | SQL Server hostname or `.` for local                                    |
| `CP_SQL_DATABASE`       | sql only | Counterpoint database name                                              |
| `CP_SQL_USER`           | sql only | SQL login                                                               |
| `CP_SQL_PASSWORD`       | sql only | SQL password                                                            |
| `CP_SQL_DRIVER`         | no       | ODBC driver. Default `ODBC Driver 17 for SQL Server`.                   |
| `FLASK_HOST`            | no       | Default `0.0.0.0`                                                       |
| `FLASK_PORT`            | no       | Default `5000`                                                          |
| `FLASK_DEBUG`           | no       | `true` enables Flask's reloader and verbose errors                      |

Counterpoint Basic Auth is constructed as
`<CP_COMPANY_ALIAS>.<CP_API_USERNAME>` (e.g. `Acme.MGR`).

---

## Routing model

Every registered endpoint is mounted at **two** locations:

| Wrapper path                       | Meaning                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `/<guide path>`                    | **Drop-in mode** - identical to NCR's API path       |
| `/api/cp/<guide path>`             | Explicit-prefix mode - useful when this wrapper runs |
|                                    | on a host that already exposes routes at root.       |

Examples:

```
GET  /Items/MAIN                            ── same as GET  /api/cp/Items/MAIN
POST /Document                              ── same as POST /api/cp/Document
PATCH /Customer/12345                       ── same as PATCH /api/cp/Customer/12345
DELETE /Customer/12345/Address              ── same as DELETE /api/cp/Customer/12345/Address
```

Auth matches NCR's (HTTP Basic + APIKey header), but the wrapper injects
both from `.env`, so callers don't need to send them.

Anything not in `cp_endpoints.ENDPOINTS` still falls through to NCR
automatically - at **both** the bare `/<path>` root **and** the
`/api/cp/<path>` prefix. The wrapper is drop-in by default: every
unmatched path gets forwarded upstream, so new NCR endpoints work the
day they ship. The typed registry only matters when you want hooks on
a specific path. See [Generic mirror](#generic-mirror-forward-compatibility).

---

## Direct mode (per-request hook bypass)

Sometimes a caller doesn't want hooks running on a particular request. A
redact hook might be hiding fields they're trying to debug. An ops
dashboard might want to compare wrapper output against raw upstream. Maybe
they just want NCR's exact response shape.

Direct mode is the escape hatch. The caller opts in two ways:

| Mechanism | Value |
| --------- | ----- |
| Query parameter | `?_direct=1` (also `true` / `yes` / `on`) |
| Request header  | `X-CntrP-Mode: direct` |

Either works. The `_direct` query param is stripped before forwarding so
NCR never sees it.

With `CP_ALLOW_DIRECT_MODE=true` in `.env`, an opt-in request skips all
pre/during/post hooks. The wrapper forwards method, query, body, and
content-type to NCR and returns the upstream response unmodified. The
response includes an `X-CntrP-Mode: direct` header so callers can confirm
they got the raw shape.

With `CP_ALLOW_DIRECT_MODE=false` (the default), the opt-in flag is
silently ignored, the normal hooked response is returned, and no
`X-CntrP-Mode` header appears. That default stops anyone from trivially
bypassing a compliance hook in production. Enable it in dev/staging when
you actually want the escape hatch.

### Examples

```bash
# Normal request (hooks run):
curl http://localhost:5000/Customer/12345

# Direct (raw) request via query:
curl 'http://localhost:5000/Customer/12345?_direct=1'

# Direct (raw) request via header:
curl -H 'X-CntrP-Mode: direct' http://localhost:5000/Customer/12345

# Direct on a write path - body + query are forwarded as-is, no pre-hook
# stamping or post-hook reshaping:
curl -X POST 'http://localhost:5000/Document?_direct=1' \
  -H 'Content-Type: application/json' \
  -d '{"PS_DOC_HDR":{...}}'
```

### Equivalent: the generic mirror

`/api/cp/<path>` is also hook-less, since the mirror has no registry
binding. Direct mode is mostly a convenience so callers can stick with the
URL they already use and add a flag, instead of rewriting to the mirror
prefix. Same outcome either way.

### Checking whether it's enabled

`GET /api/cp` returns a `direct_mode` block in the manifest:

```json
"direct_mode": {
  "enabled": false,
  "opt_in_query": "?_direct=1",
  "opt_in_header": "X-CntrP-Mode: direct",
  "description": "..."
}
```

---

## Endpoint registry

The registry in [cp_endpoints.py](cp_endpoints.py) lists every Counterpoint
endpoint the wrapper exposes as a typed route. Each row carries:

- `method` - GET / POST / PUT / PATCH / DELETE
- `guide_path` - the path NCR documents, e.g. `/Customer/{CustNo}/Address`
- `name` - stable identifier hooks attach to; doesn't change if NCR
  renames the path
- `description` - what it does in one line
- `requires_api_key` - whether NCR demands the APIKey header here
- `requires_cp_registration` - whether the company has to be CP-registered

Add or remove entries by editing the list.

### System Administration

| Method | Guide path                                | Registry name              | Description |
| ------ | ----------------------------------------- | -------------------------- | ----------- |
| GET    | `/AdminUsers`                             | `get_admin_users`          | Gets a list of admins for the API. |
| DELETE | `/AdminUser/{UserId}`                     | `delete_admin_user`        | Deletes the provided administrator. |
| GET    | `/APIKey`                                 | `get_api_key`              | Gets information on a single API Key. |
| POST   | `/APIKey`                                 | `post_api_key`             | Posts a new APIKey file and updates the APIKey cache. |
| GET    | `/APIKeys`                                | `get_api_keys`             | Gets a list of all API Keys installed on the server. |
| DELETE | `/CompanyAdmin/{CompanyName}/{AdminUser}` | `delete_company_admin`     | Deletes a company admin by user id. |
| GET    | `/CompanyAdmins/{CompanyName}`            | `get_company_admins`       | Gets a list of Company Admins. |
| POST   | `/CompanyAdmins/{CompanyName}`            | `post_company_admins`      | Adds a list of Company Admins. |
| PUT    | `/CompanyAdmins/{CompanyName}`            | `put_company_admins`       | Sets a list of Company Admins. |
| GET    | `/Database/{Id}`                          | `get_database`             | Gets info about a configured Database (Company). |
| PUT    | `/Database/{Id}`                          | `put_database`             | Updates info about a Database (Company). |
| DELETE | `/Database/{Id}`                          | `delete_database`          | Deletes a Database (Company). |
| GET    | `/Databases`                              | `get_databases`            | Lists all Databases the API can interact with. |
| POST   | `/Databases`                              | `post_databases`           | Adds one or more Databases. |
| GET    | `/Databases/ini`                          | `get_databases_ini`        | Lists company DB info from a companies.ini file. |
| GET    | `/DeviceConfig/{WorkstationID}`           | `get_device_config`        | Device configuration for a workstation. |
| GET    | `/SystemInfo`                             | `get_system_info`          | Gets API server and hardware environment info. |

### Customers & Documents

| Method | Guide path                                | Registry name              | Description |
| ------ | ----------------------------------------- | -------------------------- | ----------- |
| GET    | `/Company`                                | `get_company`              | Company info (SY_COMP & DB_CTL). |
| POST   | `/Customer`                               | `post_customer`            | Adds a new customer. |
| GET    | `/Customer/{CustNo}`                      | `get_customer`             | Customer info. |
| PATCH  | `/Customer/{CustNo}`                      | `patch_customer`           | Updates a customer. |
| POST   | `/Customer/{CustNo}/Address`              | `post_customer_address`    | Adds a shipping address. |
| PATCH  | `/Customer/{CustNo}/Address`              | `patch_customer_address`   | Updates a shipping address. |
| DELETE | `/Customer/{CustNo}/Address`              | `delete_customer_address`  | Deletes a shipping address. |
| POST   | `/Customer/{CustNo}/Card`                 | `post_customer_card`       | Adds a card on file. |
| PATCH  | `/Customer/{CustNo}/Card`                 | `patch_customer_card`      | Updates a card on file. |
| DELETE | `/Customer/{CustNo}/Card`                 | `delete_customer_card`     | Deletes a card on file. |
| POST   | `/Customer/{CustNo}/Note`                 | `post_customer_note`       | Adds a note. |
| PATCH  | `/Customer/{CustNo}/Note`                 | `patch_customer_note`      | Updates a note. |
| DELETE | `/Customer/{CustNo}/Note`                 | `delete_customer_note`     | Deletes a note. |
| GET    | `/Customer/{CustNo}/OpenItems`            | `get_customer_open_items`  | AR open-item info. |
| GET    | `/CustomerControl`                        | `get_customer_control`     | Customer control info. |
| GET    | `/Customers`                              | `get_customers`            | Bulk customer info. |
| GET    | `/Customers/EC`                           | `get_customers_ec`         | Bulk eCommerce customer info. |
| POST   | `/Document`                               | `post_document`            | Adds a new document (ticket). |
| GET    | `/Document/{DocId}`                       | `get_document`             | Info on an unposted document. |
| POST   | `/Document/{DocId}/Contact`               | `post_document_contact`    | Adds a contact to a document. |
| PATCH  | `/Document/{DocId}/Contact`               | `patch_document_contact`   | Updates a contact on a document. |
| PUT    | `/Document/{DocId}/Contact`               | `put_document_contact`     | Adds a contact to a document (PUT variant). |
| DELETE | `/Document/{DocId}/Contact`               | `delete_document_contact`  | Deletes a contact from a document. |
| POST   | `/Document/{DocId}/Lines`                 | `post_document_lines`      | Adds lines to a document. |
| POST   | `/Document/{DocId}/Note`                  | `post_document_note`       | Adds a note to a document. |
| PATCH  | `/Document/{DocId}/Note`                  | `patch_document_note`      | Updates a note on a document. |
| PUT    | `/Document/{DocId}/Note`                  | `put_document_note`        | Updates a customer note (PUT variant). |
| DELETE | `/Document/{DocId}/Note`                  | `delete_document_note`     | Deletes a note from a document. |
| POST   | `/Document/{DocId}/Payments`              | `post_document_payments`   | Adds payments to a document. |

### eCommerce, Gift cards, Inventory, Items

| Method | Guide path                                | Registry name                | Description |
| ------ | ----------------------------------------- | ---------------------------- | ----------- |
| GET    | `/EC`                                     | `get_ec`                     | eCommerce settings. |
| GET    | `/ECCategories`                           | `get_ec_categories`          | eCommerce categories & items. |
| GET    | `/GiftCard/{GiftCardNo}`                  | `get_gift_card`              | Gift card info. |
| GET    | `/GiftCardCode/{GiftCardCode}`            | `get_gift_card_code`         | Gift card code info. |
| GET    | `/GiftCardCodes`                          | `get_gift_card_codes`        | Bulk gift card codes. |
| GET    | `/GiftCards`                              | `get_gift_cards`             | Bulk gift cards. |
| GET    | `/Inventory/{LocId}`                      | `get_inventory_by_location`  | Inventory for a location. |
| GET    | `/InventoryControl`                       | `get_inventory_control`      | Inventory control info. |
| GET    | `/Inventory/EC`                           | `get_inventory_ec`           | eCommerce inventory. |
| GET    | `/Inventory/Locations`                    | `get_inventory_locations`    | Inventory locations list. |
| GET    | `/Item/Images/{Filename}`                 | `get_item_image_filename`    | Fetches an item image by filename. |
| GET    | `/Item/{ItemNo}`                          | `get_item`                   | Item and inventory info. |
| GET    | `/Item/{ItemNo}/Images`                   | `get_item_images`            | Available item images. |
| GET    | `/Item/{ItemNo}/Inventory/{LocId}`        | `get_item_inventory`         | Item inventory at location. |
| GET    | `/Item/{ItemNo}/InventoryCost/{LocId}`    | `get_item_inventory_cost`    | Item inventory cost at location. |
| GET    | `/Item/{ItemNo}/Serial/{SerialNo}`        | `get_item_serial`            | Single serial info. |
| GET    | `/Item/{ItemNo}/Serials/Location/{LocId}` | `get_item_serials`           | Active serials at a location. |
| GET    | `/ItemCategories`                         | `get_item_categories`        | Bulk item categories. |
| GET    | `/ItemCategory/{CategoryCode}`            | `get_item_category`          | Single item category. |
| GET    | `/Items`                                  | `get_items`                  | Bulk items (filterable). |
| GET    | `/Items/{LocId}`                          | `get_items_by_location`      | Bulk items for a location. |

### Pay codes, Roles, Stores, Tax, Users, Vendors

| Method | Guide path                                | Registry name              | Description |
| ------ | ----------------------------------------- | -------------------------- | ----------- |
| POST   | `/NSPTransaction`                         | `post_nsp_transaction`     | Monetra secure pay transactions. |
| GET    | `/PayCode/{Paycode}`                      | `get_pay_code`             | Single paycode. |
| PATCH  | `/PayCode/{Paycode}`                      | `patch_pay_code`           | Updates a paycode. |
| PUT    | `/PayCode/{Paycode}`                      | `put_pay_code`             | Updates a paycode (PUT variant). |
| GET    | `/PayCodes`                               | `get_pay_codes`            | Bulk paycodes. |
| GET    | `/Role/Endpoints`                         | `get_role_endpoints`       | Endpoints available to any role. |
| DELETE | `/Role/{RoleName}`                        | `delete_role`              | Delete a role. |
| GET    | `/Role/{RoleName}`                        | `get_role`                 | Endpoints for a role. |
| PUT    | `/Role/{RoleName}`                        | `put_role`                 | Upsert a role. |
| GET    | `/Role/{RoleName}/Users`                  | `get_role_users`           | Users assigned to a role. |
| PUT    | `/Role/{RoleName}/Users`                  | `put_role_users`           | Sets users on a role. |
| GET    | `/Roles`                                  | `get_roles`                | All roles with endpoint data. |
| GET    | `/Roles/Names`                            | `get_role_names`           | Role names. |
| GET    | `/Roles/Users`                            | `get_roles_users`          | All roles, permissions, and assignments. |
| GET    | `/Store/{StoreID}`                        | `get_store`                | Store info. |
| GET    | `/Store/{StoreID}/Station/{StationID}`    | `get_store_station`        | Station info. |
| POST   | `/Store/{StoreId}/Tokenize`               | `post_store_tokenize`      | Tokenizes the store's cards. |
| GET    | `/Store/{StoreId}/Tokenize`               | `get_store_tokenize_info`  | Store tokenization info. |
| GET    | `/Stores/Tokenized`                       | `get_stores_tokenized`     | Tokenized count per store. |
| GET    | `/TaxCodes`                               | `get_tax_codes`            | Tax codes. |
| POST   | `/User/Admin`                             | `post_user_admin`          | Adds a sysadmin user. |
| PUT    | `/User/Password`                          | `put_user_password`        | Updates the authenticated user's password. |
| GET    | `/User/{UserID}`                          | `get_user`                 | User info. |
| DELETE | `/User/{UserID}/Roles`                    | `delete_user_roles`        | Removes a user's roles. |
| GET    | `/User/{UserID}/Roles`                    | `get_user_roles`           | Roles for a user. |
| PUT    | `/User/{UserID}/Roles`                    | `put_user_roles`           | Sets a user's roles. |
| GET    | `/Users`                                  | `get_users`                | List of users. |
| GET    | `/Users/{CompanyName}`                    | `get_users_for_company`    | Users for a company. |
| GET    | `/Users/Roles`                            | `get_users_roles`          | Users and their roles. |
| GET    | `/VendorItem/{VendorNo}/Item/{ItemNo}`    | `get_vendor_item`          | Vendor item info. |
| GET    | `/Workgroup/{WorkgroupID}`                | `get_workgroup`            | Workgroup info. |

---

## Hook system

Three hook points fire on every request to a registered endpoint:

| Hook    | When                                 | What you can do |
| ------- | ------------------------------------ | --------------- |
| `pre`   | Before the upstream call             | Mutate request body, query, headers, or path params. Set `ctx["skip_upstream"] = True` to short-circuit. Multiple pre-hooks allowed; they run in registration order. |
| `during`| Replaces the upstream call           | Talk to a different backend, return canned data, hit a cache. One per endpoint. |
| `post`  | After the upstream call (or during)  | Mutate response body, status, headers, content-type. Multiple allowed; registration order. |

### The context dict

Hooks receive a single `ctx` dict. Mutate it in place.

```python
ctx = {
    "name":                  str,    # registry name, e.g. "get_customer"
    "method":                str,    # HTTP method
    "guide_path":            str,    # upstream path with params substituted
    "guide_path_template":   str,    # original template, e.g. "/Customer/{CustNo}"
    "path_params":           dict,   # {param_name: value}
    "query":                 dict,   # query string (mutable)
    "request_body":          Any,    # parsed JSON or None
    "request_headers":       dict,   # headers to send upstream

    "upstream_status":       int|None,
    "upstream_body":         Any,    # parsed JSON, str, or bytes
    "upstream_headers":      dict,
    "upstream_content_type": str|None,

    "response_status":       int|None,   # defaults to upstream_status
    "response_body":         Any,        # defaults to upstream_body
    "response_headers":      dict,
    "response_content_type": str|None,   # defaults to upstream_content_type

    "skip_upstream":         bool,   # pre-hook sets True to bypass upstream
    "meta":                  dict,   # free-form scratch space
}
```

### Registering hooks

Open [__CntrPHooks__.py](__CntrPHooks__.py) and write your hooks. That's it.
`app.py` looks for the file at startup with `importlib.util.find_spec` and
imports it. The `@cp_endpoints.pre/during/post` decorators register
themselves on import.

The file ships with commented templates for each hook type. Uncomment and
tweak them, or delete them and write your own.

```python
# __CntrPHooks__.py
import cp_endpoints

@cp_endpoints.pre("post_document")
def stamp_default_user(ctx):
    """Make sure every order is recorded under a known USR_ID."""
    body = ctx["request_body"] or {}
    body.setdefault("PS_DOC_HDR", {}).setdefault("USR_ID", "API")
    ctx["request_body"] = body

@cp_endpoints.post("get_customer")
def redact_credit_limit(ctx):
    body = ctx["response_body"]
    if isinstance(body, dict):
        body.pop("AR_CRD_LIM", None)
```

Restart Flask to pick up changes (the debug reloader handles this in dev).
The startup log shows which branch fired:

```
INFO Loaded hooks from __CntrPHooks__.py
```

or:

```
INFO No __CntrPHooks__.py found, running without custom hooks.
```

Hooks attach to the registry name (third column in the tables above), not
the path. If NCR renames `/Customer/{CustNo}` tomorrow, your hooks keep
working. The dunder-style filename is just a convention; it stands out in
the file tree and signals "framework wiring" rather than ordinary module.

---

## Extension recipes

#### Stamp a default field on every order

```python
@cp_endpoints.pre("post_document")
def force_store_id(ctx):
    body = ctx["request_body"] or {}
    body.setdefault("PS_DOC_HDR", {})["STR_ID"] = "MAIN"
    ctx["request_body"] = body
```

#### Drop sensitive fields before returning

```python
@cp_endpoints.post("get_customer")
def redact(ctx):
    body = ctx["response_body"]
    if isinstance(body, dict):
        for k in ("AR_CRD_LIM", "AR_ACCT_OPN_DT", "INTERNAL_NOTES"):
            body.pop(k, None)
```

#### Reject bad input before we hit NCR

```python
@cp_endpoints.pre("get_item")
def reject_blank_item(ctx):
    if not ctx["path_params"].get("ItemNo", "").strip():
        ctx["skip_upstream"] = True
        ctx["response_status"] = 400
        ctx["response_body"] = {"ok": False, "message": "ItemNo required."}
```

#### In-memory TTL cache for an idempotent GET

```python
import time
_cache: dict[tuple, tuple[float, object]] = {}
TTL = 60  # seconds

@cp_endpoints.pre("get_store")
def cache_lookup(ctx):
    key = (ctx["name"], tuple(sorted(ctx["path_params"].items())))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        ctx["skip_upstream"] = True
        ctx["response_status"] = 200
        ctx["response_body"] = hit[1]

@cp_endpoints.post("get_store")
def cache_store(ctx):
    if ctx["response_status"] == 200:
        key = (ctx["name"], tuple(sorted(ctx["path_params"].items())))
        _cache[key] = (time.time(), ctx["response_body"])
```

#### Stub the upstream call in staging

```python
@cp_endpoints.during("get_system_info")
def stub_system_info(ctx):
    ctx["upstream_status"] = 200
    ctx["upstream_body"] = {"stub": True, "env": "staging"}
```

#### Audit every write

```python
import logging
log = logging.getLogger("cp.audit")

for name in ("post_document", "post_customer", "patch_customer",
             "delete_customer_address", "post_document_payments"):
    @cp_endpoints.post(name)
    def _audit(ctx, _name=name):
        log.info("%s %s -> %s",
                 ctx["method"], ctx["guide_path"], ctx["response_status"])
```

#### Add a brand-new typed Flask route

Registry routes beat the generic mirror because they're more specific. A
hand-written `@app.route` at a *more specific* path wins over a registry
route. Same-path overrides need the override pattern below.

```python
@app.get("/api/sql/my-report")
def my_report():
    # do whatever, including using get_sql_connection()
    return jsonify({"rows": [...]})

@app.get("/api/cp/Items/<loc_id>")
def my_items(loc_id):
    # Overrides the registry route for /Items/{LocId}. Hooks are skipped
    # for this path; your code is in charge end to end.
    ...
```

#### Replace a registry endpoint entirely

If you want to swap out the full behavior of one endpoint (not just hook
into it), use a `during` hook. It bypasses the upstream HTTP call but
keeps your pre/post hooks for that endpoint.

```python
@cp_endpoints.during("get_inventory_locations")
def from_warehouse_service(ctx):
    # Call your own warehouse microservice instead of NCR
    import requests
    r = requests.get("http://warehouse.internal/locations")
    ctx["upstream_status"] = r.status_code
    ctx["upstream_body"] = r.json()
```

---

## Built-in SQL extensions

SQL-backed routes shipped as examples. They're useful out of the box, but
nothing in the framework depends on them, so rip them out or replace them.
Every query is parameterized and read-only.

| Method | Path                                             | Query params                                            |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| GET    | `/api/sql/items`                                 | `q`, `limit`, `kits_only`, `category`, `subcategory`    |
| GET    | `/api/sql/items/<item_no>`                       | -                                                       |
| GET    | `/api/sql/items/<item_no>/kit-components`        | -                                                       |
| GET    | `/api/sql/kits`                                  | `q`, `limit`                                            |
| GET    | `/api/sql/categories`                            | -                                                       |
| GET    | `/api/sql/subcategories`                         | `category`                                              |

The kit-components route walks a list of likely Counterpoint kit tables
(`IM_PRC_KIT_COMP`, `IM_KIT_COMP`, `IM_KIT_COMPONENT`, `IM_KIT_DTL`,
`IM_KIT`, `IM_BOM`, `IM_BOM_COMP`) and falls back to a diagnostic dump if
none exist. Adjust `_KIT_COMPONENT_TABLE_GUESSES` in [app.py](app.py) for
your install.

---

## SQL helper utilities

Building your own SQL-backed extension? The helpers in [app.py](app.py):

| Helper                                  | What it does                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `get_sql_connection() -> Connection`    | Opens a pyodbc connection from `.env`. Use `with`.                                    |
| `get_existing_columns(table) -> set`    | Column names that actually exist on `table`. Cached per process; survives schema drift between CP versions. |
| `_safe_select(table, wanted) -> list`   | Intersects `wanted` with the columns that exist on `table`.                           |
| `_jsonable(val) -> Any`                 | Turns Decimal / bytes into something `jsonify` accepts.                               |
| `_row_to_dict(cursor, row) -> dict`     | pyodbc row → `{column: value, ...}` dict.                                             |
| `_sql_error(message, exc)`              | Logs a warning and returns `(jsonify, 500)`. Use it as the `except` return value.     |

Example:

```python
from app import app, get_sql_connection, _row_to_dict, _sql_error

@app.get("/api/sql/customers-by-zip")
def customers_by_zip():
    zip_code = request.args.get("zip", "").strip()
    if not zip_code:
        return jsonify({"ok": False, "message": "zip required"}), 400
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(
                "SELECT TOP (50) CUST_NO, NAM, ADRS_1, CITY, STATE, ZIP_COD "
                "FROM AR_SHIP_ADRS WHERE ZIP_COD = ? ORDER BY CUST_NO",
                zip_code,
            )
            return jsonify({"customers": [_row_to_dict(cur, r) for r in cur.fetchall()]})
    except Exception as exc:
        return _sql_error("zip lookup failed", exc)
```

---

## Generic mirror (forward compatibility)

Any Counterpoint endpoint not in the typed registry is still reachable
at **either** of:

```
<METHOD> /api/cp/<guide path>
<METHOD> /<guide path>
```

Both forward method, query string, headers, and body bytes transparently
to the upstream Counterpoint API. Auth is injected the same way as on
registered routes. Reserved roots `/api/*` and `/static/*` are excluded
from the bare-root mirror so the wrapper's own endpoints (`/api/health`,
`/api/cp`, `/api/sql/*`) aren't shadowed.

Practical consequence: this wrapper is a **true drop-in by default**.
Point your existing Counterpoint client at this port and every endpoint
works on day one, registered or not. The typed registry only matters
when you want hooks (pre / during / post) on a specific path; everything
else falls through to NCR unchanged.

Mirror requests don't run hooks. If you want hooks for a path, add the
row to `cp_endpoints.ENDPOINTS` and the typed dispatcher takes over.

---

## Discovery: `/api/cp` manifest

`GET /api/cp` returns a JSON manifest describing the wrapper:

```json
{
  "ok": true,
  "message": "Wrapper for the NCR Counterpoint API ...",
  "guide": "https://github.com/NCRCounterpointAPI/APIGuide",
  "base_url": "https://localhost:52000",
  "company_alias": "Acme",
  "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "registry_count": 98,
  "registry": [
    {
      "method": "GET",
      "guide_path": "/Customer/{CustNo}",
      "name": "get_customer",
      "description": "Gets information about a customer.",
      "requires_api_key": true,
      "requires_cp_registration": true,
      "wrapper_paths": ["/api/cp/Customer/{CustNo}", "/Customer/{CustNo}"],
      "has_pre_hooks": false,
      "has_during_hook": false,
      "has_post_hooks": true
    },
    ...
  ],
  "sql_extensions": ["/api/sql/items", ...]
}
```

The `has_*_hooks` flags let you see which endpoints have been extended.
Handy for ops dashboards and integration smoke tests.

---

## Health check

`GET /api/health` pings the SQL connection and the Counterpoint API:

```json
{
  "ok": true,
  "company_alias": "Acme",
  "sql": {"ok": true, "database": "Acme"},
  "counterpoint_api": {"ok": true, "base_url": "https://localhost:52000", "status_code": 401}
}
```

A 401 from CP still flips `ok=true`; the service answered, that's the
point. Only transport errors (timeout, refused, DNS) flip it false.

---

## Web store (`webstore/`)

An optional, installable storefront PWA lives in [`webstore/`](webstore/). It
turns **whatever is in Counterpoint into a web store**: products, categories,
pricing, the store name and locations are all read live from CP - nothing is
hard-coded. It's served separately (static build) and talks to this wrapper.

`store_api.py` adds the storefront aggregation endpoints (registered from
`app.py`); they shape Counterpoint into clean JSON and write orders back as
Documents:

| Endpoint                          | Returns / does                                   |
| --------------------------------- | ------------------------------------------------ |
| `GET /api/store/config`           | store name, currency, tax rate, locations        |
| `GET /api/store/categories`       | `[{ id, name, image, tint }]`                    |
| `GET /api/store/products`         | `[{ id, name, categoryId, price, unit, image }]` |
| `GET /api/store/item-image/<id>`  | item photo (or an SVG placeholder)               |
| `POST /api/store/order`           | writes a Counterpoint `Document` (ticket)        |

Catalog reads use the read-only SQL helpers; the image proxy and order
writeback use the Counterpoint API. Configure the few presentation values CP
doesn't model via `.env` (`STORE_NAME`, `STORE_CURRENCY`, `STORE_TAX_RATE`,
`STORE_DEFAULT_LOC_ID`, `STORE_DEFAULT_CUST_NO`). See
[`webstore/README.md`](webstore/README.md) to run the storefront.

---

## Security model

Secrets live only in `.env`. `.gitignore` excludes `.env` and its common
variants so they can't be committed by accident. `.env.example` is the
only env file checked in.

`/api/health` and `/api/cp` only ever return non-sensitive status. Logs
never include passwords or API keys.

There's no SQL write endpoint, and no generic SQL endpoint. Shipped
queries are parameterized and read-only. When you add SQL extensions,
keep the same rule: writes go through the Counterpoint API so triggers
and replication paths stay intact.

The wrapper supports an optional API-key gate. Set `CNTRPORT_API_KEY` in
`.env` and every caller must send the same value in the
`CNTRPORT_API_KEY_HEADER` (default `X-API-Key`). Requests without it get a
401. The key is **not** forwarded to NCR - `CP_API_KEY` still handles
upstream auth. Paths listed in `CNTRPORT_AUTH_EXEMPT_PATHS` (default
`/api/health`) skip the check so uptime monitors keep working.

```bash
# With CNTRPORT_API_KEY set in .env:
curl -H 'X-API-Key: your-key-here' http://localhost:5000/Customer/12345

# Without the header (or wrong value):
# -> 401 {"ok": false, "message": "Missing or invalid X-API-Key header."}
```

Leave `CNTRPORT_API_KEY` blank to keep the wrapper open (legacy behavior).
Either way, still treat the network the wrapper sits on as trusted: bind
it to localhost or an internal segment and put a reverse proxy in front
for TLS termination and rate limiting.

In anything non-dev, replace the SQL `sa` account with a dedicated
read-only login that has `SELECT` only on the tables your extensions
touch.

`CP_API_VERIFY_SSL=true` is the default. Only disable it against
self-signed certs in development.

---

## Troubleshooting

### `IM002 / Data source name not found`

The ODBC driver isn't installed or the driver name doesn't match. Install
"Microsoft ODBC Driver 17 for SQL Server" (or 18) and set `CP_SQL_DRIVER`:

```
CP_SQL_DRIVER=ODBC Driver 18 for SQL Server
```

### `SSL: CERTIFICATE_VERIFY_FAILED` against the Counterpoint API

Local installs use a self-signed cert. For development:

```
CP_API_VERIFY_SSL=false
```

The wrapper silences the resulting urllib3 warning. Re-enable verification
in production by installing a trusted certificate.

### Health says CP API is down

Check `CP_API_BASE_URL` against the running service (default port 52000),
the Windows service `Counterpoint API` (or whatever yours is called), and
firewall rules. A 401 isn't down - the pill stays green on any HTTP
response. Red only fires on transport errors.

### Health says SQL is down

Recheck `CP_SQL_SERVER`, `CP_SQL_DATABASE`, and credentials. Named
instance? Use `CP_SQL_SERVER=.\SQLEXPRESS` or `HOSTNAME\INSTANCE`. For
Azure / managed SQL you may need `Encrypt=yes` in `get_sql_connection()`.

### A registered route returns 405 Method Not Allowed

The path is registered but not for that method. Look at the rows for that
`guide_path` in `cp_endpoints.ENDPOINTS`. To add a method, drop in another
tuple with the same `guide_path` and the new `method`.

### My hook never runs

Three things to check. First, the registry name in your decorator has to
match the third column of a row exactly. Typos raise
`KeyError: Unknown endpoint name` at import. Second, `app.py` has to
actually import your hook module. Hooks register on import; if Python
never runs the file, the decorators never fire. Third, make sure Flask
isn't routing to the generic mirror instead - mirror paths skip hooks. Hit
`/api/cp` and look at `has_pre_hooks` / `has_during_hook` /
`has_post_hooks` for the endpoint you care about.

### `during`-hook collision

One `during` hook per endpoint, period. The second one raises
`RuntimeError: during-hook already registered`. If you need to replace
one (tests usually do), call `cp_endpoints.clear_hooks("name")` first.

### A new NCR endpoint isn't in the registry yet

Hit it through the mirror at `<METHOD> /api/cp/<NewPath>` until you add a
row to `cp_endpoints.ENDPOINTS`. No hooks there, but it forwards fine.

---

## Out of scope

Things the framework deliberately doesn't do:

- User authentication or login (put a reverse proxy in front).
- UI. Callers bring their own (POS, eCom, integration code).
- Payments or PCI cardholder data. `/NSPTransaction` forwards to NCR's
  Monetra path; payments live there, not here.
- Generic SQL. Read-only catalog lookups are as far as it goes.
- Multi-tenant isolation. One `.env`, one Counterpoint company.
- Schema migrations against Counterpoint tables. Writes go through the
  Counterpoint API, never SQL.
