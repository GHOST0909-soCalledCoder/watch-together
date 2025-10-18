// --- CONFIGURE FIREBASE HERE ---
const firebaseConfig = {
  apiKey: "AIzaSyBVBzK1RuqYKOznJ6hgv_ouoJlm6qUrSqA",
  authDomain: "watch-together-5479f.firebaseapp.com",
  databaseURL: "https://watch-together-5479f-default-rtdb.firebaseio.com",
  projectId: "watch-together-5479f",
  storageBucket: "watch-together-5479f.appspot.com",
  messagingSenderId: "343985532299",
  appId: "1:343985532299:web:9f858ec40f79c38b75538e"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let pc = null;
let localStream = null;   // screen stream (used by creator)
let micStream = null;     // microphone stream (used by either)
let localTracks = [];
let roomRef = null;
let roomId = null;
let micEnabled = true;
let isCreator = false;

const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const hangupBtn = document.getElementById('hangupBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const roomInput = document.getElementById('roomIdInput');
const remoteVideo = document.getElementById('remoteVideo');
const localPreview = document.getElementById('localPreview');
const statusDiv = document.getElementById('status');
const playOverlay = document.getElementById('playOverlay');

function logStatus(msg) {
  console.log(msg);
  if (statusDiv) statusDiv.textContent = 'Status: ' + msg;
}

createBtn.onclick = createRoom;
joinBtn.onclick = joinRoom;
hangupBtn.onclick = hangUp;
toggleMicBtn.onclick = toggleMic;
playOverlay.onclick = () => {
  // user tapped overlay -> try to play remote video
  tryPlayRemote().then(ok => {
    if (ok) hideOverlay();
  });
};

async function createPeerConnection(roleIsCreator = false) {
  pc = new RTCPeerConnection(servers);

  // ICE candidate handler - push to appropriate DB path depending on role
  pc.onicecandidate = (event) => {
    if (!event.candidate || !roomRef) return;
    const candidate = event.candidate.toJSON();
    const path = roleIsCreator ? 'callerCandidates' : 'calleeCandidates';
    roomRef.child(path).push(candidate);
  };

  pc.ontrack = (event) => {
    console.log('ontrack event', event);
    // set the remote stream (use provided streams[0] when available)
    try {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      } else {
        // fallback: build a stream from track(s)
        const ms = new MediaStream();
        ms.addTrack(event.track);
        remoteVideo.srcObject = ms;
      }
      // try to play right away
      tryPlayRemote().then(ok => {
        if (!ok) showOverlay();
      });
    } catch (e) {
      console.warn('ontrack error', e);
      showOverlay();
    }
  };

  return pc;
}

async function tryPlayRemote() {
  if (!remoteVideo || !remoteVideo.srcObject) return false;
  // attempt to play; returns true if play succeeded
  try {
    // Some browsers require muted play to auto-start; but we want audio.
    // We'll try unmuted play first (since user likely interacted by granting mic).
    await remoteVideo.play();
    return !remoteVideo.paused;
  } catch (err) {
    console.warn('remoteVideo.play() failed:', err);
    // as fallback, try muted autoplay to check video frames (then unmute on user gesture)
    try {
      remoteVideo.muted = true;
      await remoteVideo.play();
      // leave overlay visible to prompt user to unmute and enable sound
      return true;
    } catch (err2) {
      console.warn('muted play failed too', err2);
      remoteVideo.muted = false;
      return false;
    }
  }
}

function showOverlay() {
  if (playOverlay) playOverlay.style.display = 'block';
}
function hideOverlay() {
  if (playOverlay) playOverlay.style.display = 'none';
}

async function startScreenAndMic() {
  logStatus('Requesting screen share... choose the movie window & check "Share audio"');
  // getDisplayMedia may fail on mobile or insecure origins
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    // quick sanity: ensure a video track exists
    if (!localStream.getVideoTracks().length) {
      alert('No video track found in the shared screen. Choose a window that has video content.');
      throw new Error('no video track');
    }
  } catch (e) {
    console.error('getDisplayMedia failed', e);
    alert('Screen sharing failed. Make sure you allow screen sharing and choose the window. If it still fails, try Chrome/Edge on desktop.');
    throw e;
  }

  // microphone (optional)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    console.warn('Microphone not available or denied.', e);
    micStream = null;
  }

  // preview the screen locally (muted so it doesn't echo)
  localPreview.srcObject = localStream;
  localPreview.muted = true;
}

