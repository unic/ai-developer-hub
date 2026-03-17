"use client";

import { useState } from "react";
import { toast } from "sonner";
import { resetUserPassword } from "@/actions/invite";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ResetPasswordDialogProps {
  user: { id: number; name: string; email: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: ResetPasswordDialogProps) {
  const [sendEmail, setSendEmail] = useState(true);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  async function handleResetPassword() {
    try {
      const result = await resetUserPassword({ userId: user.id, sendEmail });
      if (result.success) {
        onOpenChange(false);
        setInviteUrl(result.data.inviteUrl);
        setShowInviteLink(true);
        if (result.data.emailSent) {
          toast.success("Password reset. Invite email sent.");
        } else {
          toast.success("Password reset. Share the invite link with the user.");
        }
        onSuccess?.();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setSendEmail(true);
    }
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the current password and generate a new invite link.
              The user will not be able to sign in until they set a new password via the invite link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center space-x-2 py-2">
            <Checkbox
              id={`reset-email-${user.id}`}
              checked={sendEmail}
              onCheckedChange={(checked) => setSendEmail(checked === true)}
            />
            <Label htmlFor={`reset-email-${user.id}`}>
              Send invite email to {user.email}
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPassword}>
              Reset Password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <InviteLinkDialog
        open={showInviteLink}
        onOpenChange={setShowInviteLink}
        inviteUrl={inviteUrl}
        userId={user.id}
      />
    </>
  );
}
