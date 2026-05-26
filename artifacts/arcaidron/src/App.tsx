import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginPage } from "@/pages/LoginPage";
import { ChatPage } from "@/pages/ChatPage";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient();

function AppInner() {
  const { user, loading, error, login, register, logout, updateUser } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background grid-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center pulse-neon">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Conectando ao ARCAIDRON...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLogin={login}
        onRegister={register}
        error={error}
        loading={loading}
      />
    );
  }

  return (
    <ChatPage
      user={user}
      onLogout={logout}
      onUpdateUser={updateUser}
    />
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/:rest*" component={AppInner} />
            <Route component={AppInner} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
