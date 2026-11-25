import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@deevy/design-system";

/** A footer at the bottom, with a button that closes it. deevy's one sheet has neither, so the words are of no product. */
export const WithFooter = () => (
  <Sheet open>
    <SheetContent side="right">
      <SheetHeader>
        <SheetTitle>A title</SheetTitle>
        <SheetDescription>A line on what this is for.</SheetDescription>
      </SheetHeader>
      <SheetFooter>
        <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);
