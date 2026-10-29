import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay transition-opacity duration-[var(--duration-300)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

// Runs on attach, before focus moves into the dialog, so activeElement is still the trigger.
function growFromTrigger(popup: HTMLDivElement | null) {
  const trigger = document.activeElement;
  if (!popup || !(trigger instanceof HTMLElement) || trigger === document.body) return;
  if (popup.contains(trigger)) return;
  const from = trigger.getBoundingClientRect();
  const to = popup.getBoundingClientRect();
  const x = from.left + from.width / 2 - to.left;
  const y = from.top + from.height / 2 - to.top;
  popup.style.transformOrigin = `${x}px ${y}px`;
}

function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={growFromTrigger}
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-400 border border-line-card bg-surface text-foreground shadow-300 outline-none transition-[opacity,scale] duration-[var(--duration-300)] ease-spring data-ending-style:scale-[var(--scale-enter)] data-ending-style:opacity-0 data-starting-style:scale-[var(--scale-enter)] data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          aria-label="Close"
          title="Close"
          render={
            <Button
              variant="ghost"
              className="absolute top-300 right-300 size-[var(--height-control-md)] rounded-full bg-fill-neutral-secondary px-0 hover:bg-surface-active"
            />
          }
        >
          <XIcon aria-hidden="true" size={18} strokeWidth={2} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("grid gap-400 p-600", className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex justify-end gap-300 rounded-b-400 border-t border-line bg-surface-secondary px-600 py-400",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "m-0 pr-1000 text-[length:var(--font-size-550)] leading-[var(--line-height-tight)] font-bold tracking-[var(--letter-spacing-heading)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("m-0 text-[length:var(--font-size-350)] text-secondary", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
