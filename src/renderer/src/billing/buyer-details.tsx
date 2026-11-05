import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { filledBuyerCount, type BuyerField, type BuyerText } from "./buyer-input";

export const buyerPanelId = "buyer-details-panel";
export const buyerInputId = (field: BuyerField) => `buyer-${field}`;

export type BuyerErrors = Partial<Record<BuyerField, string>>;

interface BuyerToggleProps {
  text: BuyerText;
  open: boolean;
  onToggle: () => void;
}

export function BuyerToggle({ text, open, onToggle }: BuyerToggleProps) {
  const filled = filledBuyerCount(text);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <Button
      id="buyer-details-toggle"
      variant="secondary"
      aria-expanded={open}
      aria-controls={buyerPanelId}
      className="mt-auto w-full justify-between px-300"
      onClick={onToggle}
    >
      <span className="flex items-center gap-200">
        <Chevron aria-hidden="true" size={16} strokeWidth={2} />
        {!open && filled > 0 ? `Buyer details · ${filled}` : "Buyer details"}
      </span>
      <Kbd>F11</Kbd>
    </Button>
  );
}

const fields: {
  field: BuyerField;
  label: string;
  props: { inputMode?: "tel"; maxLength: number };
}[] = [
  { field: "name", label: "Name", props: { maxLength: 100 } },
  { field: "phone", label: "Phone", props: { inputMode: "tel", maxLength: 20 } },
  { field: "ntn", label: "NTN", props: { maxLength: 20 } },
  { field: "cnic", label: "CNIC", props: { maxLength: 20 } },
];

interface BuyerFieldsProps {
  text: BuyerText;
  errors: BuyerErrors;
  onChange: (field: BuyerField, value: string) => void;
  onBlurField: (field: BuyerField) => void;
}

export function BuyerFields({ text, errors, onChange, onBlurField }: BuyerFieldsProps) {
  return (
    <div id={buyerPanelId} role="group" aria-label="Buyer details" className="grid gap-300">
      <div className="grid grid-cols-2 gap-300">
        {fields.map(({ field, label, props }) => (
          <Field key={field} invalid={Boolean(errors[field])}>
            <FieldLabel>{label}</FieldLabel>
            <Input
              id={buyerInputId(field)}
              autoComplete="off"
              {...props}
              value={text[field]}
              onChange={(event) => onChange(field, event.target.value)}
              onBlur={() => onBlurField(field)}
            />
            {errors[field] ? <FieldError>{errors[field]}</FieldError> : null}
          </Field>
        ))}
      </div>
    </div>
  );
}
