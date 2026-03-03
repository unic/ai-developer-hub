"use client";

import { useThemePreference } from "@/hooks/use-theme-preference";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function LeanModeToggle() {
  const { isLean, setLeanMode } = useThemePreference();

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="lean-mode"
        checked={isLean}
        onCheckedChange={setLeanMode}
        aria-label="Toggle lean mode"
      />
      <Label htmlFor="lean-mode" className="text-xs cursor-pointer">
        Lean
      </Label>
    </div>
  );
}
