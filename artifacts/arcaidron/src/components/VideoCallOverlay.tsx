import { useState, useEffect, useRef } from "react";
import { X, Video, VideoOff, Mic, MicOff, RotateCcw, Phone } from "lucide-react";
import { Socket } from "socket.io-client";
import { Avatar } from "./Avatar";

interface VideoCallOverlayProps {
  socket: Socket;
  otherUser: string;
  incomingOffer?: RTCSessionDescriptionInit;
  onClose: () => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export function VideoCallOverlay({ socket, otherUser, incomingOffer, onClose }: VideoCallOverlayProps) {
  const [camEnabled, setCamEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [status, setStatus] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function startStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch {
      setStatus("ended");
      return null;
    }
  }

  function createPC() {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = event => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      setStatus("connected");
    };

    pc.onicecandidate = event => {
      if (event.candidate) socket.emit("ice-candidate", { candidate: event.candidate });
    };

    return pc;
  }

  useEffect(() => {
    (async () => {
      const stream = await startStream();
      if (!stream) return;

      if (incomingOffer) {
        // Incoming call — answer it
        setStatus("ringing");
        const pc = createPC();
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("make-answer", { answer });
        setStatus("connected");
      } else {
        // Outgoing call
        setStatus("ringing");
        const pc = createPC();
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("call-user", { offer });
      }
    })();

    socket.on("answer-made", async (data: { answer: RTCSessionDescriptionInit }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setStatus("connected");
      }
    });

    socket.on("ice-candidate", async (candidate: RTCIceCandidateInit) => {
      if (pcRef.current) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    socket.on("call-ended", endCall);

    return () => {
      socket.off("answer-made");
      socket.off("ice-candidate");
      socket.off("call-ended");
    };
  }, []);

  function endCall() {
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    socket.emit("end-call");
    setStatus("ended");
    onClose();
  }

  function toggleCam() {
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camEnabled; });
    setCamEnabled(!camEnabled);
  }

  function toggleMic() {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micEnabled; });
    setMicEnabled(!micEnabled);
  }

  async function flipCamera() {
    if (!streamRef.current || !pcRef.current) return;
    const currentTrack = streamRef.current.getVideoTracks()[0];
    const currentFacing = currentTrack?.getSettings().facingMode || "user";
    const newFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing }, audio: true });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
      sender?.replaceTrack(newVideoTrack);
      currentTrack?.stop();
      streamRef.current = newStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-zinc-950 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-2">
            <Avatar name={otherUser} size="sm" />
            <div>
              <p className="text-white text-sm font-medium">{otherUser}</p>
              <p className="text-white/60 text-xs">
                {status === "connecting" && "Conectando..."}
                {status === "ringing" && "Chamando..."}
                {status === "connected" && "Em chamada"}
                {status === "ended" && "Chamada encerrada"}
              </p>
            </div>
          </div>
          <button
            onClick={endCall}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            data-testid="button-close-call"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Remote video (main) */}
        <div className="aspect-video bg-zinc-900 relative">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            data-testid="video-remote"
            className="w-full h-full object-cover"
          />
          {status !== "connected" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Avatar name={otherUser} size="xl" className="opacity-80" />
            </div>
          )}

          {/* Local video PiP */}
          <div className="video-pip">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              data-testid="video-local"
              className="w-full h-full object-cover"
            />
            {!camEnabled && (
              <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
                <VideoOff className="w-4 h-4 text-white/50" />
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 p-5 bg-zinc-950">
          <button
            onClick={toggleMic}
            data-testid="button-toggle-mic"
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${micEnabled ? "bg-white/10 hover:bg-white/20 text-white" : "bg-orange-500 text-white"}`}
          >
            {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <button
            onClick={endCall}
            data-testid="button-end-call"
            className="w-14 h-14 rounded-2xl bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-all shadow-lg shadow-red-500/30"
          >
            <Phone className="w-6 h-6 rotate-[135deg]" />
          </button>

          <button
            onClick={toggleCam}
            data-testid="button-toggle-cam"
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${camEnabled ? "bg-white/10 hover:bg-white/20 text-white" : "bg-orange-500 text-white"}`}
          >
            {camEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          <button
            onClick={flipCamera}
            data-testid="button-flip-cam"
            className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
