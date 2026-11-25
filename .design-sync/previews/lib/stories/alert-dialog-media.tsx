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
import { Trash2 } from "lucide-react";

/** With an icon above the title. deevy's one alert dialog has none, so the words are of no product. */
export const WithMedia = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <Trash2 />
        </AlertDialogMedia>
        <AlertDialogTitle>Delete this?</AlertDialogTitle>
        <AlertDialogDescription>
          It cannot be undone, and everything it holds goes with it.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
