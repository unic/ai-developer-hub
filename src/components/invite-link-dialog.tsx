"use client";

import { useState, useEffect } from "react";
import { Copy, Mail, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendInviteEmail } from "@/actions/invite";

interface InviteLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteUrl: string;
  userId: number;
}

export function InviteLinkDialog({
  open,
  onOpenChange,
  inviteUrl,
  userId,
}: InviteLinkDialogProps) {
  const [currentUrl, setCurrentUrl] = useState(inviteUrl);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  // Sync with parent when the prop changes (e.g. token generated after mount)
  useEffect(() => {
    if (inviteUrl) setCurrentUrl(inviteUrl);
  }, [inviteUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      toast.success("Invite link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      const result = await sendInviteEmail(userId);
      if (result.success) {
        toast.success("Invite email sent successfully");
        if (result.data?.inviteUrl) setCurrentUrl(result.data.inviteUrl);
      } else {
        toast.error(result.error ?? "Failed to send invite email");
      }
    } catch {
      toast.error("Failed to send invite email");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Link</DialogTitle>
          <DialogDescription>
            Share this link with the user so they can set up their account, or
            send it directly via email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={currentUrl} readOnly className="flex-1" />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              aria-label="Copy invite link"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>

        </div>

        <Button
          onClick={handleSendEmail}
          disabled={sending}
          className="w-full"
        >
          <Mail className="mr-2 size-4" />
          {sending ? "Sending..." : "Send Invite Email"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
