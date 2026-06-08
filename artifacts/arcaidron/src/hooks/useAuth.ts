import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";

export interface User {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  status: string;
  token: string;
}

const SESSION_KEY = "arcaidron_session";

export function useAuth() {
  // All hooks declared unconditionally at top level — never reorder these
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const savedRef = useRef<User | null>(null);

  const handleLoginOk = useCallback((data: User) => {
    const userData = { ...data };
    setUser(userData);
    savedRef.current = userData;
    localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    // Re-authenticate on every reconnect using saved session
    function onConnect() {
      const saved = savedRef.current || (() => {
        try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
      })();
      if (saved?.token) {
        socket.emit("auth_token", { token: saved.token });
      }
    }

    socket.on("login_ok", handleLoginOk);

    socket.on("error_msg", (msg: string) => {
      setError(msg);
      setLoading(false);
    });

    socket.on("token_invalid", () => {
      // Only log out if there's no saved session we can retry with
      localStorage.removeItem(SESSION_KEY);
      savedRef.current = null;
      setUser(null);
      setLoading(false);
    });

    socket.on("connect", onConnect);

    // Try restoring session from localStorage immediately
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as User;
        savedRef.current = parsed;
        if (socket.connected) {
          socket.emit("auth_token", { token: parsed.token });
        }
        // Optimistically show the user immediately while we validate token
        // This prevents flash of login screen on page refresh
        setUser(parsed);
        setLoading(false);
      } catch {
        localStorage.removeItem(SESSION_KEY);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    // Heartbeat to keep session alive
    heartbeatRef.current = setInterval(() => {
      if (socket.connected && savedRef.current) {
        socket.emit("heartbeat");
      }
    }, 25000);

    return () => {
      socket.off("login_ok", handleLoginOk);
      socket.off("error_msg");
      socket.off("token_invalid");
      socket.off("connect", onConnect);
      clearInterval(heartbeatRef.current);
    };
  }, [handleLoginOk]);

  const login = useCallback((username: string, password: string) => {
    setError(null);
    setLoading(true);
    getSocket().emit("login", { username, password });
  }, []);

  const register = useCallback((username: string, password: string, avatarUrl?: string) => {
    setError(null);
    setLoading(true);
    getSocket().emit("create_account", { username, password, avatarUrl: avatarUrl || null });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    savedRef.current = null;
    setUser(null);
    clearInterval(heartbeatRef.current);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      savedRef.current = updated;
      localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { user, loading, error, login, register, logout, updateUser };
}
