import { sha256Blob } from "../security/hash.js";

export class MockDriveAdapter {
  constructor({ manifestUrl = "/fixtures/review_batch_manifest.json", clipUrl = null, fetchImpl = (...args) => fetch(...args) } = {}) {
    this.manifestUrl = manifestUrl;
    this.clipUrl = clipUrl;
    this.fetchImpl = fetchImpl;
  }

  async loadManifest() {
    const response = await this.fetchImpl(this.manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("BLOCKED_MANIFEST_INVALID");
    return response.json();
  }

  async loadClip(candidate) {
    const response = await this.fetchImpl(candidate.mock_clip_url || this.clipUrl || `/fixtures/${encodeURIComponent(candidate.clip_filename)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("VIDEO_DECODE_FAILED");
    const blob = await response.blob();
    const checksum = await sha256Blob(blob);
    if (checksum !== candidate.clip_sha256) throw new Error("CLIP_CHECKSUM_MISMATCH");
    return blob;
  }
}
