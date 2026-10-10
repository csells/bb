import { useEffect, useState } from "react";
import type { Environment } from "@bb/domain";
import type {
  ProjectResponse,
  ThreadSectionResponse,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { sdk } from "@/lib/sdk";
import { appQueryClient } from "@/lib/app-query-client";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const fieldClass = "flex flex-col gap-2 text-sm";
export function RoomContextFields({
  projectId: initialProjectId = null,
  environmentId = null,
  sectionId = null,
}: {
  projectId?: string | null;
  environmentId?: string | null;
  sectionId?: string | null;
}) {
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [sections, setSections] = useState<ThreadSectionResponse[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [selectedEnvironment, setSelectedEnvironment] = useState(
    environmentId ?? "",
  );
  const [selectedSection, setSelectedSection] = useState(sectionId ?? "");
  const [creatingSection, setCreatingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setProjectId(initialProjectId ?? "");
    setSelectedEnvironment(environmentId ?? "");
    setSelectedSection(sectionId ?? "");
  }, [initialProjectId, environmentId, sectionId]);
  useEffect(() => {
    let active = true;
    void Promise.all([sdk.projects.list(), sdk.threadSections.list()])
      .then(([nextProjects, nextSections]) => {
        if (active) {
          setProjects(nextProjects);
          setSections(nextSections);
        }
      })
      .catch((problem: Error) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setEnvironments([]);
    if (!projectId) return;
    let active = true;
    void sdk.environments
      .list({ projectId })
      .then((next) => {
        if (active) setEnvironments(next);
      })
      .catch((problem: Error) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <label className={fieldClass}>
        Project
        <select
          className={selectClass}
          name="projectId"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setSelectedEnvironment("");
          }}
        >
          <option value="">No project yet</option>
          {projectId &&
            !projects.some((project) => project.id === projectId) && (
              <option value={projectId}>Current project</option>
            )}
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldClass}>
        Environment
        <select
          className={selectClass}
          name="defaultEnvironmentId"
          value={selectedEnvironment}
          onChange={(event) => setSelectedEnvironment(event.target.value)}
          disabled={!projectId}
        >
          <option value="">Project default</option>
          {selectedEnvironment &&
            !environments.some(
              (environment) => environment.id === selectedEnvironment,
            ) && (
              <option value={selectedEnvironment}>Current environment</option>
            )}
          {environments.map((environment) => (
            <option value={environment.id} key={environment.id}>
              {environment.name || environment.path || environment.id}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldClass}>
        Section
        <select
          className={selectClass}
          name="sectionId"
          value={selectedSection}
          onChange={(event) => setSelectedSection(event.target.value)}
        >
          <option value="">Unsectioned</option>
          {selectedSection &&
            !sections.some((section) => section.id === selectedSection) && (
              <option value={selectedSection}>Current section</option>
            )}
          {sections.map((section) => (
            <option value={section.id} key={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </label>
      {creatingSection ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label="New section name"
            value={sectionName}
            onChange={(event) => setSectionName(event.target.value)}
            placeholder="Section name"
          />
          <Button
            type="button"
            disabled={!sectionName.trim()}
            onClick={() => {
              void sdk.threadSections
                .create({ name: sectionName.trim() })
                .then((section) => {
                  setSections((current) => [...current, section]);
                  setSelectedSection(section.id);
                  setCreatingSection(false);
                  setSectionName("");
                  void appQueryClient.invalidateQueries({
                    queryKey: sidebarNavigationQueryKey(),
                  });
                })
                .catch((problem: Error) => setError(problem.message));
            }}
          >
            Add section
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setCreatingSection(true)}
        >
          New section
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        New agents use this project and environment. Existing threads keep their
        own work context. Sections are the same sections used by BB’s thread
        sidebar.
      </p>
    </div>
  );
}
export function readRoomContext(data: FormData) {
  return {
    projectId: String(data.get("projectId") ?? "") || null,
    defaultEnvironmentId:
      String(data.get("defaultEnvironmentId") ?? "") || null,
    sectionId: String(data.get("sectionId") ?? "") || null,
  };
}
