/** The cookie that tells one device from another behind a shared address — set by `src/proxy.ts`, read by `checkRequestLimit`. Kept apart so the proxy loads nothing else. */
export const DEVICE_COOKIE = "ls_device";
