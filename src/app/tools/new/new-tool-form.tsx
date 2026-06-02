"use client";

import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createTool, createTier } from "@/actions/tools";
import { toolSchema } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
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
} from "@/components/ui/form";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { Plus, Trash2 } from "lucide-react";

const newToolSchema = toolSchema.extend({
  tiers: z
    .array(
      z.object({
        name: z.string().min(1, "Tier name is required"),
        description: z.string().optional(),
        monthlyCostDollars: z.number().min(0, "Cost must be non-negative"),
      })
    )
    .min(1, "At least one tier is required"),
});

type NewToolInput = z.infer<typeof newToolSchema>;

export function NewToolForm() {
  const router = useRouter();
  const status = useInlineStatus();

  const form = useForm<NewToolInput>({
    resolver: zodResolver(newToolSchema),
    defaultValues: {
      name: "",
      vendor: "",
      description: "",
      tiers: [{ name: "", description: "", monthlyCostDollars: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tiers",
  });

  async function onSubmit(data: NewToolInput) {
    const toolResult = await createTool({
      name: data.name,
      vendor: data.vendor,
      description: data.description,
      maxLicenses: data.maxLicenses,
    });

    if (!toolResult.success) {
      status.error(toolResult.error);
      return;
    }

    // Create tiers
    for (const tier of data.tiers) {
      const tierResult = await createTier({
        toolId: toolResult.data.id,
        name: tier.name,
        description: tier.description,
        monthlyCostCents: Math.round(tier.monthlyCostDollars * 100),
      });

      if (!tierResult.success) {
        status.error(`Tier "${tier.name}" failed`);
      }
    }

    router.push("/tools");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-ink">Add New Tool</h1>
        <p className="text-muted-foreground">
          Register a new AI tool with pricing tiers
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tool Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="GitHub Copilot" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vendor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor</FormLabel>
                    <FormControl>
                      <Input placeholder="GitHub" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="AI-powered code completion..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxLicenses"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Licenses (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Unlimited"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Access Tiers</CardTitle>
              <CardDescription>
                Define pricing tiers for this tool
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Tier {index + 1}
                    </span>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name={`tiers.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tier Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Pro" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`tiers.${index}.monthlyCostDollars`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Monthly Cost ($)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="19.00"
                              {...field}
                              onChange={(e) =>
                                field.onChange(e.target.valueAsNumber)
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name={`tiers.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Full IDE integration..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  append({ name: "", description: "", monthlyCostDollars: 0 })
                }
              >
                <Plus className="mr-2 size-4" />
                Add Tier
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Creating..." : "Create Tool"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/tools")}
            >
              Cancel
            </Button>
            <StatusText status={status.status} />
          </div>
        </form>
      </Form>
    </div>
  );
}
