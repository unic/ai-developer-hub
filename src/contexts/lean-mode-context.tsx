"use client";

import { createContext, useCallback, useEffect, useState } from "react";

export interface LeanModeContextValue {
  isLean: boolean;
  setLeanMode: (value: boolean) => void;
}

export const LeanModeContext = createContext<LeanModeContextValue | undefined>(
  undefined
);

export function LeanModeProvider({ children }: { children: React.ReactNode }) {
  const [isLean, setIsLean] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("lean-mode");
    const leanValue = stored === "true";
    setIsLean(leanValue);

    if (!leanValue) {
      document.documentElement.setAttribute("data-retro", "");
    } else {
      document.documentElement.removeAttribute("data-retro");
    }
  }, []);

  const setLeanMode = useCallback((value: boolean) => {
    setIsLean(value);
    localStorage.setItem("lean-mode", String(value));

    if (!value) {
      document.documentElement.setAttribute("data-retro", "");
    } else {
      document.documentElement.removeAttribute("data-retro");
    }
  }, []);

  return (
    <LeanModeContext value={{ isLean, setLeanMode }}>
      {children}
    </LeanModeContext>
  );
}
