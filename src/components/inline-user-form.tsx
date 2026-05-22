"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  inlineUserCreationSchema,
  type InlineUserCreationInput,
} from "@/lib/validators";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DISCIPLINES, DISCIPLINE_LABEL } from "@/lib/disciplines";

interface InlineUserFormProps {
  defaultName: string;
  defaultEmail: string;
  githubLogin: string;
  onSubmit: (data: InlineUserCreationInput) => void;
  onCancel: () => void;
}

export function InlineUserForm({
  defaultName,
  defaultEmail,
  githubLogin,
  onSubmit,
  onCancel,
}: InlineUserFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<InlineUserCreationInput>({
    resolver: zodResolver(inlineUserCreationSchema),
    // defaultValues is a DeepPartial<InlineUserCreationInput>, so omitting
    // discipline is type-safe; the zodResolver still requires it on submit.
    defaultValues: {
      githubLogin,
      name: defaultName,
      email: defaultEmail,
    },
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
    >
      <input type="hidden" {...register("githubLogin")} />

      <div className="text-xs text-muted-foreground">
        GitHub: <span className="font-medium text-foreground">{githubLogin}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`name-${githubLogin}`} className="text-xs">
            Name
          </Label>
          <Input
            id={`name-${githubLogin}`}
            {...register("name")}
            className="h-8 text-sm"
            placeholder="Full name"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`email-${githubLogin}`} className="text-xs">
            Email
          </Label>
          <Input
            id={`email-${githubLogin}`}
            type="email"
            {...register("email")}
            className="h-8 text-sm"
            placeholder="user@example.com"
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`discipline-${githubLogin}`} className="text-xs">
          Discipline
        </Label>
        <Controller
          control={control}
          name="discipline"
          render={({ field }) => (
            <Select
              onValueChange={field.onChange}
              value={field.value ?? ""}
            >
              <SelectTrigger
                id={`discipline-${githubLogin}`}
                className="h-8 text-sm"
              >
                <SelectValue placeholder="Select a discipline" />
              </SelectTrigger>
              <SelectContent>
                {DISCIPLINES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DISCIPLINE_LABEL[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.discipline && (
          <p className="text-xs text-destructive">{errors.discipline.message}</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" className="h-7 text-xs">
          Create User
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
