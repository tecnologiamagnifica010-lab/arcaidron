import { useState } from "react";
import { X, Lock, User, KeyRound, MessageSquarePlus } from "lucide-react";

interface OpenChatModalProps {
  onOpen: (otherUser: string, key: string) => void;
  onClose: () => void;
}

export function OpenChatModal({ onOpen, onClose }: OpenChatModalProps) {
  const [otherUser, setOtherUser] = useState("");
  const [key, setKey] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!otherUser.trim() || !key.trim()) return;
    onOpen(otherUser.trim(), key.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl fade-in-up">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Nova conversa privada</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
            <span>Ambos precisam usar o mesmo nome de usuário e a mesma chave privada para entrar na conversa.</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Nome do usuário</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={otherUser}
                onChange={e => setOtherUser(e.target.value)}
                placeholder="Nome da pessoa"
                autoComplete="off"
                data-testid="input-other-user"
                className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Chave privada da sala</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="Chave combinada entre vocês"
                autoComplete="off"
                data-testid="input-room-key"
                className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!otherUser.trim() || !key.trim()}
            data-testid="button-open-chat"
            className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-xl transition-all neon-blue text-sm"
          >
            Abrir conversa
          </button>
        </form>
      </div>
    </div>
  );
}
