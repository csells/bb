# Failed attempts in conversation history

Failure cards now appear immediately after the public request that caused them. Later messages and successful replies remain below that point in conversation history. The failed attempt is retained when a later attempt succeeds, and its draft preparation and owner Activity controls remain available when scrolling back.

Cards are rendered only for requests in the currently loaded message history. This prevents orphaned failures from appearing at the end of a bounded snapshot. Active queued/running/uncertain status cards remain in the separate active-work area.

The existing rendered browser fixture now adds 12 subsequent messages and a successful delivery, then verifies actual screen positions, scrolling, retained controls, and loaded-history removal/restoration. The pre-fix artifact failed because the error card remained below newer messages; see `history-ui-red/test.log`. This is a presentation test using synthetic HTTP snapshots, not a provider execution test.

Composer hints also explain that everyone follows the conversation and that mentions request a response. Actual ambient-delivery behavior is verified separately by the parent task.

Final compiled-client verification passed **15 browser groups in Chromium and 15 in WebKit**. The parent’s combined build/typecheck and 28 Rooms tests passed before these checks. `history-ui-final-*` contains browser logs and screenshots; `client-sha256.txt` identifies the tested client assets. The task-owned static server on loopback38902 was stopped afterward. This subtask did not restart the public gateway or change user messages.

## Final public Workshop check

After the subsequent backend build/typecheck and 30-test pass, the compiled client hashes still matched this UI proof. A fresh VM Chromium context then signed into the actual public Workshop as Chris. The read-only check passed: the old Nova failure is directly after its original request, newer Atlas/Nova messages follow it, and it is outside the viewport at the latest conversation. The latest screenshot includes Atlas’s reply to Nova’s room question.

See `live-workshop/` for the inspectable browser harness, five assertion groups plus cleanup, and both screenshots. The harness blocked room mutations, left the composer empty, signed out with an API401 check, closed its browser, and removed the exact temporary credential fixture. It sent no messages and made no provider calls.
