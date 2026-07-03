# Privacy

## Camera Processing

Camera video is processed only inside the browser. It is not uploaded to the server.

## Data Not Stored

The app must not store:

- videos
- photos
- face images
- raw landmarks
- biometric identifiers
- names or account data

## Stored Data

localStorage may store:

- completed lesson IDs
- quiz completion
- last lesson ID
- review lesson IDs
- landmark overlay setting
- camera mirror setting

## Deletion

Users can clear progress on the `/progress` page. Developers can also clear the browser localStorage entry:

```text
handsigns-first-step-progress
```
