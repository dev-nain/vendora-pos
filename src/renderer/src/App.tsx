import { CheckIcon, CircleXIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";

const roles = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
];

function Panel({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`grid content-start gap-400 rounded-300 border border-line bg-surface p-600 ${className ?? ""}`}
    >
      <h2 className="m-0 text-[length:var(--font-size-300)] font-semibold tracking-[var(--letter-spacing-caps)] text-tertiary uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RoleSelect({ disabled, invalid }: { disabled?: boolean; invalid?: boolean }) {
  const [role, setRole] = useState<string | null>(null);
  return (
    <Field invalid={invalid} disabled={disabled}>
      <FieldLabel>Role</FieldLabel>
      <Select value={role} onValueChange={setRole} items={roles}>
        <SelectTrigger>
          <SelectValue placeholder="Choose a role" />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {invalid ? <FieldError>Choose a role.</FieldError> : null}
    </Field>
  );
}

function VoidSaleDialog({ disabled }: { disabled?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" disabled={disabled} />}>
        {disabled ? "Open dialog (disabled)" : "Open dialog"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void sale T1-000231?</DialogTitle>
          <DialogDescription>
            This cancels Rs 4,770 and returns 3 items to stock. A credit note will print. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep sale</DialogClose>
          <DialogClose render={<Button variant="destructive" />}>Void sale</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const numeric = "text-right font-mono tabular-nums";

export function App() {
  const [version, setVersion] = useState<string | null>(null);

  const loadVersion = useCallback(() => {
    void window.vendora.app.getInfo().then((info) => setVersion(info.version));
  }, []);

  useEffect(loadVersion, [loadVersion]);

  return (
    <main className="grid min-h-screen content-start gap-600 bg-page p-800">
      <header className="flex items-center justify-between">
        <h1 className="m-0 text-[length:var(--font-size-900)] leading-[var(--line-height-tight)] font-semibold tracking-[var(--letter-spacing-tight)] text-foreground">
          vendora<span className="text-fill-brand">.</span>
        </h1>
        <div className="flex items-center gap-400">
          <p className="m-0 font-mono text-[length:var(--font-size-350)] text-secondary">
            {version ? `v${version}` : "…"}
          </p>
          <Button variant="secondary" onClick={loadVersion}>
            Refresh version
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-600">
        <Panel title="Input & field">
          <Field>
            <FieldLabel>Username</FieldLabel>
            <Input name="username" autoComplete="off" />
            <FieldDescription>Letters and numbers only.</FieldDescription>
          </Field>
          <Field invalid>
            <FieldLabel>Sale price</FieldLabel>
            <Input name="sale-price" defaultValue="560" inputMode="numeric" />
            <FieldError>Sale price is below cost (Rs 585).</FieldError>
          </Field>
          <Field disabled>
            <FieldLabel>Store name</FieldLabel>
            <Input name="store-name" defaultValue="Hamid General Store" />
          </Field>
        </Panel>

        <Panel title="Select">
          <RoleSelect />
          <RoleSelect invalid />
          <Field disabled>
            <FieldLabel>Role</FieldLabel>
            <Select items={roles} defaultValue="manager">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Panel>

        <Panel title="Dialog">
          <div className="flex flex-wrap gap-300">
            <VoidSaleDialog />
            <VoidSaleDialog disabled />
          </div>
        </Panel>

        <Panel title="Badge">
          <div className="flex flex-wrap gap-300">
            <Badge variant="success">
              <CheckIcon aria-hidden="true" strokeWidth={2} />
              In stock
            </Badge>
            <Badge variant="warning">
              <TriangleAlertIcon aria-hidden="true" strokeWidth={2} />
              Low stock · 4
            </Badge>
            <Badge variant="critical">
              <CircleXIcon aria-hidden="true" strokeWidth={2} />
              Negative · −3
            </Badge>
            <Badge>Archived</Badge>
            <Badge variant="brand">Held</Badge>
            <Badge>
              <LockIcon aria-hidden="true" strokeWidth={2} />
              Manager override
            </Badge>
          </div>
        </Panel>

        <Panel title="Kbd" className="col-span-2">
          <div className="flex flex-wrap items-center gap-600 text-[length:var(--font-size-350)] text-secondary">
            <span className="flex items-center gap-200">
              <Kbd>F2</Kbd> Search
            </span>
            <span className="flex items-center gap-200">
              <Kbd>F4</Kbd> Qty
            </span>
            <span className="flex items-center gap-200">
              <Kbd>F6</Kbd> Discount
            </span>
            <span className="flex items-center gap-200">
              <span className="flex items-center gap-100">
                <Kbd>Ctrl</Kbd>+<Kbd>R</Kbd>
              </span>
              Return
            </span>
            <span className="flex items-center gap-200">
              <Kbd>Esc</Kbd> Back
            </span>
          </div>
        </Panel>

        <Panel title="Table" className="col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className={numeric}>Qty</TableHead>
                <TableHead className={numeric}>Price</TableHead>
                <TableHead className={numeric}>Disc.</TableHead>
                <TableHead className={numeric}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Dalda Cooking Oil 1L</TableCell>
                <TableCell className={numeric}>2</TableCell>
                <TableCell className={numeric}>585</TableCell>
                <TableCell className={numeric}>—</TableCell>
                <TableCell className={numeric}>1,170</TableCell>
              </TableRow>
              <TableRow aria-selected="true">
                <TableCell>
                  <span className="flex items-center gap-200">
                    Sugar loose
                    <Badge>Weighed</Badge>
                  </span>
                </TableCell>
                <TableCell className={numeric}>1.250 kg</TableCell>
                <TableCell className={numeric}>160</TableCell>
                <TableCell className={numeric}>—</TableCell>
                <TableCell className={numeric}>200</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Olpers Milk 1L — carton of 12</TableCell>
                <TableCell className={numeric}>1</TableCell>
                <TableCell className={numeric}>3,480</TableCell>
                <TableCell className={numeric}>−80</TableCell>
                <TableCell className={numeric}>3,400</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </div>
    </main>
  );
}
