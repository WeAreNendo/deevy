import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deevy/design-system";

const roleName = (selected: string) => (selected === "admin" ? "Admin" : "Member");

/** A form in a Dialog, open: Invite someone, from Settings › General. The kit portals it to the body; the card keeps it inside. */
export const InviteSomeone = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite someone</DialogTitle>
        <DialogDescription>
          Invite one person by email address. You get a link to send them, good for seven days; they
          join by signing in with that address.
        </DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={(submitted) => submitted.preventDefault()}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" placeholder="grace@example.com" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select defaultValue="member">
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue>{roleName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
          <Button type="submit">Create invitation</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
