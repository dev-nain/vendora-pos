import { createOwnerInputSchema } from "../../../shared/auth";

export interface OwnerFormValues {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  pin: string;
  confirmPin: string;
}

export type OwnerFormField = keyof OwnerFormValues;
export type OwnerFormErrors = Partial<Record<OwnerFormField, string>>;

const { shape } = createOwnerInputSchema;

function firstMessage(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

export function validateOwnerForm(values: OwnerFormValues): OwnerFormErrors {
  const checks: [OwnerFormField, string | undefined][] = [
    ["username", firstMessage(shape.username.safeParse(values.username))],
    ["displayName", firstMessage(shape.displayName.safeParse(values.displayName))],
    ["password", firstMessage(shape.password.safeParse(values.password))],
    [
      "confirmPassword",
      values.confirmPassword === values.password ? undefined : "Passwords don't match",
    ],
    ["pin", firstMessage(shape.pin.safeParse(values.pin))],
    ["confirmPin", values.confirmPin === values.pin ? undefined : "PINs don't match"],
  ];
  const errors: OwnerFormErrors = {};
  for (const [field, message] of checks) if (message) errors[field] = message;
  return errors;
}
