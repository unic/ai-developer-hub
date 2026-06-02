"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-input !shadow-none !font-mono !text-xs",
          title: "!font-mono !text-xs !tracking-wide",
          description: "!text-muted-foreground",
        },
      }}
      style={
        {
          // Flat Nothing toast — transitional fallback while toast.* call sites
          // migrate to inline <StatusText>. Monochrome surface, status color on
          // text only, no shadow.
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--input)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--success)",
          "--success-border": "var(--input)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive)",
          "--error-border": "var(--destructive)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--input)",
          "--border-radius": "8px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
