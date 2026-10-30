# JAAL for Android

Ambient scam shield. JAAL reads incoming notification **title + text**, runs on-device triage (a Kotlin port of
`shared/extract.js` that gives the same keys), and checks only suspicious identifiers against the JAAL graph. A
`reported` or `confirmed` verdict appears as a floating VerdictCard over whatever app is open. A `clear` verdict
shows nothing.

Kotlin + Views, minSdk 26, target/compile SDK 35. Dependencies are `kotlinx-coroutines-android` only (HTTP uses
`HttpURLConnection`, JSON uses `org.json`, background work uses platform `JobScheduler`). There is no AppCompat,
no WorkManager and no OkHttp.

## Build / install

```bash
# JDK 17+ required (Android Studio's bundled JBR works):
#   Windows (Git Bash): export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
cd android
# local.properties -> sdk.dir=C\:/Users/<you>/AppData/Local/Android/Sdk   (machine-specific, not committed)
./gradlew assembleDebug            # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest        # extractor/triage parity with shared/extract.js
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Sideload: the debug APK is also copied to `web/jaal.apk`. On the phone, allow "Install unknown apps" for the
browser or file manager that opens it.

Server URL: defaults to `http://10.0.2.2:8787` (the emulator's route to the dev machine). Change it in
**Settings → Server URL**: use `http://<laptop LAN IP>:8787` for a phone on the same Wi-Fi, or the production
URL. Cleartext HTTP is allowed so local dev works.

Granting permissions without tapping through Settings (emulator / dev):

```bash
P=app.jaal.android
adb shell cmd notification allow_listener $P/$P.service.JaalNotificationListener
adb shell appops set $P SYSTEM_ALERT_WINDOW allow
adb shell pm grant $P android.permission.POST_NOTIFICATIONS
```

## Pipeline

```
notification (title+text) -> Extract.triage (<10 ms, warm ~1-3 ms)
   ignore  -> dropped; never leaves the phone, never stored
   check   -> SHA-256(canonical key)[:8] in local prefix set (GET /api/prefixes, refreshed every 30 min)?
                no  -> dropped
                yes -> POST /api/check { identifiers only }
   trigger -> POST /api/check { text + identifiers }
verdict: clear -> silence | reported -> card, caution rule, auto-dismiss 8 s | confirmed -> tint + animated ring + 1 haptic, stays
```

`source:"android"`, `surface:"notification"|"call"|"clipboard"|"manual"`, `context.app` = package name,
`reporter` = salted random install hash (`d_` + SHA-256(random salt + UUID)). JAAL never sends a hardware ID.

## Permissions

| Permission | Why | Required? |
|---|---|---|
| Notification access (`BIND_NOTIFICATION_LISTENER_SERVICE`) | Read title + text of incoming notifications for on-device triage. This is the core sensor. | Yes |
| Display over other apps (`SYSTEM_ALERT_WINDOW`) | Show the VerdictCard over WhatsApp, SMS or a UPI app. Without it, verdicts arrive as notifications. | Recommended |
| `POST_NOTIFICATIONS` (13+) | Guardian alerts, the overlay fallback, and the demo notification. | Recommended |
| Call screening role (`ROLE_CALL_SCREENING`, 10+) | Get the incoming number of non-contact calls **without** call-log permission. Calls are always allowed and never blocked or silenced. | Optional |
| `READ_PHONE_STATE` | Ringing/offhook/idle state, so the personal layer knows whether an unknown call is still active. JAAL never reads the call log. | Optional |
| `INTERNET`, `ACCESS_NETWORK_STATE` | API calls; a network-constrained periodic job. | Yes |
| `VIBRATE` | One haptic tap on a confirmed verdict. | Yes |
| `<queries>` for 11 remote-access packages | Detect AnyDesk/TeamViewer/etc. installed during a call (install_plus_call). JAAL does not use `QUERY_ALL_PACKAGES`. | n/a |

**Play Store distribution:** notification-listener access requires a Permissions Declaration and a
core-functionality justification ("scam detection over incoming messages"). The overlay and call-screening role
also get reviewed. Hackathon builds are sideloaded.

## What Android allows and what it doesn't

- **No AccessibilityService.** JAAL never reads screen content. It sees only notification title/text,
  and only from apps that post notifications. Messages inside an open chat that never notify are not seen.
- **Clipboard:** since Android 10, background apps cannot read the clipboard. JAAL does not fake it. It offers:
  - reading the clipboard **when JAAL is opened** (a banner offers the check; nothing is sent until you tap it)
  - a **Quick Settings tile "Check clipboard"**, which opens a small JAAL window that reads on focus
  - **"Check with JAAL"** in the system share sheet (`ACTION_SEND text/plain`)
- **Calls:** `CallScreeningService` only receives non-contact numbers (non-dialer app), API 29+. On Android 8–9
  there is no call sensor. JAAL never blocks calls automatically and never places calls (`ACTION_DIAL` only).
