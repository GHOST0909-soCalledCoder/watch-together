// --- Firebase ---
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com", // <-- Replace with your Firebase Realtime DB URL
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- Variables ---
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let pc, localStream, micStream, roomRef, roomId;
let isCreator = false;

const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

// --- Button Events ---
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;
document.getElementById("toggleMicBtn").onclick = toggleMic;

// --- Peer Connection ---
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
    logStatus("Streaming");

    // Don't autoplay to avoid mobile autoplay issues; let user manually play
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE State:", pc.iceConnectionState);
    logStatus("ICE state: " + pc.iceConnectionState);
  };

  return pc;
}

// --- Create Room ---
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 640, height: 360, frameRate: 10 },
      audio: true
    });
  } catch (err) {
    alert("Screen share failed. Try Chrome on desktop.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    micStream = null;
  }

  localPreview.srcObject = localStream;

  makePeerConnection();

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  if (micStream) micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.on("value", async snap => {
    const data = snap.val();
    if (data?.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received");
    }
  });

  roomRef.child("calleeCandidates").on("child_added", s => {
    const c = s.val();
    if (c) pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
  });

  alert("Room created: " + roomId);
  logStatus("Room ready — share ID: " + roomId);
}

// --- Join Room ---
async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter a room ID");
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Joining room: " + roomId);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localPreview.srcObject = micStream;
  } catch {
    micStream = null;
  }

  makePeerConnection();

  if (micStream) micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  const snap = await roomRef.once("value");
  const data = snap.val();
  if (!data?.offer) {
    alert("No stream yet. Wait for the presenter.");
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

  logStatus("Connected. Waiting for video...");
}

// --- Mic & Hangup ---
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

