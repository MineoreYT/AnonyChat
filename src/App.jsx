import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "https://anonymous-chat-server-1q5h.onrender.com";
const socket = io(SOCKET_URL, { path: "/socket.io", autoConnect: false });

function avatarColor(id) {
  const colors = ["#4a90e2","#50e3c2","#f5a623","#d0021b","#9013fe","#7ed321"];
  let sum = 0; for (let c of id) sum += c.charCodeAt(0);
  return colors[sum % colors.length];
}

function avatarLetter(id) { return id?.charAt(0)?.toUpperCase() || "?"; }

export default function App() {
  const [username, setUsername] = useState("Connecting...");
  const [userID, setUserID] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [privateMessages, setPrivateMessages] = useState({});
  const [liveMessages, setLiveMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [text, setText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callWith, setCallWith] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  
  const chatEndRef = useRef(null);
  const usernameRef = useRef("");
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scrollToBottom = () => {
    setTimeout(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
  };

  // WebRTC Configuration
  const iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  const createPeerConnection = (targetUser) => {
    const pc = new RTCPeerConnection(iceServers);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: targetUser || callWith,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Remote track received:", event);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setRemoteStreamActive(true);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    return pc;
  };

  const startCall = async (targetUser, isVideo = true) => {
    try {
      setCallWith(targetUser);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Start with camera OFF by default
      if (isVideo) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
          setIsVideoOff(true);
        }
      } else {
        setIsVideoOff(true);
      }

      const pc = createPeerConnection(targetUser);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("call-user", {
        to: targetUser,
        offer: offer,
        isVideo: isVideo
      });

      setInCall(true);
    } catch (error) {
      console.error("Error starting call:", error);
      alert("Could not access camera/microphone. Please check permissions.");
      setCallWith(null);
      setInCall(false);
    }
  };

  const answerCall = async () => {
    try {
      setCallWith(incomingCall.from);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.isVideo,
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Start with camera OFF by default
      if (incomingCall.isVideo) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
          setIsVideoOff(true);
        }
      } else {
        setIsVideoOff(true);
      }

      const pc = createPeerConnection(incomingCall.from);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer-call", {
        to: incomingCall.from,
        answer: answer
      });

      setInCall(true);
      setIncomingCall(null);
    } catch (error) {
      console.error("Error answering call:", error);
      alert("Could not access camera/microphone. Please check permissions.");
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    socket.emit("end-call", { to: callWith });
    
    setInCall(false);
    setCallWith(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setRemoteStreamActive(false);
    localStreamRef.current = null;
    peerConnectionRef.current = null;
  };

  const rejectCall = () => {
    socket.emit("reject-call", { to: incomingCall.from });
    setIncomingCall(null);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        console.log("Video toggled:", videoTrack.enabled ? "ON" : "OFF");
      } else {
        console.log("No video track found");
      }
    } else {
      console.log("No local stream");
    }
  };

  useEffect(() => {
    socket.connect();

    socket.on("username_assigned", ({ username: assignedName, userID: assignedID }) => {
      setUsername(assignedName);
      usernameRef.current = assignedName;
      setUserID(assignedID);

      const params = new URLSearchParams(window.location.search);
      const targetUser = params.get('chat');
      if (targetUser && targetUser !== assignedName) {
        setTimeout(() => {
          setSelectedUser(targetUser);
          setSidebarOpen(false);
        }, 1000);
      }
    });

    socket.on("online_users", users => {
      const filtered = users.filter(u => u !== usernameRef.current);
      setOnlineUsers(filtered);
    });

    socket.on("receive_private", data => {
      let chatKey;
      if (data.from === usernameRef.current) {
        chatKey = selectedUser;
      } else {
        chatKey = data.from;
      }
      
      if (chatKey) {
        setPrivateMessages(prev => ({ 
          ...prev, 
          [chatKey]: [...(prev[chatKey]||[]), data] 
        }));
      }
      
      if (data.from !== usernameRef.current && selectedUser !== data.from) {
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

    // Call signaling
    socket.on("incoming-call", ({ from, offer, isVideo }) => {
      setIncomingCall({ from, offer, isVideo });
    });

    socket.on("call-answered", async ({ answer }) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on("call-ended", () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      setInCall(false);
      setCallWith(null);
      setIsMuted(false);
      setIsVideoOff(false);
      setRemoteStreamActive(false);
    });

    socket.on("call-rejected", () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      setInCall(false);
      setCallWith(null);
      setRemoteStreamActive(false);
      alert("Call was rejected");
    });

    return () => {
      socket.off("username_assigned");
      socket.off("online_users");
      socket.off("receive_private");
      socket.off("live_message");
      socket.off("warning");
      socket.off("incoming-call");
      socket.off("call-answered");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
    };
  }, [selectedUser]);

  useEffect(() => {
    fetch(`${SOCKET_URL}/live-messages`)
      .then(res => res.json())
      .then(data => { setLiveMessages(data); scrollToBottom(); })
      .catch(err => console.error("Failed to load messages:", err));
  }, []);

  const sendPrivateMessage = () => {
    if (!text.trim() || !selectedUser) return;
    const msg = { 
      toName: selectedUser, 
      text, 
      time: new Date().toLocaleTimeString() 
    };
    socket.emit("private_message", msg);
    setText(""); 
    scrollToBottom();
  };

  const sendLive = () => {
    if (!text.trim()) return;
    const msg = { text, time: new Date().toLocaleTimeString() };
    socket.emit("live_message", msg); 
    setText(""); 
    scrollToBottom();
  };

  const selectChat = user => {
    setSelectedUser(user);
    setSidebarOpen(false);
    if (user !== "LIVE") {
      setUnreadCounts(prev => ({ ...prev, [user]: 0 }));
    }
    scrollToBottom();
  };

  const copyUserLink = (e, userName) => {
    e.stopPropagation();
    const currentUrl = window.location.origin + window.location.pathname;
    const shareLink = `${currentUrl}?chat=${encodeURIComponent(userName)}`;
    
    navigator.clipboard.writeText(shareLink).then(() => {
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    });
  };

  const shareMyLink = () => {
    const currentUrl = window.location.origin + window.location.pathname;
    const myLink = `${currentUrl}?chat=${encodeURIComponent(username)}`;
    
    navigator.clipboard.writeText(myLink).then(() => {
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    });
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
        maxWidth:"75%", 
        lineHeight:1.4, 
        wordBreak:"break-word", 
        overflowWrap:"anywhere" 
      }}>
        <div style={{ fontSize:11, opacity:0.8, marginBottom:4 }}>
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
      <span style={{ opacity:0.5, fontSize:12 }}> [{m.time}]</span>
      <div style={{ 
        wordBreak:"break-word", 
        overflowWrap:"anywhere", 
        maxWidth:"100%",
        marginTop:4 
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
      fontFamily:"Inter,sans-serif",
      overflow:"hidden",
      position:"relative"
    }}>
      
      {/* Copy Notification */}
      {showCopyNotification && (
        <div style={{
          position:"fixed",
          top:20,
          right:20,
          background:"#4a90e2",
          padding:"12px 20px",
          borderRadius:8,
          zIndex:1000,
          boxShadow:"0 4px 12px rgba(0,0,0,0.3)"
        }}>
          ✓ Link copied to clipboard!
        </div>
      )}

      {/* Mobile Overlay */}
      {sidebarOpen && isMobile && (
        <div 
          onClick={() => setSidebarOpen(false)}
          style={{
            position:"fixed",
            top:0,
            left:0,
            right:0,
            bottom:0,
            background:"rgba(0,0,0,0.5)",
            zIndex:9
          }}
        />
      )}

      {/* Sidebar */}
      <div style={{ 
        width: isMobile ? (sidebarOpen ? "80%" : "0") : "260px",
        maxWidth:"300px",
        background:"#181818", 
        borderRight:"1px solid #2a2a2a", 
        display:"flex", 
        flexDirection:"column", 
        padding: sidebarOpen || !isMobile ? "16px" : "0",
        position: isMobile ? "fixed" : "relative",
        left:0,
        top:0,
        bottom:0,
        zIndex:10,
        transition:"all 0.3s ease",
        overflow:"hidden"
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <h2 style={{ margin:0, fontSize:20 }}>O Hello Chat</h2>
          {isMobile && sidebarOpen && (
            <button 
              onClick={() => setSidebarOpen(false)}
              style={{
                background:"none",
                border:"none",
                color:"#fff",
                fontSize:24,
                cursor:"pointer",
                padding:4
              }}
            >
              ×
            </button>
          )}
        </div>
        
        <div style={{ 
          display:"flex", 
          alignItems:"center", 
          justifyContent:"space-between",
          marginBottom:16,
          padding:10,
          background:"#242424",
          borderRadius:8
        }}>
          <div style={{ opacity:0.7, fontSize:14, flex:1, marginRight:8 }}>
            {username}
          </div>
          <button
            onClick={shareMyLink}
            title="Copy my chat link"
            style={{
              background:"#4a90e2",
              border:"none",
              color:"#fff",
              padding:"6px 12px",
              borderRadius:6,
              cursor:"pointer",
              fontSize:12,
              fontWeight:"500"
            }}
          >
            📋 Share
          </button>
        </div>

        <div 
          onClick={()=>selectChat("LIVE")} 
          style={{ 
            padding:14, 
            borderRadius:12, 
            cursor:"pointer", 
            background:selectedUser==="LIVE"?"#4a90e2":"#242424", 
            marginBottom:12, 
            textAlign:"center",
            fontWeight:"500"
          }}
        >
          🕸️ Live Chat
        </div>
        <h4 style={{ margin:"8px 0", fontSize:14, opacity:0.8 }}>
          Online Users ({onlineUsers.length})
        </h4>
        <div style={{ marginTop:8, overflowY:"auto", flex:1 }}>
          {onlineUsers.length === 0 && (
            <div style={{ opacity:0.5, fontSize:13, textAlign:"center", marginTop:20 }}>
              No other users online
            </div>
          )}
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
                marginBottom:8,
                transition:"background 0.2s",
                position:"relative"
              }}
            >
              <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
                <div style={{ 
                  width:34,
                  height:34,
                  borderRadius:"50%",
                  background:avatarColor(u),
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontWeight:"bold",
                  fontSize:14,
                  flexShrink:0
                }}>
                  {avatarLetter(u)}
                </div>
                <span style={{ fontSize:14, wordBreak:"break-word", flex:1 }}>{u}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {unreadCounts[u]>0 && (
                  <span style={{ 
                    background:"#ff3b30", 
                    padding:"4px 8px", 
                    borderRadius:20, 
                    fontSize:11,
                    fontWeight:"bold",
                    flexShrink:0,
                    minWidth:20,
                    textAlign:"center"
                  }}>
                    {unreadCounts[u]}
                  </span>
                )}
                <button
                  onClick={(e) => copyUserLink(e, u)}
                  title="Copy chat link"
                  style={{
                    background:"none",
                    border:"1px solid #4a90e2",
                    color:"#4a90e2",
                    padding:"4px 8px",
                    borderRadius:6,
                    cursor:"pointer",
                    fontSize:11,
                    flexShrink:0
                  }}
                >
                  🔗
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ 
        flex:1, 
        display:"flex", 
        flexDirection:"column",
        width: isMobile ? "100%" : "auto",
        overflow:"hidden"
      }}>
        {/* Header */}
        <div style={{
          display:"flex",
          alignItems:"center",
          gap:12,
          padding:"16px",
          borderBottom:"1px solid #2a2a2a",
          background:"#181818"
        }}>
          {isMobile && !sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background:"none",
                border:"none",
                color:"#fff",
                fontSize:24,
                cursor:"pointer",
                padding:4
              }}
            >
              ☰
            </button>
          )}
          <h2 style={{ margin:0, fontSize:18, flex:1 }}>
            {selectedUser==="LIVE"
              ?"🕸️ Live Chat"
              :selectedUser
                ?`Chat with ${selectedUser}`
                :"Select a chat"}
          </h2>
          {selectedUser && selectedUser !== "LIVE" && (
            <div style={{ display:"flex", gap:8 }}>
              
              
              
            </div>
          )}
        </div>

        {/* Messages Container */}
        <div style={{ 
          flex:1, 
          padding:16, 
          overflowY:"auto",
          overflowX:"hidden",
          background:"#0f0f0f"
        }}>
          {!selectedUser && (
            <div style={{
              display:"flex",
              alignItems:"center",
              justifyContent:"center",
              height:"100%",
              opacity:0.5,
              fontSize:16,
              textAlign:"center"
            }}>
              {isMobile 
                ? "Tap the menu to start chatting"
                : "Select a chat to start messaging"}
            </div>
          )}
          {selectedUser==="LIVE"
            ? liveMessages.map((m,i) => <LiveBubble key={i} m={m} />)
            : (selectedUser && selectedUser!=="LIVE") && 
              (privateMessages[selectedUser]||[]).map((m,i) => 
                <MessageBubble key={i} m={m} />
              )}
          <div ref={chatEndRef}></div>
        </div>

        {/* Input Area */}
        {selectedUser && (
          <div style={{ 
            display:"flex", 
            padding:16,
            gap:8,
            background:"#181818",
            borderTop:"1px solid #2a2a2a"
          }}>
            <input
              value={text}
              onChange={e=>setText(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&(selectedUser==="LIVE"?sendLive():sendPrivateMessage())}
              placeholder={selectedUser==="LIVE"?"Message everyone...":"Type a message..."}
              style={{ 
                flex:1,
                padding:"12px 16px",
                borderRadius:24,
                background:"#242424",
                border:"1px solid #333",
                color:"#fff",
                outline:"none",
                fontSize:14
              }}
            />
            <button 
              onClick={selectedUser==="LIVE"?sendLive:sendPrivateMessage} 
              style={{ 
                padding:"12px 20px", 
                borderRadius:24, 
                background:"#4a90e2", 
                border:"none", 
                color:"#fff", 
                cursor:"pointer",
                fontWeight:"500",
                fontSize:14
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
