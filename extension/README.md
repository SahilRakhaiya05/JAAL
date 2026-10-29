# JAAL Chrome extension (जाल, "net")

An ambient scam shield for India, built on Manifest V3. It stays silent until something you receive, paste, download or open matches reports from other people. Then it shows one card with a count, the ring it belongs to, and what you can do next.

## Install

**From the zip** (`dist/jaal-extension.zip`, also served by the website as `/extension.zip`):
1. Unzip it to a folder.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.

**From source:**
```
cd extension
npm install        # dev-only: bundled fonts (OFL)
npm run build      # copies ../shared/{extract.js,tokens.css,ring.js} into lib/, renders icons, zips
npm test           # node:test unit tests
```
Then use **Load unpacked** on the `extension/` folder.

The API defaults to `http://localhost:8787/api` (start it with `cd ../server && npm start`). You can change it under Settings > Server. If the API is down, JAAL keeps working on-device.

## The four rules

| Rule | What it watches | What it does |
|---|---|---|
| **Chat watch** | New incoming bubbles on web.whatsapp.com, web.telegram.org, mail.google.com | A debounced MutationObserver reads only added message nodes in the conversation pane. It finds them by role, aria and data-attributes, with class names as one fallback, and skips your own outgoing messages. Every message is scored on-device. `ignore` stops there. `check` is sent only on a hash-prefix hit. `trigger` is sent to `POST /api/check`. *Reported* shows a caution card. *Confirmed* tints the card, animates the ring, dims the page a little (click to dismiss) and sends a desktop notification. |
| **Site check** | Each top-level navigation | The domain is hashed and looked up in the prefix set. Only a hit is sent to the graph. A *confirmed* domain gets a declarativeNetRequest dynamic redirect rule to `pages/blocked.html`, which offers **Go back** (primary) and **Continue anyway**. Continue anyway adds a session allow rule. A *reported* domain gets the in-page card. |
| **Paste check** | `paste` events (capture phase), all sites | JAAL pulls UPI handles, bank accounts and crypto wallets from the pasted text. If their prefix is reported, a card appears under the field ("61 people reported this UPI handle"). The paste is never blocked, and the clipboard is never read outside a paste. |
| **Download watch** | `chrome.downloads` | AnyDesk, TeamViewer, QuickSupport, AirDroid, RustDesk and UltraViewer are matched by filename and URL. JAAL asks one question: *"Is someone on a call asking you to install this?"* **Yes** shows guidance (hang up, don't share codes, call 1930), with **Cancel download** and **Delete the file** as buttons you must click. |

**Offline:** if the API is unreachable, `trigger`-level messages still get an on-device card ("Matches 3 scam patterns: asks for an OTP, KYC update pressure, urgency pressure") marked *Checked on this device only*. Everything else stays silent.

**Side panel** (toolbar icon): latest verdict with the full ring, the last 20 checks, a manual check box, and these actions: Chakshu (copies a filled draft and opens the form, never auto-submits), Call 1930 (number and script), Share with family (text plus ring PNG) and Dispute. If `chrome.sidePanel` is missing, the toolbar opens a small popup with status and toggles.

**Settings:** API base URL, per-rule switches, language (English, हिन्दी, ગુજરાતી), Guardian pairing (enter a family member's 6-digit code, which calls `POST /api/guardian/link`, or get a code for this browser), optional "early stop" site access, and a privacy summary.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Settings, device id, prefix cache, last 20 checks. All local. |
| `sidePanel` | The JAAL panel. |
| `notifications` | Desktop alert for confirmed rings, the download question, and Guardian alerts. |
| `downloads` | Notice remote-access installers. Cancel or delete one only when you click. |
| `declarativeNetRequestWithHostAccess` | Redirect rules for confirmed ring domains, plus session allow rules for "Continue anyway". The `WithHostAccess` variant adds no install warning. Rules only fire on hosts you grant. |
| `webNavigation` | See top-level navigations so the domain can be checked before the page loads. This also works for scam domains that don't resolve. |
| `alarms` | Refresh the prefix list every 30 minutes and poll Guardian alerts. |
| `optional_host_permissions: <all_urls>` | Off by default. If you grant it (Settings > "Allow early stop"), Chrome redirects confirmed domains before any byte loads. Without it, JAAL sends the tab to the warning page itself. |
| Content script on `<all_urls>` | Needed for **paste check**: payment fields live on any bank, wallet or shop site, and the payee cannot be known in advance. The script does nothing until you paste, reads only that paste event's text, and sends only the extracted identifier. The same script hosts the in-page card (closed shadow DOM, so pages can't read or restyle it). |
| Content script on WhatsApp Web, Telegram Web, Gmail (and `localhost` / `file:///` `*/demo/*` for the demo) | Chat watch. |

No `tabs` permission, no install-time host permissions, no remote code (CSP `script-src 'self'`), no remote fonts. See [PRIVACY.md](PRIVACY.md).

## Demo for judges (30 seconds)

Start the API (`cd server && npm start`) and the demo pages (`cd extension && npm run demo`, then open `http://localhost:5174/demo/`). You can also open them from inside the extension: Settings > *Open the demo pages*. Open the JAAL side panel from the toolbar.

1. **Chat (10 s):** open *Chat* and click **Receive next message**. A red *Confirmed ring* card slides in at the top right: "61 people reported this UPI handle", with a ring thumbnail, the page slightly dimmed, and a desktop notification. Click **Send my own reply**: nothing happens, because your own messages are ignored. Click **Receive a low-signal message**: it is checked only because its hash prefix is on the list.
2. **Pay (8 s):** open *Pay*, click **Copy** next to `refund.desk@ybl`, then paste into *UPI ID*. The card appears right under the field, before any money moves, and the paste still goes through.
3. **Site (5 s):** type `earn-daily-task.vip` in the address bar. JAAL hashes the domain locally, gets a prefix hit, asks the graph, and shows the *Confirmed ring* warning page with **Go back** and **Continue anyway**.
4. **Download (7 s):** open *Download* and click **Download AnyDesk.exe** (a harmless 2-line text file). JAAL asks *"Is someone on a call asking you to install this?"* Click **Yes** for the guidance and the **Cancel download** / **Delete the file** buttons.

Offline bonus: stop the server and repeat step 1. The card becomes *On-device · Matches 4 scam patterns*.

## Layout

```
manifest.json, background.js        service worker (gates, API, badge, notifications, DNR, downloads, guardian)
src/core.js                         pure logic (hashing, gating, matcher, text diff, strings) - unit tested
src/card.js                         VerdictCard / StateChip / ring thumbnail / ActionPair / DisputeLink
src/content/{overlay,paste,watch}.js  content scripts (shadow-DOM overlay, paste intercept, chat watch)
pages/                              sidepanel, popup, options, blocked (+ ?mock=1 renders with demo data)
lib/                                built: shared extract.js, tokens.css, ring.js
demo/                               unbranded Chat / Pay / Download pages
scripts/                            build, PNG icon rasteriser, zip writer, demo server
```
