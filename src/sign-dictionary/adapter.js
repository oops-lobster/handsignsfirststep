const defaultSources = [
  {
    id: "life",
    name: "일상생활수어",
    keyEnv: "CULTURE_API_LIFE_KEY",
    env: "CULTURE_API_LIFE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01701"
  },
  {
    id: "integrated",
    name: "통합 수어",
    keyEnv: "CULTURE_API_INTEGRATED_KEY",
    env: "CULTURE_API_INTEGRATED_URL",
    defaultUrl: "https://api.kcisa.kr/API_CNV_054/request"
  },
  {
    id: "specialized",
    name: "전문용어수어",
    keyEnv: "CULTURE_API_SPECIALIZED_KEY",
    env: "CULTURE_API_SPECIALIZED_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01702"
  },
  {
    id: "culture",
    name: "문화정보수어",
    keyEnv: "CULTURE_API_CULTURE_KEY",
    env: "CULTURE_API_CULTURE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01703"
  }
];

const sourcePriority = {
  integrated: 0,
  life: 1,
  specialized: 2,
  culture: 3
};

function getFirstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] != null && String(object[key]).trim()) return String(object[key]).trim();
  }
  return "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function collectEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.items,
    payload.item,
    payload.data,
    payload.result,
    payload.results,
    payload.response?.body?.items?.item,
    payload.response?.body?.items,
    payload.response?.body
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = Object.values(candidate).find(value => Array.isArray(value));
      if (nested) return nested;
    }
  }

  return Object.values(payload).find(value => Array.isArray(value)) || [];
}

export function parseXmlItems(text) {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(text))) {
    const item = {};
    const fieldPattern = /<([A-Za-z0-9_.:-]+)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let fieldMatch;

    while ((fieldMatch = fieldPattern.exec(itemMatch[1]))) {
      const key = fieldMatch[1].replace(/^.*:/, "");
      const value = decodeXml(fieldMatch[2].replace(/<[^>]+>/g, ""));
      if (value) item[key] = value;
    }

    if (Object.keys(item).length) items.push(item);
  }

  return items;
}

export function parseApiPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return collectEntries(JSON.parse(trimmed));
  return parseXmlItems(trimmed);
}

function firstCsvUrl(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .find(Boolean) || "";
}

function isVideoUrl(value) {
  return /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(value || "");
}

function isImageUrl(value) {
  return /\.(png|jpe?g|gif|webp|bmp)(\?|#|$)/i.test(value || "");
}

function upgradeSldictUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && url.hostname === "sldict.korean.go.kr") {
      url.protocol = "https:";
      return url.href;
    }
    return value;
  } catch {
    return value;
  }
}

function normalizeEntry(entry, searchedTerm, source) {
  const resourceUrl = getFirstValue(entry, ["url", "resourceUrl", "referenceUrl", "identifier"]);
  const mediaUrl = getFirstValue(entry, ["subDescription"]);
  const explicitVideoUrl = getFirstValue(entry, ["videoUrl", "vodUrl", "movieUrl", "mp4Url", "signVideoUrl", "signVideo", "video", "mvurl", "fileUrl"]);
  const explicitImageUrl = getFirstValue(entry, ["imageUrl", "imgUrl", "thumbnail", "thumbUrl", "signImageUrl", "image", "imageObject", "posterUrl", "referenceIdentifier"]);
  const signImageUrl = firstCsvUrl(getFirstValue(entry, ["signImages"]));
  const thumbnailUrl = upgradeSldictUrl(explicitImageUrl || signImageUrl || (isImageUrl(mediaUrl) ? mediaUrl : "") || (isImageUrl(resourceUrl) ? resourceUrl : ""));
  const rawVideoUrl = upgradeSldictUrl(explicitVideoUrl || (isVideoUrl(mediaUrl) ? mediaUrl : "") || (isVideoUrl(resourceUrl) ? resourceUrl : ""));
  const title = getFirstValue(entry, ["title", "word", "name", "signWord", "korName", "term", "subject", "krwd"]) || searchedTerm;
  const id = getFirstValue(entry, ["localId", "origin_no", "originNo", "id", "identifier"]) || `${source.id}:${title}`;

  return {
    id,
    searchedTerm,
    sourceId: source.id,
    sourceName: source.name,
    title,
    description: getFirstValue(entry, ["signDescription", "description", "desc", "contents", "content", "meaning", "explanation", "sense", "dc", "subDescription"]),
    videoUrl: rawVideoUrl,
    rawVideoUrl,
    thumbnailUrl,
    sourceUrl: resourceUrl,
    category: getFirstValue(entry, ["categoryType", "collectionDb", "category"]),
    attribution: "영상 출처: 국립국어원 한국수어사전",
    hasMedia: Boolean(rawVideoUrl || thumbnailUrl),
    raw: entry
  };
}

