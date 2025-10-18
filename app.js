// --- Firebase Config ---
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
let pc, localStream, micStream, roomRef, roomId;
let isCreator = false;
const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const playFallbackBtn = document.getElementById("playFallbackBtn");

function logStatus(msg) {
  console.log(msg);
  statusDiv.textContent = "Status: " + msg;
}

// --- Button Events ---
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;
document.getElementById("toggleMicBtn").onclick = toggleMic;
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
};

playFallbackBtn.onclick = () => {
  remoteVideo.play().then(() => {
    playFallbackBtn.style.display = "none";
  }).catch(err => {
    console.warn("Manual play failed", err);
  });
};

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
    console.log("✅ Remote track received:", e.streams);
    const stream = e.streams[0];
    remoteVideo.srcObject = stream;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      console.log("VideoTrack settings:", videoTrack.getSettings());
    } else {
      console.warn("⚠️ No video track present in remote stream!");
    }

    // Mute the video to allow autoplay on mobile
    remoteVideo.muted = true;

    remoteVideo.play().then(() => {
      console.log("✅ Remote video playing automatically");
      playFallbackBtn.style.display = "none";
    }).catch(err => {
      console.warn("❌ Autoplay failed:", err);
      logStatus("Tap to play video");
      playFallbackBtn.style.display = "inline-block";
    });
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE State:", pc.iceConnectionState);
  };

  return pc;
}

// --- Create Room (Presenter) ---
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 15 },
      audio: true
    });
  } catch (err) {
    alert("Screen sharing failed. Use Chrome/Edge on desktop.");
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
  if (micStream) micStream.getTracks().for
