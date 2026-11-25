import { Toaster, toast } from "@deevy/design-system";
import { useEffect } from "react";

/** Toasts land bottom-right: a success, a plain line, and an error with a second line. The app mounts the Toaster and no screen calls `toast()`, so the words are of no product. */
export const Toasts = () => {
  useEffect(() => {
    toast.success("Saved");
    toast("Copied");
    toast.error("It could not be saved", {
      description: "Try again in a moment.",
    });
  }, []);
  return (
    <div className="min-h-64">
      <Toaster position="bottom-right" expand />
    </div>
  );
};
