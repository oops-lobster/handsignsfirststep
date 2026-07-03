const cache = new Map();

export function getCached(key, ttlMs = 1000 * 60 * 30) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

export function setCached(key, value) {
  cache.set(key, { value, createdAt: Date.now() });
}
