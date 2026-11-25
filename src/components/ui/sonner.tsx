"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck, CircleInfo, TriangleExclamation, CircleXmark, ArrowsRotateRight } from "@gravity-ui/icons"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      offset={{ bottom: "3.5rem" }} // 留出狀態列（min-h-9）的高度，不蓋住進度條
      mobileOffset={{ bottom: "3.5rem" }}
      className="toaster group"
      icons={{
        success: (
          <CircleCheck className="size-4" />
        ),
        info: (
          <CircleInfo className="size-4" />
        ),
        warning: (
          <TriangleExclamation className="size-4" />
        ),
        error: (
          <CircleXmark className="size-4" />
        ),
        loading: (
          <ArrowsRotateRight className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
