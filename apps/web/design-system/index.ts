/**
 * deevy's design system, as one entry for the Claude Design sync (`/design-sync`,
 * `.design-sync/`). Everything a screen is built from that renders on its own:
 * the shadcn base-mira kit in `components/ui`, and deevy's own chips, badges,
 * headers, tables, logo and sign-in buttons. Components bound to the API or the
 * router (AppBreadcrumb, CommandPalette, GateControls, ItemEvents, WorkFilters,
 * the connect dialogs, the Project binding…) are deliberately absent: a design
 * tool has no Workspace to query. Add a component here AND to families.json.
 */

// The kit (shadcn base-mira, Base UI)
export * from "@/components/ui/alert";
export * from "@/components/ui/alert-dialog";
export * from "@/components/ui/avatar";
export * from "@/components/ui/badge";
export * from "@/components/ui/breadcrumb";
export * from "@/components/ui/button";
export * from "@/components/ui/button-group";
export * from "@/components/ui/card";
export * from "@/components/ui/checkbox";
export * from "@/components/ui/collapsible";
export * from "@/components/ui/combobox";
export * from "@/components/ui/command";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/empty";
export * from "@/components/ui/field";
export * from "@/components/ui/input";
export * from "@/components/ui/input-group";
export * from "@/components/ui/item";
export * from "@/components/ui/kbd";
export * from "@/components/ui/label";
export * from "@/components/ui/popover";
export * from "@/components/ui/resizable";
export * from "@/components/ui/scroll-area";
export * from "@/components/ui/select";
export * from "@/components/ui/separator";
export * from "@/components/ui/sheet";
export * from "@/components/ui/sidebar";
export * from "@/components/ui/skeleton";
export * from "@/components/ui/sonner";
// The `toast()` that reaches the kit's Toaster: a second copy of sonner would write to a store it never reads.
export { toast } from "sonner";
export * from "@/components/ui/spinner";
export * from "@/components/ui/switch";
export * from "@/components/ui/table";
export * from "@/components/ui/tabs";
export * from "@/components/ui/textarea";
export * from "@/components/ui/toggle";
export * from "@/components/ui/toggle-group";
export * from "@/components/ui/tooltip";

// deevy's own
export * from "@/components/data-table";
export * from "@/components/deevy-logo";
export * from "@/components/kbd-hint";
export * from "@/components/markdown";
export * from "@/components/member-chip";
export * from "@/components/page-header";
export * from "@/components/rail-heading";
export * from "@/components/run-status";
export * from "@/components/secret-input";
export * from "@/components/settings-page";
export * from "@/components/sign-in-button";
export { cn } from "@/lib/utils";
