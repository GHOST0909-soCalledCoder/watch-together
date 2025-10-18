// --- CONFIGURE FIREBASE HERE ---
// Replace the firebaseConfig object with your Firebase project's config.
// I will explain how to get this config in the steps below.
const firebaseConfig = {
  apiKey: "AIzaSyBVBzK1RuqYKOznJ6hgv_ouoJlm6qUrSqA",
  authDomain: "watch-together-5479f.firebaseapp.com",
  databaseURL: "https://watch-together-5479f-default-rtdb.firebaseio.com",
  projectId: "watch-together-5479f",
  storageBucket: "watch-together-5479f.firebasestorage.app",
  messagingSenderId: "343985532299",
  appId: "1:343985532299:web:9f858ec40f79c38b75538e"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let pc = null;
let localStream = null;      // screen (video + maybe system audio)
let micStream = null;        // microphone audio
let mergedLocalStream = null;
let localTracks = [];
let roomRef = null;
let roomId = null;
let micEnabled = true;

const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const hangupBtn = document.getElementById('hangupBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const roomInput = document.getElementById('roomIdInput');
const remoteVideo = document.getElementById('remoteVideo');
const localPreview = document.getElementById('localPreview');
const statusDiv = document.getElementById('status');

function logStatus(msg) {
  console.log(msg);
  statusDiv.textContent = 'Status: ' + msg;
}

createBtn.onclick = createRoom;
joinBtn.onclick = joinRoom;
hangupBtn.onclick = hangUp;
toggleMicBtn.onclick = toggleMic;

async function createPeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const c = event.candidate.toJSON();
    const candidatesRef = roomRef.child('callerCandidates');
    candidatesRef.push(c);
  };

  pc.ontrack = (event) => {
    // when remote track arrives, set remote video srcObject
    remoteVideo.srcObject = event.streams[0];
  };

  return pc;
}

async function startScreenAndMic() {
  // 1) screen (video + system audio if available)
  logStatus('Requesting screen share... choose the movie window & check "Share audio"');
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (e) {
    console.error('getDisplayMedia failed', e);
    alert('Screen sharing failed. Make sure you allow screen sharing and choose the window. If it still fails, try Chrome/Edge.');
    throw e;
  }

  // 2) microphone
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    console.warn('Microphone not available or denied.', e);
    micStream = null;
  }

  // preview: show screen locally (muted)
  localPreview.srcObject = localStream;

  // We will add tracks separately to the peer connection.
}

async function createRoom() {
  roomId = roomInput.value.trim() || Math.random().toString(36).slice(2,9);
  roomRef = db.ref('rooms/' + roomId);
  logStatus('Creating room: ' + roomId);
  createBtn.disabled = true;

  await startScreenAndMic();
  await createPeerConnection();

  // Add tracks to peer connection:
  // prefer sending screen's audio (system) if present; also add mic track as separate audio so remote hears both your mic and the movie.
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    localTracks.push(track);
  });

  if (micStream) {
    micStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, micStream);
      localTracks.push(track);
    });
  }

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const roomWithOffer = { offer: { type: offer.type, sdp: offer.sdp } };
  await roomRef.set(roomWithOffer);

  // listen for answer
  roomRef.on('value', async snapshot => {
    const val = snapshot.val();
    if (!pc.currentRemoteDescription && val && val.answer) {
      const answer = new RTCSessionDescription(val.answer);
      await pc.setRemoteDescription(answer);
      logStatus('Remote description (answer) applied');
    }
  });

  // listen for callee ICE candidates
  roomRef.child('calleeCandidates').on('child_added', snapshot => {
    const c = snapshot.val();
    pc.addIceCandidate(new RTCIceCandidate(c));
  });

  logStatus('Room created. Give this room id to the other person: ' + roomId);
  alert('Room created: ' + roomId + '\nSend this ID to the other person to join.');
}

async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) { alert('Enter room id to join'); return; }
  roomRef = db.ref('rooms/' + roomId);
  logStatus('Joining room: ' + roomId);
  joinBtn.disabled = true;

  await startScreenAndMic(); // preview local screen too (optional)
  await createPeerConnection();

  // add local tracks (the joiner also may share screen, but in this simple flow both sides add their tracks)
  if (localStream) {
    localStream.getTracks().forEach(track => { pc.addTrack(track, localStream); localTracks.push(track); });
  }
  if (micStream) {
    micStream.getAudioTracks().forEach(track => { pc.addTrack(track, micStream); localTracks.push(track); });
  }

  // read offer
  const snapshot = await roomRef.once('value');
  const roomData = snapshot.val();
  if (!roomData || !roomData.offer) { alert('Room does not contain an offer. Make sure the creator already started the room.'); return; }

  const offer = roomData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // write answer
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  // push ICE candidates to callerCandidates on our side (callee)
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const c = event.candidate.toJSON();
    const candidatesRef = roomRef.child('calleeCandidates');
    candidatesRef.push(c);
  };

  // listen for caller ICE candidates
  roomRef.child('callerCandidates').on('child_added', snapshot => {
    const c = snapshot.val();
    pc.addIceCandidate(new RTCIceCandidate(c));
  });

  logStatus('Joined room and sent answer. You should now see remote stream.');
}

function toggleMic() {
  micEnabled = !micEnabled;
  toggleMicBtn.textContent = micEnabled ? 'Mute Mic' : 'Unmute Mic';
  if (micStream) {
    micStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  } else {
    // if no separate mic stream (maybe screen share included mic), try localTracks
    localTracks.forEach(t => { if (t.kind === 'audio') t.enabled = micEnabled; });
  }
}

async function hangUp() {
  logStatus('Ending call & cleaning up');
  // stop local tracks
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());

  // remove listeners and close pc
  if (roomRef) roomRef.off();
  if (pc) pc.close();
  pc = null;

  // clear UI
  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  createBtn.disabled = false;
  joinBtn.disabled = false;
  logStatus('idle');
}

// optional: cleanup on page close
window.addEventListener('beforeunload', async () => {
  if (roomRef && roomId) {
    // remove room so future joins will fail (optional)
    try { await roomRef.remove(); } catch(e){/*ignore*/ }
  }
  hangUp();
});
