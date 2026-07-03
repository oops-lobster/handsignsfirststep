# 손말 첫걸음 · Handsigns First Step

손말 첫걸음은 한국수어를 처음 배우는 사용자가 국립수어사전의 지문자 영상을 보고, 브라우저 카메라로 천천히 따라 하며, 손이 화면에 잘 보이는지에 대한 따뜻한 연습 피드백을 받는 MVP입니다.

이 앱은 공식 한국수어 능력 평가 도구가 아니며, 통역 서비스도 아닙니다.

## 대상 사용자

- 한국수어를 처음 배우는 청인
- 농·난청 아동과 소통하기 위해 수어를 배우는 부모와 가족
- 지문자를 반복해서 연습하려는 초보 학습자
- 교육 콘텐츠를 검토할 한국수어 교사, 통역사, 농인 당사자

## MVP 범위

- 자음과 모음 지문자 목록
- 첫 5개 입문 과정 시범 구성
- 국립수어사전 영상 연결
- 보기, 이해하기, 따라 하기, 확인하기, 완료 흐름
- 카메라 기반 손 위치와 손 크기 피드백
- localStorage 학습 진도 저장
- 개발자용 reference capture 안내 페이지

제외 범위: 전체 문장 번역, 생성형 AI 피드백, 음성 인식, Google Video Intelligence API, Vertex AI, 사용자 영상 저장, 로그인, 결제, 공식 점수화.

## 기술 스택

- Node.js ESM static server
- Browser JavaScript modules
- CSS
- Node built-in test runner
- MediaPipe Hand Landmarker via `@mediapipe/tasks-vision` browser bundle
- localStorage

기존 손말관의 Node 기반 구조와 국립수어사전 API 계약을 재사용했습니다.

## 로컬 실행

```bash
npm install
cp .env.example .env
npm run dev
```

기본 주소:

```text
http://127.0.0.1:3001
```

## 환경변수

실제 키 값은 커밋하지 마세요.

```text
CULTURE_API_KEY=
CULTURE_API_INTEGRATED_KEY=
CULTURE_API_LIFE_KEY=
CULTURE_API_SPECIALIZED_KEY=
CULTURE_API_CULTURE_KEY=
CULTURE_API_LIFE_URL=
CULTURE_API_SPECIALIZED_URL=
CULTURE_API_CULTURE_URL=
CULTURE_API_INTEGRATED_URL=
CULTURE_API_KEY_PARAM=serviceKey
CULTURE_API_QUERY_PARAM=keyword
CULTURE_API_PAGE_SIZE_PARAM=numOfRows
CULTURE_API_PAGE_SIZE=20
```

## 국립수어사전 API 연동

`src/sign-dictionary/adapter.js`가 기존 손말관의 공공 API 계약을 기반으로 검색, XML/JSON 파싱, 영상 URL 추출, 출처 표기를 담당합니다.

검색 결과의 첫 번째 항목을 무조건 쓰지 않고, 표제어 일치와 쉼표 동의어 파트를 우선 확인합니다. 정확히 연결되지 않은 항목은 앱에서 “사전 영상 연결 확인 중” 상태로 보여줍니다.

## MediaPipe Hand Landmarker

카메라 연습은 브라우저 내부에서만 처리합니다. 사용자 영상, 사진, landmark 원본은 서버로 보내지 않습니다.

모델 파일은 아래 위치에 배치해야 합니다.

```text
public/models/hand_landmarker.task
```

모델은 Google AI Edge / MediaPipe의 공식 Hand Landmarker 모델을 사용하고, 재배포 가능 여부와 라이선스를 확인한 뒤 배치하세요.

## 새 지문자 추가 방법

`src/data/fingerspelling/curriculum.js`에 lesson을 추가합니다.

- `id`
- `symbol`
- `category`
- `order`
- `dictionaryQuery`
- `reviewStatus`
- `referenceFeedbackStatus`

교육 설명은 검수 전이면 “전문가 검수 전” 상태로 유지하세요.

## dictionaryEntryId 매핑 방법

`src/data/fingerspelling/dictionaryMappings.js`에 lesson별 `dictionaryEntryId`를 추가할 수 있습니다. 현재 MVP는 query 기반으로 검색하며, 잘못된 영상을 보여주지 않기 위해 정확한 표제어 일치를 우선합니다.

## 교육 설명 추가 방법

검수된 설명은 `src/data/fingerspelling/reviewedTips.js`에 추가하세요. 사전 설명과 앱 작성 설명, 전문가 검수 상태를 UI에서 구분해야 합니다.

## 기준 landmark sample 추가 방법

`src/data/fingerspellingReferences/samples/`에 normalized landmark sample을 추가할 수 있습니다. 원본 영상, 사진, 얼굴 이미지, raw 생체 데이터는 저장하지 마세요.

## 테스트

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Vercel 배포

새 Vercel 프로젝트 이름 권장:

```text
handsignsfirststep
```

Vercel 프로젝트 환경변수에 국립수어사전 API 키를 별도로 등록해야 합니다. 기존 손말관 프로젝트의 환경변수는 자동 복사되지 않습니다.

## 개인정보 처리

- 카메라 영상은 기기 안에서만 분석됩니다.
- 서버에 영상, 사진, 얼굴 이미지, landmark 원본, 생체정보를 저장하지 않습니다.
- localStorage에는 학습 진도와 UI 설정만 저장합니다.
- 진도 초기화 버튼으로 localStorage 데이터를 삭제할 수 있습니다.

## 현재 한계

- 공식 수어 능력 평가가 아닙니다.
- 모든 손 모양을 정확히 판정하지 않습니다.
- reference landmark sample은 아직 검수 전입니다.
- 조명, 카메라 위치, 손 크기, 기기 성능에 따라 감지 품질이 달라질 수 있습니다.
- 한국수어 전문가와 농인 당사자의 지속적인 검수가 필요합니다.

## 향후 개발 계획

- 검수된 지문자 설명 추가
- 전문가 검수 landmark sample 추가
- 모바일 실제 기기 카메라 QA
- 학습자/가족 대상 예비 평가
- 손말관 번역기와 안전한 탐색 링크 연결
