import { useState, useRef } from "react";
import { X, Upload, Save, User } from "lucide-react";
import { Avatar } from "./Avatar";
import { User as UserType } from "@/hooks/useAuth";
import { getSocket } from "@/lib/socket";

interface ProfileModalProps {
  user: UserType;
  onClose: () => void;
  onUpdate: (updates: Partial<UserType>) => void;
}

export function ProfileModal({ user, onClose, onUpdate }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName || user.username);
  const [bio, setBio] = useState(user.bio || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleSave() {
    setSaving(true);
    const socket = getSocket();
    socket.emit("update_profile", {
      displayName: displayName.trim(),
      bio: bio.trim(),
      status: "Disponível",
      avatarUrl: avatarPreview || null
    });
    socket.once("profile_updated", () => {
      onUpdate({
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl: avatarPreview || null
      });
      setSaving(false);
      onClose();
    });
    setTimeout(() => {
      onUpdate({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl: avatarPreview || null });
      setSaving(false);
      onClose();
    }, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl fade-in-up">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Meu perfil</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-profile"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative block"
                data-testid="button-change-avatar"
              >
                <Avatar src={avatarPreview} name={displayName || user.username} size="xl" />
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="w-4 h-4 text-white" />
                </div>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            <div>
              <p className="font-medium text-sm">{user.username}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Clique na foto para alterar</p>
            </div>
          </div>

          {/* Display name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nome exibido</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Como você quer ser chamado"
              data-testid="input-display-name"
              className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Sobre você..."
              rows={3}
              data-testid="input-bio"
              className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="button-save-profile"
            className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm neon-blue"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <><Save className="w-4 h-4" /> Salvar</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
