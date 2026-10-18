# LiveTalk Translator

Two-way voice translator: Telugu, English, Hindi, Tamil, Kannada, Malayalam.
Person 1 taps their mic and speaks; the app translates and speaks the result aloud for Person 2.

## Get the APK (no local setup)
1. Create a GitHub repo and push this folder to the `main` branch.
2. Open the **Actions** tab. **Build Android APK** runs on every push (or run it manually).
3. When it finishes, download `LiveTalkTranslator-APK` from the run's Artifacts. Unzip it and install `app-debug.apk`.
4. On first mic tap, allow the microphone permission.

## Build locally
Requires Node 20 and JDK 17 (plus Android SDK for Gradle or Android Studio).
```
npm install
npm run add:android      # creates android/ and patches the manifest
npm run sync
npm run open             # opens Android Studio, then Run
```

## Run in a browser (no APK)
`npm run serve`, or host `www/` on GitHub Pages. Open in Chrome on Android and tap "Install app".
Speech recognition there uses the browser's Web Speech API.

## Notes
- Needs internet for speech recognition (Google) and translation.
- Speech uses the device's Google speech service. For spoken output in Telugu etc., install the voice in
  Settings > System > Languages > Text-to-speech output.
- Translation uses Google's unofficial endpoint with MyMemory as a fallback. Both are free and rate-limited;
  for production, switch to the Cloud Translation API.
- The APK is a debug build. A Play Store release needs a signed release build.
