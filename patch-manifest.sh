#!/usr/bin/env bash
# Idempotent: adds mic permission + Android 11+ package-visibility queries
set -e
M=android/app/src/main/AndroidManifest.xml
[ -f "$M" ] || { echo "AndroidManifest.xml not found"; exit 1; }

if ! grep -q 'android.permission.RECORD_AUDIO' "$M"; then
  sed -i 's|<application|<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <application|' "$M"
fi

if ! grep -q 'android.speech.RecognitionService' "$M"; then
  sed -i 's|</manifest>|    <queries>\n        <intent><action android:name="android.speech.RecognitionService" /></intent>\n        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>\n    </queries>\n</manifest>|' "$M"
fi
echo "Manifest patched."
