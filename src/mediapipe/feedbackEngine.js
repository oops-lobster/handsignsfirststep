import { calculateHandBoundingBox, isHandStable } from "./landmarkUtils.js";

export function evaluateGeneralHandFeedback({ hands = [], history = [], referenceAvailable = false }) {
  const messages = [];
  if (!hands.length) {
    return [{ state: "no_hand", text: "손이 아직 보이지 않아요. 카메라 안에 손을 보여주세요.", priority: 100 }];
  }

  const box = calculateHandBoundingBox(hands[0]);
  if (!box) return [{ state: "no_hand", text: "손이 아직 보이지 않아요. 카메라 안에 손을 보여주세요.", priority: 100 }];

  if (box.width < 0.18 || box.height < 0.18) {
    messages.push({ state: "hand_too_small", text: "손을 카메라에 조금 더 가까이 보여주세요.", priority: 90 });
  }
  if (box.width > 0.78 || box.height > 0.78) {
    messages.push({ state: "hand_too_large", text: "손 전체가 보이도록 조금만 멀리해 주세요.", priority: 85 });
  }
  if (box.centerX < 0.32 || box.centerX > 0.68 || box.centerY < 0.24 || box.centerY > 0.78) {
    messages.push({ state: "hand_off_center", text: "손을 화면 가운데로 옮겨주세요.", priority: 80 });
  }
  if (box.minX < 0.03 || box.maxX > 0.97 || box.minY < 0.03 || box.maxY > 0.97) {
    messages.push({ state: "partial_hand", text: "손가락 끝까지 화면 안에 보이도록 해주세요.", priority: 75 });
  }
  if (hands.length > 1) {
    messages.push({ state: "two_hands", text: "두 손이 보여요. 이번 연습은 기준 영상처럼 필요한 손만 천천히 확인해요.", priority: 45 });
  }
  if (!isHandStable(history)) {
    messages.push({ state: "unstable", text: "손 모양을 잠시 유지해볼까요?", priority: 55 });
  }
  if (!referenceAvailable) {
    messages.push({ state: "reference_unavailable", text: "현재는 손의 위치와 화면 상태를 중심으로 안내하고 있어요.", priority: 20 });
  }

  if (!messages.length) {
    messages.push({ state: "ready", text: "좋아요. 손 모양을 확인해볼게요.", priority: 20 });
  }

  return messages.sort((a, b) => b.priority - a.priority).slice(0, 2);
}
