// src/App.jsx
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = "https://anonymous-chat-server.onrender.com"; // change in prod
const socket = io(SOCKET_URL, { autoConnect: false });

function generateAnonID() {
  return "anon-" + Math.random().toString(36).substring(2, 12);
}

export default function App() {
  // identity & presence
  const [userID, setUserID] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);

  // private chat state
  const [selectedUser, setSelectedUser] = useState(null);
  const [privateMessages, setPrivateMessages] = useState({});
  const [text, setText] = useState("");

  // calling state
  const [callState, setCallState] = useState("idle"); // idle, calling, ringing, in-call
  const [incomingCall, setIncomingCall] = useState(null); // { from, fromSocketId, offer }
  const localStreamRef = useRef(null);
  const pcRef = useRef(null); // RTCPeerConnection
  const remoteAudioRef = useRef(null);

  // --- Initialize userID and optionally select chat from URL ---
  useEffect(() => {
    // Load or create anon id
    let storedID = sessionStorage.getItem("anon_id");
    if (!storedID) {
      storedID = generateAnonID();
      sessionStorage.setItem("anon_id", storedID);
    }
    setUserID(storedID);

    // Connect to socket
    socket.auth = { userID: storedID };
    socket.connect();

    // Online users update
    socket.on("online_users", (users) => {
      setOnlineUsers(users.filter(u => u !== storedID));
    });

    // Private messages
    socket.on("receive_private", (data) => {
      setPrivateMessages(prev => {
        const chatWith = data.from;
        const arr = prev[chatWith] || [];
        return { ...prev, [chatWith]: [...arr, data] };
      });
    });

    // Incoming WebRTC signaling
    socket.on("incoming-call", ({ from, fromSocketId, offer }) => {
      setIncomingCall({ from, fromSocketId, offer });
      setCallState("ringing");
    });

    socket.on("call-answered", async ({ fromSocketId, answer }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(answer);
          setCallState("in-call");
        } catch (err) { console.error(err); }
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (pcRef.current && candidate) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (err) {
          console.warn(err);
        }
      }
    });

    socket.on("call-ended", () => {
      endLocalCallCleanup();
    });

    // --- Check URL for chatWith param ---
    const params = new URLSearchParams(window.location.search);
    const chatWith = params.get("chatWith");
    if (chatWith) setSelectedUser(chatWith);

    return () => {
      socket.off("online_users");
      socket.off("receive_private");
      socket.off("incoming-call");
      socket.off("call-answered");
      socket.off("ice-candidate");
      socket.off("call-ended");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------- Private messaging --------------------
  const sendPrivateMessage = () => {
    if (!selectedUser || !text.trim()) return;
    const msg = { to: selectedUser, from: userID, text, time: new Date().toLocaleTimeString() };
    socket.emit("private_message", msg);
    setPrivateMessages(prev => {
      const arr = prev[selectedUser] || [];
      return { ...prev, [selectedUser]: [...arr, msg] };
    });
    setText("");
  };

  // -------------------- WebRTC helpers --------------------
  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.error("Microphone access denied", err);
      throw err;
    }
  }

  function createPeerConnection(remoteSocketId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit("ice-candidate", { toSocketId: remoteSocketId, candidate: ev.candidate });
    };

    pc.ontrack = (ev) => {
      if (!remoteAudioRef.current) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = ev.streams[0];
        audio.id = "remoteAudio";
        document.getElementById("remoteAudioContainer").appendChild(audio);
        remoteAudioRef.current = audio;
      } else {
        remoteAudioRef.current.srcObject = ev.streams[0];
      }
    };

    return pc;
  }

  async function startCall() {
    if (!selectedUser) return alert("Pick a user to call.");
    setCallState("calling");
    try {
      await ensureLocalStream();
      const pc = createPeerConnection(null);
      pcRef.current = pc;
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call-user", { to: selectedUser, offer: pc.localDescription });
    } catch (err) {
      console.error(err);
      setCallState("idle");
    }
  }

  async function acceptCall() {
    if (!incomingCall) return;
    const { fromSocketId, offer } = incomingCall;
    try {
      await ensureLocalStream();
      const pc = createPeerConnection(fromSocketId);
      pcRef.current = pc;
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer-call", { toSocketId: fromSocketId, answer: pc.localDescription });

      setCallState("in-call");
      setIncomingCall(null);
    } catch (err) {
      console.error(err);
      setCallState("idle");
    }
  }

  function declineCall() {
    if (incomingCall) {
      socket.emit("end-call", { toSocketId: incomingCall.fromSocketId });
      setIncomingCall(null);
      setCallState("idle");
    }
  }

  function hangUp() {
    const otherSocketId = pcRef.current ? pcRef.current._remoteSocketId : null;
    if (otherSocketId) socket.emit("end-call", { toSocketId: otherSocketId });
    endLocalCallCleanup();
  }

  function endLocalCallCleanup() {
    try {
      setCallState("idle");
      setIncomingCall(null);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        if (remoteAudioRef.current.parentNode) remoteAudioRef.current.parentNode.removeChild(remoteAudioRef.current);
        remoteAudioRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    } catch (e) { console.warn(e); }
  }

  // -------------------- UI --------------------
  const shareLink = `${window.location.origin}/?chatWith=${userID}`;

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#121212", color: "#fff", fontFamily: "sans-serif" }}>
      {/* Sidebar */}
      <div style={{ width: 260, background: "#1f1f1f", borderRight: "1px solid #333", padding: 16, display: "flex", flexDirection: "column" }}>
        <h3>Your ID</h3>
        <div style={{ wordBreak: "break-all", marginBottom: 12, fontSize: 14 }}><strong>{userID}</strong></div>

        <button
          onClick={() => navigator.clipboard.writeText(shareLink)}
          style={{ padding: "8px", marginBottom: 12, borderRadius: 12, border: "none", cursor: "pointer", backgroundColor: "#4a90e2", color: "#fff" }}
        >
          Copy Chat Link
        </button>

        <h4>Online</h4>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          {onlineUsers.map(u => (
            <div key={u} onClick={() => setSelectedUser(u)}
              style={{
                padding: 10, marginBottom: 6, borderRadius: 12, cursor: "pointer",
                background: selectedUser === u ? "#4a90e2" : "#2c2c2c",
                color: selectedUser === u ? "#fff" : "#ccc",
                transition: "0.2s"
              }}>
              {u}
            </div>
          ))}
        </div>

        <div>
          <button onClick={() => { if (selectedUser) startCall(); else alert("Select user to call"); }}
            style={{ padding: "10px 16px", borderRadius: 20, border: "none", cursor: "pointer", marginRight: 8, backgroundColor: "#28a745", color: "#fff" }}
            disabled={callState === "calling" || callState === "in-call"}>Call</button>
          <button onClick={hangUp}
            style={{ padding: "10px 16px", borderRadius: 20, border: "none", cursor: "pointer", backgroundColor: "#dc3545", color: "#fff" }}
            disabled={callState !== "in-call" && callState !== "calling"}>Hang Up</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12 }}>Call state: <strong>{callState}</strong></div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16 }}>
        {selectedUser ? (
          <>
            <h2 style={{ marginBottom: 12 }}>Chat with {selectedUser}</h2>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6, border: "1px solid #333", borderRadius: 12, backgroundColor: "#1e1e1e" }}>
              {(privateMessages[selectedUser] || []).map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.from === userID ? "flex-end" : "flex-start",
                  backgroundColor: m.from === userID ? "#4a90e2" : "#2c2c2c",
                  color: "#fff", padding: "10px 14px", borderRadius: 20, maxWidth: "70%", wordBreak: "break-word",
                  boxShadow: m.from === userID ? "0 2px 8px rgba(74,144,226,0.5)" : "0 2px 8px rgba(0,0,0,0.5)"
                }}>
                  <strong>{m.from}</strong> [{m.time}]: {m.text}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={text} onChange={e => setText(e.target.value)} placeholder="Type a message..."
                style={{ flex: 1, padding: 10, borderRadius: 20, border: "none", outline: "none", backgroundColor: "#2c2c2c", color: "#fff" }} />
              <button onClick={sendPrivateMessage} style={{ padding: "10px 16px", borderRadius: 20, border: "none", cursor: "pointer", backgroundColor: "#4a90e2", color: "#fff" }}>Send</button>
            </div>
          </>
        ) : <h2>Select someone to chat / call</h2>}

        {/* Remote audio */}
        <div id="remoteAudioContainer" style={{ marginTop: 12 }} />
      </div>

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div style={{ position: "fixed", right: 20, bottom: 20, backgroundColor: "#1f1f1f", color: "#fff", border: "1px solid #444", padding: 16, borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          <div><strong>Incoming Call</strong></div>
          <div>From: {incomingCall.from}</div>
          <div style={{ marginTop: 8 }}>
            <button onClick={acceptCall} style={{ padding: "8px 12px", borderRadius: 20, border: "none", cursor: "pointer", backgroundColor: "#28a745", color: "#fff" }}>Accept</button>
            <button onClick={declineCall} style={{ padding: "8px 12px", borderRadius: 20, border: "none", cursor: "pointer", backgroundColor: "#dc3545", color: "#fff", marginLeft: 8 }}>Decline</button>
          </div>
        </div>
      )}
    </div>
  );
}
