// Dev helper that (re)writes the secondary pages from one shared shell, so their head/header/footer stay identical.
// Run: node web/dev/build-pages.mjs   (output is checked in; the site itself has no build step)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const head = ({ title, desc, scripts = [], css = ['pages'] }) => `<!doctype html>
<html lang="en-IN" data-theme-auto>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#0A0C0F">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&family=Noto+Sans+Gujarati:wght@400;600&display=swap">
<link rel="stylesheet" href="/assets/app.css">
${css.map((c) => `<link rel="stylesheet" href="/assets/${c}.css">`).join('\n')}
${scripts.join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="JAAL home"><span data-icon="mark" style="color:var(--brand);display:inline-flex"></span>jaal</a>
    <span class="spacer"></span>
    <a class="btn sm" href="/check.html">Check something</a>
  </div>
</header>
`;
const foot = `
<footer class="foot">
  <div class="wrap">
    <div><a class="brand" href="/"><span data-icon="mark" style="color:var(--brand);display:inline-flex"></span>jaal</a><p style="margin-top:8px;max-width:36ch">जाल means net. Built in India, for the people scam rings call first.</p></div>
    <div><h4>Product</h4><ul><li><a href="/check.html">Check something</a></li><li><a href="/guardian.html">Family Shield</a></li><li><a href="/extension.html">Install</a></li></ul></div>
    <div><h4>Trust</h4><ul><li><a href="/privacy.html">Privacy</a></li><li><a href="/privacy.html#dispute">Dispute a report</a></li><li><a href="tel:1930">Call 1930</a></li></ul></div>
    <div><h4>Graph</h4><ul><li><a href="/#rings">Ring of the day</a></li><li><a href="/api/stats">Public stats API</a></li></ul></div>
  </div>
</footer>
</body>
</html>
`;
const mod = '<script src="/shared/extract.js" defer></script>\n<script src="/shared/ring.js" defer></script>\n<script type="module" src="/assets/pages.js"></script>';

const pages = {
  'ring.html': [head({ title: 'A scam ring, mapped — JAAL', desc: 'Every number, UPI ID, account and link in one scam ring, as the JAAL graph sees it.', scripts: [mod] }), `
<main class="wrap page" id="main" data-page="ring">
  <p class="crumbs"><a href="/#rings">Ring of the day</a><span aria-hidden="true">/</span><span id="rCrumb">Ring</span></p>
  <h1 class="page-title" id="rName">Loading the ring…</h1>
  <p class="page-sub" id="rPattern"></p>
  <div class="statrow" id="rStats"></div>
  <div class="ring-hero dark">
    <div class="stage" id="rStage" role="img" aria-label="Ring diagram"></div>
    <div class="bar">
      <div class="legend"><span><i style="background:var(--brand)"></i>Centre</span><span><i style="background:var(--state-confirmed)"></i>Confirmed</span><span><i style="background:var(--text-lo);opacity:.4"></i>Linked</span></div>
      <span class="spacer"></span>
      <button class="btn sm" type="button" id="rReplay">Replay</button>
      <button class="btn sm" type="button" id="rShare"><span data-icon="share"></span>Share</button>
      <button class="btn sm primary" type="button" id="rDownload"><span data-icon="download"></span>Download image</button>
    </div>
  </div>
  <h2 class="sub">Where it spread</h2>
  <p class="caption lo" style="margin-top:6px">Cities in the order reports first arrived from them.</p>
  <ol class="spread" id="rSpread"></ol>
</main>`],

  'privacy.html': [head({ title: 'Privacy — JAAL', desc: 'What JAAL takes (hashed scammer-side identifiers) and what it never takes (contacts, your identity, your messages).', scripts: [mod] }), `
<main class="wrap page narrow doc" id="main" data-page="privacy">
  <h1 class="page-title">We keep what the scammer sent. Never you.</h1>
  <p class="page-sub">Plain language, no legal hedging. If something here is ever untrue, that is a bug and we will fix it.</p>
  <div class="tworow">
    <div class="yes"><h3>What JAAL takes</h3><ul>
      <li>Scammer-side identifiers: the number, UPI ID, bank account, link, app file or wallet in a suspicious message</li>
      <li>Only as SHA-256 hashes for lookups; the first 8 characters are checked first</li>
      <li>A report, tied to a salted hash of a random device id</li>
    </ul></div>
    <div class="no"><h3>What JAAL never takes</h3><ul>
      <li>Your contacts or address book</li>
      <li>Your name, phone number, email or any account</li>
      <li>Your messages, beyond the scammer identifiers in them</li>
      <li>Your screen: no Android AccessibilityService</li>
    </ul></div>
  </div>

  <h2>How a check works</h2>
  <p>Your device keeps a list of 8-character hash prefixes for identifiers that have been reported. When something arrives, JAAL extracts identifiers on the device, hashes them, and compares prefixes locally, the same pattern Google Safe Browsing uses. Only when a prefix matches does your device ask for that one bucket of full hashes. The server never learns the identifiers that did not match.</p>
  <p>Most text never leaves your device at all: <strong>on-device triage</strong> runs in under 1 ms and discards everything without a signal.</p>

  <h2>Your normal stays on your phone</h2>
  <p>JAAL learns what is normal for you, like the payees you pay every month, as an <strong>on-device baseline</strong>. It is never uploaded and is deleted when you uninstall.</p>

  <h2>Reports and reporters</h2>
  <p>A report is linked to a <strong>salted hash</strong> of a random id made on your device, never to a person. Message text is only stored after removing your own names, amounts and account numbers. A verdict says "confirmed" only after at least 3 reports from 2 independent groups of reporters, or a match with a public feed.</p>

  <h2>Chakshu and 1930</h2>
  <p>JAAL drafts a Chakshu report for you to read and send yourself. It is <strong>never auto-submitted</strong>. Calling 1930 is always your tap.</p>

  <h2 id="dispute">Dispute a report</h2>
  <p>If your number, UPI ID or site is shown as reported and it is yours, tell us. Its reports are held for review straight away and nothing is shown as confirmed while we look.</p>
  <form class="formcard" id="disputeForm">
    <div class="field"><label for="dId">Your number, UPI ID, link or account</label><input class="input" id="dId" required autocomplete="off" placeholder="e.g. shop.name@okaxis"></div>
    <div class="field"><label for="dWhy">Why is it wrong?</label><textarea class="input" id="dWhy" rows="3" required maxlength="500"></textarea></div>
    <div class="field"><label for="dContact">Contact (optional)</label><input class="input" id="dContact" autocomplete="off" maxlength="120"></div>
    <button class="btn primary" type="submit">Send dispute</button>
    <p class="caption lo" id="dStatus" role="status"></p>
  </form>
</main>`],

  'guardian.html': [head({ title: 'Family Shield — JAAL', desc: 'Pair your parent’s phone with yours using a 6-digit code. When they see a confirmed scam ring, you see it too.', scripts: [mod] }), `
<main class="wrap page narrow" id="main" data-page="guardian">
  <h1 class="page-title">Family Shield</h1>
  <p class="page-sub">Pair a parent’s phone with yours using a 6-digit code. When JAAL shows them a confirmed ring, you get the same card. No account, no contacts.</p>
  <div class="seg2" role="tablist" aria-label="Which phone is this?">
    <button role="tab" type="button" id="tabParent" aria-selected="true" aria-controls="paneParent">This is the phone to protect</button>
    <button role="tab" type="button" id="tabGuardian" aria-selected="false" aria-controls="paneGuardian">I am the guardian</button>
  </div>
  <section class="pane" id="paneParent" role="tabpanel" aria-labelledby="tabParent">
    <p class="lo">Show a code here, then type it on your own phone under “I am the guardian”.</p>
    <div class="code" id="code" aria-live="polite"><span>·</span><span>·</span><span>·</span><span>·</span><span>·</span><span>·</span></div>
    <button class="btn primary" type="button" id="pairBtn">Show pairing code</button>
  </section>
  <section class="pane" id="paneGuardian" role="tabpanel" aria-labelledby="tabGuardian" hidden>
    <form id="linkForm" class="pane" style="margin-top:0">
      <div class="field"><label for="codeIn">6-digit code from the other phone</label>
      <input class="input codeinput" id="codeIn" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>
      <button class="btn primary" type="submit">Link phones</button>
    </form>
    <p class="status-line" id="linkStatus" role="status"></p>
    <div id="alertsWrap" hidden>
      <h2 class="sub" style="margin-top:24px">Alerts</h2>
      <p class="status-line" style="margin:6px 0 16px"><span class="live"><i></i></span><span>Checking every 15 s</span></p>
      <div class="alerts" id="alerts" aria-live="polite"></div>
    </div>
  </section>
</main>`],

  'extension.html': [head({ title: 'Install the Chrome extension — JAAL', desc: 'Four steps to load JAAL into Chrome while it waits for the Web Store.', scripts: [mod] }), `
<main class="wrap page narrow" id="main" data-page="extension">
  <h1 class="page-title">Add JAAL to Chrome in four steps</h1>
  <p class="page-sub">While the Web Store listing is in review, load the extension directly. It takes about a minute and works in Chrome, Edge and Brave.</p>
  <ol class="isteps">
    <li>
      <div><h3>Download the extension</h3><p>One zip. Unzip it somewhere you will not delete it, like Documents.</p>
        <a class="btn primary copy" href="/extension.zip" download><span data-icon="download"></span>Download jaal-extension.zip</a></div>
      <div class="mock" aria-hidden="true"><div class="file"><i></i><span>jaal-extension</span></div><div class="file"><i></i><span>jaal-extension.zip</span></div></div>
    </li>
    <li>
      <div><h3>Open the extensions page</h3><p>Paste this into the address bar. Chrome does not let websites open it for you.</p>
        <button class="btn copy" type="button" data-copy="chrome://extensions"><span data-icon="copy"></span>Copy chrome://extensions</button></div>
      <div class="mock" aria-hidden="true"><div class="url">chrome://extensions</div></div>
    </li>
    <li>
      <div><h3>Turn on Developer mode</h3><p>The switch is in the top-right corner of the extensions page.</p></div>
      <div class="mock" aria-hidden="true"><div class="row"><span>Extensions</span><span class="row" style="gap:8px"><span>Developer mode</span><span class="toggle"></span></span></div></div>
    </li>
    <li>
      <div><h3>Load unpacked, then pin it</h3><p>Click <b>Load unpacked</b>, choose the unzipped <b>jaal-extension</b> folder, then pin JAAL from the puzzle icon.</p></div>
      <div class="mock" aria-hidden="true"><div><span class="fakebtn hl">Load unpacked</span> <span class="fakebtn">Pack extension</span></div><div class="pin"><span data-icon="mark"></span></div></div>
    </li>
  </ol>
  <p class="caption lo" style="margin-top:24px">Prefer Android? <a href="/jaal.apk" download>Download the APK</a>. Nothing to install? <a href="/check.html">Check something here</a>.</p>
</main>`],

  'thanks.html': [head({ title: 'Family Shield is on — JAAL', desc: 'Thank you. Pair your family’s phones to start getting alerts.', scripts: [mod] }), `
<main class="wrap page narrow" id="main" data-page="thanks">
  <div class="done-mark" aria-hidden="true"></div>
  <h1 class="page-title">Family Shield is on.</h1>
  <p class="page-sub">Thank you. Your ₹149 covers up to 5 phones for a month. Pair them now so alerts reach you.</p>
  <p class="demo-note" id="demoNote" hidden>Demo checkout: no money was taken.</p>
  <ul class="nextlist">
    <li><a href="/guardian.html"><span><b>Pair a parent’s phone</b><small>Show a 6-digit code on their phone, type it on yours.</small></span><span data-icon="arrow"></span></a></li>
    <li><a href="/extension.html"><span><b>Add JAAL to their Chrome</b><small>WhatsApp Web, Gmail and payment pages, covered.</small></span><span data-icon="arrow"></span></a></li>
    <li><a href="/check.html"><span><b>Check something now</b><small>Unlimited checks are on for this device.</small></span><span data-icon="arrow"></span></a></li>
  </ul>
</main>`]
};

for (const [file, [h, body]] of Object.entries(pages)) fs.writeFileSync(path.join(WEB, file), h + body + foot);
console.log('wrote', Object.keys(pages).join(', '));
