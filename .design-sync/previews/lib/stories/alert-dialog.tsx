import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@deevy/design-system";
import { KeyRound } from "lucide-react";

/** What does not undo asks first: the destructive action sits last, Cancel beside it. Open, so the card shows it. */
export const RevokeKey = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <KeyRound />
        </AlertDialogMedia>
        <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
        <AlertDialogDescription>
          The key <span className="font-mono">deevy_sk_…8f2a</span> for Builder stops working at
          once. Runs it has already started finish; the next one fails to sign in.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Revoke key</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
