// Firebase setup here (same as before)...

// Variables
const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let pc, localStream, micStream, remoteStream = null;
let roomRef, roomId;
let isCreator = false;

const remoteVideo = document.getElementById("remoteVideo");
const localPreview = document.getElementById("localPreview");
const statusDiv = document.getElementById("status");
const playOverlay = document.getElementById("playOverlay");

function logStatus(msg) {
  console.log("[STATUS]", msg);
  statusDiv.textContent = "Status: " + msg;
}

// Create peer connection and setup handlers
function makePeerConnection() {
  pc = new RTCPeerConnection(servers);

  pc.onicecandidate = e => {
    if (e.candidate && roomRef) {
      const path = isCreator ? "callerCandidates" : "calleeCandidates";
      roomRef.child(path).push(e.candidate.toJSON());
    }
  };

  // Handle incoming tracks
  pc.ontrack = event => {
    console.log("🎥 Remote track received:", event.streams);

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

    // Check if video track exists
    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.warn("❌ No video track found in remote stream.");
      playOverlay.style.display = "block";
      logStatus("Waiting for video track...");
    } else {
      playOverlay.style.display = "none";
      logStatus("Streaming");

      remoteVideo.muted = false; // unmute remote video for viewing
      remoteVideo.play().then(() => {
        console.log("✅ Remote video playing automatically");
      }).catch(err => {
        console.warn("❌ Autoplay failed:", err);
        playOverlay.style.display = "block";
        logStatus("Tap ▶ to play");
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE State:", pc.iceConnectionState);
    logStatus("ICE state: " + pc.iceConnectionState);
  };

  return pc;
}

// --- Create Room (PC Presenter) ---
async function createRoom() {
  isCreator = true;
  roomId = document.getElementById("roomIdInput").value.trim() || Math.random().toString(36).substring(2, 8);
  roomRef = db.ref("rooms/" + roomId);
  logStatus("Creating room: " + roomId);

  // Get screen and mic
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720 },
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

  localPreview.srcObject = localStream;

  pc = makePeerConnection();

  // Add video tracks from screen share
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    console.log(`Added local ${track.kind} track to pc: ${track.id}`);
  });

  // Add mic audio if available
  if (micStream) {
    micStream.getTracks().forEach(track => {
      pc.addTrack(track, micStream);
      console.log(`Added mic ${track.kind} track to pc: ${track.id}`);
    });
  }

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

// --- Join Room (Android Viewer) ---
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

  pc = makePeerConnection();

  // Add mic tracks for audio to send back if needed
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

// --- Mic toggle ---
function toggleMic() {
  if (!micStream) return;
  const track = micStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById("toggleMicBtn").textContent = track.enabled ? "Mute Mic" : "Unmute Mic";
}

// --- Hang Up ---
async function hangUp() {
  logStatus("Hanging up...");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  if (roomRef && isCreator) await roomRef.remove();

  remoteStream = null;
  remoteVideo.srcObject = null;
  remoteVideo.muted = false;
  localPreview.srcObject = null;
  playOverlay.style.display = "none";
  logStatus("Idle");
}

// --- Play overlay tap to play (for Android mobile autoplay restrictions) ---
playOverlay.addEventListener("click", () => {
  remoteVideo.play().then(() => {
    playOverlay.style.display = "none";
    logStatus("Streaming");
  }).catch(() => {
    logStatus("Tap ▶ to play");
  });
});

// Add event listener for remoteVideo click for manual play fallback
remoteVideo.addEventListener("click", () => {
  remoteVideo.play().catch(() => {});
});

