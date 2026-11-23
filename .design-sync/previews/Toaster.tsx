import { Toaster, toast } from "@deevy/design-system";
import { useEffect } from "react";

/** Toasts land bottom-right: a success with the record's key, a plain confirmation, and an error with what to do. */
export const Toasts = () => {
  useEffect(() => {
    toast.success("Approved plan on acme/deevy#412");
    toast("Copied run_8k2m4q9x1z7c");
    toast.error("Could not approve the Gate", {
      description: "Grace Hopper ruled on it a moment ago. Reload to see the ruling.",
    });
  }, []);
  return (
    <div className="min-h-64">
      <Toaster position="bottom-right" expand />
    </div>
  );
};
