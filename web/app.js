const $ = id => document.getElementById(id);
const CHUNK = 16 * 1024;
let senderPC = null, receiverPC = null, senderChannel = null, outgoing = null;
let incomingMeta = null, incomingParts = [], incomingSize = 0, receivedBlob = null;

function status(id, message) { $(id).textContent = message; }
function setProgress(id, value) { $(id).style.width = `${Math.max(0, Math.min(100, value))}%`; }
function waitIce(pc, timeoutMs = 18000) {
  // ICE gathering can take longer than expected on mobile or restrictive networks.
  // Never block creation of the answer indefinitely: return the latest SDP on timeout.
  if (pc.iceGatheringState === 'complete') return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = complete => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve(complete);
    };
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish(true); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
    onChange();
  });
}
function encodeDescription(desc) { return JSON.stringify({ type: desc.type, sdp: desc.sdp }); }
function decodeDescription(value) {
  const obj = JSON.parse(value);
  if (!obj || !['offer','answer'].includes(obj.type) || typeof obj.sdp !== 'string') throw new Error('That connection code is invalid.');
  return obj;
}
async function copy(id, buttonId) {
  const value = $(id).value;
  if (!value) return;
  try { await navigator.clipboard.writeText(value); const b=$(buttonId), old=b.textContent; b.textContent='Copied ✓'; setTimeout(()=>b.textContent=old,1300); }
  catch { status('sender-status','Clipboard unavailable. Select and copy the code manually.'); }
}
function makePeer() {
  // Public STUN helps peers discover direct routes. No TURN relay is configured.
  return new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
}
function waitForChannelOpen(channel) {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Connection timed out. Check both codes and network restrictions.')),30000);
    channel.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    channel.addEventListener('close',()=>{clearTimeout(timeout);reject(new Error('Connection closed before transfer.'));},{once:true});
  });
}

$('create-offer').addEventListener('click', async () => {
  try {
    const file=$('send-file').files[0], text=$('send-text').value;
    if (!file && !text) throw new Error('Enter text or choose a file first.');
    if (file && file.size > 500*1024*1024) throw new Error('For reliability, this demo limits files to 500 MB.');
    outgoing = file ? {name:file.name,type:file.type || 'application/octet-stream',size:file.size,file} : {name:'pasted-text.txt',type:'text/plain;charset=utf-8',size:new Blob([text]).size,blob:new Blob([text],{type:'text/plain;charset=utf-8'})};
    $('create-offer').disabled=true; status('sender-status','Creating direct connection offer…');
    senderPC?.close(); senderPC=makePeer(); senderChannel=senderPC.createDataChannel('paste-anywhere',{ordered:true});
    senderChannel.binaryType='arraybuffer';
    senderChannel.bufferedAmountLowThreshold=CHUNK*8;
    senderPC.onconnectionstatechange=()=>status('sender-status',`Connection: ${senderPC.connectionState}`);
    const offer=await senderPC.createOffer(); await senderPC.setLocalDescription(offer); const gathered = await waitIce(senderPC);
    $('offer-out').value=encodeDescription(senderPC.localDescription); $('copy-offer').disabled=false; $('show-offer-qr').disabled=false; $('connect-sender').disabled=false;
    status('sender-status', gathered ? 'Offer ready. Share it with the receiver.' : 'Offer ready with available ICE candidates. If connection fails, retry on another network or use a TURN-enabled peer.');
  } catch(e) { status('sender-status',e.message); }
  finally { $('create-offer').disabled=false; }
});
$('copy-offer').addEventListener('click',()=>copy('offer-out','copy-offer'));
$('copy-answer').addEventListener('click',()=>copy('answer-out','copy-answer'));

