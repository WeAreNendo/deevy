import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from "@deevy/design-system";
import { CircleAlert, Info } from "lucide-react";

// No screen uses Alert: a note inside a section is a `<p>`, a refusal is
// `text-sm text-destructive`. These are the component's own shapes.

/** Something to know, with what to do about it in the corner. */
export const Default = () => (
  <Alert className="max-w-lg">
    <Info />
    <AlertTitle>Builder has no API key</AlertTitle>
    <AlertDescription>It cannot reach deevy yet.</AlertDescription>
    <AlertAction>
      <Button variant="outline" size="xs">
        Issue
      </Button>
    </AlertAction>
  </Alert>
);

/** Something gone wrong: the text turns to the destructive colour. */
export const Destructive = () => (
  <Alert variant="destructive" className="max-w-lg">
    <CircleAlert />
    <AlertTitle>Reviewer is suspended</AlertTitle>
    <AlertDescription>deevy refuses its keys until it is reinstated.</AlertDescription>
    <AlertAction>
      <Button variant="outline" size="xs">
        Reinstate
      </Button>
    </AlertAction>
  </Alert>
);

/** Without an action and without an icon. */
export const Plain = () => (
  <Alert className="max-w-lg">
    <AlertTitle>Nothing is configured</AlertTitle>
    <AlertDescription>
      Every Checkpoint an Agent asks about wants one approval, from anybody. Name one to ask for
      more.
    </AlertDescription>
  </Alert>
);
