import { useEffect, useState } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { sdk } from "@/lib/sdk";

const fieldClass = "flex flex-col gap-2 text-sm";
const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export function RoomAgentForm({
  canOperate,
  hasProject,
  submit,
}: {
  canOperate: boolean;
  hasProject: boolean;
  submit: (body: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [threads, setThreads] = useState<ThreadListEntry[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!canOperate || mode !== "existing") return;
    let active = true;
    void sdk.threads
      .list({ archived: false, hasParent: false, limit: 100 })
      .then((next) => {
        if (active) setThreads(next);
      })
      .catch((problem: Error) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, [canOperate, mode]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setPending(true);
        setError("");
        void submit(data)
          .catch((problem: Error) => setError(problem.message))
          .finally(() => setPending(false));
      }}
    >
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {canOperate && (
        <label className={fieldClass}>
          Agent conversation
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value === "existing" ? "existing" : "new")
            }
            className={selectClass}
          >
            <option value="new">Create an independent thread</option>
            <option value="existing">Invite an existing BB thread</option>
          </select>
        </label>
      )}
      <label className={fieldClass}>
        Name
        <Input name="name" required maxLength={80} />
      </label>
      <label className={fieldClass}>
        Handle
        <Input name="handle" required pattern="[a-z][a-z0-9_\-]{1,31}" />
      </label>
      {mode === "existing" ? (
        <label className={fieldClass}>
          BB thread
          <select
            required
            name="threadId"
            className={selectClass}
            defaultValue=""
          >
            <option value="" disabled>
              Choose a thread
            </option>
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title || thread.id}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className={fieldClass}>
            Provider
            <select
              name="provider"
              defaultValue="codex"
              className={selectClass}
            >
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
              <option value="pi">Pi</option>
            </select>
          </label>
          <label className={fieldClass}>
            Model
            <Input
              name="model"
              placeholder="Provider default"
              maxLength={100}
            />
          </label>
        </>
      )}
      <label className={fieldClass}>
        Instructions
        <Textarea
          name="instructions"
          maxLength={4000}
          placeholder="What perspective should this agent bring?"
        />
      </label>
      {mode === "new" && !hasProject && (
        <p className="text-sm text-muted-foreground">
          Choose the room’s project in Room controls before creating a new
          agent.
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || (mode === "new" && !hasProject)}
      >
        {pending ? "Adding agent…" : "Add agent"}
      </Button>
    </form>
  );
}
