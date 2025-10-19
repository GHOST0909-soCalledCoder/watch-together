// 🔥 Firebase Config (keep yours if already set)
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

// ⚙️ Setup
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let pc, localStream, micStream, finalStream, roomRef, roomId, isCreator = false;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusEl = document.getElementById("status");

// 🪄 Helpers
function log(msg) {
  console.log(msg);
  statusEl.textContent = "Status: " + msg;
}

// Fullscreen Button
document.getElementById("fullscreenBtn").onclick = async () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else await remoteVideo.requestFullscreen().catch(() => {});
};

// Buttons
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;

// 🔗 Peer connection setup
function makeConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate) {
      const path = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(path).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    log("🎥 Remote stream added");
    remoteVideo.srcObject = e.streams[0];
  };

  return pc;
}

// 🎬 Create room (creator shares screen + mic)
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);

  log("Creating room " + roomId);

  try {
    // Screen share with audio
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

    // Mic audio (for talking)
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Merge both audio sources
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    if (screenStream.getAudioTracks().length > 0) {
      const screenAudio = audioContext.createMediaStreamSource(screenStream);
      screenAudio.connect(destination);
    }
    if (micStream.getAudioTracks().length > 0) {
      const micAudio = audioContext.createMediaStreamSource(micStream);
      micAudio.connect(destination);
    }

    // Combine video + merged audio
    finalStream = new MediaStream([
      ...screenStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);

    localVideo.srcObject = finalStream;
  } catch (err) {
    alert("Error: " + err.message);
    return;
  }

  pc = makeConnection();

  finalStream.getTracks().forEach(t => pc.addTrack(t, finalStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.child("calleeCandidates").on("child_added", s => {
    pc.addIceCandidate(new RTCIceCandidate(s.val()));
  });

  roomRef.on("value", async snap => {
    const data = snap.val();
    if (data && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      log("Connected!");
    }
  });

  alert("Room created: " + roomId);
  log("Waiting for partner...");
}

// 🎧 Join room (viewer + mic for voice chat)
async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter a room ID first!");

  roomRef = db.ref("rooms/" + roomId);
  const snapshot = await roomRef.once("value");
  const data = snapshot.val();
  if (!data || !data.offer) return alert("Room not found!");

  pc = makeConnection();

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  // Add mic for voice chat
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach(track => pc.addTrack(track, micStream));
  } catch (err) {
    console.warn("Mic permission denied: ", err);
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  roomRef.child("callerCandidates").on("child_added", s => {
    pc.addIceCandidate(new RTCIceCandidate(s.val()));
  });

  log("Joined room " + roomId);
}

// 🚫 Hang up
async function hangUp() {
  log("Hanging up...");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (finalStream) finalStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  if (isCreator && roomRef) await roomRef.remove();
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  log("Idle");
}

