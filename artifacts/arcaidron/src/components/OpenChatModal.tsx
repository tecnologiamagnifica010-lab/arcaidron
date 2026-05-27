import { useState, useEffect, useRef } from "react";
import { X, Lock, User, KeyRound, MessageSquarePlus, Search, CheckCircle2, Circle } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { Avatar } from "./Avatar";

interface OpenChatModalProps {
  onOpen: (otherUser: string, key: string) => void;
  onClose: () => void;
}

interface SearchResult {
  found: boolean;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  online?: boolean;
}

export function OpenChatModal({ onOpen, onClose }: OpenChatModalProps) {
  const [step, setStep] = useState<"search" | "key">("search");
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [key, setKey] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const socket = getSocket();
    socket.on("user_search_result", (data: SearchResult) => {
      setResult(data);
      setSearching(false);
    });
    return () => { socket.off("user_search_result"); };
  }, []);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setResult(null);
    clearTimeout(searchTimeout.current);
    if (!value.trim()) return;
    setSearching(true);
    searchTimeout.current = setTimeout(() => {
      getSocket().emit("search_user", { username: value.trim() });
    }, 400);
  }

  function handleSelectUser() {
    if (result?.found) setStep("key");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result?.username || !key.trim()) return;
    onOpen(result.username, key.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl fade-in-up">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Nova conversa</h3>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === "search" ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nome do usuário</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={e => handleSearchChange(e.target.value)}
                    placeholder="Digite o nome exato"
                    autoComplete="off"
                    autoFocus
                    className="w-full pl-10 pr-10 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                  {searching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  )}
                  {!searching && searchInput && (
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {result !== null && (
                <div className={`rounded-xl border p-3 transition-all ${result.found ? "border-primary/40 bg-primary/5 cursor-pointer hover:bg-primary/10" : "border-border bg-muted/30"}`}
                  onClick={result.found ? handleSelectUser : undefined}
                >
                  {result.found ? (
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar src={result.avatarUrl} name={result.username} size="md" />
                        <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${result.online ? "bg-emerald-400" : "bg-zinc-500"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{result.displayName || result.username}</p>
                        <p className="text-xs text-muted-foreground">@{result.username} · {result.online ? <span className="text-emerald-400">online</span> : "offline"}</p>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <Circle className="w-5 h-5" />
                      <p className="text-sm">Usuário não encontrado</p>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleSelectUser}
                disabled={!result?.found}
                className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-xl transition-all neon-blue text-sm"
              >
                Continuar
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {result?.found && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
                  <Avatar src={result.avatarUrl} name={result.username} size="sm" />
                  <div>
                    <p className="text-sm font-medium">{result.displayName || result.username}</p>
                    <p className="text-xs text-muted-foreground">@{result.username}</p>
                  </div>
                </div>
              )}

              <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                <span>Ambos precisam usar a mesma chave privada para entrar na conversa criptografada.</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Chave privada compartilhada</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="password"
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    placeholder="Chave combinada entre vocês"
                    autoComplete="off"
                    autoFocus
                    className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("search")}
                  className="flex-1 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-xl transition-all text-sm"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={!key.trim()}
                  className="flex-1 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-xl transition-all neon-blue text-sm"
                >
                  Abrir conversa
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
