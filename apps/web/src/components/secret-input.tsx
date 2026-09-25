import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/**
 * A field that takes a secret an admin pastes from a tool: a token, a client
 * secret, a signing secret.
 *
 * Masked, because it is typed where a screen can be shared or recorded, and
 * kept from autofill — the browser's, and the password managers' by the
 * attributes each of them reads — because it is not a password of the
 * person's, and a manager that offers to save one, or fills a stored password
 * in, is wrong both ways. Every connect dialog showed these in the clear until
 * the Linear check (2026-09-25).
 */
export function SecretInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  return (
    <Input
      {...props}
      type="password"
      autoComplete="off"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore=""
      data-form-type="other"
    />
  );
}
