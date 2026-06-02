"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createBudget } from "@/actions/budget";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const newBudgetSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  totalAmountDollars: z.number().positive("Budget must be positive"),
  periodType: z.enum(["monthly", "quarterly"]),
});

type NewBudgetInput = z.infer<typeof newBudgetSchema>;

export function NewBudgetForm() {
  const router = useRouter();
  const status = useInlineStatus();
  const currentYear = new Date().getFullYear();

  const form = useForm<NewBudgetInput>({
    resolver: zodResolver(newBudgetSchema),
    defaultValues: {
      fiscalYear: currentYear,
      totalAmountDollars: 0,
      periodType: "monthly",
    },
  });

  async function onSubmit(data: NewBudgetInput) {
    const result = await createBudget({
      fiscalYear: data.fiscalYear,
      totalAmountCents: Math.round(data.totalAmountDollars * 100),
      periodType: data.periodType,
    });

    if (result.success) {
      router.push(`/budget/${result.data.id}`);
    } else {
      status.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-ink">Create Annual Budget</h1>
        <p className="text-muted-foreground">
          Set up a new fiscal year budget for AI tools
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Budget Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fiscalYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fiscal Year</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalAmountDollars"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Budget ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="50000.00"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>
                      Annual budget total in dollars
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="periodType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="monthly">
                          Monthly (12 periods)
                        </SelectItem>
                        <SelectItem value="quarterly">
                          Quarterly (4 periods)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? "Creating..."
                    : "Create Budget"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/budget")}
                >
                  Cancel
                </Button>
                <StatusText status={status.status} />
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
