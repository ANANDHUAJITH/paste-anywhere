const $ = id => document.getElementById(id);
const CHUNK = 16 * 1024;
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

let peer = null, conn = null, role = null; // role: 'host' | 'guest'
let applyingRemoteText = false, textDebounce = null;
let outgoing = null, sending = false;
let incomingMeta = null, incomingParts = [], incomingSize = 0;

function setStatus(message, state) {
  $('room-status').textContent = message;
  const dot = $('room-dot');
  dot.className = 'dot' + (state ? ' ' + state : '');
}
function setProgress(id, value) {
  const pct = Math.max(0, Math.min(100, value));
  $(id).style.width = `${pct}%`;
  const bar = $(id).parentElement;
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

$('toggle-password').addEventListener('click', () => {
  const input = $('room-password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('toggle-password').textContent = showing ? 'Show' : 'Hide';
  $('toggle-password').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  $('toggle-password').setAttribute('aria-pressed', String(!showing));
});

// The username+password pair is hashed into a short, stable room id. Any two
// devices that enter the same username & password land on the same room id,
// so they find each other on the public PeerJS signaling broker automatically
// — no manual codes, no QR codes, no copy/paste of connection text.
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
  $('room-username').value = username; $('room-password').value = password;
  setStatus('Generated. Tell the other device these two values, then Connect on both.');
});
$('copy-creds').addEventListener('click', async () => {
  const username = $('room-username').value, password = $('room-password').value;
  if (!username && !password) return;
  try { await navigator.clipboard.writeText(`${username} / ${password}`); const b = $('copy-creds'); const old = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = old, 1200); }
  catch { setStatus('Clipboard unavailable — copy manually.', 'err'); }
});

function friendlyPeerError(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') return 'Could not reach the other device. Make sure it also clicked Connect with the exact same username & password.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'disconnected') return 'Could not reach the signaling service. Check your connection and try again.';
  return (err && err.message) || 'Connection error.';
}

// ---------- Connect (symmetric: first device opens the room, second joins it) ----------
$('connect-room').addEventListener('click', async () => {
  try {
    const username = $('room-username').value, password = $('room-password').value;
    validateCreds(username, password);
    $('connect-room').disabled = true;
    setStatus('Opening room…', 'connecting');
    const id = await roomId(username, password);
    openOrJoinRoom(id);
  } catch (e) {
    setStatus(e.message, 'err');
    $('connect-room').disabled = false;
  }
});

function openOrJoinRoom(id) {
  peer?.destroy();
  peer = new Peer(id, { config: { iceServers: ICE } });

  peer.on('open', () => {
    role = 'host';
    setStatus('Room open. Waiting for the other device to connect…', 'connecting');
  });
  peer.on('connection', c => {
    if (conn && conn.open) { c.close(); return; } // already paired, ignore extra joiners
    wireConnection(c);
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      // Someone already opened this room — join it instead, as a guest.
      peer.destroy();
      joinRoom(id);
      return;
    }
    setStatus(friendlyPeerError(err), 'err');
    $('connect-room').disabled = false;
  });
  peer.on('disconnected', () => { if (!conn || !conn.open) setStatus('Disconnected from signaling service.', 'err'); });
}

function joinRoom(id) {
  peer = new Peer({ config: { iceServers: ICE } });
  let settled = false;
  const giveUp = setTimeout(() => {
    if (settled || (conn && conn.open)) return;
    settled = true;
    setStatus('No response from the other device. Check the username & password match exactly, then try again.', 'err');
    $('connect-room').disabled = false;
  }, 20000);

  peer.on('open', () => {
    role = 'guest';
    setStatus('Joining room…', 'connecting');
    const c = peer.connect(id, { reliable: true });
    c.on('open', () => { settled = true; clearTimeout(giveUp); });
    c.on('error', e => { settled = true; clearTimeout(giveUp); setStatus(friendlyPeerError(e), 'err'); $('connect-room').disabled = false; });
    wireConnection(c);
  });
  peer.on('error', err => {
    settled = true; clearTimeout(giveUp);
    setStatus(friendlyPeerError(err), 'err');
    $('connect-room').disabled = false;
  });
}

function wireConnection(c) {
  conn = c;
  conn.on('open', () => {
    setStatus('Connected. Live sync is on.', 'live');
    $('connect-card').classList.add('hidden');
    $('live-card').classList.remove('hidden');
    $('live-text').focus();
  });
  conn.on('data', handleData);
  conn.on('close', () => {
    setStatus('Disconnected.', 'err');
    $('connect-room').disabled = false;
    $('live-card').classList.add('hidden');
    $('connect-card').classList.remove('hidden');
  });
  conn.on('error', e => setStatus(friendlyPeerError(e), 'err'));
}

$('disconnect-room').addEventListener('click', () => {
  conn?.close(); peer?.destroy();
  conn = null; peer = null; role = null;
  $('connect-room').disabled = false;
  $('live-text').value = '';
  $('received-files').replaceChildren();
  setStatus('Not connected.');
  $('live-card').classList.add('hidden');
  $('connect-card').classList.remove('hidden');
});

