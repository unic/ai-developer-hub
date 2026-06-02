import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-faint focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
