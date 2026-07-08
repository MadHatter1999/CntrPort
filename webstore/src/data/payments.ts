import { apiUrl, authHeaders } from "./api";

/**
 * Payment-processor configuration for the storefront.
 *
 * The catalogue of supported providers lives here (the admin picks ONE). The
 * actual credentials are stored server-side by the CntrPort wrapper - secret
 * keys never live in this browser bundle. The storefront only ever reads the
 * secret-free status (`fetchPaymentStatus`) to decide live vs demo checkout;
 * the admin reads/writes the full (redacted) config behind the wrapper API key.
 *
 * When no provider is enabled + fully configured, status.mode is "demo" and
 * checkout keeps its existing demo behaviour.
 */

export interface PaymentField {
  key: string;
  label: string;
  /** Secret keys are write-only: never returned to the browser, masked in the UI. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface PaymentEnv {
  value: string;
  label: string;
}

export interface PaymentProvider {
  id: string;
  label: string;
  /** Short one-liner shown under the picker. */
  note?: string;
  environments: PaymentEnv[];
  fields: PaymentField[];
}

const SANDBOX_LIVE: PaymentEnv[] = [
  { value: "sandbox", label: "Sandbox" },
  { value: "production", label: "Production" },
];
const TEST_LIVE: PaymentEnv[] = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
];

/** The supported providers. Field sets are representative of each gateway's
 *  typical integration; publishable/id values are non-secret, keys are secret. */
export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: "stripe",
    label: "Stripe",
    note: "Cards, wallets. Publishable key is client-side; secret key stays on the server.",
    environments: TEST_LIVE,
    fields: [
      { key: "publishableKey", label: "Publishable key", required: true, placeholder: "pk_live_…" },
      { key: "secretKey", label: "Secret key", secret: true, required: true, placeholder: "sk_live_…" },
      { key: "webhookSecret", label: "Webhook signing secret", secret: true, placeholder: "whsec_…" },
    ],
  },
  {
    id: "moneris",
    label: "Moneris",
    note: "Canadian acquirer. Store ID + API token; optional Moneris Checkout id.",
    environments: [
      { value: "qa", label: "QA / Test" },
      { value: "production", label: "Production" },
    ],
    fields: [
      { key: "storeId", label: "Store ID", required: true, placeholder: "store5" },
      { key: "apiToken", label: "API token", secret: true, required: true },
      { key: "checkoutId", label: "Moneris Checkout ID", placeholder: "chkt…" },
    ],
  },
  {
    id: "square",
    label: "Square",
    environments: SANDBOX_LIVE,
    fields: [
      { key: "applicationId", label: "Application ID", required: true, placeholder: "sq0idp-…" },
      { key: "locationId", label: "Location ID", required: true, placeholder: "L…" },
      { key: "accessToken", label: "Access token", secret: true, required: true },
    ],
  },
  {
    id: "authorizenet",
    label: "Authorize.Net",
    environments: SANDBOX_LIVE,
    fields: [
      { key: "apiLoginId", label: "API Login ID", required: true },
      { key: "transactionKey", label: "Transaction key", secret: true, required: true },
      { key: "publicClientKey", label: "Public client key (Accept.js)", placeholder: "optional" },
      { key: "signatureKey", label: "Signature key", secret: true, placeholder: "optional" },
    ],
  },
  {
    id: "cybersource",
    label: "Cybersource",
    environments: TEST_LIVE,
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "keyId", label: "Key ID", required: true },
      { key: "sharedSecretKey", label: "Shared secret key", secret: true, required: true },
    ],
  },
  {
    id: "adyen",
    label: "Adyen",
    environments: TEST_LIVE,
    fields: [
      { key: "merchantAccount", label: "Merchant account", required: true },
      { key: "clientKey", label: "Client key", required: true, placeholder: "live_…" },
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "hmacKey", label: "HMAC key (webhooks)", secret: true, placeholder: "optional" },
    ],
  },
  {
    id: "braintree",
    label: "Braintree",
    note: "A PayPal service. Tokenization key is client-side; private key stays on the server.",
    environments: SANDBOX_LIVE,
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "publicKey", label: "Public key", required: true },
      { key: "privateKey", label: "Private key", secret: true, required: true },
      { key: "tokenizationKey", label: "Tokenization key", placeholder: "optional (client SDK)" },
    ],
  },
  {
    id: "helcim",
    label: "Helcim",
    environments: TEST_LIVE,
    fields: [
      { key: "apiToken", label: "API token", secret: true, required: true },
      { key: "accountId", label: "Account ID", placeholder: "optional" },
    ],
  },
  {
    id: "nuvei",
    label: "Nuvei",
    environments: SANDBOX_LIVE,
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "merchantSiteId", label: "Merchant site ID", required: true },
      { key: "secretKey", label: "Secret key", secret: true, required: true },
    ],
  },
  {
    id: "tdmerchant",
    label: "TD Merchant Solutions",
    note: "TD Online Mart. Merchant ID + API token.",
    environments: TEST_LIVE,
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "apiToken", label: "API token", secret: true, required: true },
      { key: "terminalId", label: "Terminal ID", placeholder: "optional" },
    ],
  },
  {
    id: "globalpayments",
    label: "Global Payments Canada",
    note: "GP API (Unified Commerce).",
    environments: SANDBOX_LIVE,
    fields: [
      { key: "appId", label: "App ID", required: true },
      { key: "appKey", label: "App key", secret: true, required: true },
    ],
  },
  {
    id: "elavon",
    label: "Elavon Canada",
    note: "Converge. Merchant ID + user ID + PIN.",
    environments: [
      { value: "demo", label: "Demo" },
      { value: "production", label: "Production" },
    ],
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "userId", label: "Converge user ID", required: true },
      { key: "pin", label: "PIN", secret: true, required: true },
    ],
  },
  {
    id: "chase",
    label: "Chase Payment Solutions Canada",
    note: "Chase / Orbital gateway.",
    environments: TEST_LIVE,
    fields: [
      { key: "merchantId", label: "Merchant ID", required: true },
      { key: "username", label: "Username", required: true },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "terminalId", label: "Terminal ID", placeholder: "optional" },
    ],
  },
];

