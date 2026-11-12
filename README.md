# Paste Anywhere by GetMeBy — fast P2P file & text sharing

A static, browser-based text and file transfer app. It uses **WebRTC DataChannels** to send data directly between browsers — any number of them in the same room. There is no upload API, backend, hosted transfer store, or account system — just a username and password typed on every device that should join.

## How it works

1. Open the site on every device that should take part — two, three, or more.
2. On each device, type the exact same **username and password (6+ characters each)** and click **Connect**. It doesn't matter which device clicks first — whichever one gets there first creates the room, every device after that joins it automatically.
3. Once connected, a shared "live clipboard" text box appears on every device. Anything typed or pasted into it on any one of them shows up on all the others as you type, live, for as long as the room is open.
4. Anyone in the room can also pick a file and click **Send file** at any point — it goes straight to everyone else over the same direct connections, with a progress bar and a preview/download card on the receiving side. Any participant can send a file, any number of times, independent of the live text sync.
5. The app hashes the username+password into a short room id and uses that to find the matching peer through the public [PeerJS](https://peerjs.com) signaling broker. Once browsers find each other, everything — text sync and files — travels directly between them over encrypted WebRTC data channels; the broker only helps them find each other, it never sees the content.

### Room safety: a username & password can't be "double-booked"

The room id is derived deterministically from the username+password pair, and only one device can hold that id on the signaling broker at a time:

- The **first** device to connect with a given pair creates (opens) the room and becomes its host.
- While that room is open, **nobody can create a second, separate room with the same pair** — trying to "connect" with those same details just joins the existing active room instead, exactly like every other participant.
- **Any number of people** can join an already-open room with the right username & password — there's no limit on guests, and everyone in the room syncs text and files with everyone else.
- Once every device disconnects and the room closes, the same username & password become free again and the next device to use them creates a fresh room.

This is a convenience pairing mechanism, not a hardened authentication system — anyone who learns (or guesses) the username & password can join that room while it's open. Use a pair that isn't trivially guessable and isn't reused from anywhere important.

### Network caveat

This build uses a public STUN server for peer discovery and deliberately has **no TURN relay**. Direct connections work on many networks, but restrictive NATs, corporate firewalls, VPNs, and some mobile networks may prevent a connection. A TURN service would improve reachability but would relay traffic and require infrastructure. The static app itself does not host or relay user files.

## SEO & discoverability

The `web/` app ships with what it needs to show up for searches like "paste anywhere", "share files between devices online free", or "p2p clipboard sync":

- Descriptive `<title>`, meta description, and a keywords tag covering the terms people actually search.
- Open Graph + Twitter Card tags (including a generated `og-image.png`) so links preview well when shared on social apps and chat.
- A canonical URL and `sitemap.xml`, referenced from `robots.txt`, pointing at the GitHub Pages URL.
- `WebApplication` and `FAQPage` JSON-LD structured data, so search engines can surface rich results (price: free, feature list, FAQ snippets).
- Semantic headings (`h1`/`h2`/`h3`) and a real FAQ section with the questions people actually ask before using a tool like this.

**If you deploy to a different URL** (a custom domain, a different GitHub username/repo, etc.), update the `canonical`, `og:url`, `og:image`, `twitter:image` tags and the JSON-LD `url`/`image` fields in `web/index.html`, plus the URLs in `web/sitemap.xml` and `web/robots.txt`, to match. They're currently set to `https://anandhuajith.github.io/paste-anywhere/`.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).
4. The workflow publishes the `web/` directory. The app is static and needs no Go server.

The included `.github/workflows/pages.yml` builds and deploys the site. If your default branch is not `main`, update the workflow trigger.

## Run locally

Because WebRTC and clipboard features require a secure context, use `localhost`:

```bash
cd web
python3 -m http.server 8080
```

Open http://localhost:8080.

## Security and limitations

- WebRTC data channels are encrypted in transit (DTLS/SCTP).
- No files are uploaded to this website or stored by it. Participating browsers hold the data in memory while transferring.
- The username & password are a pairing convenience, not real authentication — anyone with the same two values can join that room while it's open. Don't reuse a password you care about, and don't treat this as access control.
- A public STUN service and the public PeerJS signaling broker are contacted for peer discovery/pairing; neither receives the file payload, only connection metadata.
- No TURN fallback means some network combinations cannot connect.
- Files are limited to 500 MB each on the sending side; send one at a time per device and wait for it to finish before starting the next. Browser memory and device capabilities may impose lower practical limits.
- Keep every tab open for as long as you want text to keep syncing or files to transfer. If the host's tab closes, the room ends for everyone in it; a guest closing their tab only removes that one device. Click Connect again to start or rejoin a room.
- Use HTTPS in production. GitHub Pages provides HTTPS.

## Repository layout

```text
web/                         Static application (index.html, app.js, styles.css, SEO files, og-image.png)
.github/workflows/pages.yml  GitHub Pages deployment
```

The previous Go HTTP upload server and Docker deployment are no longer part of the runtime architecture.