async function createRoom() {
  isCreator = true;
  roomId = roomInput.value.trim() || Math.random().toString(36).slice(2,9);
  roomRef = db.ref('rooms/' + roomId);
  logStatus('Creating room: ' + roomId);
  createBtn.disabled = true;

  try {
    await startScreenAndMic();
  } catch (e) {
    createBtn.disabled = false;
    return;
  }

  await createPeerConnection(true);

  // Add local tracks (screen + optional mic)
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      localTracks.push(track);
    });
  }
  if (micStream) {
    micStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, micStream);
      localTracks.push(track);
    });
  }

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // save offer to DB
  const roomWithOffer = { offer: { type: offer.type, sdp: offer.sdp } };
  await roomRef.set(roomWithOffer);

  // listen for answer (only once)
  roomRef.on('value', async snapshot => {
    const val = snapshot.val();
    if (!pc) return;
    if (!pc.currentRemoteDescription && val && val.answer) {
      const answer = new RTCSessionDescription(val.answer);
      await pc.setRemoteDescription(answer);
      logStatus('Remote description (answer) applied');
    }
  });

  // listen for callee ICE candidates
  roomRef.child('calleeCandidates').on('child_added', snapshot => {
    const c = snapshot.val();
    if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('addIceCandidate error', e));
  });

  logStatus('Room created. Share this room id: ' + roomId);
  alert('Room created: ' + roomId + '\nSend this ID to the other person to join.');
}

async function joinRoom() {
  isCreator = false;
  roomId = roomInput.value.trim();
  if (!roomId) { alert('Enter room id to join'); return; }
  roomRef = db.ref('rooms/' + roomId);
  logStatus('Joining room: ' + roomId);
  joinBtn.disabled = true;

  // Only request mic for joiner (no screen capture)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // optional tiny preview (muted) so joiner sees they gave mic permission
    localPreview.srcObject = micStream;
    localPreview.muted = true;
  } catch (e) {
    console.warn('Microphone access failed or denied.', e);
    micStream = null;
  }

  await createPeerConnection(false);

  if (micStream) {
    micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));
  }

  // Read offer
  const snapshot = await roomRef.once('value');
  const roomData = snapshot.val();
  if (!roomData || !roomData.offer) {
    alert('Room does not contain an offer. Make sure the creator already started the room.');
    joinBtn.disabled = false;
    return;
  }

  const offer = roomData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // write answer
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  // Listen for caller ICE candidates
  roomRef.child('callerCandidates').on('child_added', snapshot => {
    const c = snapshot.val();
    if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('addIceCandidate error', e));
  });

  logStatus('Joined room and sent answer. Waiting for remote stream...');
  // hide overlay initially; it will show if autoplay fails
  hideOverlay();
}

// mute / unmute mic
function toggleMic() {
  micEnabled = !micEnabled;
  toggleMicBtn.textContent = micEnabled ? 'Mute Mic' : 'Unmute Mic';
  if (micStream) {
    micStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  } else {
    localTracks.forEach(t => { if (t.kind === 'audio') t.enabled = micEnabled; });
  }
}

async function hangUp() {
  logStatus('Ending call & cleaning up');

  // Stop local tracks
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());

  // Remove DB listeners
  try { if (roomRef) roomRef.off(); } catch(e){/*ignore*/}

  // If you are the creator, optionally remove the room entry
  try {
    if (isCreator && roomRef) {
      await roomRef.remove();
    }
  } catch(e) { console.warn('failed to remove room', e); }

  // Close peer connection
  if (pc) pc.close();
  pc = null;

  // Clear UI
  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  createBtn.disabled = false;
  joinBtn.disabled = false;
  hideOverlay();
  logStatus('idle');
}

// optional: cleanup on page close
window.addEventListener('beforeunload', async () => {
  try {
    if (roomRef && isCreator) await roomRef.remove();
  } catch(e){/*ignore*/}
  hangUp();
});
