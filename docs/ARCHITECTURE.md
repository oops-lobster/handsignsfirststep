# Architecture

## Data Flow

1. User opens a lesson.
2. The browser requests `/api/dictionary/lesson/:id`.
3. The server loads curriculum data and queries the Culture Portal sign dictionary API through `SignDictionaryAdapter`.
4. The normalized dictionary entry is returned to the browser.
5. The browser renders the reference video and learning flow.
6. Practice mode runs MediaPipe Hand Landmarker locally in the browser.
7. General hand feedback is generated from landmarks and displayed as text.
8. Learning progress is stored in localStorage.

## Dictionary Adapter

`src/sign-dictionary/adapter.js` owns:

- source configuration
- service key handling
- query parameter construction
- XML/JSON parsing
- media URL extraction
- dictionary attribution
- relevance sorting

No component parses raw API payloads.

## MediaPipe Flow

`public/js/practice.js` loads:

- `src/mediapipe/createHandLandmarker.js`
- `src/mediapipe/landmarkUtils.js`
- `src/mediapipe/feedbackEngine.js`

Frames stay in the browser. The server never receives camera images.

## Feedback Engine

The first MVP gives general guidance only:

- no hand
- too small
- too large
- off center
- partial hand
- unstable
- ready/reference unavailable

Reference similarity is only available when reviewed reference samples exist.

## localStorage

`LearningProgressRepository` stores:

- completed lesson IDs
- quiz completed lesson IDs
- last lesson
- review lesson IDs
- recent lesson IDs
- landmark overlay and mirror settings

Schema version is `1`.

## Client and Server Boundary

Server:

- dictionary API calls
- static file serving
- lesson JSON routes

Client:

- camera access
- MediaPipe inference
- feedback text rendering
- localStorage progress
