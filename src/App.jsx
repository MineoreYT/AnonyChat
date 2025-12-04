import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "https://anonymous-chat-server-1q5h.onrender.com";

function generateRandomName() {
  const adjectives = ["Swift","Silent","Brave","Lucky","Clever","Mighty","Happy","Cosmic","Frosty","Shadow"];
  const animals = ["Tiger","Falcon","Wolf","Panda","Eagle","Lion","Otter","Hawk","Bear","Dragon"];
  return adjectives[Math.floor(Math.random() * adjectives.length)] +
         animals[Math.floor(Math.random() * animals.length)] + "-" +
         Math.floor(Math.random() * 9999);
}

function avatarColor(id) {
  const colors = ["#4a90e2","#50e3c2","#f5a623","#d0021b","#9013fe","#7ed321"];
  let sum = 0; for (let c of id) sum += c.charCodeAt(0);
  return colors[sum % colors.length];
}

function avatarLetter(id) { return id?.charAt(0)?.toUpperCase() || "?"; }

// Browser fingerprinting function
function getBrowserFingerprint() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillText('fingerprint', 2, 2);
  
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvas: canvas.toDataURL()
  };
}

export default function App() {
  const [username, setUsername] = useState(generateRandomName() + " (pending...)");
  const [userID, setUserID] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [privateMessages, setPrivateMessages] = useState({});
  const [liveMessages, setLiveMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [text, setText] = useState("");
  const chatEndRef = useRef(null);
  const socketRef = useRef(null);

  const scrollToBottom = () => {
    setTimeout(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
  };

  // Initial setup & socket connection
  useEffect(() => {
    // Generate browser fingerprint
    const fingerprint = getBrowserFingerprint();
    
    // Initialize socket with fingerprint
    socketRef.current = io(SOCKET_URL, { 
      path: "/socket.io", 
      auth: { fingerprint },
      autoConnect: false 
    });
    
    const socket = socketRef.current;
    socket.connect();

    // Listen for server-assigned username
    socket.on("username_assigned", ({ username: assignedName, userID: assignedID }) => {
      setUsername(assignedName);
      setUserID(assignedID);
    });

    socket.on("online_users", users => {
      setOnlineUsers(users);
    });

    socket.on("receive_private", data => {
      setPrivateMessages(prev => ({ 
        ...prev, 
        [data.from]: [...(prev[data.from]||[]), data] 
      }));
      if (selectedUser !== data.from) {
        setUnreadCounts(prev => ({ 
          ...prev, 
          [data.from]: (prev[data.from]||0)+1 
        }));
      }
      scrollToBottom();
    });

    socket.on("live_message", msg => { 
      setLiveMessages(prev => [...prev, msg]); 
      scrollToBottom(); 
    });

    socket.on("warning", ({ message }) => {
      setLiveMessages(prev => [...prev, { 
        userID: "SERVER", 
        text: message, 
        time: new Date().toLocaleTimeString() 
      }]);
      scrollToBottom();
    });

    return () => {
      socket.off("username_assigned");
      socket.off("online_users");
      socket.off("receive_private");
      socket.off("live_message");
      socket.off("warning");
      socket.disconnect();
    };
  }, [selectedUser, username]);

  // Fetch initial live messages
  useEffect(() => {
    fetch(`${SOCKET_URL}/live-messages`)
      .then(res => res.json())
      .then(data => { setLiveMessages(data); scrollToBottom(); })
      .catch(err => console.error("Failed to load messages:", err));
  }, []);

  const sendPrivateMessage = () => {
    if (!text.trim() || !selectedUser || !socketRef.current) return;
    const msg = { 
      toName: selectedUser, 
      text, 
      time: new Date().toLocaleTimeString() 
    };
    socketRef.current.emit("private_message", msg);
    setText(""); 
    scrollToBottom();
  };

  const sendLive = () => {
    if (!text.trim() || !socketRef.current) return;
    const msg = { text, time: new Date().toLocaleTimeString() };
    socketRef.current.emit("live_message", msg); 
    setText(""); 
    scrollToBottom();
  };

  const selectChat = user => {
    setSelectedUser(user);
    if (user !== "LIVE") {
      setUnreadCounts(prev => ({ ...prev, [user]: 0 }));
    }
    scrollToBottom();
  };

  const MessageBubble = ({ m }) => (
    <div style={{ 
      display:"flex", 
      justifyContent: m.from===username?"flex-end":"flex-start", 
      marginBottom:10 
    }}>
      <div style={{ 
        background: m.from===username?"#4a90e2":"#333", 
        padding:"10px 14px", 
        borderRadius:16, 
        maxWidth:"65%", 
        lineHeight:1.4, 
        wordBreak:"break-word", 
        overflowWrap:"anywhere" 
      }}>
        <div style={{ fontSize:12, opacity:0.8 }}>
          {m.from} • {m.time}
        </div>
        {m.text}
      </div>
    </div>
  );

  const LiveBubble = ({ m }) => (
    <div style={{ marginBottom:12 }}>
      <strong style={{ color: avatarColor(m.userID) }}>
        {m.userID}
      </strong>
      <span style={{ opacity:0.5 }}> [{m.time}]</span>
      <div style={{ 
        wordBreak:"break-word", 
        overflowWrap:"anywhere", 
        maxWidth:"100%" 
      }}>
        {m.text}
      </div>
    </div>
  );

  return (
    <div style={{ 
      display:"flex", 
      height:"100vh", 
      background:"#0f0f0f", 
      color:"#fff", 
      fontFamily:"Inter,sans-serif" 
    }}>
      <div style={{ 
        width:260, 
        background:"#181818", 
        borderRight:"1px solid #2a2a2a", 
        display:"flex", 
        flexDirection:"column", 
        padding:16 
      }}>
        <h2 style={{ marginBottom:4 }}>O Hello Chat</h2>
        <div style={{ opacity:0.7, marginBottom:20 }}>
          {username}
        </div>
        <div 
          onClick={()=>selectChat("LIVE")} 
          style={{ 
            padding:14, 
            borderRadius:12, 
            cursor:"pointer", 
            background:selectedUser==="LIVE"?"#4a90e2":"#242424", 
            marginBottom:12, 
            textAlign:"center" 
          }}
        >
          🕸️ Live Chat
        </div>
        <h4>Online Users</h4>
        <div style={{ marginTop:8, overflowY:"auto", flex:1 }}>
          {onlineUsers.map(u => (
            <div 
              key={u} 
              onClick={()=>selectChat(u)} 
              style={{ 
                padding:12, 
                borderRadius:12, 
                background:selectedUser===u?"#4a90e2":"#242424", 
                cursor:"pointer", 
                display:"flex", 
                alignItems:"center", 
                justifyContent:"space-between", 
                marginBottom:8 
              }}
            >
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ 
                  width:34,
                  height:34,
                  borderRadius:"50%",
                  background:avatarColor(u),
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontWeight:"bold",
                  fontSize:16 
                }}>
                  {avatarLetter(u)}
                </div>
                {u}
              </div>
              {unreadCounts[u]>0 && (
                <span style={{ 
                  background:"red", 
                  padding:"4px 8px", 
                  borderRadius:20, 
                  fontSize:12 
                }}>
                  {unreadCounts[u]}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ 
        flex:1, 
        display:"flex", 
        flexDirection:"column", 
        padding:16 
      }}>
        <h2 style={{ marginBottom:16 }}>
          {selectedUser==="LIVE"
            ?"🕸️ Live Chat"
            :selectedUser
              ?`Chat with ${selectedUser}`
              :"Select a chat"}
        </h2>
        <div style={{ 
          flex:1, 
          background:"#181818", 
          border:"1px solid #2b2b2b", 
          borderRadius:12, 
          padding:16, 
          overflowY:"auto" 
        }}>
          {selectedUser==="LIVE"
            ? liveMessages.map((m,i) => <LiveBubble key={i} m={m} />)
            : (selectedUser && selectedUser!=="LIVE") && 
              (privateMessages[selectedUser]||[]).map((m,i) => 
                <MessageBubble key={i} m={m} />
              )}
          <div ref={chatEndRef}></div>
        </div>
        {selectedUser && (
          <div style={{ display:"flex", marginTop:14 }}>
            <input
              value={text}
              onChange={e=>setText(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&(selectedUser==="LIVE"?sendLive():sendPrivateMessage())}
              placeholder={selectedUser==="LIVE"?"Send a message to everyone...":"Type a private message..."}
              style={{ 
                flex:1,
                padding:14,
                borderRadius:30,
                background:"#242424",
                border:"1px solid #333",
                color:"#fff",
                outline:"none" 
              }}
            />
            <button 
              onClick={selectedUser==="LIVE"?sendLive:sendPrivateMessage} 
              style={{ 
                padding:"14px 20px", 
                marginLeft:10, 
                borderRadius:30, 
                background:"#4a90e2", 
                border:"none", 
                color:"#fff", 
                cursor:"pointer" 
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
