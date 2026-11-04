import { createFirstUserInputSchema } from "../../../shared/auth";

export interface FirstUserFormValues {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  pin: string;
  confirmPin: string;
}

export type FirstUserFormField = keyof FirstUserFormValues;
export type FirstUserFormErrors = Partial<Record<FirstUserFormField, string>>;

const { shape } = createFirstUserInputSchema;

function firstMessage(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

export function validateFirstUserForm(values: FirstUserFormValues): FirstUserFormErrors {
  const checks: [FirstUserFormField, string | undefined][] = [
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
  const errors: FirstUserFormErrors = {};
  for (const [field, message] of checks) if (message) errors[field] = message;
  return errors;
}
