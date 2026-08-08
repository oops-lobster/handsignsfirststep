import { sha256Blob } from "../security/hash.js";

export class GoogleDriveAdapter {
  constructor({ tokenProvider, fetchImpl = (...args) => fetch(...args) } = {}) {
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async #get(fileId) {
    if (!fileId) throw new Error("GOOGLE_ACCOUNT_NOT_AUTHORIZED");
    const token = await this.tokenProvider();
    if (!token) throw new Error("BLOCKED_GOOGLE_AUTH");
    const response = await this.fetchImpl(`/google-drive/files/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error("GOOGLE_ACCOUNT_NOT_AUTHORIZED");
    }
    if (!response.ok) throw new Error("DRIVE_FILE_LOAD_FAILED");
    return response;
  }

  async loadManifest(fileId) {
    const response = await this.#get(fileId);
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new Error("BLOCKED_MANIFEST_INVALID");
    }
  }

  async loadClip(candidate) {
    const response = await this.#get(candidate.drive_file_id);
    const blob = await response.blob();
    const checksum = await sha256Blob(blob);
    if (checksum !== candidate.clip_sha256) throw new Error("CLIP_CHECKSUM_MISMATCH");
    return blob;
  }
}
