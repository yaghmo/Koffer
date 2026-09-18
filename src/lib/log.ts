import { api } from "./api";

/**
 * Fire-and-forget UI logging into the app log file.
 *
 * Best-effort by design: a log write must never fail the action it is
 * describing, so every failure path (missing command, IPC error) is
 * swallowed. Descriptions only — never a password or field value.
 */
export function logUi(level: "info" | "warn", scope: string, message: string): void {
  try {
    void Promise.resolve(api.logEvent(level, scope, message)).catch(() => {});
  } catch {
    // ignore
  }
}
