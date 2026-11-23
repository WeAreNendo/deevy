The field a secret is typed or pasted into: a token, a client secret, a webhook's signing secret. An `Input` that is always masked, `autoComplete="off"`, and marked for 1Password, LastPass, Bitwarden and Dashlane to leave alone — a token an admin pastes from a tool is not their password. Takes every `Input` prop but `type`. A secret deevy shows back once is not an input: it is mono text with a line saying it is shown once. A PEM key stays a `Textarea`.

```tsx
<Field>
  <FieldLabel htmlFor="token">Access token</FieldLabel>
  <SecretInput id="token" />
</Field>
```
