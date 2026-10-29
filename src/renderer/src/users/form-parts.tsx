import { CircleXIcon } from "lucide-react";

import { userRoleSchema, type SafeUser } from "@shared/auth";
import { Field, FieldLabel } from "@renderer/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { roleLabel } from "../auth/role-label";

type Role = SafeUser["role"];

const roleItems = userRoleSchema.options.map((value) => ({ value, label: roleLabel(value) }));

export function ErrorLine({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical"
    >
      <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
      {children}
    </p>
  );
}

export function RoleSelect({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <Field>
      <FieldLabel>Role</FieldLabel>
      <Select
        items={roleItems}
        value={value}
        onValueChange={(next) => {
          const parsed = userRoleSchema.safeParse(next);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roleItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
