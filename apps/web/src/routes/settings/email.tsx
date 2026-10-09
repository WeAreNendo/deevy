import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { senderForms, senderLabel } from "@/lib/email-senders";
import { orpc } from "@/lib/orpc";

/**
 * Settings › Email (docs/plans/email-channel.md, slice 3): which sender this
 * Workspace sends through and where that was set, a test email to yourself,
 * and a form that sets the sender here over the environment's. Admins only;
 * the server refuses anybody else.
 */
export function EmailPage() {
  const queryClient = useQueryClient();
  const status = useQuery(orpc.email.status.queryOptions({ input: {} }));
  const [sender, setSender] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<string | null>(null);

  const data = status.data;
  // The sender in force when it can be chosen here, else the first that can:
  // the development stand-in is in force on a seeded instance and is nobody's choice.
  const inForceChoosable =
    data?.sender && data.available.includes(data.sender) ? data.sender : null;
  const chosen = sender ?? inForceChoosable ?? data?.available[0] ?? null;
  const form = chosen ? senderForms[chosen] : undefined;
  // The saved key stays unless a new one is typed: it is never read back.
  const savedHere = data?.source === "settings" && data.sender === chosen;

  useEffect(() => {
    if (!data) return;
    setFrom(data.from ?? "");
    setValues(data.config);
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.email.key() });
  const configure = useMutation(orpc.email.configure.mutationOptions({ onSuccess: refresh }));
  const clear = useMutation(orpc.email.clear.mutationOptions({ onSuccess: refresh }));
  const test = useMutation(
    orpc.email.test.mutationOptions({
      onSuccess: (result) =>
        setTested(
          result.delivered
            ? `Sent to ${result.to}. If it isn't there in a minute, look in spam.`
            : `The sender refused it: ${result.error ?? String(result.status)}`,
        ),
    }),
  );
  const failed = configure.error ?? clear.error ?? test.error;

  return (
    <SettingsPage title="Email">
      {status.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {data ? (
        <SettingsSection title="Sending">
          {data.sender ? (
            <p className="text-sm">
              Sending through {senderLabel(data.sender)}, as {data.from}.{" "}
              <span className="text-muted-foreground">
                {data.source === "settings"
                  ? "Set here, over the environment's."
                  : "It was set in this deployment's environment."}
              </span>
            </p>
          ) : null}
          {data.problem ? <p className="text-sm text-destructive">{data.problem}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!data.runnable || test.isPending}
              onClick={() => test.mutate({})}
            >
              Send a test email
            </Button>
            {data.source === "settings" ? (
              <Button variant="outline" disabled={clear.isPending} onClick={() => clear.mutate({})}>
                Use the environment's sender
              </Button>
            ) : null}
          </div>
          {tested ? <p className="text-sm text-muted-foreground">{tested}</p> : null}
        </SettingsSection>
      ) : null}

      {data && data.available.length > 0 ? (
        <SettingsSection
          title="Set the sender here"
          description="Overrides the environment's until you clear it. The key is sealed and never shown again."
        >
          <form
            aria-label="Set the sender here"
            className="flex flex-col gap-4"
            onSubmit={(submitted) => {
              submitted.preventDefault();
              if (!chosen || !form) return;
              const config: Record<string, string> = {};
              const credentials: Record<string, string> = {};
              for (const field of form.fields) {
                const value = (values[field.key] ?? "").trim();
                if (value) (field.secret ? credentials : config)[field.key] = value;
              }
              configure.mutate({
                sender: chosen as "resend",
                from: from.trim(),
                config,
                credentials,
              });
            }}
          >
            {data.available.length > 1 ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="email-sender">Sender</Label>
                <Select value={chosen} onValueChange={(next) => setSender(next)}>
                  <SelectTrigger id="email-sender" className="w-56">
                    <SelectValue>{(selected: string) => senderLabel(selected)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {data.available.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {senderLabel(kind)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sender: {senderLabel(chosen)}</p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-from">From</Label>
              <Input
                id="email-from"
                value={from}
                placeholder="deevy <deevy@yourcompany.com>"
                onChange={(changed) => setFrom(changed.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Its domain is the one your sender must have verified.
              </p>
            </div>
            {form?.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-2">
                <Label htmlFor={`email-${field.key}`}>{field.label}</Label>
                <Input
                  id={`email-${field.key}`}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  value={values[field.key] ?? ""}
                  placeholder={
                    field.secret && savedHere
                      ? "Saved. Type a new one to replace it."
                      : field.placeholder
                  }
                  onChange={(changed) =>
                    setValues((current) => ({ ...current, [field.key]: changed.target.value }))
                  }
                />
                {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
              </div>
            ))}
            <div>
              <Button type="submit" disabled={configure.isPending || !from.trim()}>
                Save
              </Button>
            </div>
          </form>
        </SettingsSection>
      ) : null}

      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}
    </SettingsPage>
  );
}
