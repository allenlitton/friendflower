"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";

const noSubscribe = () => () => {};

/** Hidden inside the iPhone app, where "get the app" messages make no sense. */
export function WebOnly({ children }: { children: ReactNode }) {
  const native = useSyncExternalStore(noSubscribe, () => Capacitor.isNativePlatform(), () => false);
  return native ? null : children;
}
