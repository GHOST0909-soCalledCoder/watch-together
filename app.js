// Firebase config - replace with your own config
const firebaseConfig = {
  apiKey: "",
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

let pc;
let localStream;
let roomRef;
let roomId;
let isCreator = false;

const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

// Button event listeners
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
    console.log("Remote track received", e.streams);
    remoteVideo.srcObject = e.streams[0];
    logStatus("Remote stream available");
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
    logStatus("ICE state: " + pc.iceConnectionState);
  };

  return pc;
}

async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 8);
    alert("No Room ID given, generated: " + roomId);
    document.getElementById("roomIdInput").value = roomId;
  }
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 15 },
      audio: true // capture audio from screen if available
    });
  } catch (err) {
    alert("Screen capture failed or not supported.");
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
      logStatus("Answer received");
    }
  });

  roomRef.child("calleeCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    }
  });

  alert("Room created: " + roomId);
  logStatus("Waiting for participants...");
}

async function joinRoom() {
  isCreator = false;
  roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) {
    alert("Enter a Room ID");
    return;
  }
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Joining room: " + roomId);

  pc = makePeerConnection();

  roomRef.child("callerCandidates").on("child_added", snapshot => {
    const candidate = snapshot.val();
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    }
  });

  const snap = await roomRef.once("value");
  const data = snap.val();

  if (!data || !data.offer) {
    alert("Room does not exist or no offer yet.");
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  logStatus("Connected! Waiting for remote stream...");
}

async function hangUp() {
  logStatus("Hanging up...");
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
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

