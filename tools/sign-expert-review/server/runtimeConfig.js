const REQUIRED_GOOGLE_KEYS = Object.freeze([
  "googleClientId",
  "allowedEmail",
  "driveFolderId",
  "manifestFileId",
  "spreadsheetId"
]);

export function reviewRuntimeConfig(env = process.env) {
  return {
    mode: env.REVIEW_DATA_MODE === "google" ? "google" : "mock",
    googleClientId: env.REVIEW_GOOGLE_CLIENT_ID || "",
    allowedEmail: String(env.REVIEW_ALLOWED_EMAIL || "").trim().toLowerCase(),
    driveFolderId: env.REVIEW_DRIVE_FOLDER_ID || "",
    manifestFileId: env.REVIEW_MANIFEST_FILE_ID || "",
    spreadsheetId: env.REVIEW_SPREADSHEET_ID || "",
    sheetTab: env.REVIEW_SHEET_TAB || "review_events",
    prefetchMemoryBudgetMb: Number(env.REVIEW_PREFETCH_MEMORY_MB || 64)
  };
}

export function validateRuntimeConfig(config) {
  if (config.mode !== "google") return { ok: true, code: "MOCK_CONFIG_READY" };
  if (REQUIRED_GOOGLE_KEYS.some(key => !config[key])) return { ok: false, code: "BLOCKED_VERCEL_ENV" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.allowedEmail)) return { ok: false, code: "BLOCKED_VERCEL_ENV" };
  if (!Number.isFinite(config.prefetchMemoryBudgetMb) || config.prefetchMemoryBudgetMb <= 0) return { ok: false, code: "BLOCKED_VERCEL_ENV" };
  return { ok: true, code: "GOOGLE_CONFIG_READY" };
}
