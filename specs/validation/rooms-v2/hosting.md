# Staging longevity checkpoint — 2026-10-09

The current preview is independent of the agent's active tool call or turn. Read-only host inspection found the Rooms Tart process (PID92335) reparented to launchd (`PPID=1`) with its own process group (`PGID=92335`), still running 28 minutes after the launcher returned. The registered launcher uses a detached session. Ending the coding turn does not own or terminate this process group.

The application services have persistent launchd supervision:

| Where | Label | Verified settings |
| --- | --- | --- |
| Disposable VM | `bb.rooms.core` | `RunAtLoad=true`, `KeepAlive=true`, `ThrottleInterval=10` |
| Disposable VM | `bb.rooms.gateway` | Same |
| Disposable VM | `bb.rooms.tunnel` | Same |
| Host, relay only | `app.bb.rooms.preview.relay` | Same; SSH local51992 forwards VM38900 with `ExitOnForwardFailure` and15s keepalive |
| Host, claim redirect only | `app.bb.rooms.preview.claim` | Same; loopback51989 returns owner-claim redirect |

The VM services demonstrably returned after the serial Safari verification: core health reported ready, the host daemon was running, the Rooms gateway returned healthy, and the replacement public HTTPS endpoint returned200. A subsequent read-only relay check returned `{"ok":true,"service":"bb-rooms"}` on local51992 and302 on the claim endpoint, without following or exposing its invitation URL.

## Limits of this checkpoint

The Tart VM itself is a detached long-lived process, not yet a launchd-supervised restart job. A VM crash is different from ending this agent turn. The current quick-tunnel hostname also changes when its tunnel process is recreated: the owner-claim relay and gateway's permitted public origin must be updated together. This checkpoint establishes turn-independent service lifetime; it does not claim unattended recovery from VM failure or host reboot. No VM, core or gateway restart was performed during this inspection because native provider acceptance was active.

The host relays contain no candidate agent runtime. Candidate application execution and all private application data remain inside the disposable VM. Host login/reboot recovery and stable services were not changed.
