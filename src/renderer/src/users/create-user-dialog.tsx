import { useRef, useState, type ComponentProps, type FormEvent } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { sanitizePin } from "../auth/pin-entry";
import { ErrorLine, RoleSelect } from "./form-parts";
import {
  validateCreateUserForm,
  type CreateUserFormErrors,
  type CreateUserFormField,
  type CreateUserFormValues,
} from "./user-form";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onSessionEnded: () => void;
}

const emptyValues: CreateUserFormValues = {
  username: "",
  displayName: "",
  password: "",
  confirmPassword: "",
  pin: "",
  confirmPin: "",
};

const fieldOrder: CreateUserFormField[] = [
  "username",
  "displayName",
  "password",
  "confirmPassword",
  "pin",
  "confirmPin",
];

function CreateUserForm({
  onClose,
  onCreated,
  onSessionEnded,
}: {
  onClose: () => void;
  onCreated: () => void;
  onSessionEnded: () => void;
}) {
  const [values, setValues] = useState<CreateUserFormValues>(emptyValues);
  const [role, setRole] = useState<SafeUser["role"]>("cashier");
  const [errors, setErrors] = useState<CreateUserFormErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<CreateUserFormField, HTMLInputElement | null>>>({});

  const focus = (field: CreateUserFormField) => {
    requestAnimationFrame(() => refs.current[field]?.focus());
  };

  const set = (field: CreateUserFormField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const found = validateCreateUserForm(values);
    const invalid = fieldOrder.find((field) => found[field]);
    if (invalid) {
      setErrors(found);
      setServiceError(null);
      const onlyMismatch = Object.keys(found).every(
        (field) => field === "confirmPassword" || field === "confirmPin",
      );
      if (onlyMismatch) {
        setValues((current) => ({
          ...current,
          ...(found.confirmPassword ? { confirmPassword: "" } : {}),
          ...(found.confirmPin ? { confirmPin: "" } : {}),
        }));
      }
      focus(invalid);
      return;
    }

    setErrors({});
    setServiceError(null);
    setPending(true);
    const { username, displayName, password, pin } = values;
    setValues((current) => ({
      ...current,
      password: "",
      confirmPassword: "",
      pin: "",
      confirmPin: "",
    }));
    try {
      const result = await window.vendora.users.create({
        username,
        displayName,
        role,
        password,
        pin,
      });
      if (result.ok) {
        onCreated();
        onClose();
        return;
      }
      setErrors({ username: result.message });
      focus("username");
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
      focus("password");
    }
    setPending(false);
  };

  const field = (
    name: CreateUserFormField,
    label: string,
    description: string | null,
    inputProps: ComponentProps<typeof Input>,
  ) => (
    <Field invalid={Boolean(errors[name])}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        ref={(element) => {
          refs.current[name] = element;
        }}
        value={values[name]}
        {...inputProps}
      />
      {errors[name] ? (
        <FieldError>{errors[name]}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>They can log in with these details once you add them.</DialogDescription>
        <div className="grid grid-cols-2 items-start gap-x-400 gap-y-400">
          {field("username", "Username", "Used to log in", {
            autoFocus: true,
            autoComplete: "off",
            maxLength: 64,
            onChange: (event) => set("username", event.target.value),
          })}
          {field("displayName", "Display name", null, {
            autoComplete: "off",
            maxLength: 64,
            onChange: (event) => set("displayName", event.target.value),
          })}
          <RoleSelect value={role} onChange={setRole} />
          <div />
          {field("password", "Password", "4–5 characters", {
            type: "password",
            autoComplete: "new-password",
            onChange: (event) => set("password", event.target.value),
          })}
          {field("confirmPassword", "Confirm password", null, {
            type: "password",
            autoComplete: "new-password",
            onChange: (event) => set("confirmPassword", event.target.value),
          })}
          {field("pin", "PIN", "4–6 digits, for quick switching at the counter", {
            type: "password",
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 6,
            onChange: (event) => set("pin", sanitizePin(event.target.value)),
          })}
          {field("confirmPin", "Confirm PIN", null, {
            type: "password",
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 6,
            onChange: (event) => set("confirmPin", sanitizePin(event.target.value)),
          })}
        </div>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding user…" : "Add user"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  onSessionEnded,
}: CreateUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(600px,calc(100vw-32px))]">
        <CreateUserForm
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
          onSessionEnded={onSessionEnded}
        />
      </DialogContent>
    </Dialog>
  );
}
