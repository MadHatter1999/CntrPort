import { isFirebaseConfigured, loadFirebase } from "../lib/firebase";

/**
 * Thin Firestore sync used by the orders data layer. Each is a no-op in
 * local mode (no Firebase config), so the localStorage path keeps working. The
 * SDK is loaded lazily via loadFirebase(), so it's only fetched when a project
 * is actually configured.
 */
export function remoteUpsert(collName: string, id: string, data: unknown): void {
  if (!isFirebaseConfigured) return;
  void (async () => {
    const [{ db }, { doc, setDoc }] = await Promise.all([loadFirebase(), import("firebase/firestore")]);
    await setDoc(doc(db, collName, id), data as Record<string, unknown>);
  })().catch(() => {
    /* offline / rules — localStorage already holds the write */
  });
}

export function remoteDelete(collName: string, id: string): void {
  if (!isFirebaseConfigured) return;
  void (async () => {
    const [{ db }, { doc, deleteDoc }] = await Promise.all([loadFirebase(), import("firebase/firestore")]);
    await deleteDoc(doc(db, collName, id));
  })().catch(() => {});
}

/** Realtime subscribe to a collection (ordered by createdAt desc). Returns an
 *  unsubscribe fn; a no-op in local mode. */
export function remoteSubscribe<T>(collName: string, onChange: (rows: T[]) => void): () => void {
  if (!isFirebaseConfigured) return () => {};
  let unsub = () => {};
  void (async () => {
    const [{ db }, { collection, onSnapshot, query, orderBy }] = await Promise.all([
      loadFirebase(),
      import("firebase/firestore"),
    ]);
    const q = query(collection(db, collName), orderBy("createdAt", "desc"));
    unsub = onSnapshot(
      q,
      (snap) => onChange(snap.docs.map((d) => d.data() as T)),
      () => {
        /* permission / network error — stay on local data */
      },
    );
  })().catch(() => {});
  return () => unsub();
}
