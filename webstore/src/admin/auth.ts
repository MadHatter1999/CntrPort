import { isFirebaseConfigured, loadFirebase, loadedAuth } from "../lib/firebase";
import { icon } from "../lib/icons";

/**
 * Admin access control. With Firebase configured the admin is locked to real
 * Firebase Auth accounts (email/password). Without it, the app falls back to a
 * lightweight demo gate so the mockup is still usable — clearly labelled so it's
 * never mistaken for real security.
 */
const DEMO_KEY = "enm.admin.session";

let onAuthed: () => void = () => {};

export function requireAuth(ready: () => void): void {
  onAuthed = ready;
  const root = document.getElementById("admin-app")!;

  if (!isFirebaseConfigured) {
    if (sessionStorage.getItem(DEMO_KEY) === "1") return ready();
    renderLogin(root, "demo");
    return;
  }

  void (async () => {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      loadFirebase(),
      import("firebase/auth"),
    ]);
    onAuthStateChanged(auth, (user) => {
      if (user) ready();
      else renderLogin(root, "firebase");
    });
  })();
}

export function signOutAdmin(): void {
  if (!isFirebaseConfigured) {
    sessionStorage.removeItem(DEMO_KEY);
    location.reload();
    return;
  }
  void (async () => {
    const [{ auth }, { signOut }] = await Promise.all([loadFirebase(), import("firebase/auth")]);
    await signOut(auth);
  })();
}

/** Current signed-in email (or "Demo") for the sidebar. */
export function currentUserLabel(): string {
  if (!isFirebaseConfigured) return "Demo session";
  return loadedAuth()?.currentUser?.email ?? "";
}

function renderLogin(root: HTMLElement, mode: "demo" | "firebase"): void {
  const note =
    mode === "demo"
      ? `<p class="login__note">${icon("lock", 14)} Demo mode — Firebase isn't configured, so any details sign you in. Add a Firebase project to require real staff accounts.</p>`
      : `<p class="login__note">${icon("lock", 14)} Authorized staff only. Access is protected by Firebase Authentication.</p>`;

  root.className = "";
  root.innerHTML = /* html */ `
    <div class="login">
      <form class="login__card" id="login-form" novalidate>
        <img class="login__logo" src="/favicon.svg" alt="" />
        <h1 class="login__brand">Store Admin</h1>
        <p class="login__sub">Sign in to manage your store</p>
        <div class="login__err" data-login-err hidden></div>
        <label class="login__fld">
          <span>Email</span>
          <input type="email" data-login="email" autocomplete="username" placeholder="you@store.com" required />
        </label>
        <label class="login__fld">
          <span>Password</span>
          <input type="password" data-login="password" autocomplete="current-password" placeholder="••••••••" required />
        </label>
        <button type="submit" class="btn btn--primary login__btn">Sign in</button>
        ${note}
        <a class="login__back" href="/">← Back to storefront</a>
      </form>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#login-form")!;
  const err = root.querySelector<HTMLElement>("[data-login-err]")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = form.querySelector<HTMLInputElement>('[data-login="email"]')!.value.trim();
    const pw = form.querySelector<HTMLInputElement>('[data-login="password"]')!.value;
    err.hidden = true;

    if (mode === "demo") {
      if (!email || !pw) {
        showError(err, "Enter any email and password to continue.");
        return;
      }
      sessionStorage.setItem(DEMO_KEY, "1");
      onAuthed();
      return;
    }

    const btn = form.querySelector<HTMLButtonElement>(".login__btn")!;
    btn.disabled = true;
    btn.textContent = "Signing in…";
    void (async () => {
      const [{ auth }, { signInWithEmailAndPassword }] = await Promise.all([
        loadFirebase(),
        import("firebase/auth"),
      ]);
      await signInWithEmailAndPassword(auth, email, pw);
    })().catch((e2: { code?: string }) => {
      btn.disabled = false;
      btn.textContent = "Sign in";
      showError(err, authMessage(e2?.code));
    });
    // success path is handled by onAuthStateChanged in requireAuth.
  });
}

function showError(el: HTMLElement, msg: string): void {
  el.textContent = msg;
  el.hidden = false;
}

function authMessage(code?: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That doesn't look like a valid email.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Incorrect email or password.";
  }
}
