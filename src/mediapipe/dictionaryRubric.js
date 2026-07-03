import { getFingerExtensionState } from "./landmarkUtils.js";

const fingerNumberMap = {
  1: "thumb",
  2: "index",
  3: "middle",
  4: "ring",
  5: "pinky"
};

const allFingers = Object.values(fingerNumberMap);

function parseFingerNumbers(text) {
  return String(text || "")
    .match(/[1-5]/g)
    ?.map(Number)
    .filter((value, index, array) => array.indexOf(value) === index) || [];
}

export function createDictionaryRubric(description) {
  const text = String(description || "");
  const extensionMatch = text.match(/([1-5](?:\s*[·ㆍ,.]\s*[1-5])*)\s*지(?:를|가)?\s*펴/);
  const extended = parseFingerNumbers(extensionMatch?.[1]).map(number => fingerNumberMap[number]).filter(Boolean);

  if (!extended.length) {
    return {
      available: false,
      reason: "dictionary-text-unparsed",
      extended: [],
      folded: []
    };
  }

  return {
    available: true,
    reason: "dictionary-text",
    extended,
    folded: allFingers.filter(finger => !extended.includes(finger))
  };
}

export function evaluateDictionaryRubric({ landmarks, description }) {
  const rubric = createDictionaryRubric(description);
  if (!rubric.available) {
    return {
      rubric,
      passed: false,
      details: ["사전 설명에서 손가락 조건을 아직 읽어내지 못했어요."]
    };
  }

  const state = getFingerExtensionState(landmarks);
  const missingExtended = rubric.extended.filter(finger => state[finger] !== "extended");
  const notFolded = rubric.folded.filter(finger => state[finger] === "extended");
  const passed = !missingExtended.length && !notFolded.length;

  return {
    rubric,
    state,
    passed,
    details: [
      ...missingExtended.map(finger => `${finger} 손가락을 더 또렷하게 펴야 해요.`),
      ...notFolded.map(finger => `${finger} 손가락은 사전 설명처럼 접어주세요.`)
    ]
  };
}
