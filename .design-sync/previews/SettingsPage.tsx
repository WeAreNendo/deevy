import {
  Button,
  Input,
  Label,
  MemberChip,
  SecretInput,
  SettingsPage,
  SettingsSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deevy/design-system";
import { ada, planner } from "./lib/fixtures";

const keys = [
  { name: "laptop", prefix: "deevy_sk_7f3k", lastUsed: "2m ago" },
  { name: "ci", prefix: "deevy_sk_q81z", lastUsed: "yesterday" },
];

/** An Agent's Settings page: a header, list sections, a form section and a danger zone. */
export const AgentPage = () => (
  <SettingsPage
    title={<MemberChip member={planner} size="lg" showHandle />}
    description={
      <span>
        Sponsored by <span className="text-foreground">{ada.user.name}</span>
      </span>
    }
  >
    <SettingsSection title="Projects" aria-label="Projects">
      <ul className="flex flex-col divide-y text-sm">
        {["deevy", "Operations"].map((project) => (
          <li key={project} className="flex items-center justify-between py-2">
            <span>{project}</span>
            <Button variant="destructive" size="sm" aria-label={`Revoke ${project}`}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </SettingsSection>
    <SettingsSection title="API keys" aria-label="API keys">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Revoke</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.prefix}>
              <TableCell>{key.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {key.prefix}…
              </TableCell>
              <TableCell className="text-muted-foreground">{key.lastUsed}</TableCell>
              <TableCell className="text-right">
                <Button variant="destructive" size="sm">
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <form className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="key-name">Name</Label>
          <Input id="key-name" placeholder="laptop" className="w-56" />
        </div>
        <Button type="submit">Generate</Button>
      </form>
    </SettingsSection>
    <SettingsSection
      title="Webhook"
      description="deevy posts to this URL the moment there is work in the Projects this Agent was granted, signed with a secret you choose."
      aria-label="Webhook"
    >
      <div className="grid gap-3 @lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="webhook-url">Webhook URL</Label>
          <Input id="webhook-url" defaultValue="https://agents.example.com/deevy" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="webhook-secret">Signing secret</Label>
          <SecretInput id="webhook-secret" defaultValue="whsec_5b1f0c9e2a" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button>Start deliveries</Button>
        <Button variant="outline">Generate</Button>
      </div>
    </SettingsSection>
    <SettingsSection
      title="Suspend this Agent"
      description="A suspended Agent's keys stop working and nothing is routed to it. Reinstate it to undo."
      tone="danger"
      aria-label="Suspend this Agent"
    >
      <div>
        <Button variant="outline">Suspend</Button>
      </div>
    </SettingsSection>
  </SettingsPage>
);
