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

let pc, localStream, roomRef, roomId, isCreator = false;

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

function makePeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const candidateCollection = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(candidateCollection).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
    logStatus("✅ Remote stream received!");
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
  };

  return pc;
}

async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  // Try to capture screen
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 15 },
      audio: true
    });
  } catch (err) {
    alert("⚠️ Screen capture failed. Instead, select a video file to share.");
    return;
  }

  localPreview.srcObject = localStream;

  pc = makePeerConnection();
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.on("value", async snapshot => {
    const data = snapshot.val();
    if (!pc.currentRemoteDescription && data && data.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      logStatus("Answer received, connected!");
    }
  });

  roomRef.child("calleeCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  });

  alert("Room created: " + roomId);
}

async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter Room ID!");

  roomRef = db.ref("rooms/" + roomId);
  pc = makePeerConnection();

  roomRef.child("callerCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  });

  const snap = await roomRef.once("value");
  const data = snap.val();
  if (!data || !data.offer) return alert("Room not found!");

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  logStatus("Joined room successfully, waiting for remote stream...");
}

async function hangUp() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  logStatus("Disconnected.");
  if (isCreator && roomRef) await roomRef.remove();
}

