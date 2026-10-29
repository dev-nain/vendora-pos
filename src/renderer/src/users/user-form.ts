import { createUserInputSchema } from "../../../shared/users";

export interface CreateUserFormValues {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  pin: string;
  confirmPin: string;
}

export type CreateUserFormField = keyof CreateUserFormValues;
export type CreateUserFormErrors = Partial<Record<CreateUserFormField, string>>;

const { shape } = createUserInputSchema;

function firstMessage(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

export function validateDisplayName(displayName: string): string | undefined {
  return firstMessage(shape.displayName.safeParse(displayName));
}

export function validateCreateUserForm(values: CreateUserFormValues): CreateUserFormErrors {
  const checks: [CreateUserFormField, string | undefined][] = [
    ["username", firstMessage(shape.username.safeParse(values.username))],
    ["displayName", validateDisplayName(values.displayName)],
    ["password", firstMessage(shape.password.safeParse(values.password))],
    [
      "confirmPassword",
      values.confirmPassword === values.password ? undefined : "Passwords don't match",
    ],
    ["pin", firstMessage(shape.pin.safeParse(values.pin))],
    ["confirmPin", values.confirmPin === values.pin ? undefined : "PINs don't match"],
  ];
  const errors: CreateUserFormErrors = {};
  for (const [field, message] of checks) if (message) errors[field] = message;
  return errors;
}

export type CredentialKind = "password" | "pin";

export interface CredentialFormValues {
  value: string;
  confirm: string;
}

export type CredentialFormErrors = Partial<Record<keyof CredentialFormValues, string>>;

export function validateCredentialForm(
  kind: CredentialKind,
  values: CredentialFormValues,
): CredentialFormErrors {
  const schema = kind === "password" ? shape.password : shape.pin;
  const errors: CredentialFormErrors = {};
  const valueError = firstMessage(schema.safeParse(values.value));
  if (valueError) errors.value = valueError;
  if (values.confirm !== values.value) {
    errors.confirm = kind === "password" ? "Passwords don't match" : "PINs don't match";
  }
  return errors;
}
