import { useState, useEffect, useCallback } from "react";
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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLoginOk = useCallback((data: User) => {
    const userData = { ...data };
    setUser(userData);
    localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    socket.on("login_ok", handleLoginOk);
    socket.on("error_msg", (msg: string) => {
      setError(msg);
      setLoading(false);
    });
    socket.on("token_invalid", () => {
      localStorage.removeItem(SESSION_KEY);
      setUser(null);
      setLoading(false);
    });

    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as User;
        socket.on("connect", () => {
          socket.emit("auth_token", { token: parsed.token });
        });
        if (socket.connected) {
          socket.emit("auth_token", { token: parsed.token });
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    return () => {
      socket.off("login_ok", handleLoginOk);
      socket.off("error_msg");
      socket.off("token_invalid");
      socket.off("connect");
    };
  }, [handleLoginOk]);

  const login = useCallback((username: string, password: string) => {
    setError(null);
    setLoading(true);
    const socket = getSocket();
    socket.emit("login", { username, password });
  }, []);

  const register = useCallback((username: string, password: string, avatarUrl?: string) => {
    setError(null);
    setLoading(true);
    const socket = getSocket();
    socket.emit("create_account", { username, password, avatarUrl: avatarUrl || null });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { user, loading, error, login, register, logout, updateUser };
}
