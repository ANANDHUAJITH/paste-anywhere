const $ = id => document.getElementById(id);
const CHUNK = 16 * 1024;
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

let senderPeer = null, senderConn = null, outgoing = null;
let receiverPeer = null, receiverConn = null;
let incomingMeta = null, incomingParts = [], incomingSize = 0, receivedBlob = null;

function status(id, message) { $(id).textContent = message; }
function setProgress(id, value) { $(id).style.width = `${Math.max(0, Math.min(100, value))}%`; }

// The username+password pair is hashed into a short room id. Any two devices
// that enter the same username & password land on the same room id, which is
// how they find each other on the public PeerJS signaling broker — no manual
// codes, no QR codes, no copy/paste.
async function roomId(username, password) {
  const data = new TextEncoder().encode(`paste-anywhere:${username.trim().toLowerCase()}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'pa-' + hex.slice(0, 24);
}

function validateCreds(username, password) {
  if (username.trim().length < 6) throw new Error('Username needs at least 6 characters.');
  if (password.length < 6) throw new Error('Password needs at least 6 characters.');
}

function randomCreds() {
  const words = ['nova', 'quartz', 'cedar', 'river', 'comet', 'vivid', 'amber', 'ember', 'pixel', 'orbit'];
  const pick = () => words[Math.floor(Math.random() * words.length)] + Math.floor(100 + Math.random() * 900);
  return { username: pick(), password: pick() };
}
$('generate-creds').addEventListener('click', () => {
  const { username, password } = randomCreds();
  $('send-username').value = username; $('send-password').value = password;
  status('sender-status', 'Generated. Share these two values with the receiver, then click Start sharing.');
});

function friendlyPeerError(err) {
  const type = err && err.type;
  if (type === 'unavailable-id') return 'That username & password are already sharing something right now. Pick a different password, or wait for the other share to finish.';
  if (type === 'peer-unavailable') return 'No active share found for that username & password yet. Make sure the sender clicked "Start sharing" first, and that both sides typed the exact same values.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'disconnected') return 'Could not reach the signaling service. Check your connection and try again.';
  return (err && err.message) || 'Connection error.';
}

// ---------- Sender ----------
$('start-share').addEventListener('click', async () => {
  try {
    const username = $('send-username').value, password = $('send-password').value;
    validateCreds(username, password);
    const file = $('send-file').files[0], text = $('send-text').value;
    if (!file && !text) throw new Error('Enter text or choose a file first.');
    if (file && file.size > 500 * 1024 * 1024) throw new Error('For reliability, this demo limits files to 500 MB.');
    outgoing = file
      ? { name: file.name, type: file.type || 'application/octet-stream', size: file.size, blob: file }
      : { name: 'pasted-text.txt', type: 'text/plain;charset=utf-8', size: new Blob([text]).size, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) };

    $('start-share').disabled = true;
    status('sender-status', 'Opening room…');
    const id = await roomId(username, password);
    senderPeer?.destroy();
    senderPeer = new Peer(id, { config: { iceServers: ICE } });

    senderPeer.on('open', () => {
      status('sender-status', 'Waiting for the receiver to connect with the same username & password…');
    });
    senderPeer.on('connection', conn => {
      senderConn = conn;
      status('sender-status', 'Receiver found. Connecting…');
      conn.on('open', () => sendOutgoing(conn));
      conn.on('error', e => status('sender-status', friendlyPeerError(e)));
      conn.on('close', () => status('sender-status', 'Receiver disconnected.'));
    });
    senderPeer.on('error', err => {
      status('sender-status', friendlyPeerError(err));
      $('start-share').disabled = false;
    });
    senderPeer.on('disconnected', () => status('sender-status', 'Disconnected from signaling service.'));
  } catch (e) {
    status('sender-status', e.message);
    $('start-share').disabled = false;
  }
});

async function sendOutgoing(conn) {
  try {
    status('sender-status', 'Connected. Sending…');
    const blob = outgoing.blob;
    conn.send({ kind: 'meta', name: outgoing.name, type: outgoing.type, size: outgoing.size });
    let offset = 0;
    const dc = conn.dataChannel;
    while (offset < blob.size) {
      if (conn.open === false) throw new Error('Peer disconnected during transfer.');
      if (dc && dc.bufferedAmount > CHUNK * 32) {
        await new Promise(resolve => dc.addEventListener('bufferedamountlow', resolve, { once: true }));
      }
      const chunk = await blob.slice(offset, offset + CHUNK).arrayBuffer();
      conn.send(chunk);
      offset += chunk.byteLength;
      setProgress('send-progress', blob.size ? (offset / blob.size) * 100 : 100);
    }
    conn.send({ kind: 'done' });
    status('sender-status', 'Transfer complete. The data went directly to the other browser.');
  } catch (e) {
    status('sender-status', e.message);
    $('start-share').disabled = false;
  }
}

// ---------- Receiver ----------
$('start-receive').addEventListener('click', async () => {
  try {
    const username = $('recv-username').value, password = $('recv-password').value;
    validateCreds(username, password);
    $('start-receive').disabled = true;
    status('receiver-status', 'Looking for the share…');
    const id = await roomId(username, password);
    receiverPeer?.destroy();
    receiverPeer = new Peer({ config: { iceServers: ICE } });

    let settled = false;
    const giveUp = setTimeout(() => {
      if (settled) return;
      settled = true;
      receiverConn?.close();
      status('receiver-status', 'No response. Make sure the sender clicked "Start sharing" and that both sides typed the exact same username & password, then try again.');
      $('start-receive').disabled = false;
    }, 20000);

    receiverPeer.on('open', () => {
      const conn = receiverPeer.connect(id, { reliable: true });
      receiverConn = conn;
      conn.on('open', () => {
        settled = true; clearTimeout(giveUp);
        status('receiver-status', 'Connected. Waiting for incoming data…');
      });
      conn.on('data', handleIncoming);
      conn.on('close', () => status('receiver-status', 'Transfer connection closed.'));
      conn.on('error', e => {
        settled = true; clearTimeout(giveUp);
        status('receiver-status', friendlyPeerError(e));
        $('start-receive').disabled = false;
      });
    });
    receiverPeer.on('error', err => {
      settled = true; clearTimeout(giveUp);
      status('receiver-status', friendlyPeerError(err));
      $('start-receive').disabled = false;
    });
  } catch (e) {
    status('receiver-status', e.message);
    $('start-receive').disabled = false;
  }
});

function handleIncoming(data) {
  const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!isBinary) {
    const message = data;
    if (message && message.kind === 'meta') {
      incomingMeta = message; incomingParts = []; incomingSize = 0;
      $('received').classList.add('hidden');
      status('receiver-status', `Receiving ${message.name}…`);
    }
    if (message && message.kind === 'done' && incomingMeta) finishIncoming();
    return;
  }
  if (!incomingMeta) return;
  const buf = data instanceof ArrayBuffer ? data : data.buffer;
  incomingParts.push(buf); incomingSize += buf.byteLength;
  const pct = incomingMeta.size ? Math.min(100, (incomingSize / incomingMeta.size) * 100) : 100;
  status('receiver-status', `Receiving… ${Math.round(pct)}%`);
}

function finishIncoming() {
  receivedBlob = new Blob(incomingParts, { type: incomingMeta.type || 'application/octet-stream' });
  $('received-name').textContent = `${incomingMeta.name} · ${(receivedBlob.size / 1024).toFixed(1)} KB`;
  const url = URL.createObjectURL(receivedBlob);
  $('download').href = url; $('download').download = incomingMeta.name;
  const preview = $('received-preview'); preview.replaceChildren();
  if ((incomingMeta.type || '').startsWith('text/')) {
    const pre = document.createElement('pre'); pre.textContent = 'Loading preview…'; preview.append(pre);
    receivedBlob.text().then(t => pre.textContent = t);
  } else if ((incomingMeta.type || '').startsWith('image/')) {
    const img = document.createElement('img'); img.alt = incomingMeta.name; img.src = url; preview.append(img);
  } else if ((incomingMeta.type || '').startsWith('audio/')) {
    const audio = document.createElement('audio'); audio.controls = true; audio.src = url; preview.append(audio);
  } else {
    const p = document.createElement('p'); p.textContent = 'File received. Use Download to save it.'; preview.append(p);
  }
  $('copy-received').classList.toggle('hidden', !(incomingMeta.type || '').startsWith('text/'));
  $('received').classList.remove('hidden');
  status('receiver-status', 'Transfer complete.');
  incomingMeta = null; incomingParts = [];
}

$('copy-received').addEventListener('click', async () => {
  if (!receivedBlob) return;
  try { await navigator.clipboard.writeText(await receivedBlob.text()); $('copy-received').textContent = 'Copied ✓'; }
  catch { status('receiver-status', 'Clipboard access was blocked.'); }
});

window.addEventListener('beforeunload', () => {
  senderConn?.close(); receiverConn?.close();
  senderPeer?.destroy(); receiverPeer?.destroy();
});
