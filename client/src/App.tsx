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
import { ScanLine, Search, ListChecks, MoreHorizontal, ScanBarcode, LogOut, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isClerkMode, initClerk, getClerk } from "@/lib/clerk";

// ── Bottom navigation ─────────────────────────────────────────────────────────

const TABS = [
  { path: "/",        label: "Lookup",  Icon: ScanLine      },
  { path: "/search",  label: "Search",  Icon: Search        },
  { path: "/session", label: "Session", Icon: ListChecks    },
  { path: "/more",    label: "More",    Icon: MoreHorizontal },
];

function useSessionItemCount() {
  const { data: sessionData } = useQuery<any>({
    queryKey: ["/api/sessions/active"],
    refetchInterval: 5000,
  });
  const sessionId = sessionData?.session?.id;
  const { data: itemsData } = useQuery<any>({
    queryKey: ["/api/scanned-items", sessionId],
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
  return (itemsData?.items?.length ?? 0) as number;
}

function BottomNav() {
  const [location, setLocation] = useLocation();
  const sessionCount = useSessionItemCount();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map(({ path, label, Icon }) => {
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

// ── Landing page (shown when not logged in) ───────────────────────────────────

function LandingPage() {
  function handleSignIn() {
    if (isClerkMode()) {
      getClerk()?.openSignIn();
    } else {
      window.location.href = "/api/login";
    }
  }

  const subtitle = isClerkMode()
    ? "Google, GitHub, Apple, or email — your choice"
    : "Google, GitHub, Apple, or email — your choice";

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-8 flex flex-col items-center gap-4">
        <div className="bg-blue-600 rounded-2xl p-5 shadow-xl shadow-blue-900/40">
          <ScanBarcode className="h-14 w-14 text-white stroke-[1.5]" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Michigan Liquor</h1>
          <p className="text-zinc-400 text-sm mt-1">Inventory &amp; Pricing Tool</p>
        </div>
      </div>

      <ul className="mb-10 space-y-3 text-left max-w-xs w-full">
        {[
          "Scan barcodes to build label sessions",
          "Compare register prices to Michigan's price book",
          "Generate Brother QL-820NWB shelf labels",
          "Auto-save your work across all devices",
        ].map((f) => (
          <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
            <span className="flex-shrink-0 h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            </span>
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={handleSignIn}
        data-testid="button-login"
        className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-8 py-4 rounded-2xl shadow-lg shadow-blue-900/40 transition-colors text-base"
      >
        <User className="h-5 w-5" />
        Sign in to get started
      </button>
      <p className="mt-4 text-xs text-zinc-600">{subtitle}</p>
    </div>
  );
}

// ── Signed-in header strip ────────────────────────────────────────────────────

function AuthHeader({ user }: { user: any }) {
  const qc = useQueryClient();

  async function handleSignOut() {
    if (isClerkMode()) {
      await getClerk()?.signOut();
      qc.setQueryData(["/api/auth/user"], null);
    } else {
      window.location.href = "/api/logout";
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-zinc-900/90 backdrop-blur border-b border-zinc-800 flex items-center justify-between px-4 py-1.5">
      <div className="flex items-center gap-2">
        {user?.profileImageUrl ? (
          <img src={user.profileImageUrl} alt="avatar" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        <span className="text-xs text-zinc-400 hidden sm:inline">
          {user?.firstName || user?.email || "Signed in"}
        </span>
      </div>
      <button
        onClick={handleSignOut}
        data-testid="button-logout"
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1 px-2 rounded"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
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
  const { user, isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    const clerk = getClerk();
    if (!clerk) return;
    const unsub = clerk.addListener(() => {
      qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [qc]);

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <LandingPage />;

  return (
    <>
      <AuthHeader user={user} />
      <div className="pt-8">
        <Router />
      </div>
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

function App() {
  const [clerkReady, setClerkReady] = useState(!isClerkMode());

  useEffect(() => {
    if (!isClerkMode()) return;
    initClerk()
      .then(() => setClerkReady(true))
      .catch(() => setClerkReady(true));
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
