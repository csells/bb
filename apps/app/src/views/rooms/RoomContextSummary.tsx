import { useEffect, useState } from "react";
import type { RoomsRoom } from "@bb/domain";
import { sdk } from "@/lib/sdk";

export function RoomContextSummary({ room }: { room: RoomsRoom }) {
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      room.projectId ? sdk.projects.get({ projectId: room.projectId }) : null,
      room.sectionId ? sdk.threadSections.list() : null,
      room.defaultEnvironmentId
        ? sdk.environments.get({ environmentId: room.defaultEnvironmentId })
        : null,
    ])
      .then(([project, sections, environment]) => {
        if (!active) return;
        const section = sections?.find((item) => item.id === room.sectionId);
        setLabels(
          [
            project?.name,
            environment?.name ?? environment?.path,
            section?.name ? `Section: ${section.name}` : null,
          ].filter((label): label is string => Boolean(label)),
        );
        setError("");
      })
      .catch((problem: Error) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, [room.projectId, room.sectionId, room.defaultEnvironmentId]);
  return (
    <span className="text-xs text-muted-foreground">
      {error
        ? `Context unavailable: ${error}`
        : labels.join(" · ") || "No project or section assigned"}
    </span>
  );
}
