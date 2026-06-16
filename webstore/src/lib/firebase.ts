import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

/**
 * Firebase wiring. Config comes from Vite env vars (`.env` — never commit real
 * keys), so the repo stays credential-free. When unconfigured the app runs in
 * "local mode": data lives in localStorage and the admin uses a demo gate, so
 * the mockup works with zero setup.
 *
 * The SDK is loaded **dynamically and only when a project is configured**, so
 * the ~130 KB Firebase bundle never weighs down the public storefront in local
 * mode (`import type` above is erased at compile time).
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** True once a real Firebase web config is present (apiKey + projectId). */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

let cached: Promise<{ auth: Auth; db: Firestore }> | null = null;
let authRef: Auth | undefined;

/** Lazily import + initialize Firebase. Rejects in local mode. */
export function loadFirebase(): Promise<{ auth: Auth; db: Firestore }> {
  if (!isFirebaseConfigured) return Promise.reject(new Error("Firebase not configured"));
  if (!cached) {
    cached = (async () => {
      const [{ initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);
      const app = initializeApp(config as Record<string, string>);
      authRef = getAuth(app);
      return { auth: authRef, db: getFirestore(app) };
    })();
  }
  return cached;
}

/** The Auth instance once loaded (for synchronous reads like the current email). */
export function loadedAuth(): Auth | undefined {
  return authRef;
}
