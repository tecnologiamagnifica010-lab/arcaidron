import { useState, useRef, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { Avatar } from "@/components/Avatar";
import { User } from "@/hooks/useAuth";
import { ImagePlus, Send, Trash2, X, Heart, ChevronLeft } from "lucide-react";

interface Post {
  id: string;
  username: string;
  avatar: string;
  text: string;
  media: string;
  mediaType: string;
  time: string;
  likes: number;
  likedBy: string[];
  comments: { id: string; username: string; text: string; time: string }[];
}

interface FeedPageProps {
  user: User;
  onBack: () => void;
}

export function FeedPage({ user, onBack }: FeedPageProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("get_feed");
    socket.on("feed_update", (data: Post[]) => setPosts(data));
    return () => { socket.off("feed_update"); };
  }, []);

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setMediaPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handlePost() {
    if (!text.trim() && !mediaPreview) return;
    setPosting(true);
    const socket = getSocket();
    socket.emit("create_post", {
      text: text.trim(),
      media: mediaPreview || "",
      mediaType: mediaPreview ? "image" : "text"
    });
    setText("");
    setMediaPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    setTimeout(() => setPosting(false), 800);
  }

  function handleDelete(postId: string) {
    setDeleteConfirm(postId);
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    getSocket().emit("delete_post", { postId: deleteConfirm });
    setDeleteConfirm(null);
  }

  function handleLike(postId: string) {
    getSocket().emit("like_post", { postId });
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="font-bold text-sm">Feed</h2>
          <p className="text-xs text-muted-foreground">Novidades e avisos</p>
        </div>
      </div>

      {/* Compose */}
      <div className="px-4 py-3 border-b border-border bg-card/30 flex-shrink-0">
        <div className="flex gap-3">
          <Avatar src={user.avatarUrl} name={user.displayName || user.username} size="sm" />
          <div className="flex-1 space-y-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="O que há de novo?"
              rows={2}
              className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
            {mediaPreview && (
              <div className="relative inline-block">
                <img src={mediaPreview} alt="preview" className="max-h-32 rounded-xl border border-border object-cover" />
                <button onClick={() => { setMediaPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                <ImagePlus className="w-4 h-4" />
                Foto
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
              <button onClick={handlePost}
                disabled={posting || (!text.trim() && !mediaPreview)}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground text-xs font-medium rounded-xl transition-all neon-blue">
                <Send className="w-3 h-3" />
                Publicar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Posts */}
      <div className="flex-1 overflow-y-auto">
        {posts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center px-6">
            <p className="text-muted-foreground text-sm">Nenhuma publicação ainda</p>
            <p className="text-xs text-muted-foreground mt-1">Seja o primeiro a postar!</p>
          </div>
        )}
        {posts.map(post => (
          <div key={post.id} className="px-4 py-4 border-b border-border hover:bg-card/30 transition-colors">
            <div className="flex gap-3">
              <Avatar name={post.username} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold text-sm">{post.username}</span>
                    <span className="text-xs text-muted-foreground ml-2">{post.time}</span>
                  </div>
                  {post.username.toLowerCase() === user.username.toLowerCase() && (
                    <button onClick={() => handleDelete(post.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {post.text && <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap">{post.text}</p>}

                {post.media && (
                  <button onClick={() => setLightbox(post.media)} className="mt-2 block">
                    <img src={post.media} alt="post" className="max-h-64 w-full object-cover rounded-xl border border-border hover:opacity-90 transition-opacity" />
                  </button>
                )}

                <div className="flex items-center gap-4 mt-3">
                  <button onClick={() => handleLike(post.id)}
                    className={`flex items-center gap-1.5 text-xs transition-colors ${post.likedBy?.includes(user.username) ? "text-rose-400" : "text-muted-foreground hover:text-rose-400"}`}>
                    <Heart className={`w-4 h-4 ${post.likedBy?.includes(user.username) ? "fill-rose-400" : ""}`} />
                    {post.likes > 0 && post.likes}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xs p-6 text-center shadow-2xl fade-in-up">
            <Trash2 className="w-8 h-8 text-destructive mx-auto mb-3" />
            <p className="font-semibold mb-1">Apagar publicação?</p>
            <p className="text-sm text-muted-foreground mb-5">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-medium transition-colors">
                Cancelar
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl text-sm font-medium transition-colors">
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <img src={lightbox} alt="fullsize" className="max-w-full max-h-full object-contain rounded-xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
