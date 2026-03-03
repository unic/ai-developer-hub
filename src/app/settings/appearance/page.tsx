"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useThemePreference } from "@/hooks/use-theme-preference";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function AppearancePage() {
  const { theme, resolvedTheme, setTheme, isLean, setLeanMode, isSaving } =
    useThemePreference();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold retro:neon-glow-green">Appearance</h1>
        <p className="text-muted-foreground">
          Customize the look and feel of the application.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>
              Select your preferred color scheme.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={theme === option.value ? "default" : "outline"}
                  className="flex flex-col gap-2 h-auto py-4"
                  onClick={() => setTheme(option.value)}
                  disabled={isSaving}
                >
                  <option.icon className="size-5" />
                  <span className="text-xs">{option.label}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Visual Effects</CardTitle>
            <CardDescription>
              Toggle the retro-glitch aesthetic on or off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="lean-mode-setting">Lean Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Removes scanlines, noise, and glitch effects.
                </p>
              </div>
              <Switch
                id="lean-mode-setting"
                checked={isLean}
                onCheckedChange={setLeanMode}
                disabled={isSaving}
                aria-label="Toggle lean mode"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Current: {resolvedTheme === "dark" ? "Dark" : "Light"} theme
              {isLean ? " + Lean mode" : " + Retro effects"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 retro:border-glitch retro:scanlines">
                <p className="text-sm font-medium retro:neon-glow-green">
                  Sample Card
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This shows how content looks with current settings.
                </p>
                <span className="mt-2 inline-block rounded-md bg-secondary px-2 py-1 text-xs retro:badge-retro retro:text-phosphor-cyan">
                  Badge
                </span>
              </div>
              <div className="rounded-lg border p-4 retro:border-glitch retro:noise-static">
                <p className="text-sm font-medium retro:neon-glow-cyan">
                  Another Card
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Effects are {isLean ? "hidden" : "visible"} based on lean mode.
                </p>
                <span className="mt-2 inline-block rounded-md bg-primary text-primary-foreground px-2 py-1 text-xs retro:badge-retro">
                  Active
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isSaving && (
        <p className="text-sm text-muted-foreground">Saving preferences...</p>
      )}
    </div>
  );
}
