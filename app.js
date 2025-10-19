// Firebase config
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

const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let pc, localStream, micStream, mixedStream, roomRef, roomId, isCreator = false;

const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;

// Fullscreen toggle
document.getElementById("fullscreenBtn").onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
};

function makePeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const collection = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(collection).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    console.log("Remote stream received", e.streams);
    remoteVideo.srcObject = e.streams[0];
    logStatus("✅ Remote stream connected!");
  };

  return pc;
}

async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  try {
    // 1️⃣ Screen or window share
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 15 },
      audio: true
    });

    // 2️⃣ Microphone stream
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 3️⃣ Merge both into one stream (video + mic audio)
    mixedStream = new MediaStream([
      ...screenStream.getVideoTracks(),
      ...micStream.getAudioTracks()
    ]);

    localStream = mixedStream;
    localPreview.srcObject = localStream;
  } catch (err) {
    alert("Screen or mic permission denied.");
    return;
  }

  pc = makePeerConnection();
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.on("value", async snap => {
    const data = snap.val();
    if (!pc.currentRemoteDescription && data && data.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received, connected!");
    }
  });

  roomRef.child("calleeCandidates").on("child_added", s => {
    const cand = s.val();
    if (cand) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
  });

  alert("Room created: " + roomId);
  logStatus("Waiting for partner to join...");
}

async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter Room ID!");

  roomRef = db.ref("rooms/" + roomId);
  pc = makePeerConnection();

  roomRef.child("callerCandidates").on("child_added", s => {
    const cand = s.val();
    if (cand) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
  });

  const snap = await roomRef.once("value");
  const data = snap.val();
  if (!data || !data.offer) return alert("Room not found!");

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  // 🎙️ Joiner adds their mic (so both can talk)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach(track => pc.addTrack(track, micStream));
  } catch (e) {
    console.warn("Mic permission denied on joiner.");
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  logStatus("Joined room. Waiting for remote stream...");
}

async function hangUp() {
  logStatus("Hanging up...");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();

  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  if (isCreator && roomRef) await roomRef.remove();

  logStatus("Idle");
}

