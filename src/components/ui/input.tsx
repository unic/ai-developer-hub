import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 font-mono text-base text-foreground transition-[color,box-shadow] outline-none selection:bg-destructive selection:text-white file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-mono file:text-sm file:text-foreground placeholder:text-faint placeholder:tracking-normal disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 md:text-sm",
        "focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/15",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
