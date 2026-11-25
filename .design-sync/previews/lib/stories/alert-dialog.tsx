import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deevy/design-system";

/** What does not undo asks first, and says what stays and what goes: disconnecting a Socket. Open, so the card shows it. */
export const Disconnect = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Disconnect acme on GitHub?</AlertDialogTitle>
        <AlertDialogDescription>
          The Issues it projected and the Runs on them stay. deevy drops the credential, stops
          taking deliveries, and the Projects bound to it have nothing to work.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction>Disconnect it</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
