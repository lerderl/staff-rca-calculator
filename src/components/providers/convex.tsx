import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";

// The backend always runs on the same machine that serves this page, so reach
// it through whatever host the browser used: localhost on the host machine,
// the LAN IP from other machines. VITE_CONVEX_URL is deliberately ignored —
// `npx convex dev` pins it to 127.0.0.1, which other machines can't reach.
const convexUrl = `${window.location.protocol}//${window.location.hostname}:3210`;
const convex = new ConvexReactClient(convexUrl);

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
