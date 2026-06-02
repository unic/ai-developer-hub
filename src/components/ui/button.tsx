import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Nothing buttons: pill, Space Mono, ALL CAPS, flat (no shadow). Primary is a
// GREYSCALE fill (white/black), never the red. Destructive is an outline in the
// shared --destructive red. Secondary/outline collapse onto one bordered variant.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-mono text-[13px] font-normal tracking-[0.06em] uppercase whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "border border-destructive bg-transparent text-destructive hover:bg-destructive-subtle",
        outline:
          "border border-input bg-transparent text-foreground hover:border-foreground",
        secondary:
          "border border-input bg-transparent text-foreground hover:border-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        link: "font-sans text-[14px] tracking-normal normal-case text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 has-[>svg]:px-5",
        xs: "h-8 gap-1.5 px-4 text-[11px] has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 gap-1.5 px-4 text-[11px] has-[>svg]:px-3",
        lg: "h-11 px-8 has-[>svg]:px-6",
        icon: "size-11",
        "icon-xs": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
