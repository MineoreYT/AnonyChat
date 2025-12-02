// src/App.jsx
import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL =
  import.meta.env.VITE_SERVER_URL || "https://anonymous-chat-server-1q5h.onrender.com";

const socket = io(SOCKET_URL, { path: "/socket.io", autoConnect: false });

// Random name generator
function generateRandomName() {
  const adjectives = ["Swift","Silent","Brave","Lucky","Clever","Mighty","Happy","Cosmic","Frosty","Shadow"];
  const animals = ["Tiger","Falcon","Wolf","Panda","Eagle","Lion","Otter","Hawk","Bear","Dragon"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}-${Math.floor(Math.random() * 9999)}`;
}

function getAvatarLetter(id) {
  return id?.charAt(0)?.toUpperCase() || "?";
}

function getAvatarColor(id) {
  const colors = ["#4a90e2","#50e3c2","#f5a623","#d0021b","#9013fe","#7ed321"];
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return colors[sum % colors.length];
}

export default function App() {

  const [userID, setUserID] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);

  const [privateMessages, setPrivateMessages] = useState({});
  const [liveMessages, setLiveMessages] = useState([]);
  const [text, setText] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});

  // Load user, connect socket
  useEffect(() => {
    let storedID = sessionStorage.getItem("anon_id");
    if (!storedID) {
      storedID = generateRandomName();
      sessionStorage.setItem("anon_id", storedID);
    }
    setUserID(storedID);

    socket.auth = { userID: storedID };
    socket.connect();

    socket.on("online_users", users =>
      setOnlineUsers(users.filter(u => u !== storedID))
    );

    // Private message
    socket.on("receive_private", data => {
      setPrivateMessages(prev => ({
        ...prev,
        [data.from]: [...(prev[data.from] || []), data]
      }));

      if (data.from !== selectedUser) {
        setUnreadCounts(prev => ({
          ...prev,
          [data.from]: (prev[data.from] || 0) + 1
        }));
      }
    });

    // Live chat message
    socket.on("live_message", msg => {
      setLiveMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.off("online_users");
      socket.off("receive_private");
      socket.off("live_message");
    };
  }, [selectedUser]);

  // Load saved chat messages
  useEffect(() => {
    fetch(`${SOCKET_URL}/live-messages`)
      .then(res => res.json())
      .then(data => setLiveMessages(data));
  }, []);

  // Send private message
  const sendPrivateMessage = () => {
    if (!selectedUser || !text.trim()) return;
    const msg = {
      to: selectedUser,
      from: userID,
      text,
      time: new Date().toLocaleTimeString()
    };
    socket.emit("private_message", msg);

    setPrivateMessages(prev => ({
      ...prev,
      [selectedUser]: [...(prev[selectedUser] || []), msg]
    }));

    setText("");
  };

  // Send live chat message
  const sendLive = () => {
    if (!text.trim()) return;
    const msg = {
      userID,
      text,
      time: new Date().toLocaleTimeString()
    };
    socket.emit("live_message", msg);
    setText("");
  };

  // Select user or LIVE chat
  const selectUserChat = user => {
    setSelectedUser(user);
    if (user !== "LIVE") {
      setUnreadCounts(prev => ({ ...prev, [user]: 0 }));
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#121212", color: "#fff" }}>

      {/* Sidebar */}
      <div style={{ width: 260, background: "#1f1f1f", padding: 16 }}>

        <h3>O Hello Chat</h3>
        <div style={{ marginBottom: 12 }}>
          <strong>{userID}</strong>
        </div>

        {/* LIVE CHAT BUTTON */}
        <div onClick={() => selectUserChat("LIVE")}
          style={{
            padding: 12,
            marginBottom: 10,
            background: selectedUser === "LIVE" ? "#4a90e2" : "#2c2c2c",
            borderRadius: 12,
            cursor: "pointer"
          }}>
          🌐 Live Chat
        </div>

        <h4>Online Users</h4>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {onlineUsers.map(u => (
            <div key={u} onClick={() => selectUserChat(u)}
              style={{
                padding: 12,
                background: selectedUser === u ? "#4a90e2" : "#2c2c2c",
                borderRadius: 12,
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
                cursor: "pointer"
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
  <div style={{
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: getAvatarColor(u),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: 16,
    color: "#fff"
  }}>
    {getAvatarLetter(u)}
  </div>

  <span>{u}</span>
</div>

              {unreadCounts[u] > 0 &&
                <span style={{ background: "red", padding: "2px 8px", borderRadius: 20 }}>
                  {unreadCounts[u]}
                </span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column" }}>
        
        {/* LIVE CHAT UI */}
        {selectedUser === "LIVE" && (
          <>
            <h2>Live Chat</h2>
            <div style={{
              flex: 1,
              padding: 12,
              overflowY: "auto",
              background: "#1e1e1e",
              borderRadius: 12,
              border: "1px solid #333"
            }}>
              {liveMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <strong>{m.userID}</strong> [{m.time}] : {m.text}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", marginTop: 12 }}>
              <input value={text} onChange={e=>setText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendLive()}
                style={{ flex: 1, padding: 10, borderRadius: 20, border: "none", background: "#2c2c2c", color: "#fff" }}
                placeholder="Send a message to everyone..."
              />
              <button onClick={sendLive} style={{ padding: "10px 16px", marginLeft: 8, background: "#4a90e2", color: "#fff", border: "none", borderRadius: 20 }}>
                Send
              </button>
            </div>
          </>
        )}

        {/* PRIVATE CHAT UI */}
        {selectedUser && selectedUser !== "LIVE" && (
          <>
            <h2>Chat with {selectedUser}</h2>

            <div style={{
              flex: 1, overflowY: "auto", padding: 12,
              background: "#1e1e1e", borderRadius: 12, border: "1px solid #333"
            }}>
              {(privateMessages[selectedUser] || []).map((m, i) => (
                <div key={i} style={{
                  display: "flex",
                  flexDirection: m.from === userID ? "row-reverse" : "row",
                  marginBottom: 10
                }}>
                  <div style={{
                    background: m.from === userID ? "#4a90e2" : "#333",
                    padding: "8px 14px",
                    borderRadius: 18
                  }}>
                    <strong>{m.from}</strong> [{m.time}]: {m.text}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", marginTop: 12 }}>
              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendPrivateMessage()}
                style={{ flex: 1, padding: 10, borderRadius: 20, border: "none", background: "#2c2c2c", color: "#fff" }}
                placeholder="Type a private message..."
              />
              <button onClick={sendPrivateMessage} style={{ padding: "10px 16px", marginLeft: 8, background: "#4a90e2", color: "#fff", borderRadius: 20 }}>
                Send
              </button>
            </div>
          </>
        )}

        {!selectedUser && (
          <h2>Select a user or Live Chat</h2>
        )}

      </div>
    </div>
  );
}
