import {
  Badge,
  Button,
  MemberChip,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@deevy/design-system";
import { ada, builder, grace, planner, records, suspendedAgent } from "./lib/fixtures";

const rows = [
  { member: ada, role: "admin" },
  { member: grace, role: "member" },
  { member: planner, role: "member" },
  { member: builder, role: "member" },
  { member: suspendedAgent, role: "member" },
];

/** Settings › Members: a MemberChip, the handle, the role, and whether they are suspended. */
export const Members = () => (
  <Table aria-label="Members">
    <TableHeader>
      <TableRow>
        <TableHead>Member</TableHead>
        <TableHead>Handle</TableHead>
        <TableHead>Role</TableHead>
        <TableHead className="text-right">Access</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map(({ member, role }) => (
        <TableRow key={member.id}>
          <TableCell>
            <MemberChip member={member} />
          </TableCell>
          <TableCell className="text-muted-foreground">@{member.handle}</TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Select defaultValue={role}>
                <SelectTrigger size="sm" aria-label={`Role of ${member.user.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="member">member</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {member.kind === "agent" ? <Badge variant="secondary">Agent</Badge> : null}
            </div>
          </TableCell>
          <TableCell className="text-right">
            {member.suspendedAt ? (
              <div className="flex items-center justify-end gap-2">
                <Badge variant="destructive">Suspended</Badge>
                <Button variant="outline" size="sm">
                  Reinstate
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm">
                Suspend
              </Button>
            )}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** A row marked with `data-state="selected"`. A list is a DataTable, which marks its own. */
export const SelectedRow = () => (
  <Table aria-label="Work">
    <TableHeader>
      <TableRow>
        <TableHead className="w-36">Key</TableHead>
        <TableHead>Title</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {records.slice(0, 3).map((record, index) => (
        <TableRow key={record.key} data-state={index === 1 ? "selected" : undefined}>
          <TableCell className="font-mono text-xs">{record.key}</TableCell>
          <TableCell>{record.title}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** A caption under it and a footer row. No screen has either, so the words are of no product. */
export const WithCaptionAndFooter = () => (
  <Table aria-label="Counts">
    <TableCaption>What the table is.</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead className="text-right">Count</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>First</TableCell>
        <TableCell className="text-right tabular-nums">3</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Second</TableCell>
        <TableCell className="text-right tabular-nums">5</TableCell>
      </TableRow>
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell>Both</TableCell>
        <TableCell className="text-right tabular-nums">8</TableCell>
      </TableRow>
    </TableFooter>
  </Table>
);
