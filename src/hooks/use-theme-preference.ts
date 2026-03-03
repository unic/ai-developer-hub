"use client";

import { useCallback, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useLeanMode } from "@/hooks/use-lean-mode";
import { updatePreferences } from "@/actions/preferences";

export function useThemePreference() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { isLean, setLeanMode } = useLeanMode();
  const { data: session, update } = useSession();
  const [isPending, startTransition] = useTransition();
  const [isSavingLocal, setIsSavingLocal] = useState(false);

  const isSaving = isPending || isSavingLocal;
  const isAuthenticated = !!session?.user;

  const persistPreferences = useCallback(
    async (newTheme: string, newLeanMode: boolean) => {
      if (!isAuthenticated) return;
      setIsSavingLocal(true);
      try {
        const result = await updatePreferences({
          theme: newTheme as "light" | "dark" | "system",
          leanMode: newLeanMode,
        });
        if (result.success) {
          await update({ preferences: result.data });
        }
      } finally {
        setIsSavingLocal(false);
      }
    },
    [isAuthenticated, update]
  );

  const setThemeWithPersist = useCallback(
    (value: string) => {
      const prevTheme = theme ?? "system";
      setTheme(value);
      startTransition(async () => {
        try {
          await persistPreferences(value, isLean);
        } catch {
          setTheme(prevTheme);
        }
      });
    },
    [theme, isLean, setTheme, persistPreferences]
  );

  const setLeanModeWithPersist = useCallback(
    (value: boolean) => {
      const prevLean = isLean;
      setLeanMode(value);
      startTransition(async () => {
        try {
          await persistPreferences(theme ?? "system", value);
        } catch {
          setLeanMode(prevLean);
        }
      });
    },
    [theme, isLean, setLeanMode, persistPreferences]
  );

  return {
    theme: theme ?? "system",
    resolvedTheme: resolvedTheme ?? "light",
    setTheme: setThemeWithPersist,
    isLean,
    setLeanMode: setLeanModeWithPersist,
    isSaving,
  };
}