- **Package installs:** `ACTION_PACKAGE_ADDED` doesn't reach manifest receivers (API 26+). JAAL registers a
  runtime receiver while the notification listener is bound. It also checks the `firstInstallTime` of the
  watched remote-access packages on every evaluation.
- **code_read_aloud** (a victim reading an OTP to a caller) is **out of scope**: it would need the microphone or
  screen, and JAAL reads neither.
- **Guardian polling:** while JAAL is open, it polls every 60 s. It also polls on notification-listener wakeups
  (throttled to 60 s) and through a `JobScheduler` periodic job, which Android caps at a minimum of 15 min and
  Doze may defer. Alerts are therefore near-real-time while the guardian's phone is active, and can be up to
  about 15+ min late otherwise. There is no push channel yet (FCM would need a Firebase project and secrets).

## Personal layer (on device only, `noBackupFilesDir/baseline.json`, never uploaded)

`PersonalBaseline` learns known payees (UPI handles paid via UPI-app receipts or marked "I know this payee"),
the last 50 amounts, and a 24-hour histogram. It emits:

- `first_time_payee`: a UPI handle never seen before, in a payment context. Sent as `context.firstTimePayee`.
- `out_of_pattern`: the amount is more than 3× the median, or the hour has never been used (after 20 payments).
- `call_plus_payment`: a UPI app is active, or a pay request arrives, within 15 min of an unknown call.
- `install_plus_call`: a remote-access app is installed during or right after an unknown call.

`call_plus_payment` / `install_plus_call` escalate a message that has identifiers to `trigger`. This happens
*after* the shared triage, so phone/server parity is untouched. An active unknown call sets `onCall` in triage
(+1.2, as in extract.js).

## Guardian mode

The protected phone runs Settings → *Make pairing code* (`POST /api/guardian/pair`) and shows the 6-digit code.
The guardian's phone enters the code (`POST /api/guardian/link`) plus the protected person's number, which is
stored locally. On a confirmed verdict, the protected phone sends `POST /api/guardian/alert`. The guardian's
phone then shows a notification with a **Call** button (`ACTION_DIAL`).

## Parity tests

`tools/samples.json` → `node tools/golden.js` → `app/src/test/resources/golden.json` (28 cases: English, Hindi,
Gujarati, full-width, URLs with ports/dot-segments/IDN/hex IPs, crypto, APKs, emails, call context).
`ExtractParityTest` asserts the same level, score, trigger ids, identifier order/type/value/raw/flags, and
8-hex prefix as the JS, plus a <10 ms triage budget. Rerun `node tools/golden.js` whenever
`shared/extract.js` changes.

The Kotlin regexes avoid `\w \d \b \s .` because Android's regex engine is ICU (Unicode classes) while JS and the
JVM are ASCII-ish. Each is spelled out explicitly; see the header of `core/Extract.kt`. `new URL()` is emulated
for http(s) by a small WHATWG subset (`WhatwgUrl`).

## Demo script (filming)

1. Start the server (`server/`, port 8787). On a phone, set Settings → Server URL to the laptop's LAN IP.
2. Open JAAL and grant notification access + display over other apps (onboarding screen).
3. Home shows "Watching notifications" and "N prefixes".
4. Tap **Demo: post a sample scam notification**. JAAL posts a realistic SBI-KYC SMS containing
   `refund.desk@ybl` (flagged as a demo so the listener treats it as external) and goes to the home screen.
   The listener triages it as a trigger and the card slides in under the status bar. Against the seeded graph
   it shows the chip, the headline ("61 people reported this UPI handle"), and the ring revealing
   centre → hop1 → edges → hop2 → pulse.
5. Tap **See ring**. The detail screen shows a large ring, the campaign, the identifiers, *Report on Chakshu*
   (copies the draft and opens sancharsaathi.gov.in/sfc), *Call 1930* (dialer, not auto-called),
   *Share with family*, and *Dispute*.
6. Optional: Quick Settings → add the **Check clipboard** tile; copy a scam text in any app and tap the tile.
7. Optional: on a second phone, use Guardian mode to show the alert with a Call button.

Reduced motion (Developer options → Animator duration scale off) renders the card and ring complete, with
no animation.

## Layout

```
app/src/main/java/app/jaal/android/
  core/Extract.kt                 extract/triage port + WHATWG URL subset + SHA-256 prefix
  data/                           Prefs, ApiClient, Verdict/Ring model, PrefixStore, RecentStore
  engine/Checker.kt               ambient pipeline; PersonalBaseline; CallState
  service/                        JaalNotificationListener, JaalCallScreeningService, ClipboardTileService, JaalJobService
  guardian/Guardian.kt
  ui/                             OverlayController, RingView, CardBinder, Main/Onboarding/Settings/Verdict/Check activities
app/src/main/res/                 tokens as colors/dimens/themes, en + hi + gu strings
```

Hindi and Gujarati strings cover the visible core and **need native review**. Untranslated keys fall back to
English. Server-provided headlines are requested in the chosen `lang`.
