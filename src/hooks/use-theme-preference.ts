"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { updatePreferences } from "@/actions/preferences";

export function useThemePreference() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { data: session, update } = useSession();
  const [isPending, startTransition] = useTransition();
  const [isSavingLocal, setIsSavingLocal] = useState(false);

  const isSaving = isPending || isSavingLocal;
  const isAuthenticated = !!session?.user;

  const [hasSynced, setHasSynced] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setHasSynced(false);
      return;
    }
    if (session?.user?.preferences && !hasSynced) {
      const prefs = session.user.preferences;
      setTheme(prefs.theme);
      setHasSynced(true);
    }
  }, [isAuthenticated, session?.user?.preferences, hasSynced, setTheme]);

  const persistPreferences = useCallback(
    async (newTheme: string) => {
      if (!isAuthenticated) return;
      setIsSavingLocal(true);
      try {
        const result = await updatePreferences({
          theme: newTheme as "light" | "dark" | "system",
        });
        if (!result.success) {
          throw new Error("Failed to persist preferences");
        }
        await update({ preferences: result.data });
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
          await persistPreferences(value);
        } catch {
          setTheme(prevTheme);
        }
      });
    },
    [theme, setTheme, persistPreferences]
  );

  return {
    theme: theme ?? "system",
    resolvedTheme: resolvedTheme ?? "light",
    setTheme: setThemeWithPersist,
    isSaving,
  };
}
