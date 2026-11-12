const $ = id => document.getElementById(id);
const CHUNK = 16 * 1024;
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

let peer = null, role = null; // role: 'host' | 'guest'
// conns: Map<peerId, DataConnection>. A guest only ever has one entry (the
// host). A host can have any number — every device that connects with the
// same room username & password joins the same room and syncs with everyone
// else in it.
let conns = new Map();
let applyingRemoteText = false, textDebounce = null, lastTextValue = '';
let sending = false;
// Per-sender incoming-file state, keyed by the sender's peer id, so two
// people in the same room can send files at the same time without mixing
// their chunks up.
let incoming = new Map();

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
function peerCountLabel() {
  const others = [...conns.values()].filter(c => c.open).length;
  if (others <= 0) return 'Waiting for someone to join…';
  if (others === 1) return 'Connected. 1 other device in this room.';
  return `Connected. ${others} other devices in this room.`;
}
function refreshConnectedStatus() {
  if (conns.size === 0) return;
  setStatus(peerCountLabel(), 'live');
}

$('toggle-password').addEventListener('click', () => {
  const input = $('room-password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('toggle-password').textContent = showing ? 'Show' : 'Hide';
  $('toggle-password').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  $('toggle-password').setAttribute('aria-pressed', String(!showing));
});

// The username+password pair is hashed into a short, stable room id. Any
// number of devices that enter the same username & password land on the
// same room id, so they find each other on the public PeerJS signaling
// broker automatically — no manual codes, no QR codes, no copy/paste of
// connection text. Whichever device gets there first *creates* the room;
// everyone else who later uses that same pair automatically *joins* that
// same room instead of starting a second, separate one — the username &
// password can only ever point at one active room at a time.
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
  setStatus('Generated. Share these two values with anyone who should join, then Connect on every device.');
});
$('copy-creds').addEventListener('click', async () => {
  const username = $('room-username').value, password = $('room-password').value;
  if (!username && !password) return;
  try { await navigator.clipboard.writeText(`${username} / ${password}`); const b = $('copy-creds'); const old = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = old, 1200); }
  catch { setStatus('Clipboard unavailable — copy manually.', 'err'); }
});

function friendlyPeerError(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') return 'Could not reach that room. Make sure the other device also clicked Connect with the exact same username & password.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'disconnected') return 'Could not reach the signaling service. Check your connection and try again.';
  return (err && err.message) || 'Connection error.';
}

// ---------- Connect (symmetric: first device creates the room, everyone after joins it) ----------
$('connect-room').addEventListener('click', async () => {
  try {
    const username = $('room-username').value, password = $('room-password').value;
    validateCreds(username, password);
    $('connect-room').disabled = true;
    setStatus('Checking room…', 'connecting');
    const id = await roomId(username, password);
    createOrJoinRoom(id);
  } catch (e) {
    setStatus(e.message, 'err');
    $('connect-room').disabled = false;
  }
});

function createOrJoinRoom(id) {
  peer?.destroy();
  conns.clear();
  peer = new Peer(id, { config: { iceServers: ICE } });

  peer.on('open', () => {
    role = 'host';
    setStatus('Room created. This username & password are now reserved for your room — waiting for devices to join…', 'connecting');
    showLiveCard();
  });
  peer.on('connection', c => wireConnection(c)); // any number of guests may join
  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      // These credentials are already reserved by an active room — you
      // can't start a second, separate room with the same pair. Join the
      // existing one instead, as a guest, same as everyone else did.
      peer.destroy();
      setStatus('These room details are already in use — joining the existing room instead of creating a new one…', 'connecting');
      joinRoom(id);
      return;
    }
    setStatus(friendlyPeerError(err), 'err');
    $('connect-room').disabled = false;
  });
  peer.on('disconnected', () => { if (conns.size === 0) setStatus('Disconnected from signaling service.', 'err'); });
}

