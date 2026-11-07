import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { Supplier } from "@shared/suppliers";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input, controlClasses } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { DiscardChangesDialog } from "../products/discard-changes-dialog";
import { ErrorLine } from "../users/form-parts";
import {
  buildSupplierPayload,
  emptySupplierForm,
  formFromSupplier,
  isSupplierFormDirty,
  type SupplierField,
  type SupplierFormErrors,
  type SupplierFormValues,
} from "./supplier-form";

interface SupplierDialogProps {
  supplier: Supplier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (supplier: Supplier, mode: "added" | "saved") => void;
  onStale: () => void;
  onSessionEnded: () => void;
}

interface CloseGuard {
  dirty: boolean;
  pending: boolean;
}

type FormProps = Omit<SupplierDialogProps, "open" | "onOpenChange"> & {
  onGuardChange: (guard: CloseGuard) => void;
  onClose: () => void;
};

const textProps = { autoComplete: "off", spellCheck: false } as const;

function FormField({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field invalid={error !== undefined} className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function SupplierForm({
  supplier,
  onGuardChange,
  onClose,
  onSaved,
  onStale,
  onSessionEnded,
}: FormProps) {
  const [initial] = useState<SupplierFormValues>(() =>
    supplier ? formFromSupplier(supplier) : emptySupplierForm(),
  );
  const [values, setValues] = useState<SupplierFormValues>(initial);
  const [errors, setErrors] = useState<SupplierFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  const dirty = isSupplierFormDirty(initial, values);
  useEffect(() => {
    onGuardChange({ dirty, pending });
  }, [onGuardChange, dirty, pending]);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const field = (key: SupplierField) => ({
    name: key,
    "aria-invalid": errors[key] !== undefined,
    value: values[key],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [key]: event.target.value })),
  });

  const submit = async () => {
    if (submitting.current) return;
    const built = buildSupplierPayload(values);
    if (!built.ok) {
      setErrors(built.errors);
      setFormError(null);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    setFormError(null);
    submitting.current = true;
    setPending(true);
    try {
      const { vendora } = window;
      const result = supplier
        ? await vendora.suppliers.update({ id: supplier.id, ...built.payload })
        : await vendora.suppliers.create(built.payload);
      if (result.ok) {
        onSaved(result.supplier, supplier ? "saved" : "added");
        onGuardChange({ dirty: false, pending: false });
        onClose();
        return;
      }
      setFormError(result.message);
      onStale();
    } catch (cause) {
      if (isSessionError(cause)) onSessionEnded();
      else setFormError(serviceErrorMessage);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
    >
      <DialogHeader>
        <DialogTitle>{supplier ? "Edit supplier" : "Add supplier"}</DialogTitle>
      </DialogHeader>
      <div className="grid content-start gap-400 overflow-y-auto px-600 pb-600">
        <FormField label="Name" error={errors.name}>
          <Input {...field("name")} {...textProps} autoFocus maxLength={100} />
        </FormField>
        <div className="grid grid-cols-2 gap-x-300 gap-y-400">
          <FormField label="Contact person" error={errors.contactPerson}>
            <Input {...field("contactPerson")} {...textProps} maxLength={100} />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <Input
              {...field("phone")}
              {...textProps}
              inputMode="tel"
              maxLength={30}
              className="tabular-nums"
            />
          </FormField>
        </div>
        <FormField label="NTN" error={errors.ntn}>
          <Input {...field("ntn")} {...textProps} maxLength={20} className="tabular-nums" />
        </FormField>
        <FormField label="Notes" error={errors.notes}>
          <textarea
            {...field("notes")}
            autoComplete="off"
            rows={3}
            maxLength={500}
            className={cn(controlClasses, "resize-none py-200")}
          />
        </FormField>
        {formError ? <ErrorLine>{formError}</ErrorLine> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : supplier ? "Save" : "Add supplier"}
          <Kbd>Ctrl+S</Kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SupplierDialog({ open, onOpenChange, ...rest }: SupplierDialogProps) {
  const guard = useRef<CloseGuard>({ dirty: false, pending: false });
  const [discardOpen, setDiscardOpen] = useState(false);

  const setGuard = useCallback((next: CloseGuard) => {
    guard.current = next;
  }, []);

  const requestClose = () => {
    if (guard.current.pending) return;
    if (guard.current.dirty) setDiscardOpen(true);
    else onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent className="grid max-h-[calc(100vh-64px)] w-[min(560px,calc(100vw-32px))] grid-rows-[minmax(0,1fr)]">
        <SupplierForm {...rest} onGuardChange={setGuard} onClose={requestClose} />
        <DiscardChangesDialog
          noun="supplier"
          open={discardOpen}
          onKeepEditing={() => setDiscardOpen(false)}
          onDiscard={() => {
            setDiscardOpen(false);
            setGuard({ dirty: false, pending: false });
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
