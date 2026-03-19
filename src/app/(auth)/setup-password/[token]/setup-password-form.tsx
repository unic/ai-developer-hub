"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setupPasswordSchema } from "@/lib/validators";
import { setupPassword } from "@/actions/invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
      // Auto-sign in with the newly set password
      const signInResult = await signIn("credentials", {
        email: result.data?.email,
        password: data.password,
        redirect: false,
      });

      if (signInResult?.ok) {
        toast.success("Password set successfully. Redirecting...");
        router.push("/");
        router.refresh();
      } else {
        // Fallback: send to login page if auto-sign-in fails
        toast.success("Password set successfully. Please sign in.");
        router.push("/login");
      }
    } else {
      setError(result.error);
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
          <p className="text-sm text-muted-foreground">
            Welcome,{" "}
            <span className="font-semibold text-foreground">{userName}</span>
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  {...field}
                />
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
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Setting password...
            </>
          ) : (
            "Set Password"
          )}
        </Button>
      </form>
    </Form>
  );
}
