export const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'self'; script-src 'self' https://accounts.google.com; connect-src 'self' https://www.googleapis.com https://sheets.googleapis.com https://accounts.google.com; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'self'"
});

export function applyHeaders(response, headers = {}) {
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...headers })) {
    response.setHeader(name, value);
  }
}
