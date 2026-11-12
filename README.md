# Paste Anywhere — fast P2P file & text sharing

A static, browser-based text and file transfer app. It uses **WebRTC DataChannels** to send data directly between two browsers. There is no upload API, backend, hosted transfer store, or account system — just a username and password typed on both ends.

## How it works

1. Open the site on both devices.
2. On each device, type the exact same **username and password (6+ characters each)** and click **Connect**. It doesn't matter which device clicks first — whichever one gets there first opens the room, the other one joins it automatically.
3. Once connected, a shared "live clipboard" text box appears on both sides. Anything typed or pasted into it on either device shows up on the other device as you type, live, for as long as the connection is open.
4. You can also pick a file and click **Send file** at any point while connected — it goes straight to the other device over the same direct connection, with a progress bar and a preview/download card on the receiving side. Either side can send a file, any number of times, independent of the live text sync.
5. The app hashes the username+password into a short room id and uses that to find the matching peer through the public [PeerJS](https://peerjs.com) signaling broker. Once the two browsers find each other, everything — text sync and files — travels directly between them over an encrypted WebRTC data channel; the broker only helps them find each other, it never sees the content.

### Why a username & password instead of copy/paste codes

Plain WebRTC needs some way for two browsers to exchange connection info before they can talk directly. Instead of making people copy/paste long connection codes, this app turns "username + password" into that handshake automatically: both sides hashing the same two values lands them in the same room on the signaling broker, so they're paired with no codes to copy. This is a convenience pairing mechanism, not an authentication system — anyone who learns the username & password (or guesses it) could join that room while it's open, so just use a password that isn't trivially guessable and isn't reused from anywhere important.

### Network caveat

This build uses a public STUN server for peer discovery and deliberately has **no TURN relay**. Direct connections work on many networks, but restrictive NATs, corporate firewalls, VPNs, and some mobile networks may prevent a connection. A TURN service would improve reachability but would relay traffic and require infrastructure. The static app itself does not host or relay user files.

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
- No files are uploaded to this website or stored by it. The sender and receiver browsers hold the data in memory while transferring.
- The username & password are a pairing convenience, not real authentication — anyone with the same two values can join that room while the sender is sharing. Don't reuse a password you care about, and don't treat this as access control.
- A public STUN service and the public PeerJS signaling broker are contacted for peer discovery/pairing; neither receives the file payload, only connection metadata.
- No TURN fallback means some network combinations cannot connect.
- Files are limited to 500 MB each on the sending side; send one at a time and wait for it to finish before starting the next. Browser memory and device capabilities may impose lower practical limits.
- Keep both tabs open for as long as you want text to keep syncing or files to transfer. Closing either tab ends the connection; click Connect again on both sides to start a new session.
- Use HTTPS in production. GitHub Pages provides HTTPS.

## Repository layout

```text
web/                         Static application
.github/workflows/pages.yml  GitHub Pages deployment
```

The previous Go HTTP upload server and Docker deployment are no longer part of the runtime architecture.
