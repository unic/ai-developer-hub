import { useContext } from "react";
import { LeanModeContext } from "@/contexts/lean-mode-context";

export function useLeanMode() {
  const context = useContext(LeanModeContext);
  if (!context) {
    throw new Error("useLeanMode must be used within a LeanModeProvider");
  }
  return context;
}
