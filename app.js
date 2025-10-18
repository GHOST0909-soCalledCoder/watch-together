// Firebase config (replace with your own)
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_APIKEY",
  authDomain: "YOUR_FIREBASE_AUTHDOMAIN",
  databaseURL: "YOUR_FIREBASE_DATABASEURL",
  projectId: "YOUR_FIREBASE_PROJECTID",
  storageBucket: "YOUR_FIREBASE_STORAGEBUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGINGID",
  appId: "YOUR_FIREBASE_APPID",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ICE servers config (Google STUN)
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// DOM elements
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const hangupBtn = document.getElementById("hangupBtn");
const roomInput = document.getElementById("roomIdInput");
const localPreview = document.getElementById("localPreview");
const remoteVideo = document.getElementById("remoteVideo");
const statusDiv = document.getElementById("status");
const playOverlay = document.getElementById("playOverlay");

// Variables
let pc = null;
let localStream = null;
let remoteStream = null;
let roomRef = null;
let roomId = null;
let isCreator = false;

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

// Create RTCPeerConnection & setup handlers
function createPeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = event => {
    if (event.candidate && roomRef) {
      const candidateCollection = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(candidateCollection).push(event.candidate.toJSON());
    }
  };

  pc.ontrack = event => {
    console.log("Remote track received:", event.streams);

    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
    }

    event.streams[0].getTracks().forEach(track => {
      if (!remoteStream.getTracks().find(t => t.id === track.id)) {
        remoteStream.addTrack(track);
        console.log(`Added remote ${track.kind} track: ${track.id}`);
      }
    });

    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length === 0) {
      logStatus("Waiting for video track...");
      playOverlay.style.display = "flex";
    } else {
      logStatus("Streaming");
      playOverlay.style.display = "none";

      remoteVideo.muted = false;
      remoteVideo.play().catch(() => {
        playOverlay.style.display = "flex";
        logStatus("Tap ▶ to play");
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    logStatus("ICE state: " + pc.iceConnectionState);
  };

  return pc;
}

// PC: Create room & start screen sharing
async function createRoom() {
  isCreator = true;
  roomId = roomInput.value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: false // No audio here, add if needed
    });
  } catch (e) {
    alert("Screen capture failed: " + e.message);
    return;
  }

  localPreview.srcObject = localStream;

  pc = createPeerConnection();

  // Add all tracks from localStream (screen capture)
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    console.log("Added local track:", track.kind, track.id);
  });

  // Create offer and set local description
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Save offer to database
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  // Listen for answer
  roomRef.on("value", async snapshot => {
    const data = snapshot.val();
    if (!pc.currentRemoteDescription && data?.answer) {
      console.log("Answer received");
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received, connected");
    }
  });

  // Listen for ICE candidates from callee
  roomRef.child("calleeCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    }
  });

  alert("Room created: " + roomId + "\nShare this ID with Android viewer");
}

// Android: Join room and receive remote stream
async function joinRoom() {
  isCreator = false;
  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Please enter a room ID");
    return;
  }

  roomRef = db.ref("rooms/" + roomId);
  logStatus("Joining room: " + roomId);

  pc = createPeerConnection();

  // Get offer from database
  const snapshot = await roomRef.once("value");
  const data = snapshot.val();

  if (!data?.offer) {
    alert("No such room or no offer found");
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  // Create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Save answer to database
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  // Listen for ICE candidates from caller
  roomRef.child("callerCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    }
  });

  logStatus("Connected. Waiting for video...");
}

// Hangup and cleanup
async function hangUp() {
  logStatus("Hanging up...");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();

  if (roomRef && isCreator) {
    await roomRef.remove();
  }

  pc = null;
  roomRef = null;
  roomId = null;
  localStream = null;
  remoteStream = null;

  localPreview.srcObject = null;
  remoteVideo.srcObject = null;
  playOverlay.style.display = "none";
  logStatus("Idle");
}

// Play overlay tap to enable autoplay
playOverlay.addEventListener("click", () => {
  remoteVideo.play().then(() => {
    playOverlay.style.display = "none";
    logStatus("Streaming");
  }).catch(() => {
    logStatus("Tap ▶ to play");
  });
});

createBtn.onclick = createRoom;
joinBtn.onclick = joinRoom;
hangupBtn.onclick = hangUp;

