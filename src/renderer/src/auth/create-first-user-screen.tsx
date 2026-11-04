import { CircleXIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { serviceErrorMessage } from "./messages";
import {
  validateFirstUserForm,
  type FirstUserFormErrors,
  type FirstUserFormField,
  type FirstUserFormValues,
} from "./first-user-form";
import { sanitizePin } from "./pin-entry";
import { PaneHeading, AuthLayout } from "./split-layout";

interface CreateFirstUserScreenProps {
  onCreated: (user: SafeUser) => void;
  onAccountExists: () => void;
}

const emptyValues: FirstUserFormValues = {
  username: "",
  displayName: "",
  password: "",
  confirmPassword: "",
  pin: "",
  confirmPin: "",
};

const fieldOrder: FirstUserFormField[] = [
  "username",
  "displayName",
  "password",
  "confirmPassword",
  "pin",
  "confirmPin",
];

export function CreateFirstUserScreen({ onCreated, onAccountExists }: CreateFirstUserScreenProps) {
  const [values, setValues] = useState<FirstUserFormValues>(emptyValues);
  const [errors, setErrors] = useState<FirstUserFormErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<FirstUserFormField, HTMLInputElement | null>>>({});

  const focus = (field: FirstUserFormField) => {
    requestAnimationFrame(() => refs.current[field]?.focus());
  };

  const set = (field: FirstUserFormField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const found = validateFirstUserForm(values);
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
      const result = await window.vendora.auth.createFirstUser({
        username,
        displayName,
        password,
        pin,
      });
      if (result.ok) {
        onCreated(result.user);
        return;
      }
      onAccountExists();
      return;
    } catch {
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
    focus("password");
  };

  const field = (
    name: FirstUserFormField,
    label: string,
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
      {errors[name] ? <FieldError>{errors[name]}</FieldError> : null}
    </Field>
  );

  return (
    <AuthLayout>
      <PaneHeading
        title="Create your account"
        description="You'll use these details to log in. Add staff later in Back office."
      />
      <section className="w-[640px] max-w-full rounded-300 border border-line-card bg-surface-secondary p-600">
        <form
          onSubmit={submit}
          noValidate
          className="grid grid-cols-2 items-start gap-x-400 gap-y-400"
        >
          {field("username", "Username", {
            autoFocus: true,
            autoComplete: "username",
            maxLength: 64,
            onChange: (event) => set("username", event.target.value),
          })}
          {field("displayName", "Display name", {
            autoComplete: "name",
            maxLength: 64,
            onChange: (event) => set("displayName", event.target.value),
          })}
          {field("password", "Password", {
            type: "password",
            autoComplete: "new-password",
            onChange: (event) => set("password", event.target.value),
          })}
          {field("confirmPassword", "Confirm password", {
            type: "password",
            autoComplete: "new-password",
            onChange: (event) => set("confirmPassword", event.target.value),
          })}
          {field("pin", "PIN", {
            type: "password",
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 6,
            onChange: (event) => set("pin", sanitizePin(event.target.value)),
          })}
          {field("confirmPin", "Confirm PIN", {
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
              {pending ? "Creating account…" : "Create your account"}
              {pending ? null : <Kbd>Enter</Kbd>}
            </Button>
          </div>
        </form>
      </section>
    </AuthLayout>
  );
}