export function getProvider(id: string): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.id === id);
}
export function providerLabel(id: string): string {
  return getProvider(id)?.label ?? id;
}
export function secretKeys(id: string): string[] {
  return (getProvider(id)?.fields ?? []).filter((f) => f.secret).map((f) => f.key);
}
export function requiredKeys(id: string): string[] {
  return (getProvider(id)?.fields ?? []).filter((f) => f.required).map((f) => f.key);
}

// ── Types shared with the server ────────────────────────────────────
export interface PaymentStatus {
  mode: "live" | "demo";
  provider: string;
  environment: string;
  publicConfig: Record<string, string>;
}

export interface PaymentConfigView {
  enabled: boolean;
  provider: string;
  environment: string;
  live: boolean;
  values: Record<string, string>;
  secretsSet: Record<string, boolean>;
}

export interface PaymentConfigInput {
  provider: string;
  enabled: boolean;
  environment: string;
  values: Record<string, string>;
}

const DEMO_STATUS: PaymentStatus = { mode: "demo", provider: "", environment: "", publicConfig: {} };
const STATUS_URL = "/api/store/payments/status";
const CONFIG_URL = "/api/store/payments/config";

/** Public, secret-free status the storefront uses to pick live vs demo. */
export async function fetchPaymentStatus(): Promise<PaymentStatus> {
  try {
    const res = await fetch(apiUrl(STATUS_URL), { headers: authHeaders() });
    if (!res.ok) return DEMO_STATUS;
    return (await res.json()) as PaymentStatus;
  } catch {
    return DEMO_STATUS;
  }
}

/** Admin: current config with secret values redacted to `secretsSet` booleans. */
export async function fetchPaymentConfig(): Promise<PaymentConfigView | null> {
  try {
    const res = await fetch(apiUrl(CONFIG_URL), { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as PaymentConfigView;
  } catch {
    return null;
  }
}

/** Admin: persist the config. Secret keys sent blank are kept as-is server-side. */
export async function savePaymentConfig(
  cfg: PaymentConfigInput,
): Promise<{ ok: boolean; live?: boolean }> {
  try {
    const res = await fetch(apiUrl(CONFIG_URL), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        ...cfg,
        meta: { secret: secretKeys(cfg.provider), required: requiredKeys(cfg.provider) },
      }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; live?: boolean };
  } catch {
    return { ok: false };
  }
}