function joinRoom(id) {
  peer = new Peer({ config: { iceServers: ICE } });
  let settled = false;
  const giveUp = setTimeout(() => {
    if (settled || conns.size > 0) return;
    settled = true;
    setStatus('No response from that room. Check the username & password match exactly, then try again.', 'err');
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

function showLiveCard() {
  $('connect-card').classList.add('hidden');
  $('live-card').classList.remove('hidden');
}

function wireConnection(c) {
  conns.set(c.peer, c);
  c.on('open', () => {
    showLiveCard();
    $('live-text').focus();
    refreshConnectedStatus();
    // Bring a newly-joined device up to date with whatever is already
    // in the shared clipboard, so late joiners don't see a blank box.
    if (lastTextValue) c.send({ kind: 'text', value: lastTextValue });
  });
  c.on('data', data => handleData(c, data));
  c.on('close', () => {
    conns.delete(c.peer);
    incoming.delete(c.peer);
    if (conns.size > 0) {
      refreshConnectedStatus();
    } else {
      setStatus(role === 'host' ? 'Everyone has left this room.' : 'Disconnected.', 'err');
      $('connect-room').disabled = false;
      $('live-card').classList.add('hidden');
      $('connect-card').classList.remove('hidden');
    }
  });
  c.on('error', e => setStatus(friendlyPeerError(e), 'err'));
}

$('disconnect-room').addEventListener('click', () => {
  for (const c of conns.values()) c.close();
  conns.clear();
  peer?.destroy();
  peer = null; role = null; lastTextValue = ''; incoming.clear();
  $('connect-room').disabled = false;
  $('live-text').value = '';
  $('received-files').replaceChildren();
  setStatus('Not connected.');
  $('live-card').classList.add('hidden');
  $('connect-card').classList.remove('hidden');
});

// Sends to every connected device except (optionally) one — used both for
// things typed/sent locally (no exception) and for relaying a message a
// host just received from one guest on to everyone else in the room.
function sendToAll(data, exceptPeerId) {
  for (const [id, c] of conns) {
    if (id === exceptPeerId) continue;
    if (c.open) c.send(data);
  }
}

// ---------- Live, two-way clipboard sync ----------
$('live-text').addEventListener('input', () => {
  if (applyingRemoteText) return;
  clearTimeout(textDebounce);
  textDebounce = setTimeout(() => {
    lastTextValue = $('live-text').value;
    sendToAll({ kind: 'text', value: lastTextValue });
  }, 100);
});

function applyRemoteText(value) {
  lastTextValue = value;
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
    if (conns.size === 0) throw new Error('Not connected yet.');
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
  sendToAll({ kind: 'meta', name: file.name, type: file.type || 'application/octet-stream', size: file.size });
  let offset = 0;
  while (offset < file.size) {
    const open = [...conns.values()].filter(c => c.open);
    if (open.length === 0) throw new Error('Everyone disconnected during transfer.');
    const busy = open.some(c => c.dataChannel && c.dataChannel.bufferedAmount > CHUNK * 32);
    if (busy) {
      await new Promise(resolve => setTimeout(resolve, 15));
      continue;
    }
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    sendToAll(chunk);
    offset += chunk.byteLength;
    setProgress('send-progress', file.size ? (offset / file.size) * 100 : 100);
  }
  sendToAll({ kind: 'done' });
  setProgress('send-progress', 100);
  setTimeout(() => setProgress('send-progress', 0), 900);
}

// ---------- Receiving: text + files on the same channel, relayed on if we're the host ----------
function handleData(c, data) {
  const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!isBinary) {
    const message = data;
    if (!message) return;
    if (message.kind === 'text') { applyRemoteText(message.value); }
    else if (message.kind === 'meta') {
      incoming.set(c.peer, { meta: message, parts: [], size: 0 });
      setStatus(`Receiving ${message.name}…`, 'live');
    } else if (message.kind === 'done' && incoming.has(c.peer)) {
      finishIncomingFile(c.peer);
    } else {
      return;
    }
    // A host relays whatever it receives from one participant to everyone
    // else in the room, so the room behaves like one shared space rather
    // than just a pair.
    if (role === 'host') sendToAll(message, c.peer);
    return;
  }
  const entry = incoming.get(c.peer);
  if (!entry) return;
  const buf = data instanceof ArrayBuffer ? data : data.buffer;
  entry.parts.push(buf); entry.size += buf.byteLength;
  const pct = entry.meta.size ? Math.min(100, (entry.size / entry.meta.size) * 100) : 100;
  setStatus(`Receiving ${entry.meta.name}… ${Math.round(pct)}%`, 'live');
  if (role === 'host') sendToAll(buf, c.peer);
}

function finishIncomingFile(fromPeerId) {
  const entry = incoming.get(fromPeerId);
  if (!entry) return;
  const meta = entry.meta;
  const blob = new Blob(entry.parts, { type: meta.type || 'application/octet-stream' });
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
  refreshConnectedStatus();
  incoming.delete(fromPeerId);
}

window.addEventListener('beforeunload', () => { for (const c of conns.values()) c.close(); peer?.destroy(); });
