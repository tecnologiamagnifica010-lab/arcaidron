import { useState, useEffect, useRef, useCallback } from "react";
import { X, Video, VideoOff, Mic, MicOff, RotateCcw, Phone, PhoneOff, PhoneCall } from "lucide-react";
import { Socket } from "socket.io-client";
import { Avatar } from "./Avatar";

interface VideoCallOverlayProps {
  socket: Socket;
  otherUser: string;
  otherAvatarUrl?: string | null;
  voiceOnly?: boolean;
  incomingOffer?: RTCSessionDescriptionInit | null;
  onClose: () => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export function VideoCallOverlay({ socket, otherUser, otherAvatarUrl, voiceOnly = false, incomingOffer, onClose }: VideoCallOverlayProps) {
  const [camEnabled, setCamEnabled] = useState(!voiceOnly);
  const [micEnabled, setMicEnabled] = useState(true);
  const [status, setStatus] = useState<"incoming" | "ringing" | "connected" | "ended">(
    incomingOffer ? "incoming" : "ringing"
  );
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval>>();
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const cleanup = useCallback(() => {
    clearInterval(durationRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  async function startStream(withVideo: boolean) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: withVideo,
        audio: true
      });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch {
      return null;
    }
  }

  function createPC() {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = event => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      setStatus("connected");
      durationRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    };

    pc.onicecandidate = event => {
      if (event.candidate) socket.emit("ice-candidate", { candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        endCall();
      }
    };

    return pc;
  }

  async function startOutgoingCall() {
    const stream = await startStream(!voiceOnly);
    if (!stream) { endCall(); return; }
    const pc = createPC();
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call-user", { offer, voiceOnly });
  }

  async function acceptCall() {
    if (!incomingOffer) return;
    setStatus("ringing");
    const stream = await startStream(!voiceOnly);
    if (!stream) { endCall(); return; }
    const pc = createPC();
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
    // flush pending candidates
    for (const c of pendingCandidates.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
    pendingCandidates.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("make-answer", { answer });
  }

  function declineCall() {
    socket.emit("call-declined");
    cleanup();
    onClose();
  }

  function endCall() {
    socket.emit("end-call");
    cleanup();
    setStatus("ended");
    setTimeout(onClose, 800);
  }

  function toggleCam() {
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camEnabled; });
    setCamEnabled(v => !v);
  }

  function toggleMic() {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micEnabled; });
    setMicEnabled(v => !v);
  }

  async function flipCamera() {
    if (!streamRef.current || !pcRef.current) return;
    const currentTrack = streamRef.current.getVideoTracks()[0];
    const currentFacing = currentTrack?.getSettings().facingMode || "user";
    const newFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing }, audio: false });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
      if (sender) sender.replaceTrack(newVideoTrack);
      currentTrack?.stop();
      // keep audio tracks from old stream
      const audioTracks = streamRef.current.getAudioTracks();
      const merged = new MediaStream([newVideoTrack, ...audioTracks]);
      streamRef.current = merged;
      if (localVideoRef.current) localVideoRef.current.srcObject = merged;
    } catch {}
  }

  useEffect(() => {
    if (status === "ringing" && !incomingOffer) {
      startOutgoingCall();
    }

    const handleAnswer = async (data: { answer: RTCSessionDescriptionInit }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    };

    const handleCandidate = async (candidate: RTCIceCandidateInit) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      } else {
        pendingCandidates.current.push(candidate);
      }
    };

    const handleEnded = () => { cleanup(); setStatus("ended"); setTimeout(onClose, 800); };
    const handleDeclined = () => { cleanup(); setStatus("ended"); setTimeout(onClose, 800); };

    socket.on("answer-made", handleAnswer);
    socket.on("ice-candidate", handleCandidate);
    socket.on("call-ended", handleEnded);
    socket.on("call-declined", handleDeclined);

    return () => {
      socket.off("answer-made", handleAnswer);
      socket.off("ice-candidate", handleCandidate);
      socket.off("call-ended", handleEnded);
      socket.off("call-declined", handleDeclined);
      clearInterval(durationRef.current);
    };
  }, []);

  function formatDuration(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  const statusLabel = {
    incoming: voiceOnly ? "Chamada de voz recebida" : "Chamada de vídeo recebida",
    ringing: "Chamando...",
    connected: formatDuration(callDuration),
    ended: "Chamada encerrada"
  }[status];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="relative w-full max-w-md mx-0 sm:mx-4 bg-zinc-950 sm:rounded-3xl overflow-hidden border-t sm:border border-white/10 shadow-2xl" style={{ maxHeight: "95vh" }}>

        {/* Video area — hidden in voice-only mode */}
        {!voiceOnly ? (
          <div className="relative bg-zinc-900" style={{ aspectRatio: "9/16", maxHeight: "55vh" }}>
            {/* Remote video */}
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

            {/* Placeholder when not connected */}
            {status !== "connected" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-900">
                <Avatar src={otherAvatarUrl} name={otherUser} size="xl" />
                <p className="text-white font-semibold text-lg">{otherUser}</p>
              </div>
            )}

            {/* Local video PiP */}
            <div className="absolute bottom-3 right-3 w-24 h-32 rounded-xl overflow-hidden border border-white/20 shadow-lg bg-zinc-800">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              {!camEnabled && (
                <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
                  <VideoOff className="w-5 h-5 text-white/40" />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Voice-only screen */
          <div className="flex flex-col items-center justify-center gap-5 py-14 bg-gradient-to-b from-zinc-900 to-zinc-950">
            <div className="relative">
              <div className={`absolute inset-0 rounded-full ${status === "connected" ? "animate-ping bg-emerald-400/20" : ""}`} />
              <Avatar src={otherAvatarUrl} name={otherUser} size="xl" />
            </div>
            <div className="text-center">
              <p className="text-white font-bold text-xl">{otherUser}</p>
              <p className="text-white/50 text-sm mt-1">Chamada de voz</p>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <p className="text-white/80 text-sm font-medium">{statusLabel}</p>
          {!voiceOnly && status === "ringing" && (
            <p className="text-white/40 text-xs">Aguardando resposta...</p>
          )}
        </div>

        {/* Controls */}
        {status === "incoming" ? (
          /* Incoming call — accept / decline */
          <div className="flex items-center justify-center gap-12 p-8">
            <div className="flex flex-col items-center gap-2">
              <button onClick={declineCall}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/30 transition-all">
                <PhoneOff className="w-7 h-7" />
              </button>
              <span className="text-xs text-white/50">Recusar</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={acceptCall}
                className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 transition-all">
                <PhoneCall className="w-7 h-7" />
              </button>
              <span className="text-xs text-white/50">Aceitar</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 p-5 bg-zinc-950">
            <button onClick={toggleMic}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${micEnabled ? "bg-white/10 hover:bg-white/20 text-white" : "bg-orange-500 text-white"}`}>
              {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            <button onClick={endCall}
              className="w-14 h-14 rounded-2xl bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/30 transition-all">
              <Phone className="w-6 h-6 rotate-[135deg]" />
            </button>

            {!voiceOnly && (
              <button onClick={toggleCam}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${camEnabled ? "bg-white/10 hover:bg-white/20 text-white" : "bg-orange-500 text-white"}`}>
                {camEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
            )}

            {!voiceOnly && (
              <button onClick={flipCamera}
                className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <RotateCcw className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
