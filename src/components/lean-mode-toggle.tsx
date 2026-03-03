"use client";

import { useLeanMode } from "@/hooks/use-lean-mode";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function LeanModeToggle() {
  const { isLean, setLeanMode } = useLeanMode();

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
