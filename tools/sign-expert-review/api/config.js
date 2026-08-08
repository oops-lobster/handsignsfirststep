import { applyHeaders } from "../server/securityHeaders.js";
import { reviewRuntimeConfig, validateRuntimeConfig } from "../server/runtimeConfig.js";

export default function handler(request, response) {
  applyHeaders(response, { "content-type": "application/json; charset=utf-8" });
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const config = reviewRuntimeConfig();
  const validation = validateRuntimeConfig(config);
  if (!validation.ok) {
    response.status(503).json({ code: validation.code });
    return;
  }
  if (request.method === "HEAD") {
    response.status(200).end();
    return;
  }
  response.status(200).json(config);
}
