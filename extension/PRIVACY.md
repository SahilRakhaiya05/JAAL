# JAAL extension privacy

JAAL is built so that almost nothing you see ever leaves your computer.

## What stays on this device

- **Chat messages** (WhatsApp Web, Telegram Web, Gmail). Only newly added *incoming* message bubbles are read, never the whole page, contacts, or your own outgoing messages. Each one is scored by an on-device pattern model (`shared/extract.js`, under 1 ms). Most score "ignore" and are forgotten.
- **Weak signals.** If a message has an identifier (number, UPI handle, link) and a weak signal, JAAL hashes `type:value` with SHA-256 on-device and compares the first 8 hex characters against a list of prefixes it downloaded (`GET /api/prefixes`, refreshed every 30 minutes). No match means nothing is sent.
- **Paste.** JAAL reads the clipboard only inside a `paste` event you trigger, never otherwise, and never blocks the paste. Only a UPI handle, bank account number or crypto wallet found in the pasted text is considered, and the rest of the text is discarded immediately.
- **Sites.** Each domain you open is hashed on-device and checked against the same prefix list.
- **Downloads.** File names and URLs are matched on-device against six remote-access tools. Nothing is uploaded.
- **History** of the last 20 checks is kept in `chrome.storage.local` on this device only.

## What is sent, and when

| Trigger | Sent to the JAAL API | Not sent |
|---|---|---|
| Strong scam pattern in an incoming message | that one message's text (max 2000 chars) | the page, other messages, sender name, your messages |
| Weak signal **and** a prefix match | that one message's text | anything else |
| Paste of a handle/account/wallet whose prefix matches, or when no prefix list is available yet | only the identifier(s) (max 3) | the pasted text |
| Site whose domain prefix matches | the domain (and host) | full URL path, page content |
| Manual check in the side panel | the text you typed | anything else |
| Guardian | a pairing code, and on a confirmed verdict the verdict id | messages, identifiers |

Every request carries `reporter`: `SHA-256(salt + ":" + deviceId)`, where both the 32-byte device id and the salt are random values generated on this device and never sent. It is not linked to your name, phone, email or Google account.

## No tracking

No analytics, no ads, no remote code, no remote fonts (fonts are bundled). The only network destination is the JAAL API base URL shown in Settings.

## Turning things off

Each rule (chat watch, site check, paste check, download watch) has its own switch in the popup and Settings. Removing the extension deletes all local data.
