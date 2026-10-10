import { createContext, useContext } from "react";

export const NativeRoomsContext = createContext(false);
export function useNativeRoomsEnabled() {
  return useContext(NativeRoomsContext);
}