// ---------- Live, two-way clipboard sync ----------
$('live-text').addEventListener('input', () => {
  if (applyingRemoteText) return;
  clearTimeout(textDebounce);
  textDebounce = setTimeout(() => {
    if (conn && conn.open) conn.send({ kind: 'text', value: $('live-text').value });
  }, 100);
});

function applyRemoteText(value) {
  const el = $('live-text');
  if (el.value === value) return;
  applyingRemoteText = true;
  const hadFocus = document.activeElement === el;
  const atEnd = el.selectionStart === el.value.length;
  el.value = value;
  if (hadFocus && atEnd) { el.selectionStart = el.selectionEnd = el.value.length; }
  applyingRemoteText = false;
}

// ---------- Sending a file ----------
$('send-file-button').addEventListener('click', async () => {
  try {
    if (!conn || !conn.open) throw new Error('Not connected yet.');
    if (sending) throw new Error('A file is already sending — wait for it to finish.');
    const file = $('send-file').files[0];
    if (!file) throw new Error('Choose a file first.');
    if (file.size > 500 * 1024 * 1024) throw new Error('For reliability, this demo limits files to 500 MB.');
    sending = true;
    $('send-file-button').disabled = true;
    await sendFile(file);
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    sending = false;
    $('send-file-button').disabled = false;
  }
});

async function sendFile(file) {
  setProgress('send-progress', 0);
  conn.send({ kind: 'meta', name: file.name, type: file.type || 'application/octet-stream', size: file.size });
  let offset = 0;
  const dc = conn.dataChannel;
  while (offset < file.size) {
    if (!conn.open) throw new Error('Peer disconnected during transfer.');
    if (dc && dc.bufferedAmount > CHUNK * 32) {
      await new Promise(resolve => dc.addEventListener('bufferedamountlow', resolve, { once: true }));
    }
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    conn.send(chunk);
    offset += chunk.byteLength;
    setProgress('send-progress', file.size ? (offset / file.size) * 100 : 100);
  }
  conn.send({ kind: 'done' });
  setProgress('send-progress', 100);
  setTimeout(() => setProgress('send-progress', 0), 900);
}

// ---------- Receiving: text + files on the same channel ----------
function handleData(data) {
  const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!isBinary) {
    const message = data;
    if (!message) return;
    if (message.kind === 'text') { applyRemoteText(message.value); return; }
    if (message.kind === 'meta') {
      incomingMeta = message; incomingParts = []; incomingSize = 0;
      setStatus(`Receiving ${message.name}…`, 'live');
      return;
    }
    if (message.kind === 'done' && incomingMeta) { finishIncomingFile(); return; }
    return;
  }
  if (!incomingMeta) return;
  const buf = data instanceof ArrayBuffer ? data : data.buffer;
  incomingParts.push(buf); incomingSize += buf.byteLength;
  const pct = incomingMeta.size ? Math.min(100, (incomingSize / incomingMeta.size) * 100) : 100;
  setStatus(`Receiving ${incomingMeta.name}… ${Math.round(pct)}%`, 'live');
}

function finishIncomingFile() {
  const meta = incomingMeta;
  const blob = new Blob(incomingParts, { type: meta.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const card = document.createElement('div');
  card.className = 'file-card';
  const name = document.createElement('p');
  name.className = 'retrieved-name';
  name.textContent = `${meta.name} · ${(blob.size / 1024).toFixed(1)} KB`;
  card.append(name);

  const preview = document.createElement('div');
  preview.className = 'preview';
  if ((meta.type || '').startsWith('text/')) {
    const pre = document.createElement('pre'); pre.textContent = 'Loading preview…'; preview.append(pre);
    blob.text().then(t => pre.textContent = t);
  } else if ((meta.type || '').startsWith('image/')) {
    const img = document.createElement('img'); img.alt = meta.name; img.src = url; preview.append(img);
  } else if ((meta.type || '').startsWith('audio/')) {
    const audio = document.createElement('audio'); audio.controls = true; audio.src = url; preview.append(audio);
  } else {
    const p = document.createElement('p'); p.textContent = 'File received. Use Download to save it.'; preview.append(p);
  }
  card.append(preview);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const download = document.createElement('a');
  download.className = 'secondary-button'; download.href = url; download.download = meta.name; download.textContent = 'Download file';
  actions.append(download);
  if ((meta.type || '').startsWith('text/')) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary-button'; copyBtn.textContent = 'Copy text';
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(await blob.text()); copyBtn.textContent = 'Copied ✓'; }
      catch { copyBtn.textContent = 'Blocked'; }
    });
    actions.append(copyBtn);
  }
  card.append(actions);

  $('received-files').prepend(card);
  setStatus('Connected. Live sync is on.', 'live');
  incomingMeta = null; incomingParts = []; incomingSize = 0;
}

window.addEventListener('beforeunload', () => { conn?.close(); peer?.destroy(); });