function sourceApiKey(source, env) {
  return env[source.keyEnv] || env.CULTURE_API_KEY || "";
}

function configuredSources(env) {
  const legacyUrl = env.CULTURE_API_BASE_URL;
  return defaultSources.map(source => ({
    ...source,
    url: env[source.env] || (source.id === "integrated" ? legacyUrl : "") || source.defaultUrl
  })).filter(source => source.url);
}

function compact(value) {
  return String(value || "").replace(/[^\p{L}\p{N}]/gu, "");
}

function titleParts(title) {
  return String(title || "")
    .split(/[,/|·ㆍ]/)
    .map(part => compact(part))
    .filter(Boolean);
}

function relevanceScore(entry, query) {
  const term = compact(query);
  const title = compact(entry.title);
  const parts = titleParts(entry.title);
  if (!term || !title) return 0;
  if (title === term) return 120;
  if (parts[0] === term) return 110;
  if (parts.includes(term)) return 90;
  if (title.startsWith(term)) return 70;
  if (title.includes(term)) return 45;
  return 0;
}

function sortEntries(entries, query) {
  return [...entries].sort((a, b) =>
    (sourcePriority[a.sourceId] ?? 99) - (sourcePriority[b.sourceId] ?? 99) ||
    relevanceScore(b, query) - relevanceScore(a, query) ||
    Number(Boolean(b.videoUrl)) - Number(Boolean(a.videoUrl)) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ko")
  );
}

function filterFingerspellingEntries(entries, query) {
  const term = compact(query);
  return entries.filter(entry => {
    const title = compact(entry.title);
    const parts = titleParts(entry.title);
    return title === term || parts.includes(term) || title.startsWith(term);
  });
}

export class SignDictionaryAdapter {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Number(env.CULTURE_API_TIMEOUT_MS || 4500);
  }

  async searchEntries(query) {
    const sources = configuredSources(this.env);
    const warnings = [];
    const entries = [];

    for (const source of sources) {
      try {
        const url = new URL(source.url);
        const apiKey = sourceApiKey(source, this.env);
        if (apiKey) url.searchParams.set(this.env.CULTURE_API_KEY_PARAM || "serviceKey", apiKey);
        url.searchParams.set(this.env.CULTURE_API_QUERY_PARAM || "keyword", query);
        url.searchParams.set(this.env.CULTURE_API_PAGE_SIZE_PARAM || "numOfRows", String(Math.max(Number(this.env.CULTURE_API_PAGE_SIZE || 20), 20)));
        url.searchParams.set(this.env.CULTURE_API_PAGE_PARAM || "pageNo", this.env.CULTURE_API_PAGE || "1");
        if (source.id === "integrated" && !url.searchParams.has("collectionDb")) url.searchParams.set("collectionDb", "");
        if (this.env.CULTURE_API_FORMAT) url.searchParams.set(this.env.CULTURE_API_FORMAT_PARAM || "format", this.env.CULTURE_API_FORMAT);

        const response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { accept: "application/json, text/xml;q=0.9, */*;q=0.8" }
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);
        entries.push(...parseApiPayload(text).map(entry => normalizeEntry(entry, query, source)));
      } catch (error) {
        warnings.push(`${source.name} search is temporarily unavailable.`);
      }
    }

    const filtered = filterFingerspellingEntries(entries, query);
    const resultEntries = sortEntries(filtered.length ? filtered : entries, query);
    return {
      status: resultEntries.length ? "success" : warnings.length ? "api-error" : "no-result",
      entries: resultEntries,
      warnings
    };
  }

  async getEntryById(id) {
    return null;
  }

  getVideo(entry) {
    if (!entry?.videoUrl) return null;
    return {
      url: entry.videoUrl,
      thumbnailUrl: entry.thumbnailUrl || "",
      sourceUrl: entry.sourceUrl || "",
      attribution: entry.attribution || "영상 출처: 국립국어원 한국수어사전"
    };
  }
}
