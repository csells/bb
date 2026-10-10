import {
  experimental_useSidebarThreads,
  type PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { getSidebarThreadRowPaddingLeft } from "../rows/sidebarRowClasses.js";

type Room = NonNullable<
  PluginSidebarThreadsState["experimental_rooms"]
>["items"][number];
type Scope =
  | { kind: "section" | "project"; id: string }
  | { kind: "loose" | "none" };

export function useSidebarRooms(scope: Scope) {
  const state = experimental_useSidebarThreads().experimental_rooms;
  if (state?.status !== "ready" || scope.kind === "none") return [];
  return state.items.filter((room) =>
    scope.kind === "section"
      ? room.sectionId === scope.id
      : scope.kind === "project"
        ? room.projectId === scope.id
        : room.sectionId === null,
  );
}

export function SidebarRoomRows({
  rooms,
  depth,
  onSelect,
}: {
  rooms: readonly Room[];
  depth: number;
  onSelect?: () => void;
}) {
  return rooms.map((room) => (
    <a
      key={room.id}
      data-sidebar-room={room.id}
      href={room.href}
      aria-label={`${room.name} Room`}
      onClick={onSelect}
      className="flex h-7 items-center gap-2 rounded-md pr-2 text-sm text-sidebar-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9"
      style={{ paddingLeft: getSidebarThreadRowPaddingLeft(depth) }}
    >
      <Icon
        name="MessageSquare"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{room.name}</span>
      <span className="ml-auto text-xs text-muted-foreground">Room</span>
    </a>
  ));
}
