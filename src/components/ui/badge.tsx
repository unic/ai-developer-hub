import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Nothing tags: border-only (never filled), Space Mono ALL CAPS, pill. The core
// inversion fill→border. `default` reads as the strong/active tag (ink border).
// Status variants (success/warning) color the border + text only. Destructive
// uses the shared --destructive red. Add a `<span className="led" />`-style dot
// in consumers when a status LED is wanted.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border bg-transparent px-3 py-0.5 font-mono text-[11px] tracking-[0.06em] uppercase whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-ink text-ink",
        secondary: "border-input text-muted-foreground",
        destructive: "border-destructive text-destructive",
        outline: "border-input text-foreground",
        ghost: "border-transparent text-muted-foreground",
        link: "border-transparent text-foreground underline-offset-4 [a&]:hover:underline",
        success: "border-success text-success",
        warning: "border-warning text-warning",
        active: "border-ink text-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
