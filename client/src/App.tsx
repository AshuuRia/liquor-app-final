import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LookupPage from "@/pages/lookup-page";
import SearchPage from "@/pages/search-page";
import SessionPage from "@/pages/session-page";
import MorePage from "@/pages/more-page";
import PriceComparePage from "@/pages/price-compare-page";
import { ScanLine, Search, ListChecks, MoreHorizontal } from "lucide-react";
import { loadConfig, isClerkMode, initClerk, getClerk } from "@/lib/clerk";
import { useAuth } from "@/hooks/use-auth";

// ── Bottom navigation ─────────────────────────────────────────────────────────

const TABS = [
  { path: "/",        label: "Lookup",  Icon: ScanLine      },
  { path: "/search",  label: "Search",  Icon: Search        },
  { path: "/session", label: "Session", Icon: ListChecks    },
  { path: "/more",    label: "More",    Icon: MoreHorizontal },
];

function useSessionItemCount(isAuthenticated: boolean) {
  const { data: sessionData } = useQuery<any>({
    queryKey: ["/api/sessions/active"],
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });
  const sessionId = sessionData?.session?.id;
  const { data: itemsData } = useQuery<any>({
    queryKey: ["/api/scanned-items", sessionId],
    enabled: isAuthenticated && !!sessionId,
    refetchInterval: 5000,
  });
  return (itemsData?.items?.length ?? 0) as number;
}

function BottomNav() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const sessionCount = useSessionItemCount(isAuthenticated);
  const visibleTabs = isAuthenticated ? TABS : TABS.filter(({ path }) => path !== "/session");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {visibleTabs.map(({ path, label, Icon }) => {
        const active = path === "/" ? location === "/" : location.startsWith(path);
        const isSession = path === "/session";
        return (
          <button
            key={path}
            data-testid={`tab-${label.toLowerCase()}`}
            onClick={() => setLocation(path)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors
              ${active ? "text-blue-400" : "text-zinc-500"}`}
          >
            <div className="relative">
              <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : "stroke-2"}`} />
              {isSession && sessionCount > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                  {sessionCount > 99 ? "99+" : sessionCount}
                </span>
              )}
            </div>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Authenticated main app ────────────────────────────────────────────────────

function Router() {
  return (
    <>
      <div className="pb-16">
        <Switch>
          <Route path="/" component={LookupPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/session" component={SessionPage} />
          <Route path="/more" component={MorePage} />
          <Route path="/more/price-compare" component={PriceComparePage} />
          <Route component={NotFound} />
        </Switch>
      </div>
      <BottomNav />
    </>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
    </div>
  );
}

function AppShell() {
  const qc = useQueryClient();

  useEffect(() => {
    const clerk = getClerk();
    if (!clerk) return;
    const unsub = clerk.addListener(() => {
      qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [qc]);

  return <Router />;
}

// ── Root ──────────────────────────────────────────────────────────────────────

function App() {
  const [clerkReady, setClerkReady] = useState(false);

  useEffect(() => {
    loadConfig()
      .then(() => {
        if (!isClerkMode()) return;
        return initClerk();
      })
      .catch(() => {})
      .finally(() => setClerkReady(true));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {clerkReady ? <AppShell /> : <Spinner />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
