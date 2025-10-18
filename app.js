// --- FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyBVBzK1RuqYKOznJ6hgv_ouoJlm6qUrSqA",
  authDomain: "watch-together-5479f.firebaseapp.com",
  databaseURL: "https://watch-together-5479f-default-rtdb.firebaseio.com",
  projectId: "watch-together-5479f",
  storageBucket: "watch-together-5479f.appspot.com",
  messagingSenderId: "343985532299",
  appId: "1:343985532299:web:9f858ec40f79c38b75538e"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- VARIABLES ---
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let pc, localStream, micStream, roomRef, roomId;
let isCreator = false;
const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");

function logStatus(msg) {
  console.log(msg);
  statusDiv.textContent = "Status: " + msg;
}

// --- BUTTONS ---
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;
document.getElementById("toggleMicBtn").onclick = toggleMic;
document.getElementById("fullscreenBtn").onclick = () => {
  if (remoteVideo.requestFullscreen) {
    remoteVideo.requestFullscreen();
  } else if (remoteVideo.webkitRequestFullscreen) {
    remoteVideo.webkitRequestFullscreen();
  } else if (remoteVideo.msRequestFullscreen) {
    remoteVideo.msRequestFullscreen();
  }
};

// --- PEER CONNECTION ---
function makePeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const path = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(path).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    console.log("Remote track received");
    remoteVideo.srcObject = e.streams[0];

    remoteVideo.onloadedmetadata = () => {
      remoteVideo.play().then(() => {
        console.log("Remote video playing");
      }).catch(err => {
        console.warn("Autoplay failed, tap to play", err);
        logStatus("Tap video to play manually.");
      });
    };
  };

  return pc;
}

// --- CREATOR FLOW ---
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    alert("Screen share failed. Use Chrome/Edge on desktop.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    micStream = null;
  }

  localPreview.srcObject = localStream;
  localPreview.muted = true;

  makePeerConnection();

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  if (micStream) micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.on("value", async snap => {
    const data = snap.val();
    if (data && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received and applied");
    }
  });

  roomRef.child("calleeCandidates").on("child_added", s => {
    const c = s.val();
    if (c) pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
  });

  alert("Room created: " + roomId + "\nShare this ID with the other person.");
  logStatus("Room ready — share ID: " + roomId);
}

// --- JOINER FLOW ---
async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter a room ID first");
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Joining room " + roomId);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localPreview.srcObject = micStream;
    localPreview.muted = true;
  } catch {
    micStream = null;
  }

  makePeerConnection();
  if (micStream) micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  const snap = await roomRef.once("value");
  const data = snap.val();
  if (!data || !data.offer) {
    alert("No offer found. Wait until creator starts the stream.");
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  roomRef.child("callerCandidates").on("child_added", s => {
    const c = s.val();
    if (c) pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
  });

  logStatus("Joined room. Waiting for video...");
}

// --- MIC & CLEANUP ---
function toggleMic() {
  if (!micStream) return;
  const track = micStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById("toggleMicBtn").textContent = track.enabled ? "Mute Mic" : "Unmute Mic";
}

async function hangUp() {
  logStatus("Hanging up...");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  if (roomRef && isCreator) await roomRef.remove();

  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  logStatus("Idle");
}

// --- Extra: Mobile tap to play ---
remoteVideo.addEventListener("click", () => {
  remoteVideo.play().catch(() => {
    logStatus("Tap again to play video.");
  });
});
