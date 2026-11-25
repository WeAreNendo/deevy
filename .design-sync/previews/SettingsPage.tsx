import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Input,
  Label,
  MemberChip,
  RunStatus,
  SecretInput,
  SettingsPage,
  SettingsSection,
} from "@deevy/design-system";
import { ada, builder, failedRun, finishedRun, grace, omar, type Member } from "./lib/fixtures";

const humans: Member[] = [ada, grace, omar];
const granted = [
  { slug: "acme-deevy", name: "deevy" },
  { slug: "acme-ops", name: "Operations" },
];
const keys = [
  { name: "laptop", start: "deevy_sk_7f3k" },
  { name: "ci", start: "deevy_sk_q81z" },
];
const recent = [
  { ...finishedRun, on: "11/25/2026" },
  { ...failedRun, on: "11/25/2026" },
];

/** An Agent's page: who answers for it, what it may see, its keys, where it is woken, its Runs, and a danger zone. Connect an Agent, after the keys, is left out here. */
export const AgentPage = () => (
  <SettingsPage
    title={<MemberChip member={builder} size="lg" showHandle />}
    description={
      <span>
        Sponsored by <span className="text-foreground">{ada.user.name}</span>
      </span>
    }
    actions={
      <div className="flex flex-col gap-1">
        <Label htmlFor="page-sponsor" className="text-xs text-muted-foreground">
          Sponsor
        </Label>
        <Combobox
          items={humans}
          defaultValue={ada}
          itemToStringLabel={(human: Member) => human.user.name}
          isItemEqualToValue={(a: Member, b: Member) => a.id === b.id}
        >
          <ComboboxInput id="page-sponsor" aria-label="Change Sponsor" className="w-56" />
          <ComboboxContent>
            <ComboboxEmpty>No Human by that name.</ComboboxEmpty>
            <ComboboxList>
              {(human: Member) => (
                <ComboboxItem key={human.id} value={human}>
                  {human.user.name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    }
  >
    <SettingsSection aria-label="Projects" title="Projects">
      <ul className="flex flex-wrap gap-2">
        {granted.map((project) => (
          <li
            key={project.slug}
            className="flex items-center gap-1 rounded-md border bg-background px-2 py-1"
          >
            <span className="font-mono text-xs text-muted-foreground">{project.slug}</span>
            <span className="text-sm">{project.name}</span>
            <Button size="xs" variant="destructive" aria-label={`Revoke ${project.slug}`}>
              ×
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Label htmlFor="page-grant">Grant a Project</Label>
        <Combobox items={[] as string[]}>
          <ComboboxInput id="page-grant" className="w-72" placeholder="Choose a Project…" />
          <ComboboxContent>
            <ComboboxEmpty>No Project matches.</ComboboxEmpty>
            <ComboboxList>
              {(name: string) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    </SettingsSection>

    <SettingsSection aria-label="API keys" title="API keys">
      <ul className="flex flex-col divide-y">
        {keys.map((key) => (
          <li key={key.start} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-medium">{key.name}</span>
              <code className="font-mono text-xs text-muted-foreground">{key.start}…</code>
            </span>
            <Button size="sm" variant="destructive">
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <form className="flex items-end gap-2" onSubmit={(submitted) => submitted.preventDefault()}>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="key-name">Key name</Label>
          <Input id="key-name" placeholder="ci, laptop, the machine it runs on" />
        </div>
        <Button type="submit">Issue</Button>
      </form>
    </SettingsSection>

    <SettingsSection
      aria-label="Webhook"
      title="Webhook"
      description="Give deevy a URL for this Agent and it posts there the moment there is work in the Projects it was granted, signed with a secret you choose. Without one, the Agent still finds its work by asking every so often."
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="webhook-url">Webhook URL</Label>
        <Input id="webhook-url" inputMode="url" placeholder="https://agent.example.com/" />
        <p className="text-xs text-muted-foreground">It must be https.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="webhook-secret">Signing secret</Label>
        <div className="flex gap-2">
          <SecretInput id="webhook-secret" placeholder="whsec_…" />
          <Button variant="outline">Generate</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          At least 16 characters. deevy signs every delivery with it, and never shows it again once
          it is saved.
        </p>
      </div>
      <div>
        <Button>Start deliveries</Button>
      </div>
    </SettingsSection>

    <SettingsSection title="Recent Runs">
      <ul className="flex flex-col divide-y">
        {recent.map((run) => (
          <li key={run.id} className="flex items-center gap-3 py-2 text-sm">
            <RunStatus status={run.status} />
            <span className="font-mono text-xs">{run.record}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{run.summary}</span>
            <span className="font-mono text-xs text-muted-foreground">{run.on}</span>
          </li>
        ))}
      </ul>
    </SettingsSection>

    <SettingsSection tone="danger" title="Suspend this Agent">
      <div>
        <Button variant="outline">Suspend</Button>
      </div>
    </SettingsSection>
  </SettingsPage>
);
