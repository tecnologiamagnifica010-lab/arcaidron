import { useState } from "react";
import { Trash2, Check, CheckCheck } from "lucide-react";
import { Avatar } from "./Avatar";
import { Message } from "@/pages/ChatPage";

interface MessageBubbleProps {
  msg: Message;
  isOwn: boolean;
  onDelete: (id: string) => void;
}

export function MessageBubble({ msg, isOwn, onDelete }: MessageBubbleProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className={`flex items-end gap-2 group ${isOwn ? "flex-row-reverse" : "flex-row"} ${isOwn ? "msg-out" : "msg-in"}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      data-testid={`message-${msg.id}`}
    >
      {!isOwn && (
        <Avatar
          src={msg.avatarUrl}
          name={msg.username}
          size="xs"
          className="mb-1 flex-shrink-0"
        />
      )}

      <div className={`max-w-[72%] md:max-w-[60%] space-y-1 ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {!isOwn && (
          <span className="text-xs text-muted-foreground px-1">{msg.username}</span>
        )}

        <div
          className={`relative rounded-2xl px-3.5 py-2.5 shadow-sm ${
            isOwn
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-border text-foreground rounded-bl-sm"
          }`}
        >
          {msg.type === "text" && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {msg.decryptedText || msg.text}
            </p>
          )}

          {(msg.type === "photo" || msg.type === "gif") && msg.media && (
            <img
              src={msg.media}
              alt="media"
              className="max-w-full rounded-xl max-h-64 object-cover"
            />
          )}

          {msg.type === "audio" && msg.media && (
            <audio controls src={msg.media} className="max-w-xs" />
          )}
        </div>

        <div className={`flex items-center gap-1.5 px-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
          <span className="text-xs text-muted-foreground">{msg.time}</span>
          {isOwn && (
            msg.seenBy ? (
              <CheckCheck className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Check className="w-3.5 h-3.5 text-muted-foreground" />
            )
          )}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(msg.id)}
        className={`w-7 h-7 flex items-center justify-center rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-all flex-shrink-0 mb-1 ${hovering ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
        data-testid={`button-delete-${msg.id}`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
