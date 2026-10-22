/** One JSON line per event, on stderr for warnings. */
export function log(level: "info" | "warn", message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}