$('create-answer').addEventListener('click', async () => {
  try {
    $('create-answer').disabled=true; status('receiver-status','Preparing answer…');
    receiverPC?.close(); receiverPC=makePeer();
    receiverPC.ondatachannel=event=>{
      const channel=event.channel; channel.binaryType='arraybuffer';
      channel.onmessage=handleIncoming;
      channel.onopen=()=>status('receiver-status','Connected. Waiting for incoming data…');
      channel.onclose=()=>status('receiver-status','Transfer connection closed.');
    };
    receiverPC.onconnectionstatechange=()=>status('receiver-status',`Connection: ${receiverPC.connectionState}`);
    await receiverPC.setRemoteDescription(decodeDescription($('offer-in').value.trim()));
    const answer=await receiverPC.createAnswer(); await receiverPC.setLocalDescription(answer); const gathered = await waitIce(receiverPC);
    $('answer-out').value=encodeDescription(receiverPC.localDescription); $('copy-answer').disabled=false; $('show-answer-qr').disabled=false;
    status('receiver-status', gathered ? 'Answer ready. Share it with the sender.' : 'Answer generated with available ICE candidates. Share it now; if connection fails, retry on another network.');
  } catch(e) { status('receiver-status',e.message); }
  finally { $('create-answer').disabled=false; }
});

$('connect-sender').addEventListener('click', async () => {
  try {
    $('connect-sender').disabled=true;
    if (!senderPC || !senderChannel || !outgoing) throw new Error('Create an offer first.');
    await senderPC.setRemoteDescription(decodeDescription($('answer-in').value.trim()));
    status('sender-status','Connecting directly…'); await waitForChannelOpen(senderChannel);
    status('sender-status','Connected. Sending…');
    const blob=outgoing.file || outgoing.blob;
    senderChannel.send(JSON.stringify({kind:'meta',name:outgoing.name,type:outgoing.type,size:outgoing.size}));
    let offset=0;
    while(offset<blob.size) {
      if(senderChannel.readyState!=='open') throw new Error('Peer disconnected during transfer.');
      if(senderChannel.bufferedAmount > CHUNK*32) await new Promise(resolve=>{
        senderChannel.addEventListener('bufferedamountlow',resolve,{once:true});
      });
      const chunk=await blob.slice(offset,offset+CHUNK).arrayBuffer(); senderChannel.send(chunk); offset+=chunk.byteLength;
      setProgress('send-progress',blob.size ? offset/blob.size*100 : 100);
    }
    senderChannel.send(JSON.stringify({kind:'done'})); status('sender-status','Transfer complete. The data went directly to the other browser.');
  } catch(e) { status('sender-status',e.message); $('connect-sender').disabled=false; }
});

function handleIncoming(event) {
  if (typeof event.data === 'string') {
    let message; try { message=JSON.parse(event.data); } catch { return; }
    if(message.kind==='meta') { incomingMeta=message; incomingParts=[]; incomingSize=0; $('received').classList.add('hidden'); status('receiver-status',`Receiving ${message.name}…`); }
    if(message.kind==='done' && incomingMeta) finishIncoming();
    return;
  }
  if (!incomingMeta) return;
  incomingParts.push(event.data); incomingSize+=event.data.byteLength;
  const pct=incomingMeta.size ? Math.min(100,incomingSize/incomingMeta.size*100) : 100;
  status('receiver-status',`Receiving… ${Math.round(pct)}%`);
}
function finishIncoming() {
  receivedBlob=new Blob(incomingParts,{type:incomingMeta.type || 'application/octet-stream'});
  $('received-name').textContent=`${incomingMeta.name} · ${(receivedBlob.size/1024).toFixed(1)} KB`;
  const url=URL.createObjectURL(receivedBlob); $('download').href=url; $('download').download=incomingMeta.name;
  const preview=$('received-preview'); preview.replaceChildren();
  if((incomingMeta.type||'').startsWith('text/')) {
    const pre=document.createElement('pre'); pre.textContent='Loading preview…'; preview.append(pre);
    receivedBlob.text().then(t=>pre.textContent=t);
  } else if((incomingMeta.type||'').startsWith('image/')) {
    const img=document.createElement('img'); img.alt=incomingMeta.name; img.src=url; preview.append(img);
  } else if((incomingMeta.type||'').startsWith('audio/')) {
    const audio=document.createElement('audio'); audio.controls=true; audio.src=url; preview.append(audio);
  } else { const p=document.createElement('p'); p.textContent='File received. Use Download to save it.'; preview.append(p); }
  $('copy-received').classList.toggle('hidden',!(incomingMeta.type||'').startsWith('text/'));
  $('received').classList.remove('hidden'); status('receiver-status','Transfer complete.'); incomingMeta=null; incomingParts=[];
}


