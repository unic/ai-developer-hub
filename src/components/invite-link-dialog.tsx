"use client";

import { useState, useEffect } from "react";
import { Copy, Mail, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { sendInviteEmail } from "@/actions/invite";

interface InviteLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteUrl: string;
  userId: number;
  emailAlreadySent?: boolean;
}

export function InviteLinkDialog({
  open,
  onOpenChange,
  inviteUrl,
  userId,
  emailAlreadySent = false,
}: InviteLinkDialogProps) {
  const [currentUrl, setCurrentUrl] = useState(inviteUrl);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const status = useInlineStatus();

  // Sync with parent when the prop changes (e.g. token generated after mount)
  useEffect(() => {
    if (inviteUrl) setCurrentUrl(inviteUrl);
  }, [inviteUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      status.ok("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      status.error("Copy failed");
    }
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      const result = await sendInviteEmail(userId);
      if (result.success) {
        status.ok("Invite sent");
        if (result.data?.inviteUrl) setCurrentUrl(result.data.inviteUrl);
      } else {
        status.error(result.error ?? "Send failed");
      }
    } catch {
      status.error("Send failed");
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

        {emailAlreadySent ? (
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Close
          </Button>
        ) : (
          <Button
            onClick={handleSendEmail}
            disabled={sending}
            className="w-full"
          >
            <Mail className="mr-2 size-4" />
            {sending ? "Sending..." : "Send Invite Email"}
          </Button>
        )}

        <div className="flex justify-end">
          <StatusText status={status.status} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
