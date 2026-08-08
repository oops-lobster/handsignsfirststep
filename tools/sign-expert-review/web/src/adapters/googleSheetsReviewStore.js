export const REVIEW_EVENT_HEADERS = Object.freeze([
  "event_id", "batch_id", "candidate_id", "revision", "reviewer_code", "reviewed_at",
  "client_version", "review_mode", "review_state", "target_validation", "boundary_assessment",
  "precise_review_required", "precise_review_reason", "boundary_confidence",
  "annotated_start_local_frame", "annotated_end_local_frame",
  "auto_proposed_start_local_frame", "auto_proposed_end_local_frame",
  "auto_proposed_start_source_sec", "auto_proposed_end_source_sec",
  "manual_start_local_frame", "manual_end_local_frame", "manual_start_source_sec", "manual_end_source_sec",
  "approved_start_local_frame", "approved_end_local_frame", "approved_start_source_sec", "approved_end_source_sec",
  "boundary_status", "learning_video_assessment", "reference_assessment", "learning_allowed", "reference_allowed",
  "representative_fit", "representative_fit_legacy", "sentence_connection_effect", "sentence_connection_effect_legacy",
  "excluded", "exclusion_reason", "expert_notes", "review_duration_ms", "interaction_count",
  "clip_sha256", "manifest_sha256", "content_hash", "save_status"
]);

export class GoogleSheetsReviewStore {
  constructor({ spreadsheetId, sheetTab = "review_events", tokenProvider, fetchImpl = (...args) => fetch(...args) }) {
    this.spreadsheetId = spreadsheetId;
    this.sheetTab = sheetTab;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async #request(path, options = {}) {
    const token = await this.tokenProvider();
    const response = await this.fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new Error("GOOGLE_ACCOUNT_NOT_AUTHORIZED");
    if (!response.ok) throw new Error("SHEET_SAVE_FAILED");
    return response.status === 204 ? null : response.json();
  }

  async listEvents() {
    const range = encodeURIComponent(`${this.sheetTab}!A:AZ`);
    const body = await this.#request(`/values/${range}`);
    const rows = body.values || [];
    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).map(row => Object.fromEntries(headers.map((key, index) => [key, parseCell(key, row[index])])));
  }

  async appendEvent(event) {
    const events = await this.listEvents();
    if (events.some(existing => existing.event_id === event.event_id || existing.content_hash === event.content_hash)) {
      return { appended: false, idempotent: true };
    }
    const range = encodeURIComponent(`${this.sheetTab}!A:AZ`);
    await this.#request(`/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: [REVIEW_EVENT_HEADERS.map(key => event[key] ?? "")] })
    });
    return { appended: true, idempotent: false };
  }
}

function parseCell(key, value) {
  if (["annotated_start_local_frame", "annotated_end_local_frame", "auto_proposed_start_local_frame", "auto_proposed_end_local_frame", "manual_start_local_frame", "manual_end_local_frame", "approved_start_local_frame", "approved_end_local_frame", "review_duration_ms", "interaction_count"].includes(key)) return value === "" || value == null ? null : Number(value);
  if (["auto_proposed_start_source_sec", "auto_proposed_end_source_sec", "manual_start_source_sec", "manual_end_source_sec", "approved_start_source_sec", "approved_end_source_sec", "boundary_confidence"].includes(key)) return value === "" || value == null ? null : Number(value);
  if (key === "precise_review_required") return String(value).toLowerCase() === "true";
  if (key === "excluded") return value === "" || value == null ? null : String(value).toLowerCase() === "true";
  return value ?? "";
}
