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

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function AppearancePage() {
  const { theme, setTheme, isSaving } = useThemePreference();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Appearance</h1>
        <p className="text-muted-foreground">
          Customize the look and feel of the application.
        </p>
      </div>

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

    </div>
  );
}
