# Paste Anywhere — serverless P2P

A static, browser-based text and file transfer app. It uses **WebRTC DataChannels** to send data directly between two browsers. There is no upload API, backend, hosted transfer store, account, or PIN database.

## How it works

1. Open the site on both devices.
2. On the sender, choose text or a file and click **Create offer**.
3. Copy the offer to the receiver using any channel you already have (chat, email, QR tool, etc.).
4. The receiver pastes it and clicks **Create answer**.
5. The receiver sends the answer back; the sender pastes it and clicks **Connect & send**.
6. Once connected, the payload travels over an encrypted WebRTC data channel directly between browsers.

### Why copy/paste is required

WebRTC needs signaling to exchange connection descriptions and ICE candidates. To avoid operating a signaling server, this app uses a manual offer/answer exchange. The offer and answer are connection metadata, not the file itself. Do not share them publicly; treat them as temporary connection credentials.

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
- The manually exchanged offer/answer is not authenticated by this app. Exchange it through a trusted channel and verify the intended peer.
- A public STUN service is contacted for network discovery; it does not receive the file payload.
- No TURN fallback means some network combinations cannot connect.
- The current UI transfers one file or text payload per connection, with a 500 MB sender-side limit. Browser memory and device capabilities may impose lower practical limits.
- Keep both tabs open until the transfer completes. Closing either tab ends the connection.
- Use HTTPS in production. GitHub Pages provides HTTPS.

## Repository layout

```text
web/                         Static application
.github/workflows/pages.yml  GitHub Pages deployment
```

The previous Go HTTP upload server and Docker deployment are no longer part of the runtime architecture.
