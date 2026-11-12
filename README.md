# Paste Anywhere

Share text and files directly between your devices. No accounts, uploads, or cloud storage required.

Paste Anywhere is a free, browser-based peer-to-peer sharing tool. Connect your devices using the same username and password, then share text and files over direct browser-to-browser connections.

## Features

- **Live clipboard sync:** Text entered on one connected device appears on the others in real time.
- **Direct file sharing:** Send files to other connected devices without uploading them to a file-hosting service.
- **Multiple devices:** Connect two or more devices to the same room.
- **No account required:** No registration, email address, or installation is needed.
- **Encrypted connections:** WebRTC DataChannels encrypt data in transit.
- **Free to use:** No subscription or payment is required.

## How to Use Paste Anywhere

1. Open the Paste Anywhere website on each device you want to connect.
2. Enter the same username and password on every device. Both must be at least 6 characters long.
3. Click **Connect**.
4. Once connected, use the shared text area to exchange text.
5. To send a file, select it and click **Send file**. Other connected devices can receive and download it.

The first device creates the room. Devices that connect later with the same credentials join that active room.

## Sharing Text

Paste Anywhere provides a shared text area for everyone in the room.

When a participant types or pastes text, the application synchronizes the changes with the other connected devices. This is useful for sharing links, notes, code snippets, and other text.

Text synchronization is available while the room and its connections remain active. It is not a cloud-backed document or permanent storage service.

## Sharing Files

Files are transferred directly between connected browsers using WebRTC DataChannels.

1. Select a file on your device.
2. Click **Send file**.
3. The application transfers the file to the other connected devices.
4. Recipients can view the transfer progress and use the available preview or download option.

The sending-side file size limit is **500 MB per file**. Browser memory and device capabilities may impose lower practical limits.

Send one file at a time per device and wait for the current transfer to finish before starting another.

## How It Works

Paste Anywhere uses a peer-to-peer architecture. It does not use a conventional application backend to receive, store, or distribute files.

### 1. Room identification

The application derives a deterministic room ID from the username and password entered by the user. Devices entering the same credentials derive the same room ID.

### 2. Peer discovery and signaling

The application uses PeerJS and its public signaling broker to help browsers discover each other and establish WebRTC connections.

The first device creates the room. Other devices using the same credentials attempt to join the active room.

The signaling service helps coordinate connection setup. It does not carry the file or text payloads after direct peer connections are established.

### 3. Direct communication

After a connection is established, devices exchange data through WebRTC DataChannels.

Text updates and file data travel directly between connected browsers rather than through a central file-transfer server.

### 4. Encrypted transfers

WebRTC DataChannels use DTLS/SCTP to provide encryption in transit between connected peers.

## Connection Architecture

```text
                 Paste Anywhere
                        |
                 Enter Credentials
                        |
                 Generate Room ID
                        |
                 PeerJS Signaling
                        |
                 Discover Devices
                        |
                 WebRTC Connections
                        |
                Encrypted DataChannels
                        |
             +----------+----------+
             |          |          |
           Phone      Laptop     Desktop
             |          |          |
             +----- Text Sync -----+
             |          |          |
             +----- File Sharing --+
```

## Room Behaviour

A room is identified by the username and password combination.

- The first device to connect creates the room.
- Devices using the same credentials join the active room.
- Multiple devices can participate in the same room.
- A second independent room cannot be created with the same room ID while the first is active.
- When the host disconnects, the room ends for everyone.
- When all devices have disconnected and the room is closed, the credentials can be used to create a new room.

The username and password are a pairing mechanism, not a hardened authentication system. Anyone who knows the credentials may be able to join while the room is active.

Use a unique, difficult-to-guess combination. Do not reuse a password that protects another account or service.

## Privacy and Security

- Files are not uploaded to a Paste Anywhere file-storage server.
- Text and files are exchanged through direct peer connections.
- WebRTC encrypts data in transit.
- The public PeerJS signaling broker and STUN service are used for connection setup and network discovery.
- The application does not provide permanent cloud storage for shared text or files.
- No user account or registration is required.

The signaling broker and STUN service may process connection metadata, such as information needed to establish peer connections. They are not intended to receive the contents of file transfers or shared text sent over established DataChannels.

Do not treat room credentials as strong access control. Anyone who obtains them may be able to join the room.

## Network Requirements and Limitations

Paste Anywhere uses a public STUN server and does not include a TURN relay.

Direct WebRTC connections work on many networks, but some network configurations prevent them. Connection problems may occur with:

- Restrictive NAT configurations
- Corporate or institutional firewalls
- Some VPN connections
- Certain mobile networks

A TURN service could improve connectivity by relaying traffic, but it would require additional infrastructure. This version deliberately does not use one.

Other limitations:

- The sending-side file size limit is 500 MB per file.
- Browser memory and device capabilities may reduce the practical file size limit.
- Keep the browser tab open while using the room.
- The host's tab must remain open to keep the room active.
- If a guest closes their tab, only that guest disconnects.
- If the host closes their tab, the room ends for everyone.
- Reconnect by clicking **Connect** again.
- The application requires HTTPS in production. Local development can use `localhost`.

## Frequently Asked Questions

### Is Paste Anywhere free?

Yes. Paste Anywhere is free to use.

### Do I need to create an account?

No. Enter the same username and password on the devices you want to connect.

### Can I connect my phone and computer?

Yes. Open the website on both devices and use the same room credentials.

### Can more than two devices connect?

Yes. Multiple devices can join the same active room.

### Are files uploaded to a server?

No. Files are transferred directly between connected browsers using WebRTC DataChannels.

### Does Paste Anywhere store my files?

Paste Anywhere does not provide a central file-storage service. Files are transferred between participating browsers.

### Is shared text saved permanently?

No. The shared text is synchronized during the active session. It is not stored as a permanent cloud document.

### Can someone else join my room?

Anyone who knows the exact username and password may be able to join while the room is active. Keep your credentials private.

### Why are my devices unable to connect?

Some networks block or restrict direct peer-to-peer connections. Firewalls, VPNs, and restrictive NAT configurations can prevent WebRTC connections. This version does not have a TURN relay fallback.

### What happens when I close the browser tab?

If the host closes its tab, the room ends for everyone. If a guest closes its tab, only that device disconnects.

### What is the maximum file size?

The sending-side limit is 500 MB per file. Actual limits may be lower depending on the browser and available memory.

## About

Paste Anywhere is a browser-based peer-to-peer text and file sharing application by GetMeBy.

Its goal is simple: make sharing between your own devices quick and straightforward, without requiring accounts, file uploads, or cloud storage.

**Connect. Paste. Share.**
