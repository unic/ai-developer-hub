"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { setCreditOpeningBalance } from "@/actions/credits";
import { parseOpeningBalanceCents } from "@/lib/credits";
import { formatCurrency } from "@/lib/utils";
import { todayLocal } from "@/components/claude/credit-purchases";

type CreditOpeningBalanceProps = {
  toolId: number;
  /** Null when no opening balance is recorded. */
  openingCents: number | null;
  /** YYYY-MM-DD, or null when no opening balance is recorded. */
  openingAt: string | null;
};

/**
 * Spec 045 — the balance an admin read in the Anthropic Console, with the day
 * it stood at. The Admin API exposes no balance, so this is the anchor every
 * derived figure is counted from.
 */
export function CreditOpeningBalance({
  toolId,
  openingCents,
  openingAt,
}: CreditOpeningBalanceProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState(todayLocal);
  const [isPending, startTransition] = useTransition();
  const formStatus = useInlineStatus();
  const rowStatus = useInlineStatus();

  const amountCents = parseOpeningBalanceCents(amount);
  const recorded = openingCents !== null && openingAt !== null;

  function openDialog() {
    setAmount(openingCents !== null ? (openingCents / 100).toFixed(2) : "");
    setAsOf(openingAt ?? todayLocal());
    setOpen(true);
  }

  function save(cents: number | null, date: string | null) {
    startTransition(async () => {
      const result = await setCreditOpeningBalance({
        toolId,
        openingBalanceCents: cents,
        openingBalanceAt: date,
      });
      if (result.success) {
        setOpen(false);
        rowStatus.ok(cents === null ? "Opening balance cleared" : "Saved");
        router.refresh();
      } else {
        formStatus.error(result.error);
      }
    });
  }

  function handleSave() {
    if (amountCents === null) {
      formStatus.error("Enter the balance in dollars, e.g. 44.79");
      return;
    }
    if (asOf > todayLocal()) {
      formStatus.error("The as-of date can't be in the future");
      return;
    }
    save(amountCents, asOf);
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Opening balance
        </p>
        <div className="flex items-center gap-2">
          <StatusText status={rowStatus.status} />
          <Button size="sm" variant="outline" onClick={openDialog}>
            {recorded ? "Edit" : "Set"}
          </Button>
        </div>
      </div>
      <p className="text-sm">
        {openingCents !== null && openingAt !== null ? (
          <>
            <span className="font-medium tabular-nums">
              {formatCurrency(openingCents)}
            </span>{" "}
            <span className="text-muted-foreground">
              at the end of {openingAt}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Not recorded — the credit balance can&apos;t be derived until it is.
          </span>
        )}
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Opening credit balance</DialogTitle>
            <DialogDescription>
              The balance shown in the Anthropic Console. The Hub counts from
              here: top-ups and usage dated after this day move the balance;
              anything on or before it is treated as already included.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="opening-amount">
                Balance ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="opening-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-date">
                As of end of <span className="text-destructive">*</span>
              </Label>
              <Input
                id="opening-date"
                type="date"
                max={todayLocal()}
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Read the balance before a top-up you&apos;re about to record? Date
            it the day before, so the top-up counts on top of it.
          </p>

          <DialogFooter>
            <StatusText status={formStatus.status} className="sm:mr-auto" />
            {recorded && (
              <Button
                variant="ghost"
                onClick={() => save(null, null)}
                disabled={isPending}
              >
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isPending || amountCents === null || !asOf}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
