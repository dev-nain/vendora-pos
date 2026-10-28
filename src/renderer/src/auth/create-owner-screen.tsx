import { CircleXIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { serviceErrorMessage } from "./messages";
import {
  validateOwnerForm,
  type OwnerFormErrors,
  type OwnerFormField,
  type OwnerFormValues,
} from "./owner-form";
import { sanitizePin } from "./pin-entry";

interface CreateOwnerScreenProps {
  onCreated: (user: SafeUser) => void;
  onOwnerExists: () => void;
}

const emptyValues: OwnerFormValues = {
  username: "",
  displayName: "",
  password: "",
  confirmPassword: "",
  pin: "",
  confirmPin: "",
};

const fieldOrder: OwnerFormField[] = [
  "username",
  "displayName",
  "password",
  "confirmPassword",
  "pin",
  "confirmPin",
];

export function CreateOwnerScreen({ onCreated, onOwnerExists }: CreateOwnerScreenProps) {
  const [values, setValues] = useState<OwnerFormValues>(emptyValues);
  const [errors, setErrors] = useState<OwnerFormErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<OwnerFormField, HTMLInputElement | null>>>({});

  const focus = (field: OwnerFormField) => {
    requestAnimationFrame(() => refs.current[field]?.focus());
  };

  const set = (field: OwnerFormField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const found = validateOwnerForm(values);
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
      const result = await window.vendora.auth.createOwner({
        username,
        displayName,
        password,
        pin,
      });
      if (result.ok) {
        onCreated(result.user);
        return;
      }
      onOwnerExists();
      return;
    } catch {
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
    focus("password");
  };

  const field = (
    name: OwnerFormField,
    label: string,
    description: string | null,
    inputProps: React.ComponentProps<typeof Input>,
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
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-page p-800">
      <section className="flex w-[720px] flex-col gap-600 rounded-300 border border-line bg-surface p-600 shadow-200">
        <header className="grid gap-200">
          <p className="m-0 text-[length:var(--font-size-900)] leading-[var(--line-height-tight)] font-semibold tracking-[var(--letter-spacing-tight)] text-foreground">
            vendora<span className="text-fill-brand">.</span>
          </p>
          <h1 className="m-0 text-[length:var(--font-size-700)] leading-[var(--line-height-tight)] font-semibold tracking-[var(--letter-spacing-tight)] text-foreground">
            Create the Owner account
          </h1>
          <p className="m-0 text-[length:var(--font-size-400)] text-secondary">
            The Owner can do everything in Vendora. You&apos;ll use these details to log in.
          </p>
        </header>
        <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-400 gap-y-400">
          {field("username", "Username", "Used to log in", {
            autoFocus: true,
            autoComplete: "username",
            maxLength: 64,
            onChange: (event) => set("username", event.target.value),
          })}
          {field("displayName", "Display name", null, {
            autoComplete: "name",
            maxLength: 64,
            onChange: (event) => set("displayName", event.target.value),
          })}
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
          <div className="col-span-2 grid gap-400">
            {serviceError ? (
              <p
                role="alert"
                className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical"
              >
                <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
                {serviceError}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? "Creating account…" : "Create Owner account"}
              {pending ? null : <Kbd>Enter</Kbd>}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
