/**
 * Asks the browser to keep this site's storage, so the pack saved on this device isn't cleared to free space, or by
 * Safari's seven-day clean-out of sites not visited. Chrome and Safari decide quietly; Firefox may ask the pilot once.
 * A "no" changes nothing: the pack stays in storage as before, and a signed-in pilot's comes back from their account.
 *
 * Asked at most once a page load, and never again once the browser has said yes.
 */
let asked: Promise<boolean> | null = null;

export function keepStorage(): Promise<boolean> {
  if (asked) return asked;
  asked = (async () => {
    try {
      const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
      if (!storage?.persist) return false;
      if (await storage.persisted?.()) return true;
      return await storage.persist();
    } catch {
      return false;
    }
  })();
  return asked;
}

/** For tests: forget that this page load already asked. */
export function resetKeepStorageForTests(): void {
  asked = null;
}
