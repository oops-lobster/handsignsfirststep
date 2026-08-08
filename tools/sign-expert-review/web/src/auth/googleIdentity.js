const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export class GoogleIdentityAuth extends EventTarget {
  constructor(clientId, { allowedEmail = "", fetchImpl = (...args) => fetch(...args) } = {}) {
    super();
    this.clientId = clientId;
    this.allowedEmail = String(allowedEmail).trim().toLowerCase();
    this.fetchImpl = fetchImpl;
    this.accessToken = null;
    this.accountEmail = null;
    this.expiresAt = 0;
    this.tokenClient = null;
  }

  ready() {
    return Boolean(this.clientId && globalThis.google?.accounts?.oauth2);
  }

  connect() {
    if (!this.ready()) return Promise.reject(new Error("BLOCKED_GOOGLE_AUTH"));
    return new Promise((resolve, reject) => {
      this.tokenClient ||= google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: async response => {
          if (response.error || !response.access_token) {
            reject(new Error("BLOCKED_GOOGLE_AUTH"));
            return;
          }
          this.accessToken = response.access_token;
          this.expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
          try {
            await this.#verifyAllowedAccount();
            this.dispatchEvent(new Event("connected"));
            resolve(this.accessToken);
          } catch (error) {
            this.#revokeCurrentToken();
            reject(error);
          }
        }
      });
      this.tokenClient.requestAccessToken({ prompt: "consent" });
    });
  }

  async token() {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    this.accessToken = null;
    throw new Error("BLOCKED_GOOGLE_AUTH");
  }

  disconnect() {
    this.#revokeCurrentToken();
  }

  async #verifyAllowedAccount() {
    if (!this.allowedEmail) throw new Error("BLOCKED_VERCEL_ENV");
    const response = await this.fetchImpl(USERINFO_URL, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("BLOCKED_GOOGLE_AUTH");
    const profile = await response.json();
    const actualEmail = String(profile.email || "").trim().toLowerCase();
    if (!profile.email_verified || actualEmail !== this.allowedEmail) throw new Error("GOOGLE_ACCOUNT_NOT_AUTHORIZED");
    this.accountEmail = actualEmail;
  }

  #revokeCurrentToken() {
    if (this.accessToken && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.accessToken);
    this.accessToken = null;
    this.accountEmail = null;
    this.expiresAt = 0;
  }
}
