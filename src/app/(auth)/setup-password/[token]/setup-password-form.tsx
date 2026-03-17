"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { setupPasswordSchema } from "@/lib/validators";
import { setupPassword } from "@/actions/invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

interface SetupPasswordFormProps {
  token: string;
  userName: string;
}

export function SetupPasswordForm({ token, userName }: SetupPasswordFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(setupPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  async function onSubmit(data: {
    token: string;
    password: string;
    confirmPassword: string;
  }) {
    setError(null);
    const result = await setupPassword({
      token: data.token,
      password: data.password,
      confirmPassword: data.confirmPassword,
    });

    if (result.success) {
      toast.success("Password set successfully. You can now sign in.");
      router.push("/login");
    } else {
      setError(result.error);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Welcome, <span className="font-medium text-foreground">{userName}</span>! Please set your password.
        </p>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Setting password..." : "Set Password"}
        </Button>
      </form>
    </Form>
  );
}
