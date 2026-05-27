import { useState, useRef } from "react";
import { Trash2, Check, CheckCheck, Mic, Play, Pause } from "lucide-react";
import { Avatar } from "./Avatar";
import { Message } from "@/pages/ChatPage";

interface MessageBubbleProps {
  msg: Message;
  isOwn: boolean;
  onDelete: (id: string) => void;
  onImageClick?: (src: string) => void;
}

function AudioPlayer({ src, isOwn }: { src: string; isOwn: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); } else { el.play(); }
    setPlaying(!playing);
  }

  function formatTime(s: number) {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 min-w-[180px]">
      <audio
        ref={audioRef}
        src={src}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (el && el.duration) setProgress(el.currentTime / el.duration);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
      />
      <button
        onClick={togglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          isOwn ? "bg-white/20 hover:bg-white/30" : "bg-primary/20 hover:bg-primary/30"
        }`}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className={`h-1 rounded-full overflow-hidden ${isOwn ? "bg-white/20" : "bg-muted"}`}>
          <div
            className={`h-full rounded-full transition-all ${isOwn ? "bg-white/70" : "bg-primary"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className={`text-[10px] tabular-nums ${isOwn ? "text-white/60" : "text-muted-foreground"}`}>
          {formatTime(duration)}
        </span>
      </div>
      <Mic className={`w-3.5 h-3.5 flex-shrink-0 ${isOwn ? "text-white/50" : "text-muted-foreground"}`} />
    </div>
  );
}

export function MessageBubble({ msg, isOwn, onDelete, onImageClick }: MessageBubbleProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className={`flex items-end gap-2 group ${isOwn ? "flex-row-reverse" : "flex-row"}`}
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
          className={`relative rounded-2xl shadow-sm overflow-hidden ${
            isOwn
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-border text-foreground rounded-bl-sm"
          }`}
        >
          {msg.type === "text" && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words px-3.5 py-2.5">
              {msg.decryptedText || msg.text}
            </p>
          )}

          {(msg.type === "photo" || msg.type === "gif") && msg.media && (
            <button
              onClick={() => onImageClick?.(msg.media)}
              className="block w-full"
            >
              <img
                src={msg.media}
                alt="media"
                className="max-w-full max-h-64 object-cover hover:opacity-90 transition-opacity"
                style={{ display: "block" }}
              />
            </button>
          )}

          {msg.type === "audio" && msg.media && (
            <AudioPlayer src={msg.media} isOwn={isOwn} />
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
