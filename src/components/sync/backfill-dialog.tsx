"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { History } from "lucide-react";
import { triggerBackfill } from "@/actions/sync";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SyncSourceType } from "@/lib/sync/framework";

interface BackfillDialogProps {
  sourceType: string;
  disabled?: boolean;
}

export function BackfillDialog({ sourceType, disabled }: BackfillDialogProps) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate) return;

    setLoading(true);
    try {
      const result = await triggerBackfill(
        sourceType as SyncSourceType,
        startDate
      );
      if (result.success) {
        toast.success("Backfill started");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to trigger backfill");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <History className="h-3 w-3 mr-1" />
          Backfill
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Historical Backfill</DialogTitle>
            <DialogDescription>
              Import historical data from the specified start date to today.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              required
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !startDate}>
              {loading ? "Starting..." : "Start Backfill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
