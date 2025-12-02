// src/App.jsx
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = "https://anonymous-chat-server-1q5h.onrender.com";
const socket = io(SOCKET_URL, {
  path: "/socket.io",
  autoConnect: false,
});

/* ---------------- RANDOM NAME GENERATOR ---------------- */
function generateRandomName() {
  const adjectives = [
    "Swift", "Silent", "Brave", "Lucky", "Clever",
    "Mighty", "Happy", "Cosmic", "Frosty", "Shadow"
  ];
  const animals = [
    "Tiger", "Falcon", "Wolf", "Panda", "Eagle",
    "Lion", "Otter", "Hawk", "Bear", "Dragon"
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}-${Math.floor(Math.random() * 9999)}`;
}

/* ---------------- AVATAR HELPERS ---------------- */
function getAvatarLetter(id) {
  return id?.charAt(0)?.toUpperCase() || "?";
}

function getAvatarColor(id) {
  const colors = ["#4a90e2", "#50e3c2", "#f5a623", "#d0021b", "#9013fe", "#7ed321"];
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return colors[sum % colors.length];
}
/* ------------------------------------------------ */

export default function App() {
  const [userID, setUserID] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [privateMessages, setPrivateMessages] = useState({});
  const [text, setText] = useState("");

  const [callState, setCallState] = useState("idle");
  const [incomingCall, setIncomingCall] = useState(null);

  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const remoteAudioRef = useRef(null);

  /* ---------------- INIT LOGIC ---------------- */
  useEffect(() => {
    let storedID = sessionStorage.getItem("anon_id");
    if (!storedID) {
      storedID = generateRandomName();
      sessionStorage.setItem("anon_id", storedID);
    }
    setUserID(storedID);

    socket.auth = { userID: storedID };
    socket.connect();

    socket.on("online_users", (users) => {
      setOnlineUsers(users.filter(u => u !== storedID));
    });

    socket.on("receive_private", (data) => {
      setPrivateMessages(prev => {
        const chatWith = data.from;
        const arr = prev[chatWith] || [];
        return { ...prev, [chatWith]: [...arr, data] };
      });
    });

    socket.on("incoming-call", ({ from, fromSocketId, offer }) => {
      setIncomingCall({ from, fromSocketId, offer });
      setCallState("ringing");
    });

    socket.on("call-answered", async ({ answer }) => {
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

    socket.on("call-ended", () => endLocalCallCleanup());

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
  }, []);

  /* ---------------- PRIVATE MESSAGING ---------------- */
  const sendPrivateMessage = () => {
    if (!selectedUser || !text.trim()) return;

    const msg = {
      to: selectedUser,
      from: userID,
      text,
      time: new Date().toLocaleTimeString(),
    };

    socket.emit("private_message", msg);

    setPrivateMessages(prev => {
      const arr = prev[selectedUser] || [];
      return { ...prev, [selectedUser]: [...arr, msg] };
    });

    setText("");
  };

  /* ---------------- CALLING / WEBRTC ---------------- */
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
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate)
        socket.emit("ice-candidate", { toSocketId: remoteSocketId, candidate: ev.candidate });
    };

    pc.ontrack = (ev) => {
      if (!remoteAudioRef.current) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = ev.streams[0];
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

      localStreamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, localStreamRef.current)
      );

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

      localStreamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, localStreamRef.current)
      );

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer-call", {
        toSocketId: fromSocketId,
        answer: pc.localDescription
      });

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
    if (pcRef.current) {
      socket.emit("end-call", {});
    }
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
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    } catch {}
  }

  const shareLink = `${window.location.origin}/?chatWith=${userID}`;

  /* ---------------- UI ---------------- */
  return (
    <div style={{
      display: "flex",
      height: "100vh",
      backgroundColor: "#121212",
      color: "#fff",
      fontFamily: "sans-serif"
    }}>

      {/* SIDEBAR */}
      <div style={{
        width: 260,
        background: "#1f1f1f",
        borderRight: "1px solid #333",
        padding: 16,
        display: "flex",
        flexDirection: "column"
      }}>
        <h3>O Hello Chat</h3>

        <div style={{
          wordBreak: "break-all",
          marginBottom: 12,
          fontSize: 14
        }}>
          <strong>{userID}</strong>
        </div>

        <button
          onClick={() => navigator.clipboard.writeText(shareLink)}
          style={{
            padding: 8,
            marginBottom: 12,
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            backgroundColor: "#4a90e2",
            color: "#fff"
          }}
        >
          Copy Chat Link
        </button>

        <h4>Online</h4>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          {onlineUsers.map(u => (
            <div
              key={u}
              onClick={() => setSelectedUser(u)}
              style={{
                padding: 10,
                marginBottom: 6,
                borderRadius: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: selectedUser === u ? "#4a90e2" : "#2c2c2c",
                color: selectedUser === u ? "#fff" : "#ccc",
                transition: "0.2s"
              }}
            >
              {/* avatar */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: getAvatarColor(u),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                fontSize: 16,
                color: "#fff",
              }}>
                {getAvatarLetter(u)}
              </div>

              {u}
            </div>
          ))}
        </div>

        <div>
          <button
            onClick={() => selectedUser ? startCall() : alert("Select user to call")}
            style={{
              padding: "10px 16px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              marginRight: 8,
              backgroundColor: "#28a745",
              color: "#fff"
            }}
            disabled={callState === "calling" || callState === "in-call"}
          >
            Call
          </button>

          <button
            onClick={hangUp}
            style={{
              padding: "10px 16px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              backgroundColor: "#dc3545",
              color: "#fff"
            }}
            disabled={callState !== "in-call" && callState !== "calling"}
          >
            Hang Up
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12 }}>
          Call state: <strong>{callState}</strong>
        </div>
      </div>

      {/* CHAT AREA */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16 }}>
        {selectedUser ? (
          <>
            <h2 style={{ marginBottom: 12 }}>Chat with {selectedUser}</h2>

            {/* messages */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              border: "1px solid #333",
              borderRadius: 12,
              backgroundColor: "#1e1e1e"
            }}>
              {(privateMessages[selectedUser] || []).map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: m.from === userID ? "row-reverse" : "row",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  {/* avatar */}
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    backgroundColor: getAvatarColor(m.from),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    fontSize: 16,
                    color: "#fff",
                    flexShrink: 0
                  }}>
                    {getAvatarLetter(m.from)}
                  </div>

                  {/* bubble */}
                  <div style={{
                    backgroundColor: m.from === userID ? "#4a90e2" : "#2c2c2c",
                    color: "#fff",
                    padding: "10px 14px",
                    borderRadius: 20,
                    maxWidth: "70%",
                    wordBreak: "break-word",
                    boxShadow:
                      m.from === userID
                        ? "0 2px 8px rgba(74,144,226,0.5)"
                        : "0 2px 8px rgba(0,0,0,0.5)"
                  }}>
                    <strong>{m.from}</strong> [{m.time}]: {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* input */}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input
  value={text}
  onChange={e => setText(e.target.value)}
  onKeyDown={e => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendPrivateMessage();
    }
  }}
  placeholder="Type a message..."
  style={{
    flex: 1,
    padding: 10,
    borderRadius: 20,
    border: "none",
    outline: "none",
    backgroundColor: "#2c2c2c",
    color: "#fff"
  }}
/>

              <button
                onClick={sendPrivateMessage}
                style={{
                  padding: "10px 16px",
                  borderRadius: 20,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: "#4a90e2",
                  color: "#fff",
                }}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <h2>Select someone to chat / call</h2>
        )}

        <div id="remoteAudioContainer" style={{ marginTop: 12 }}></div>
      </div>

      {/* INCOMING CALL POPUP */}
      {incomingCall && (
        <div style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          backgroundColor: "#1f1f1f",
          color: "#fff",
          border: "1px solid #444",
          padding: 16,
          borderRadius: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
        }}>
          <div><strong>Incoming Call</strong></div>
          <div>From: {incomingCall.from}</div>

          <div style={{ marginTop: 8 }}>
            <button
              onClick={acceptCall}
              style={{
                padding: "8px 12px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                backgroundColor: "#28a745",
                color: "#fff",
              }}
            >
              Accept
            </button>

            <button
              onClick={declineCall}
              style={{
                padding: "8px 12px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                backgroundColor: "#dc3545",
                color: "#fff",
                marginLeft: 8,
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