// QR signaling: either side can display its code or scan the other peer's code.
let qrScannerStream = null, qrScannerTimer = null;
function showQr(value, title) {
  if (!value) throw new Error('There is no connection code to show yet.');
  $('qr-title').textContent = title;
  $('qr-code').replaceChildren();
  if (typeof QRCode === 'undefined') throw new Error('QR generator did not load. Check your internet connection or use Copy.');
  new QRCode($('qr-code'), { text: value, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.L });
  $('qr-modal').classList.remove('hidden');
}
function closeQr() { $('qr-modal').classList.add('hidden'); }
function stopScanner() {
  if (qrScannerTimer) clearInterval(qrScannerTimer);
  qrScannerTimer = null;
  if (qrScannerStream) qrScannerStream.getTracks().forEach(track => track.stop());
  qrScannerStream = null;
  $('qr-video').srcObject = null;
  $('scanner').classList.add('hidden');
}
async function startScanner(targetId, statusId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    status(statusId, 'Camera scanning requires HTTPS and camera permission. You can paste the code instead.');
    return;
  }
  try {
    stopScanner();
    $('scanner-title').textContent = targetId === 'offer-in' ? 'Scan sender offer' : 'Scan receiver answer';
    $('scanner').classList.remove('hidden');
    qrScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = $('qr-video'); video.srcObject = qrScannerStream; await video.play();
    const canvas = $('qr-canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (typeof jsQR === 'undefined') throw new Error('QR scanner did not load. Check your internet connection or paste the code.');
    qrScannerTimer = setInterval(() => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
      if (result?.data) {
        try {
          decodeDescription(result.data);
          $(targetId).value = result.data;
          stopScanner();
          status(statusId, 'QR scanned. Continue to create the answer or connect.');
        } catch { status(statusId, 'QR detected, but it is not a valid Paste Anywhere connection code.'); }
      }
    }, 180);
  } catch (e) {
    stopScanner();
    status(statusId, e.message || 'Unable to access camera. Paste the code manually.');
  }
}
$('show-offer-qr').addEventListener('click', () => { try { showQr($('offer-out').value, 'Scan this offer on the receiving device'); } catch(e) { status('sender-status', e.message); } });
$('show-answer-qr').addEventListener('click', () => { try { showQr($('answer-out').value, 'Scan this answer on the sending device'); } catch(e) { status('receiver-status', e.message); } });
$('scan-offer-qr').addEventListener('click', () => startScanner('offer-in', 'receiver-status'));
$('scan-answer-qr').addEventListener('click', () => startScanner('answer-in', 'sender-status'));
$('close-qr').addEventListener('click', closeQr);
$('close-scanner').addEventListener('click', stopScanner);
$('qr-modal').addEventListener('click', e => { if (e.target === $('qr-modal')) closeQr(); });

$('copy-received').addEventListener('click',async()=>{if(receivedBlob)try{await navigator.clipboard.writeText(await receivedBlob.text());$('copy-received').textContent='Copied ✓';}catch{status('receiver-status','Clipboard access was blocked.');}});
window.addEventListener('beforeunload',()=>{stopScanner();senderPC?.close();receiverPC?.close();});
