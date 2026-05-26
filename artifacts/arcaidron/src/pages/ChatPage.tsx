import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { encryptText, decryptText } from "@/lib/crypto";
import { Avatar } from "@/components/Avatar";
import { User } from "@/hooks/useAuth";
import { ConversationList } from "@/components/ConversationList";
import { MessageBubble } from "@/components/MessageBubble";
import { VideoCallOverlay } from "@/components/VideoCallOverlay";
import { ProfileModal } from "@/components/ProfileModal";
import { OpenChatModal } from "@/components/OpenChatModal";
import {
  Lock, LogOut, Settings, Plus, Send, Paperclip, Smile,
  Phone, Video, MoreVertical, Shield, Wifi, WifiOff, ChevronLeft
} from "lucide-react";

export interface Message {
  id: string;
  chatId: string;
  username: string;
  avatar: string;
  avatarUrl?: string | null;
  type: "text" | "photo" | "gif" | "audio";
  text: string;
  media: string;
  time: string;
  seenBy: string;
  replyTo: string;
  deleted: string;
  decryptedText?: string;
}

interface Conversation {
  otherUser: string;
  chatId: string;
  key: string;
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
}

interface ChatPageProps {
  user: User;
  onLogout: () => void;
  onUpdateUser: (u: Partial<User>) => void;
}

