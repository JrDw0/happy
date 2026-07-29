#!/bin/bash
cd /Volumes/dwj/Codes/AI/happy/packages/happy-app/android || exit 1
./gradlew app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8081 -PreactNativeArchitectures=arm64-v8a > /tmp/happy-android-build2.log 2>&1
echo "GRADLE_EXIT=$?" | tee -a /tmp/happy-android-build2.log
tail -20 /tmp/happy-android-build2.log
