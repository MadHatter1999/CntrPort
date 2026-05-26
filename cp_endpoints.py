"""
Endpoint registry + pre/during/post hooks for the Counterpoint API wrapper.

The ENDPOINTS list below tracks every Counterpoint API path the wrapper
exposes as a typed Flask route. Each row gives a stable name; hooks attach
to that name and survive NCR renaming the underlying path.

Reference for paths and verbs: https://github.com/NCRCounterpointAPI/APIGuide

Hook kinds:
  pre(name)    runs before the upstream call. Mutate the ctx dict. Setting
               ctx['skip_upstream'] = True bypasses the upstream call; the
               pre-hook then has to supply ctx['response_*'].
  during(name) replaces the upstream call. One per endpoint. The hook must
               set ctx['upstream_status'] and ctx['upstream_body']. Handy
               for stubs, caches, or pointing at a different backend.
  post(name)   runs after the upstream call (or your during-hook). Mutate
               ctx['response_*']. Several post-hooks fire in registration
               order.

ctx fields the hooks see/mutate:
  name, method, guide_path (substituted), guide_path_template (with braces),
  path_params, query, request_body, request_headers,
  upstream_status / _body / _headers / _content_type,
  response_status / _body / _headers / _content_type (default to upstream_*),
  skip_upstream, meta (free-form scratch).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Callable, Iterable

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

# Tuple shape:
#   (method, guide_path, name, description, requires_api_key, requires_cp_registration)
Endpoint = tuple[str, str, str, str, bool, bool]

ENDPOINTS: list[Endpoint] = [
    # --- System Administration ----------------------------------------------
    ("GET",    "/AdminUsers",                              "get_admin_users",         "Gets a list of admins for the API.",                                                False, True),
    ("DELETE", "/AdminUser/{UserId}",                      "delete_admin_user",       "Deletes the provided administrator.",                                               False, False),
    ("GET",    "/APIKey",                                  "get_api_key",             "Gets information on a single API Key.",                                             False, False),
    ("POST",   "/APIKey",                                  "post_api_key",            "Posts a new APIKey file and updates the APIKey cache.",                             False, False),
    ("GET",    "/APIKeys",                                 "get_api_keys",            "Gets a list of all API Keys installed on the server.",                              False, False),
    ("DELETE", "/CompanyAdmin/{CompanyName}/{AdminUser}",  "delete_company_admin",    "Deletes a company admin by user id.",                                               False, False),
    ("GET",    "/CompanyAdmins/{CompanyName}",             "get_company_admins",      "Gets a list of Company Admins for the company.",                                    False, False),
    ("POST",   "/CompanyAdmins/{CompanyName}",             "post_company_admins",     "Adds a list of Company Admins.",                                                    False, False),
    ("PUT",    "/CompanyAdmins/{CompanyName}",             "put_company_admins",      "Sets a list of Company Admins for the company.",                                    False, False),
    ("GET",    "/Database/{Id}",                           "get_database",            "Gets information about a Database (Company) configured for use by the API Server.", False, False),
    ("PUT",    "/Database/{Id}",                           "put_database",            "Updates information about a Database (Company).",                                   False, False),
    ("DELETE", "/Database/{Id}",                           "delete_database",         "Deletes a Database (Company).",                                                     False, False),
    ("GET",    "/Databases",                               "get_databases",           "Gets a list of all Databases (Companies) the API is able to interact with.",        False, False),
    ("POST",   "/Databases",                               "post_databases",          "Adds one or more Databases (Companies) the API can interact with.",                 False, False),
    ("GET",    "/Databases/ini",                           "get_databases_ini",       "Gets a list of company DB information from a companies.ini file.",                  False, False),
    ("GET",    "/DeviceConfig/{WorkstationID}",            "get_device_config",       "Retrieves the device configuration settings for a specified workstation.",          False, False),
    ("GET",    "/SystemInfo",                              "get_system_info",         "Gets information about the API server and hardware environment.",                   False, False),

    # --- Company / Customers ------------------------------------------------
    ("GET",    "/Company",                                 "get_company",             "Gets information about the given company (from SY_COMP & DB_CTL).",                 True,  True),
    ("POST",   "/Customer",                                "post_customer",           "Adds a new customer record.",                                                       True,  True),
    ("GET",    "/Customer/{CustNo}",                       "get_customer",            "Gets information about a customer.",                                                True,  True),
    ("PATCH",  "/Customer/{CustNo}",                       "patch_customer",          "Updates information about a customer.",                                             True,  True),
    ("POST",   "/Customer/{CustNo}/Address",               "post_customer_address",   "Adds a new shipping address to an existing customer.",                              True,  True),
    ("PATCH",  "/Customer/{CustNo}/Address",               "patch_customer_address",  "Updates an existing shipping address for an existing customer.",                    True,  True),
    ("DELETE", "/Customer/{CustNo}/Address",               "delete_customer_address", "Deletes a shipping address from an existing customer.",                             True,  True),
    ("POST",   "/Customer/{CustNo}/Card",                  "post_customer_card",      "Adds a credit card on file to an existing customer.",                               True,  True),
    ("PATCH",  "/Customer/{CustNo}/Card",                  "patch_customer_card",     "Updates an existing credit card on file for an existing customer.",                 True,  True),
    ("DELETE", "/Customer/{CustNo}/Card",                  "delete_customer_card",    "Deletes a credit card on file for an existing customer.",                           True,  True),
    ("POST",   "/Customer/{CustNo}/Note",                  "post_customer_note",      "Adds a new note to an existing customer.",                                          True,  True),
    ("PATCH",  "/Customer/{CustNo}/Note",                  "patch_customer_note",     "Updates an existing note on an existing customer.",                                 True,  True),
    ("DELETE", "/Customer/{CustNo}/Note",                  "delete_customer_note",    "Deletes a note from an existing customer.",                                         True,  True),
    ("GET",    "/Customer/{CustNo}/OpenItems",             "get_customer_open_items", "Gets customer AR Open Item information.",                                           True,  True),
    ("GET",    "/CustomerControl",                         "get_customer_control",    "Gets customer control information.",                                                True,  True),
    ("GET",    "/Customers",                               "get_customers",           "Gets information on customers in bulk.",                                            True,  True),
    ("GET",    "/Customers/EC",                            "get_customers_ec",        "Gets information on eCommerce customers in bulk.",                                  True,  True),

    # --- Documents ----------------------------------------------------------
    ("POST",   "/Document",                                "post_document",           "Adds a new document (ticket).",                                                     True,  True),
    ("GET",    "/Document/{DocId}",                        "get_document",            "Gets information on an existing document that hasn't been posted yet.",             True,  True),
    ("POST",   "/Document/{DocId}/Contact",                "post_document_contact",   "Adds a contact to an existing document.",                                           True,  True),
    ("PATCH",  "/Document/{DocId}/Contact",                "patch_document_contact",  "Updates a contact on an existing document.",                                        True,  True),
    ("PUT",    "/Document/{DocId}/Contact",                "put_document_contact",    "Adds a contact to an existing document (PUT variant).",                             True,  True),
    ("DELETE", "/Document/{DocId}/Contact",                "delete_document_contact", "Deletes a contact from an existing document.",                                      True,  True),
    ("POST",   "/Document/{DocId}/Lines",                  "post_document_lines",     "Adds Lines to a document.",                                                         True,  True),
    ("POST",   "/Document/{DocId}/Note",                   "post_document_note",      "Adds a note to an existing document.",                                              True,  True),
    ("PATCH",  "/Document/{DocId}/Note",                   "patch_document_note",     "Updates a note on an existing document.",                                           True,  True),
    ("PUT",    "/Document/{DocId}/Note",                   "put_document_note",       "Updates an existing customer note (PUT variant).",                                  True,  True),
    ("DELETE", "/Document/{DocId}/Note",                   "delete_document_note",    "Deletes a note from an existing document.",                                         True,  True),
    ("POST",   "/Document/{DocId}/Payments",               "post_document_payments",  "Adds Payments to a document.",                                                      True,  True),

    # --- eCommerce ----------------------------------------------------------
    ("GET",    "/EC",                                      "get_ec",                  "Gets eCommerce settings.",                                                          True,  True),
    ("GET",    "/ECCategories",                            "get_ec_categories",       "Gets eCommerce Categories and items.",                                              True,  True),

    # --- Gift cards ---------------------------------------------------------
    ("GET",    "/GiftCard/{GiftCardNo}",                   "get_gift_card",           "Gets gift card information.",                                                       True,  True),
    ("GET",    "/GiftCardCode/{GiftCardCode}",             "get_gift_card_code",      "Gets gift card code information.",                                                  True,  True),
    ("GET",    "/GiftCardCodes",                           "get_gift_card_codes",     "Gets information on gift card codes in bulk.",                                      True,  True),
    ("GET",    "/GiftCards",                               "get_gift_cards",          "Gets information of Gift Cards in bulk.",                                           True,  True),

    # --- Inventory ----------------------------------------------------------
    ("GET",    "/Inventory/{LocId}",                       "get_inventory_by_location","Gets inventory information for all items for a given location.",                   True,  True),
    ("GET",    "/InventoryControl",                        "get_inventory_control",   "Gets inventory control information.",                                               True,  True),
    ("GET",    "/Inventory/EC",                            "get_inventory_ec",        "Gets eCommerce inventory information for all eCommerce items.",                     True,  True),
    ("GET",    "/Inventory/Locations",                     "get_inventory_locations", "Gets information about inventory locations.",                                       True,  True),

    # --- Items --------------------------------------------------------------
    ("GET",    "/Item/Images/{Filename}",                  "get_item_image_filename", "Gets an item image for the given item and filename.",                               True,  True),
    ("GET",    "/Item/{ItemNo}",                           "get_item",                "Gets item and item inventory information.",                                         True,  True),
    ("GET",    "/Item/{ItemNo}/Images",                    "get_item_images",         "Gets a list of available item images for a given item.",                            True,  True),
    ("GET",    "/Item/{ItemNo}/Inventory/{LocId}",         "get_item_inventory",      "Gets item inventory information for a given item and location.",                    True,  True),
    ("GET",    "/Item/{ItemNo}/InventoryCost/{LocId}",     "get_item_inventory_cost", "Gets item inventory cost for a given item and location.",                           True,  True),
    ("GET",    "/Item/{ItemNo}/Serial/{SerialNo}",         "get_item_serial",         "Gets serial information for the given item & serial number.",                       True,  False),
    ("GET",    "/Item/{ItemNo}/Serials/Location/{LocId}",  "get_item_serials",        "Gets serials that are active for the given item at the given location.",            True,  False),
    ("GET",    "/ItemCategories",                          "get_item_categories",     "Gets item Categories in bulk.",                                                     True,  True),
    ("GET",    "/ItemCategory/{CategoryCode}",             "get_item_category",       "Gets item category information for the given category code.",                       True,  True),
    ("GET",    "/Items",                                   "get_items",               "Gets item information in bulk. Filterable by category or subcategory.",             True,  True),
    ("GET",    "/Items/{LocId}",                           "get_items_by_location",   "Gets item information for a given location in bulk.",                               True,  True),

    # --- Payments / pay codes ----------------------------------------------
    ("POST",   "/NSPTransaction",                          "post_nsp_transaction",    "Posts a list of secure pay transactions from Monetra to the db.",                   False, False),
    ("GET",    "/PayCode/{Paycode}",                       "get_pay_code",            "Gets information about a given Paycode.",                                           True,  True),
    ("PATCH",  "/PayCode/{Paycode}",                       "patch_pay_code",          "Updates information about a Paycode.",                                              True,  True),
    ("PUT",    "/PayCode/{Paycode}",                       "put_pay_code",            "Updates an existing paycode (PUT variant).",                                        True,  True),
    ("GET",    "/PayCodes",                                "get_pay_codes",           "Gets information on Paycodes in bulk.",                                             True,  True),

    # --- Roles & users (RBAC) -----------------------------------------------
    ("GET",    "/Role/Endpoints",                          "get_role_endpoints",      "Gets a list of endpoints that can be made available to any role.",                  False, False),
    ("DELETE", "/Role/{RoleName}",                         "delete_role",             "Deletes a role.",                                                                   False, False),
    ("GET",    "/Role/{RoleName}",                         "get_role",                "Gets endpoint information for a role.",                                             False, False),
    ("PUT",    "/Role/{RoleName}",                         "put_role",                "Updates or inserts a role.",                                                        False, False),
    ("GET",    "/Role/{RoleName}/Users",                   "get_role_users",          "Gets a list of users assigned to the role.",                                        False, False),
    ("PUT",    "/Role/{RoleName}/Users",                   "put_role_users",          "Adds or updates the users list belonging to the role.",                             False, False),
    ("GET",    "/Roles",                                   "get_roles",               "Gets a list of roles with endpoint data.",                                          False, False),
    ("GET",    "/Roles/Names",                             "get_role_names",          "Gets a list of role names.",                                                        False, False),
    ("GET",    "/Roles/Users",                             "get_roles_users",         "Gets a list of all roles with permissions and assigned users.",                     False, False),

    # --- Stores / stations / tokenization -----------------------------------
    ("GET",    "/Store/{StoreID}",                         "get_store",               "Gets information on a store.",                                                      True,  True),
    ("GET",    "/Store/{StoreID}/Station/{StationID}",     "get_store_station",       "Gets information on a station.",                                                    True,  True),
    ("POST",   "/Store/{StoreId}/Tokenize",                "post_store_tokenize",     "Tokenizes the cards for the store.",                                                False, True),
    ("GET",    "/Store/{StoreId}/Tokenize",                "get_store_tokenize_info", "Gets tokenization information for the store.",                                      False, True),
    ("GET",    "/Stores/Tokenized",                        "get_stores_tokenized",    "Gets the tokenized count of customer cards on file for each secure pay store.",     False, True),

    # --- Tax ----------------------------------------------------------------
    ("GET",    "/TaxCodes",                                "get_tax_codes",           "Gets information on Tax Codes.",                                                    True,  True),

    # --- Users --------------------------------------------------------------
    ("POST",   "/User/Admin",                              "post_user_admin",         "Adds a new sysadmin user.",                                                         False, True),
    ("PUT",    "/User/Password",                           "put_user_password",       "Updates the authenticated user's password.",                                        False, False),
    ("GET",    "/User/{UserID}",                           "get_user",                "Gets information on a User.",                                                       True,  True),
    ("DELETE", "/User/{UserID}/Roles",                     "delete_user_roles",       "Deletes a user's assigned roles.",                                                  False, False),
    ("GET",    "/User/{UserID}/Roles",                     "get_user_roles",          "Gets a list of roles for the user.",                                                False, False),
    ("PUT",    "/User/{UserID}/Roles",                     "put_user_roles",          "Updates a user's assigned roles.",                                                  False, False),
    ("GET",    "/Users",                                   "get_users",               "Gets a list of users.",                                                             False, False),
    ("GET",    "/Users/{CompanyName}",                     "get_users_for_company",   "Gets a list of users for the company.",                                             False, False),
    ("GET",    "/Users/Roles",                             "get_users_roles",         "Gets a list of users and their assigned roles.",                                    False, False),

    # --- Vendor items / workgroups ------------------------------------------
    ("GET",    "/VendorItem/{VendorNo}/Item/{ItemNo}",     "get_vendor_item",         "Retrieves information about a Vendor Item.",                                        True,  True),
    ("GET",    "/Workgroup/{WorkgroupID}",                 "get_workgroup",           "Gets workgroup information.",                                                       True,  True),
]


# Quick-lookup helpers ------------------------------------------------------

_BY_NAME: dict[str, Endpoint] = {ep[2]: ep for ep in ENDPOINTS}


def find_endpoint(name: str) -> Endpoint | None:
    return _BY_NAME.get(name)


def iter_endpoints() -> Iterable[Endpoint]:
    return iter(ENDPOINTS)


# ---------------------------------------------------------------------------
# Hook registration
# ---------------------------------------------------------------------------

HookFn = Callable[[dict], None]

_pre_hooks: dict[str, list[HookFn]] = defaultdict(list)
_post_hooks: dict[str, list[HookFn]] = defaultdict(list)
_during_hooks: dict[str, HookFn] = {}


def pre(name: str) -> Callable[[HookFn], HookFn]:
    """Register a pre-request hook against `name`. Multiple allowed; they run
    in registration order before the upstream call."""
    if name not in _BY_NAME:
        raise KeyError(f"Unknown endpoint name: {name!r}")
    def deco(fn: HookFn) -> HookFn:
        _pre_hooks[name].append(fn)
        return fn
    return deco


def post(name: str) -> Callable[[HookFn], HookFn]:
    """Register a post-response hook against `name`. Multiple allowed; they
    run in registration order after the upstream call (or your during-hook)."""
    if name not in _BY_NAME:
        raise KeyError(f"Unknown endpoint name: {name!r}")
    def deco(fn: HookFn) -> HookFn:
        _post_hooks[name].append(fn)
        return fn
    return deco


def during(name: str) -> Callable[[HookFn], HookFn]:
    """Register a hook that replaces the upstream call for `name`. Only one
    per endpoint. The hook must set ctx['upstream_status'] and
    ctx['upstream_body']."""
    if name not in _BY_NAME:
        raise KeyError(f"Unknown endpoint name: {name!r}")
    def deco(fn: HookFn) -> HookFn:
        if name in _during_hooks:
            raise RuntimeError(f"during-hook already registered for endpoint {name!r}")
        _during_hooks[name] = fn
        return fn
    return deco


def get_pre_hooks(name: str) -> list[HookFn]:
    return _pre_hooks.get(name, [])


def get_post_hooks(name: str) -> list[HookFn]:
    return _post_hooks.get(name, [])


def get_during_hook(name: str) -> HookFn | None:
    return _during_hooks.get(name)


def clear_hooks(name: str | None = None) -> None:
    """Wipe hooks for one endpoint, or all of them if name is None. Tests use this."""
    if name is None:
        _pre_hooks.clear()
        _post_hooks.clear()
        _during_hooks.clear()
        return
    _pre_hooks.pop(name, None)
    _post_hooks.pop(name, None)
    _during_hooks.pop(name, None)
