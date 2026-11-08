import { CircleCheckIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import type { StocktakeSummary } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldLabel } from "@renderer/components/ui/field";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { PastStocktakes } from "./past-stocktakes";

const ALL_PRODUCTS = "all";

interface StocktakeStartProps {
  cancelled: boolean;
  onStarted: (stocktake: StocktakeSummary) => void;
  onAlreadyOpen: () => void;
  onOpenPast: (stocktakeId: string) => void;
  onSessionEnded: () => void;
}

export function StocktakeStart({
  cancelled,
  onStarted,
  onAlreadyOpen,
  onOpenPast,
  onSessionEnded,
}: StocktakeStartProps) {
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [scope, setScope] = useState(ALL_PRODUCTS);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    window.vendora.categories
      .list()
      .then((list) => setCategories(list))
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  const items = [
    { value: ALL_PRODUCTS, label: "All products" },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await window.vendora.stocktake.start(
        scope === ALL_PRODUCTS ? { scope: "full" } : { scope: "category", categoryId: scope },
      );
      if (result.ok) {
        onStarted(result.stocktake);
        return;
      }
      if (result.reason === "already-open") {
        onAlreadyOpen();
        return;
      }
      setError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    }
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Stocktake
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Count your stock. Billing keeps running.
        </p>
      </div>
      {cancelled ? (
        <p
          role="status"
          className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-secondary"
        >
          <CircleCheckIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
          Count cancelled. Stock was not changed.
        </p>
      ) : null}
      <form className="grid max-w-[400px] gap-500" onSubmit={start}>
        <Field>
          <FieldLabel>What to count</FieldLabel>
          <Select
            items={items}
            value={scope}
            onValueChange={(next) => {
              if (typeof next === "string") setScope(next);
            }}
          >
            <SelectTrigger aria-label="What to count" autoFocus>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <Button type="submit" disabled={pending || categories === null}>
          Start count
          <Kbd>Enter</Kbd>
        </Button>
      </form>
      <PastStocktakes onOpen={onOpenPast} onSessionEnded={onSessionEnded} />
    </div>
  );
}
