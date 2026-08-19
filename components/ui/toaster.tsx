"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme as "light" | "dark" | "system"}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Move the dismiss button from Sonner's LTR default (top-left) to the top-right corner by
          // setting Sonner's own close-button CSS variables (the values it uses for RTL) — no
          // !important overrides needed since these live on the close button that reads them.
          closeButton:
            "[--toast-close-button-start:unset] [--toast-close-button-end:0] [--toast-close-button-transform:translate(35%,-35%)]",
        },
      }}
    />
  );
}
