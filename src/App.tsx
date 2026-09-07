import { BrowserRouter, Route, Routes, NavLink, Outlet } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthCallback from "./pages/auth/Callback.tsx";
import Index from "./pages/Index.tsx";
import DatabasePage from "./pages/database/page.tsx";
import ProcessingPage from "./pages/processing/page.tsx";
import SchedulesPage from "./pages/schedules/page.tsx";
import NotFound from "./pages/NotFound.tsx";
import { Database, CalendarCheck, FileSpreadsheet, ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

function AppLayout() {
  const { user, signout } = useAuth();

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/50 mb-1">Nigerian Navy</div>
          <h1 className="text-base font-bold text-sidebar-foreground leading-tight">RCA Payment<br />Processing</h1>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <SideNavLink to="/database" icon={<Database size={16} />} label="Master Database" />
          <SideNavLink to="/processing" icon={<CalendarCheck size={16} />} label="Monthly Processing" />
          <SideNavLink to="/schedules" icon={<FileSpreadsheet size={16} />} label="Bank Schedules" />
        </nav>
        <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
          <div className="text-xs text-sidebar-foreground/40">RCA Rate: ₦3,000 / day</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-foreground truncate">
                {user?.profile.name ?? user?.profile.email ?? "Admin"}
              </div>
              <div className="text-xs text-sidebar-foreground/40">Signed in</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer shrink-0"
              onClick={() => signout()}
              title="Sign out">
              
              <LogOut size={14} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between gap-3 px-4 py-3 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
          <h1 className="font-bold text-sm">RCA Payment Processing</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-sidebar-foreground/60 hover:text-sidebar-foreground cursor-pointer"
            onClick={() => signout()}
            title="Sign out">
            
            <LogOut size={15} />
          </Button>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        {/* Mobile bottom nav */}
        <nav className="md:hidden flex border-t border-border bg-background">
          <MobileNavLink to="/database" icon={<Database size={18} />} label="Database" />
          <MobileNavLink to="/processing" icon={<CalendarCheck size={18} />} label="Processing" />
          <MobileNavLink to="/schedules" icon={<FileSpreadsheet size={18} />} label="Schedules" />
        </nav>
      </div>
    </div>);

}

function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Crest / icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/30">
            <ShieldCheck size={30} className="text-primary" />
          </div>
          <div>
            <div className="font-semibold uppercase tracking-widest text-sidebar-foreground/50 text-lg my-0">NN A AND B</div>
            <h1 className="text-2xl font-bold text-sidebar-foreground">RCA Payment Processing</h1>
            <p className="text-sm text-sidebar-foreground/50 mt-1">Authorised personnel only</p>
          </div>
        </div>

        <div className="bg-sidebar-accent/40 border border-sidebar-border rounded-2xl p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-sidebar-foreground">Sign In</h2>
            <p className="text-xs text-sidebar-foreground/50">
              Use your assigned username and password to access the system.
            </p>
          </div>
          <SignInButton className="w-full cursor-pointer" />
        </div>

        <p className="text-xs text-sidebar-foreground/30">
          Unauthorised access is prohibited.
        </p>
      </div>
    </div>);

}

function SideNavLink({ to, icon, label }: {to: string;icon: React.ReactNode;label: string;}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
      cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
        isActive ?
        "bg-sidebar-accent text-sidebar-accent-foreground" :
        "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )
      }>
      
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight size={14} className="opacity-40" />
    </NavLink>);

}

function MobileNavLink({ to, icon, label }: {to: string;icon: React.ReactNode;label: string;}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
      cn(
        "flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors cursor-pointer",
        isActive ? "text-primary" : "text-muted-foreground"
      )
      }>
      
      {icon}
      {label}
    </NavLink>);

}

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="*"
            element={
            <>
                <AuthLoading>
                  <div className="min-h-screen flex items-center justify-center bg-sidebar">
                    <div className="space-y-3 w-48">
                      <Skeleton className="h-4 w-full opacity-20" />
                      <Skeleton className="h-4 w-3/4 opacity-20" />
                      <Skeleton className="h-4 w-1/2 opacity-20" />
                    </div>
                  </div>
                </AuthLoading>
                <Unauthenticated>
                  <LoginPage />
                </Unauthenticated>
                <Authenticated>
                  <Routes>
                    <Route element={<AppLayout />}>
                      <Route path="/" element={<Index />} />
                      <Route path="/database" element={<DatabasePage />} />
                      <Route path="/processing" element={<ProcessingPage />} />
                      <Route path="/schedules" element={<SchedulesPage />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Authenticated>
              </>
            } />
          
        </Routes>
      </BrowserRouter>
    </DefaultProviders>);

}