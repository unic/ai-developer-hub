import { Briefcase, Code2, Lightbulb } from "lucide-react";
import type { UserDiscipline } from "@/types";

export const DISCIPLINES: readonly UserDiscipline[] = [
  "developer",
  "conception",
  "business",
] as const;

export const DISCIPLINE_LABEL: Record<UserDiscipline, string> = {
  developer: "Developer",
  conception: "Conception",
  business: "Business",
};

export const DISCIPLINE_ICON = {
  developer: Code2,
  conception: Lightbulb,
  business: Briefcase,
} as const;

export const DEFAULT_DISCIPLINE: UserDiscipline = "developer";

export function isDiscipline(value: unknown): value is UserDiscipline {
  return (
    typeof value === "string" &&
    (DISCIPLINES as readonly string[]).includes(value)
  );
}

/** Defensive narrowing for rendering paths — falls back to DEFAULT_DISCIPLINE
 *  when the value is unrecognized (e.g. a future enum value reached the DB
 *  before this client bundle was updated). */
export function asDiscipline(value: unknown): UserDiscipline {
  return isDiscipline(value) ? value : DEFAULT_DISCIPLINE;
}
