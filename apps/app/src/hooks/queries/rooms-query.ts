import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { NativeRoomsContext } from "@/lib/native-rooms-context";
import { loadRoomsSession } from "@/views/rooms/rooms-api";

export const roomsIndexQueryKey = ["rooms", "index"] as const;

export function useRoomsIndex() {
  const enabled = useContext(NativeRoomsContext);
  return useQuery({
    queryKey: roomsIndexQueryKey,
    queryFn: loadRoomsSession,
    enabled,
    staleTime: 1000,
    refetchInterval: enabled ? 5000 : false,
    retry: false,
  });
}
