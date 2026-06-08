import { useState, useRef } from "react";
import { Shield, Lock, User, Eye, EyeOff, Upload, Zap } from "lucide-react";

interface LoginPageProps {
  onLogin: (username: string, password: string) => void;
  onRegister: (username: string, password: string, avatarUrl?: string) => void;
  error: string | null;
  loading: boolean;
}

export function LoginPage({ onLogin, onRegister, error, loading }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    if (mode === "login") {
      onLogin(username.trim(), password.trim());
    } else {
      onRegister(username.trim(), password.trim(), avatarPreview || undefined);
    }
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : "A";
  const colors = ["from-blue-500 to-cyan-400", "from-violet-500 to-purple-400", "from-emerald-500 to-teal-400"];
  const colorIdx = username ? username.charCodeAt(0) % colors.length : 0;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background grid-bg relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm mx-4 fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 mb-4 pulse-neon">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight font-sans neon-text-blue text-primary">
            ARCAIDRON
          </h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Rede privada criptografada
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl">
          {/* Mode tabs */}
          <div className="flex bg-muted rounded-xl p-1 mb-6 gap-1">
            <button
              onClick={() => setMode("login")}
              data-testid="tab-login"
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Entrar
            </button>
            <button
              onClick={() => setMode("register")}
              data-testid="tab-register"
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Avatar upload (register only) */}
            {mode === "register" && (
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-16 h-16 rounded-xl overflow-hidden border-2 border-dashed border-border hover:border-primary transition-colors relative group flex-shrink-0"
                  data-testid="button-avatar-upload"
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center`}>
                      <span className="text-white font-bold text-lg">{initials}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload className="w-4 h-4 text-white" />
                  </div>
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Foto de perfil</p>
                  <p>Clique para escolher</p>
                </div>
              </div>
            )}

            {/* Username */}
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Seu nome privado"
                autoComplete="off"
                data-testid="input-username"
                className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Chave secreta (mín. 6 dígitos)" : "Sua chave secreta"}
                autoComplete="off"
                data-testid="input-password"
                className="w-full pl-10 pr-10 py-3 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Privacy notice (register only) */}
            {mode === "register" && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                Lista de usuários é privada. Ninguém pode ver seus contatos ou conversas.
              </p>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2" data-testid="text-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              data-testid="button-submit"
              className="w-full py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-xl transition-all flex items-center justify-center gap-2 neon-blue"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  {mode === "login" ? "Entrar" : "Criar conta"}
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Criptografia de ponta a ponta · Sem rastreamento
        </p>
      </div>
    </div>
  );
}
