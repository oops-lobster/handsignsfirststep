/**
 * @typedef {Object} SignDictionaryEntry
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [category]
 * @property {string} [videoUrl]
 * @property {string} [rawVideoUrl]
 * @property {string} [thumbnailUrl]
 * @property {string} [sourceUrl]
 * @property {string} sourceName
 * @property {string} attribution
 * @property {Record<string, string>} raw
 */

/**
 * @typedef {Object} SignDictionarySearchResult
 * @property {"loading"|"success"|"no-result"|"invalid-entry"|"api-error"|"video-unavailable"} status
 * @property {SignDictionaryEntry[]} entries
 * @property {string[]} warnings
 */

export {};
