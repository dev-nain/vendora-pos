import { useRef, useState, type FormEvent } from "react";

import { categoryNameSchema, type Category } from "@shared/categories";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

interface CategoryNameDialogProps {
  category: Category | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

function CategoryNameForm({
  category,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<CategoryNameDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const focusName = () => requestAnimationFrame(() => input.current?.focus());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a name");
      setServiceError(null);
      focusName();
      return;
    }

    setFieldError(null);
    setServiceError(null);
    setPending(true);
    try {
      const result = category
        ? await window.vendora.categories.rename(category.id, parsed.data)
        : await window.vendora.categories.create(parsed.data);
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if (result.reason === "not-found") onSaved();
      else focusName();
      setServiceError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{category ? `Rename ${category.name}` : "Add category"}</DialogTitle>
        <DialogDescription>
          {category
            ? "Products keep this category under its new name."
            : "Group products together."}
        </DialogDescription>
        <Field invalid={fieldError !== null}>
          <FieldLabel>Name</FieldLabel>
          <Input
            ref={input}
            autoFocus
            autoComplete="off"
            maxLength={64}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldError ? <FieldError>{fieldError}</FieldError> : null}
        </Field>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : category ? "Save" : "Add category"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CategoryNameDialog({ open, onOpenChange, ...rest }: CategoryNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CategoryNameForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
