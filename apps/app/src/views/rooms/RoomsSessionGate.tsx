import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { z } from "zod";
import { roomsUserSchema } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { wsManager } from "@/lib/ws";
import { appQueryClient } from "@/lib/app-query-client";
import { NativeRoomsContext } from "@/lib/native-rooms-context";
import { roomsRequest } from "./rooms-api";

const RoomsView = lazy(() =>
  import("./RoomsView").then((module) => ({ default: module.RoomsView })),
);

const nativeSessionSchema = z.object({
  enabled: z.literal(true),
  user: roomsUserSchema.nullable(),
  access: z.object({ operator: z.boolean() }),
});
type Session = z.infer<typeof nativeSessionSchema>;
const invitation =
  new URLSearchParams(location.hash.slice(1)).get("invite") ?? "";
if (invitation)
  history.replaceState(null, "", location.pathname + location.search);

export function RoomsSessionGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [native, setNative] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(Boolean(invitation));
  const [busy, setBusy] = useState(false);
  const [invitePending, setInvitePending] = useState(Boolean(invitation));
  const identity = useRef<string | null | undefined>(undefined);
  const acceptSession = useCallback((next: Session | null) => {
    const nextIdentity = next?.user
      ? `${next.user.id}:${next.access.operator ? "operator" : "guest"}`
      : null;
    if (identity.current !== nextIdentity) {
      wsManager.disconnect();
      appQueryClient.clear();
      identity.current = nextIdentity;
    }
    setSession(next);
  }, []);
  useEffect(
    () => () => {
      if (identity.current !== undefined) {
        wsManager.disconnect();
        appQueryClient.clear();
      }
    },
    [],
  );

  async function refresh() {
    const response = await fetch("/api/v1/rooms/session", {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404 && native !== true) {
      setNative(false);
      return;
    }
    if (!response.ok) throw new Error(`Unable to open BB (${response.status})`);
    const next = nativeSessionSchema.parse(await response.json());
    if (next.user && invitePending) {
      await roomsRequest("/join", { invite: invitation });
      setInvitePending(false);
    }
    acceptSession(next);
    setError("");
    setNative(true);
  }
  useEffect(() => {
    void refresh().catch((problem: Error) => setError(problem.message));
  }, []);
  useEffect(() => {
    if (!native || !session?.user) return;
    let active = true;
    const timer = setInterval(() => {
      void fetch("/api/v1/rooms/session")
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Unable to verify your session (${response.status}). Reconnect before continuing.`,
            );
          const next = nativeSessionSchema.parse(await response.json());
          if (active) acceptSession(next);
        })
        .catch((problem: Error) => {
          if (active) {
            acceptSession(null);
            setError(problem.message);
          }
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [native, session?.user?.id, acceptSession]);
  if (native === false) return children;
  if (session?.user && session.access.operator)
    return (
      <NativeRoomsContext.Provider
        key={`${session.user.id}:operator`}
        value={true}
      >
        {children}
      </NativeRoomsContext.Provider>
    );
  if (session?.user)
    return (
      <NativeRoomsContext.Provider
        key={`${session.user.id}:guest`}
        value={true}
      >
        <TooltipProvider>
          <SidebarProvider open={false} onOpenChange={() => {}}>
            <div className="flex h-dvh w-full min-w-0 flex-col bg-background p-4 text-foreground md:p-5">
              <Suspense fallback={<div role="status">Opening rooms…</div>}>
                <Routes>
                  <Route path="/rooms" element={<RoomsView />} />
                  <Route path="/rooms/:roomId" element={<RoomsView />} />
                  <Route path="*" element={<Navigate to="/rooms" replace />} />
                </Routes>
              </Suspense>
            </div>
          </SidebarProvider>
        </TooltipProvider>
      </NativeRoomsContext.Provider>
    );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-sm font-semibold">BB</p>
          <h1 className="mt-3 text-2xl font-semibold">
            {native === null
              ? "Opening BB…"
              : registering
                ? "Join the room"
                : "Sign in to BB"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {registering
              ? "Create your identity to join this shared conversation."
              : "Your account determines which rooms and BB tools you can access."}
          </p>
        </div>
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm">
              {error}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                void refresh().catch((problem: Error) =>
                  setError(problem.message),
                )
              }
            >
              Check connection
            </Button>
          </div>
        )}
        {native === null ? (
          <Button
            onClick={() =>
              void refresh().catch((problem: Error) =>
                setError(problem.message),
              )
            }
          >
            Try again
          </Button>
        ) : (
          <>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const fields = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
                setBusy(true);
                setError("");
                void (async () => {
                  try {
                    await roomsRequest(
                      registering ? "/auth/register" : "/auth/login",
                      registering ? { ...fields, invite: invitation } : fields,
                    );
                    if (registering) setInvitePending(false);
                    const response = await fetch("/api/v1/rooms/session");
                    if (!response.ok)
                      throw new Error("Sign-in could not be confirmed");
                    const next = nativeSessionSchema.parse(
                      await response.json(),
                    );
                    if (!registering && invitePending)
                      await roomsRequest("/join", { invite: invitation });
                    setInvitePending(false);
                    acceptSession(next);
                  } catch (problem) {
                    setError(
                      problem instanceof Error
                        ? problem.message
                        : String(problem),
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {registering && (
                <label className="flex flex-col gap-2 text-sm">
                  Your name
                  <Input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                  />
                </label>
              )}
              <label className="flex flex-col gap-2 text-sm">
                Handle
                <Input
                  name="handle"
                  autoComplete="username"
                  pattern="[a-z][a-z0-9_\-]{1,31}"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Password
                <Input
                  name="password"
                  type="password"
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                  minLength={registering ? 12 : undefined}
                  maxLength={128}
                  required
                />
              </label>
              <Button className="w-full" type="submit" disabled={busy}>
                {busy
                  ? "Signing in…"
                  : registering
                    ? "Create account"
                    : "Sign in"}
              </Button>
            </form>
            {invitation && (
              <Button
                variant="ghost"
                onClick={() => setRegistering(!registering)}
              >
                {registering
                  ? "Already have an account? Sign in"
                  : "Create an account"}
              </Button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
