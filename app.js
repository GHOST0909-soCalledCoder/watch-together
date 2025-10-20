// Firebase config (keep your own)
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

const servers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};
let pc, roomRef, isCreator = false;
let screenStream, micStream, mixedStream;
const remoteVideo = document.getElementById("remoteVideo");
const localVideo = document.getElementById("localVideo");
const statusEl = document.getElementById("status");

// --------------------
// Helper
function log(msg) {
  console.log(msg);
  statusEl.textContent = "Status: " + msg;
}

// --------------------
// Fullscreen
document.getElementById("fullscreenBtn").onclick = async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await remoteVideo.requestFullscreen();
    }
  } catch (err) {
    console.warn("Fullscreen error:", err);
  }
};

// --------------------
// Buttons
document.getElementById("createBtn").onclick = createRoom;
document.getElementById("joinBtn").onclick = joinRoom;
document.getElementById("hangupBtn").onclick = hangUp;

// --------------------
// PeerConnection setup
function makeConnection() {
  const pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const path = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(path).push(e.candidate.toJSON());
    }
  };

  pc.ontrack = e => {
    log("🎬 Remote stream received");
    remoteVideo.srcObject = e.streams[0];
  };

  // 💎 Improve video quality aggressively
  pc.onnegotiationneeded = async () => {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === "video") {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];

        params.encodings[0].maxBitrate = 8_000_000;  // 8 Mbps
        params.encodings[0].minBitrate = 3_000_000;  // 3 Mbps
        params.encodings[0].maxFramerate = 60;
        params.encodings[0].scaleResolutionDownBy = 1; // Keep full res

        sender.setParameters(params).catch(console.warn);
      }
    }
  };

  // 🧩 Make playback smoother
  remoteVideo.addEventListener("loadedmetadata", () => {
    remoteVideo.play().catch(() => {});
  });

  return pc;
}

// --------------------
// Create Room
async function createRoom() {
  isCreator = true;
  const roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  document.getElementById("roomIdInput").value = roomId;
  log("Creating room: " + roomId);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 }
      },
      audio: true
    });
  } catch (err) {
    alert("Screen or mic permission denied.");
    console.error(err);
    return;
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  if (screenStream.getAudioTracks().length > 0)
    audioContext.createMediaStreamSource(screenStream).connect(destination);
  if (micStream.getAudioTracks().length > 0)
    audioContext.createMediaStreamSource(micStream).connect(destination);

  mixedStream = new MediaStream([
    ...screenStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
  ]);

  localVideo.srcObject = mixedStream;

  pc = makeConnection();
  mixedStream.getTracks().forEach(t => pc.addTrack(t, mixedStream));

  const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });

  roomRef.child("calleeCandidates").on("child_added", s => {
    pc.addIceCandidate(new RTCIceCandidate(s.val()));
  });

  roomRef.on("value", async snap => {
    const data = snap.val();
    if (data && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      log("✅ Remote answer received!");
    }
  });

  alert("Room created: " + roomId);
  log("Waiting for someone to join...");
}

// --------------------
// Join Room
async function joinRoom() {
  isCreator = false;
  const roomId = document.getElementById("roomIdInput").value.trim();
  if (!roomId) return alert("Enter Room ID first");
  roomRef = db.ref("rooms/" + roomId);

  const snap = await roomRef.once("value");
  const data = snap.val();
  if (!data || !data.offer) return alert("Room not found or offer missing.");

  log("Joining room " + roomId);
  pc = makeConnection();

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach(t => pc.addTrack(t, micStream));
    log("🎧 Mic ready for talking");
  } catch (err) {
    console.warn("Mic denied:", err);
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

  roomRef.child("callerCandidates").on("child_added", s => {
    pc.addIceCandidate(new RTCIceCandidate(s.val()));
  });

  log("Connected! You’ll see and hear the sharer soon.");
}

// --------------------
// Hang Up
async function hangUp() {
  log("Hanging up...");
  [screenStream, micStream, mixedStream].forEach(s => {
    if (s) s.getTracks().forEach(t => t.stop());
  });
  if (pc) pc.close();
  if (isCreator && roomRef) await roomRef.remove();
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  log("Idle");
}

