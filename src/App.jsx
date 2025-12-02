// src/App.jsx
import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = "https://anonymous-chat-server-1q5h.onrender.com";
const socket = io(SOCKET_URL, { path: "/socket.io", autoConnect: false });

function generateRandomName() {
  const adjectives = ["Swift","Silent","Brave","Lucky","Clever","Mighty","Happy","Cosmic","Frosty","Shadow"];
  const animals = ["Tiger","Falcon","Wolf","Panda","Eagle","Lion","Otter","Hawk","Bear","Dragon"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}-${Math.floor(Math.random() * 9999)}`;
}

function getAvatarLetter(id) { return id?.charAt(0)?.toUpperCase() || "?"; }
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
  const [text, setText] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({}); // For notification badges

  useEffect(() => {
    let storedID = sessionStorage.getItem("anon_id");
    if (!storedID) {
      storedID = generateRandomName();
      sessionStorage.setItem("anon_id", storedID);
    }
    setUserID(storedID);

    // Request permission for browser notifications
    if (Notification.permission !== "granted") Notification.requestPermission();

    socket.auth = { userID: storedID };
    socket.connect();

    socket.on("online_users", users => setOnlineUsers(users.filter(u => u !== storedID)));

    socket.on("receive_private", data => {
      setPrivateMessages(prev => {
        const arr = prev[data.from] || [];
        return { ...prev, [data.from]: [...arr, data] };
      });

      // Update unread badge if user not selected
      if (data.from !== selectedUser) {
        setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
        // Browser notification
        if (Notification.permission === "granted") {
          new Notification(`New message from ${data.from}`, { body: data.text });
        }
      }
    });

    return () => {
      socket.off("online_users");
      socket.off("receive_private");
    };
  }, [selectedUser]);

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

  const selectUser = (user) => {
    setSelectedUser(user);
    setUnreadCounts(prev => ({ ...prev, [user]: 0 })); // Clear unread count when opening chat
  };

  const shareLink = `${window.location.origin}/?chatWith=${userID}`;

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#121212", color: "#fff", fontFamily: "sans-serif" }}>
      {/* SIDEBAR */}
      <div style={{ width: 260, background: "#1f1f1f", borderRight: "1px solid #333", padding: 16, display: "flex", flexDirection: "column" }}>
        <h3>O Hello Chat</h3>
        <div style={{ wordBreak: "break-all", marginBottom: 12, fontSize: 14 }}><strong>{userID}</strong></div>
        <button onClick={() => navigator.clipboard.writeText(shareLink)} style={{ padding: 8, marginBottom: 12, borderRadius: 12, border: "none", cursor: "pointer", backgroundColor: "#4a90e2", color: "#fff" }}>Copy Chat Link</button>
        <h4>Online</h4>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          {onlineUsers.map(u => (
            <div key={u} onClick={() => selectUser(u)} style={{
              padding: 10, marginBottom: 6, borderRadius: 12, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: selectedUser === u ? "#4a90e2" : "#2c2c2c",
              color: selectedUser === u ? "#fff" : "#ccc",
              transition: "0.2s"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", backgroundColor: getAvatarColor(u),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: "bold", fontSize: 16, color: "#fff"
                }}>{getAvatarLetter(u)}</div>
                {u}
              </div>
              {unreadCounts[u] > 0 && (
                <div style={{ background: "#dc3545", borderRadius: "50%", padding: "4px 8px", fontSize: 12 }}>{unreadCounts[u]}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CHAT AREA */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16 }}>
        {selectedUser ? (
          <>
            <h2 style={{ marginBottom: 12 }}>Chat with {selectedUser}</h2>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12, border: "1px solid #333", borderRadius: 12, backgroundColor: "#1e1e1e" }}>
              {(privateMessages[selectedUser] || []).map((m,i) => (
                <div key={i} style={{ display: "flex", flexDirection: m.from === userID ? "row-reverse" : "row", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ width:32,height:32,borderRadius:"50%",backgroundColor:getAvatarColor(m.from),display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold",fontSize:16,color:"#fff",flexShrink:0 }}>{getAvatarLetter(m.from)}</div>
                  <div style={{ backgroundColor: m.from===userID?"#4a90e2":"#2c2c2c", color:"#fff", padding:"10px 14px", borderRadius:20, maxWidth:"70%", wordBreak:"break-word" }}>
                    <strong>{m.from}</strong> [{m.time}]: {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={text} onChange={e=>setText(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();sendPrivateMessage();}}}
                placeholder="Type a message..." style={{flex:1,padding:10,borderRadius:20,border:"none",outline:"none",backgroundColor:"#2c2c2c",color:"#fff"}}/>
              <button onClick={sendPrivateMessage} style={{ padding:"10px 16px",borderRadius:20,border:"none",cursor:"pointer",backgroundColor:"#4a90e2",color:"#fff"}}>Send</button>
            </div>
          </>
        ) : <h2>Select someone to chat</h2>}
      </div>
    </div>
  );
}
