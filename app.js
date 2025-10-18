// --- Firebase config ---
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

// --- Variables ---
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let pc = null;
let localStream = null;
let micStream = null;
let roomRef = null;
let roomId = null;
let isCreator = false;

const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

// --- Button events ---
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;
document.getElementById("toggleMicBtn").onclick = toggleMic;

// --- Make PeerConnection ---
function makePeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const path = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(path).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    console.log("🎥 Remote track received:", e.streams);
    const stream = e.streams[0];
    remoteVideo.srcObject = stream;
    logStatus("Streaming remote");
    // Controls enabled, so user can manually play on Android or PC
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE State:", pc.iceConnectionState);
    logStatus("ICE state: " + pc.iceConnectionState);
  };

  return pc;
}

// --- Create Room (sender) ---
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 15 },
      audio: true
    });
  } catch (err) {
    alert("Screen share failed. Use Chrome on desktop.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    micStream = null;
  }

  // Show local preview (muted)
  localPreview.srcObject = localStream;

  makePeerConnection();

  // Add all tracks from screen stream
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Also add mic audio track if available
  if (micStream) micStream.getTracks().forEach(track => pc.addTrack(track, micStream));

  // Create offer and set local description
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Save offer in Firebase DB
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  // Listen for answer from callee
  roomRef.on("value", async snapshot => {
    const data = snapshot.val();
    if (!pc.currentRemoteDescription && data?.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received");
    }
  });

  // Listen for callee ICE candidates
  roomRef.child("calleeCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    }
  });

  alert("Room created. Share this ID: " + roomId);
  logStatus("Room ready — waiting for participants...");
}

// --- Join Room (receiver) ---
async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) {
    alert("Please enter a room ID");
    return;
  }
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Joining room: " + roomId);

  // Get mic audio only for local preview on receiver side
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localPreview.srcObject = micStream; // show your mic audio input as preview (optional)
  } catch {
    micStream = null;
  }

  makePeerConnection();

  if (micStream) micStream.getTracks().forEach(track => pc.addTrack(track, micStream));

  // Get offer from DB
  const snap = await roomRef.once("value");
  const data = snap.val();

  if (!data?.offer) {
    alert("No active stream found for this room.");
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Save answer in DB
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  // Listen for caller ICE candidates
  roomRef.child("callerCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    }
  });

  logStatus("Connected. Waiting for remote stream...");
}

// --- Toggle mic mute/unmute ---
function toggleMic() {
  if (!micStream) return;
  const track = micStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById("toggleMicBtn").textContent = track.enabled ? "Mute Mic" : "Unmute Mic";
}

// --- Hang up ---
async function hangUp() {
  logStatus("Hanging up...");

  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());

  if (pc) {
    pc.close();
    pc = null;
  }

  if (roomRef && isCreator) {
    await roomRef.remove();
  }

  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  logStatus("Idle");
}

