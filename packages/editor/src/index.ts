import { getSchema } from "@tiptap/core";
import type { AnyExtension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { common, createLowlight } from "lowlight";
import type * as Y from "yjs";

/**
 * What a Document is made of — the one schema (ADR-0021). The browser's editor
 * and the server that serialises a version share it, because a version is the
 * markdown of a tree and two trees that disagree are two Documents.
 *
 * Only the schema lives here. How a Human types into it — placeholders, the `/`
 * menu, mentions, ⌘Enter — is the SPA's, and none of it changes what a
 * Document *is*.
 */
export function documentExtensions(options: { history?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // A room keeps the history, so that undo is your own edits rather than
      // everybody's (`@tiptap/extension-collaboration`, ADR-0021).
      ...(options.history === false ? { undoRedo: false as const } : {}),
      // Lowlight takes the code block over; the rest of the kit stays.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true },
    }),
    CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}

/** The field a room's text lives under. Tiptap's own default, so the editor needs telling nothing. */
export const DOCUMENT_FIELD = "default";

let cached: { extensions: AnyExtension[]; schema: ReturnType<typeof getSchema> } | null = null;

/** Built once: the schema is the same for every Document in the process. */
function shared() {
  if (!cached) {
    const extensions = documentExtensions();
    cached = { extensions, schema: getSchema(extensions) };
  }
  return cached;
}

/**
 * The markdown a room currently holds. No editor and no DOM: the fragment
 * becomes a ProseMirror document against the shared schema, and the markdown
 * serialiser reads that — which is what lets a version be cut by a Durable
 * Object with nobody watching.
 */
export function markdownOf(doc: Y.Doc, field: string = DOCUMENT_FIELD): string {
  const { extensions, schema } = shared();
  const fragment = doc.getXmlFragment(field);
  if (fragment.length === 0) return "";
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const manager = new MarkdownManager({ extensions });
  return manager.serialize(root.toJSON()).trim();
}

/**
 * Put markdown into a room. Used to open one from the Document's last version,
 * and to apply what an Agent wrote into a live room.
 *
 * A write that changes nothing writes nothing: the fragment is compared with
 * what it would become before it is touched, so re-opening a room does not add
 * to its history and an Agent's no-op edit is not an edit.
 *
 * Filling an *empty* room is a rebuild rather than an edit — the server
 * restarted, the object was evicted, the state was lost — and a browser that
 * was in the room still holds its own copy of the same words. So a rebuild is
 * made to depend on nothing but the text: the same markdown builds the same
 * pieces, and the two copies merge into one Document instead of two (ADR-0021).
 */
export function loadMarkdown(doc: Y.Doc, markdown: string, field: string = DOCUMENT_FIELD): void {
  if (markdownOf(doc, field) === markdown.trim()) return;

  const { extensions, schema } = shared();
  const manager = new MarkdownManager({ extensions });
  const json = markdown.trim() === "" ? { type: "doc", content: [] } : manager.parse(markdown);
  const root = ProseMirrorNode.fromJSON(schema, json);

  const fragment = doc.getXmlFragment(field);
  const rebuild = fragment.length === 0;
  const client = doc.clientID;
  if (rebuild) doc.clientID = seedClient(markdown.trim());
  try {
    doc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(root, fragment);
    });
  } finally {
    doc.clientID = client;
  }
}

/**
 * Who a rebuild is written by. Yjs tells two pieces of writing apart by the
 * client that made them, so a rebuild written by a *different* client every
 * time is a different Document every time. Deriving it from the text gives the
 * two properties this needs at once: the same words rebuild identically, and
 * different words never claim to be the same edits under another name.
 */
function seedClient(markdown: string): number {
  let hash = 2_166_136_261;
  for (let at = 0; at < markdown.length; at++) {
    hash ^= markdown.charCodeAt(at);
    hash = Math.imul(hash, 16_777_619);
  }
  // Yjs reads zero as "no client", so the one text that hashes to it gets one.
  return hash >>> 0 || 1;
}