export function ChatPage({ user, onLogout, onUpdateUser }: ChatPageProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typingMsg, setTypingMsg] = useState("");
  const [connected, setConnected] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showOpenChat, setShowOpenChat] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callData, setCallData] = useState<{ offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit } | null>(null);
  const [showMobileList, setShowMobileList] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();

  const CONVS_KEY = `arcaidron_convs_${user.username}`;

  useEffect(() => {
    const saved = localStorage.getItem(CONVS_KEY);
    if (saved) {
      try { setConversations(JSON.parse(saved)); } catch {}
    }
  }, [CONVS_KEY]);

  function saveConvs(convs: Conversation[]) {
    setConversations(convs);
    localStorage.setItem(CONVS_KEY, JSON.stringify(convs));
  }

  const openChat = useCallback((otherUser: string, key: string) => {
    const socket = getSocket();
    socket.emit("open_private_chat", { otherUser, key });
  }, []);

  useEffect(() => {
    const socket = getSocket();

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("get_unread_counts");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("reconnect", () => {
      setConnected(true);
      socket.emit("get_unread_counts");
      if (activeConv) openChat(activeConv.otherUser, activeConv.key);
    });

    socket.on("chat_opened", async (data: { chatId: string; otherUser: string; messages: Message[] }) => {
      const conv = conversations.find(c => c.chatId === data.chatId) || activeConv;
      if (!conv) return;

      const decrypted = await Promise.all(data.messages.map(async m => {
        if (m.type === "text" && m.text) {
          return { ...m, decryptedText: await decryptText(m.text, conv.key) };
        }
        return m;
      }));

      setMessages(decrypted);
      setShowMobileList(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });

    socket.on("new_message", async (msg: Message) => {
      if (msg.chatId !== activeConv?.chatId) {
        setConversations(prev => {
          const updated = prev.map(c => c.chatId === msg.chatId ? { ...c, unread: (c.unread || 0) + 1 } : c);
          localStorage.setItem(CONVS_KEY, JSON.stringify(updated));
          return updated;
        });
        return;
      }
      const conv = activeConv;
      let decryptedText = msg.text;
      if (msg.type === "text" && msg.text && conv) {
        decryptedText = await decryptText(msg.text, conv.key);
      }
      setMessages(prev => [...prev, { ...msg, decryptedText }]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      if (msg.username !== user.username) {
        socket.emit("mark_seen", { id: msg.id });
      }
    });

    socket.on("message_seen", ({ id }: { id: string }) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, seenBy: user.username } : m));
    });

    socket.on("remove_message", (id: string) => {
      setMessages(prev => prev.filter(m => m.id !== id));
    });

    socket.on("chat_cleared", () => setMessages([]));

    socket.on("typing", (msg: string) => {
      setTypingMsg(msg);
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTypingMsg(""), 2000);
    });

    socket.on("call-made", (data: { offer: RTCSessionDescriptionInit }) => {
      setCallData(data);
      setInCall(true);
    });

    socket.on("call-ended", () => {
      setInCall(false);
      setCallData(null);
    });

    socket.on("unread_counts", (counts: Record<string, number>) => {
      setConversations(prev => {
        const updated = prev.map(c => ({
          ...c,
          unread: counts[c.chatId] ?? c.unread ?? 0
        }));
        localStorage.setItem(CONVS_KEY, JSON.stringify(updated));
        return updated;
      });
    });

    socket.on("unread_update", ({ chatId, count }: { chatId: string; count: number }) => {
      setConversations(prev => {
        const updated = prev.map(c => c.chatId === chatId ? { ...c, unread: count } : c);
        localStorage.setItem(CONVS_KEY, JSON.stringify(updated));
        return updated;
      });
    });

    // Request counts immediately if already connected
    if (socket.connected) socket.emit("get_unread_counts");

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("reconnect");
      socket.off("chat_opened");
      socket.off("new_message");
      socket.off("message_seen");
      socket.off("remove_message");
      socket.off("chat_cleared");
      socket.off("typing");
      socket.off("call-made");
      socket.off("call-ended");
      socket.off("unread_counts");
      socket.off("unread_update");
    };
  }, [activeConv, user.username, conversations, CONVS_KEY, openChat]);

  function handleOpenConversation(otherUser: string, key: string) {
    const existing = conversations.find(c => c.otherUser.toLowerCase() === otherUser.toLowerCase());
    let chatId = "";
    if (existing) {
      chatId = existing.chatId;
      setActiveConv(existing);
      openChat(otherUser, key);
    } else {
      const tempConv: Conversation = { otherUser, key, chatId: "pending" };
      setActiveConv(tempConv);
      getSocket().once("chat_opened", (data: { chatId: string; otherUser: string }) => {
        const newConv: Conversation = { otherUser: data.otherUser, chatId: data.chatId, key };
        saveConvs([...conversations.filter(c => c.chatId !== data.chatId), newConv]);
        setActiveConv(newConv);
      });
      openChat(otherUser, key);
    }
    setShowOpenChat(false);
  }

  function selectConversation(conv: Conversation) {
    setActiveConv(conv);
    setConversations(prev => {
      const updated = prev.map(c => c.chatId === conv.chatId ? { ...c, unread: 0 } : c);
      localStorage.setItem(CONVS_KEY, JSON.stringify(updated));
      return updated;
    });
    openChat(conv.otherUser, conv.key);
  }

  async function sendText() {
    if (!input.trim() || !activeConv) return;
    const encrypted = await encryptText(input.trim(), activeConv.key);
    getSocket().emit("send_message", { type: "text", text: encrypted });
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  }

  function handleTyping() {
    if (!activeConv) return;
    getSocket().emit("typing");
  }

  function sendImage(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      getSocket().emit("send_message", { type: "photo", media: e.target?.result });
    };
    reader.readAsDataURL(file);
  }

  function deleteMessage(id: string) {
    getSocket().emit("delete_message", { id });
  }

  function startCall() {
    setInCall(true);
    setCallData(null);
  }

  const otherUser = activeConv?.otherUser || "";
  const otherInitial = otherUser ? otherUser.slice(0, 2).toUpperCase() : "?";

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden">
      {/* Sidebar */}
      <div className={`${showMobileList ? "flex" : "hidden"} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-border bg-sidebar flex-shrink-0`}>
        {/* Sidebar header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowProfile(true)} data-testid="button-profile" className="hover:opacity-80 transition-opacity">
              <Avatar src={user.avatarUrl} name={user.displayName || user.username} size="md" online={true} />
            </button>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm truncate">{user.displayName || user.username}</h2>
              <div className="flex items-center gap-1.5">
                {connected ? (
                  <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-xs text-emerald-400">Conectado</span></>
                ) : (
                  <><WifiOff className="w-3 h-3 text-orange-400 animate-pulse" /><span className="text-xs text-orange-400">Reconectando...</span></>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowOpenChat(true)} data-testid="button-new-chat"
              className="w-8 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={onLogout} data-testid="button-logout"
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* App name */}
        <div className="px-4 py-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold tracking-widest text-primary neon-text-blue">ARCAIDRON</span>
          <Lock className="w-3 h-3 text-muted-foreground" />
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-6">
              <Shield className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma conversa</p>
              <p className="text-xs text-muted-foreground mt-1">Clique em + para iniciar</p>
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              activeId={activeConv?.chatId}
              currentUser={user.username}
              onSelect={selectConversation}
            />
          )}
        </div>
      </div>

      {/* Main chat */}
      <div className={`${showMobileList ? "hidden" : "flex"} md:flex flex-1 flex-col min-w-0 relative`}>
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm">
              <button onClick={() => setShowMobileList(true)} className="md:hidden w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <Avatar name={otherUser} size="md" online={undefined} />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{otherUser}</h3>
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs text-muted-foreground">Chat privado criptografado</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={startCall} data-testid="button-video-call"
                  className="w-9 h-9 rounded-xl bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors">
                  <Video className="w-4 h-4" />
                </button>
                <button className="w-9 h-9 rounded-xl hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 grid-bg">
              {messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isOwn={msg.username === user.username}
                  onDelete={deleteMessage}
                />
              ))}
              {typingMsg && (
                <div className="flex items-center gap-2 px-2 pb-2">
                  <div className="flex gap-1 items-center bg-card border border-border rounded-2xl px-3 py-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">{typingMsg.split(" está")[0]}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border bg-card/50 backdrop-blur-sm">
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => e.target.files?.[0] && sendImage(e.target.files[0])} />

                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={e => { setInput(e.target.value); handleTyping(); }}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite uma mensagem..."
                    rows={1}
                    data-testid="input-message"
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-2xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all max-h-32 overflow-y-auto leading-relaxed"
                    style={{ minHeight: "40px" }}
                  />
                </div>

                <button
                  onClick={sendText}
                  disabled={!input.trim()}
                  data-testid="button-send"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground transition-all neon-blue flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 grid-bg">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 pulse-neon">
              <Shield className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2 neon-text-blue text-primary">ARCAIDRON</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Selecione uma conversa ou inicie uma nova clicando em <strong>+</strong>
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mensagens criptografadas de ponta a ponta</span>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showOpenChat && (
        <OpenChatModal
          onOpen={handleOpenConversation}
          onClose={() => setShowOpenChat(false)}
        />
      )}

      {showProfile && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onUpdate={onUpdateUser}
        />
      )}

      {inCall && activeConv && (
        <VideoCallOverlay
          socket={getSocket()}
          otherUser={activeConv.otherUser}
          incomingOffer={callData?.offer}
          onClose={() => { setInCall(false); setCallData(null); }}
        />
      )}
    </div>
  );
}
