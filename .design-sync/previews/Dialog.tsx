import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from "@deevy/design-system";

/** A form in a Dialog, open. The kit portals it to the body; the card keeps it inside. */
export const ConnectGitHub = () => (
  <Dialog open>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Connect GitHub</DialogTitle>
        <DialogDescription>
          Paste the App you made under Developer settings › GitHub Apps. deevy seals its key and
          never shows it again.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="connect-github-app-id">App id</FieldLabel>
          <Input id="connect-github-app-id" defaultValue="1284461" className="font-mono" />
        </Field>
        <Field>
          <FieldLabel htmlFor="connect-github-key">Private key</FieldLabel>
          <Textarea
            id="connect-github-key"
            rows={4}
            placeholder="-----BEGIN RSA PRIVATE KEY-----"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button>Connect</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
