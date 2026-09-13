import { DOCUMENT_FIELD, documentExtensions } from "@deevy/editor";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { Editor, Extension, type Range } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { PluginKey } from "@tiptap/pm/state";
import { EditorContent, ReactRenderer, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { BubbleMenu } from "@tiptap/react/menus";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Table as TableIcon,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { proseClassName } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type EditorMode = "block" | "inline";

/** Someone a `@` can name: a Member or a Team, by handle. */
export interface Mentionable {
  handle: string;
  name: string;
  kind: "human" | "agent" | "team";
}

export interface TiptapEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  mode: EditorMode;
  placeholder?: string;
  mentions?: Mentionable[];
  /** ⌘Enter, the one submit key everywhere (.claude/skills/deevy-ui). */
  onSubmit?: () => void;
  autoFocus?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  /** The live Document this is a view of, when it is in a room. */
  room?: { doc: Y.Doc; awareness: Awareness; me?: { name: string; color: string } };
}

const lowlight = createLowlight(common);

// ------------------------------------------------------------- suggestions

interface SuggestionItem {
  id: string;
  label: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  run: (editor: Editor, range: Range) => void;
}

interface ListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * The popup under a `@` or a `/`: a listbox the arrow keys walk and Enter
 * picks. `aria-label` is the contract the comments test looks for
 * ("Mentions"), so it is the caller's to name.
 */
const SuggestionList = forwardRef<
  ListHandle,
  { items: SuggestionItem[]; command: (item: SuggestionItem) => void; label: string }
>(function SuggestionList({ items, command, label }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowDown") {
        setIndex((current) => (current + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((current) => (current - 1 + items.length) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item) command(item);
        return Boolean(item);
      }
      return false;
    },
  }));
  if (items.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label={label}
      className="z-50 min-w-48 rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      {items.map((item, at) => {
        const Icon = item.icon;
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={at === index}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5",
              at === index && "bg-accent",
            )}
            onMouseEnter={() => setIndex(at)}
            onMouseDown={(event) => {
              event.preventDefault();
              command(item);
            }}
          >
            {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
            <span>{item.label}</span>
            {item.hint ? (
              <span className="ml-auto font-mono text-xs text-muted-foreground">{item.hint}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

/** Wires a SuggestionList to Tiptap's suggestion plugin, positioned at the caret. */
function popup(label: string): SuggestionOptions<SuggestionItem>["render"] {
  return () => {
    let renderer: ReactRenderer<ListHandle> | null = null;
    let host: HTMLDivElement | null = null;
    /*
     * Where the caret is, asked again each time rather than remembered: the
     * popup is `fixed` to the viewport and the line it belongs to is not, so
     * anything that moves the line — a scroll, a resize — has to move the
     * popup with it, or the menu drifts away from the words it is about.
     */
    let caret: (() => DOMRect | null) | null = null;
    const place = () => {
      const rect = caret?.();
      if (!host || !rect) return;
      host.style.left = `${String(rect.left)}px`;
      host.style.top = `${String(rect.bottom + 4)}px`;
    };
    // Capture: the scroll that moves the caret is usually a pane's or the
    // peek's rather than the window's, and those do not bubble.
    const follow = () => place();
    const watch = () => {
      window.addEventListener("scroll", follow, true);
      window.addEventListener("resize", follow);
    };
    const unwatch = () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
    const close = () => {
      unwatch();
      host?.remove();
      host = null;
    };
    return {
      onStart(props) {
        renderer = new ReactRenderer(SuggestionList, {
          props: { items: props.items, command: props.command, label },
          editor: props.editor,
        });
        host = document.createElement("div");
        host.style.position = "fixed";
        host.style.zIndex = "50";
        host.appendChild(renderer.element);
        document.body.appendChild(host);
        caret = props.clientRect ?? null;
        place();
        watch();
      },
      onUpdate(props) {
        renderer?.updateProps({ items: props.items, command: props.command, label });
        caret = props.clientRect ?? null;
        place();
      },
      onKeyDown({ event }) {
        if (event.key === "Escape") {
          close();
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        close();
        renderer?.destroy();
        renderer = null;
        caret = null;
      },
    };
  };
}

/**
 * `@`: the handle goes in as text — `@ada` — and nothing else. Markdown is the
 * one format a Document is stored in, and the server already resolves handles
 * in text (packages/core/src/mentions.ts); a mention node would be a second
 * representation with a lossy bridge (docs/plans/ui-redesign.md).
 */
function mentionSuggestion(candidates: () => Mentionable[]) {
  return Extension.create({
    name: "mentionText",
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem>({
          editor: this.editor,
          char: "@",
          // Two suggestion plugins in one editor need two keys; the default is one.
          pluginKey: new PluginKey("mentionSuggestion"),
          items: ({ query }) => {
            const q = query.toLowerCase();
            return candidates()
              .filter(
                (candidate) =>
                  candidate.handle.toLowerCase().includes(q) ||
                  candidate.name.toLowerCase().includes(q),
              )
              .slice(0, 8)
              .map((candidate) => ({
                id: candidate.handle,
                label: `@${candidate.handle}`,
                hint: candidate.kind === "team" ? "Team" : candidate.name,
                run: (editor, range) =>
                  editor.chain().focus().insertContentAt(range, `@${candidate.handle} `).run(),
              }));
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: popup("Mentions"),
        }),
      ];
    },
  });
}

const blockCommands: SuggestionItem[] = [
  {
    id: "h1",
    label: "Heading 1",
    hint: "#",
    icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "##",
    icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "###",
    icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "bullets",
    label: "Bullet list",
    hint: "-",
    icon: List,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "numbers",
    label: "Numbered list",
    hint: "1.",
    icon: ListOrdered,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "tasks",
    label: "Task list",
    hint: "[ ]",
    icon: ListChecks,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "table",
    label: "Table",
    icon: TableIcon,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "code",
    label: "Code block",
    hint: "```",
    icon: SquareCode,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: ">",
    icon: Quote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: "rule",
    label: "Divider",
    hint: "---",
    icon: Minus,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

/** `/` at the start of a line: the block a Human wants, by name. */
const slashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem>({
        editor: this.editor,
        char: "/",
        pluginKey: new PluginKey("slashCommands"),
        startOfLine: true,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return blockCommands.filter((command) => command.label.toLowerCase().includes(q));
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popup("Commands"),
      }),
    ];
  },
});

// -------------------------------------------------------------- extensions

/**
 * The extensions a mode uses. Exported so a test can round-trip markdown
 * through a headless Editor with exactly what the component uses.
 */
export function editorExtensions(options: {
  mode: EditorMode;
  placeholder?: string;
  mentions?: () => Mentionable[];
  onSubmit?: () => void;
  /** The live Document this editor is a view of, when it is in a room. */
  room?: { doc: Y.Doc; awareness: Awareness; me?: { name: string; color: string } };
}) {
  const block = options.mode === "block";
  const submit = Extension.create({
    name: "submitOnModEnter",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          options.onSubmit?.();
          return Boolean(options.onSubmit);
        },
      };
    },
  });
  return [
    // A Document's schema is shared with the server that serialises its
    // versions (`@deevy/editor`, ADR-0021): two schemas that drift are two
    // Documents. A comment is not versioned and does not want headings or
    // tables, so `inline` keeps its own narrower list.
    ...(block
      ? documentExtensions({ history: !options.room })
      : [
          StarterKit.configure({
            // Lowlight takes the code block over; the rest of the kit stays.
            codeBlock: false,
            heading: false,
            blockquote: false,
            horizontalRule: false,
            bulletList: false,
            orderedList: false,
            listItem: false,
            link: { openOnClick: false, autolink: true },
          }),
          CodeBlockLowlight.configure({ lowlight }),
          Markdown.configure({ markedOptions: { gfm: true } }),
        ]),
    Placeholder.configure({ placeholder: options.placeholder ?? "" }),
    // In a room the text belongs to the Yjs document rather than to this
    // browser: history is the room's (undo of your own edits, not everybody's),
    // and the caret extension draws the other Members where they are.
    ...(options.room
      ? [
          Collaboration.configure({ document: options.room.doc, field: DOCUMENT_FIELD }),
          CollaborationCaret.configure({
            provider: { awareness: options.room.awareness },
            user: options.room.me ?? { name: "Somebody", color: "#6366f1" },
          }),
        ]
      : []),
    mentionSuggestion(options.mentions ?? (() => [])),
    ...(block ? [slashCommands] : []),
    submit,
  ];
}

/** What the editor holds, as markdown — the only thing that ever leaves it. */
export function toMarkdown(editor: Editor): string {
  return editor.getMarkdown();
}

// --------------------------------------------------------------- component

/**
 * Tiptap, holding markdown and nothing else (docs/plans/ui-redesign.md,
 * "Editing"). The parent hands in `value`; every change the Human makes comes
 * back through `onChange` as markdown; a `value` that changes from outside
 * (the Source tab) is loaded without an update event, so an untouched
 * Document is never re-serialized.
 */
export default function TiptapEditor({
  value,
  onChange,
  mode,
  placeholder,
  mentions = [],
  onSubmit,
  autoFocus = false,
  id,
  "aria-label": ariaLabel,
  className,
  room,
}: TiptapEditorProps) {
  const mentionRef = useRef(mentions);
  mentionRef.current = mentions;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const lastEmitted = useRef(value);
  // useEditor compares its options on every render and re-applies any that
  // changed, so the extensions, the editor props and the content are kept
  // stable: the callbacks reach the latest props through the refs above, and
  // `value` after the first render is loaded by the effect below.
  const initial = useRef(value);
  const extensions = useMemo(
    () =>
      editorExtensions({
        mode,
        placeholder,
        mentions: () => mentionRef.current,
        onSubmit: () => submitRef.current?.(),
        ...(room ? { room } : {}),
      }),
    [mode, placeholder, room],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: cn(proseClassName, "min-h-24 px-3 py-2 outline-none", className),
        ...(id ? { id } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        role: "textbox",
        "aria-multiline": "true",
      },
    }),
    [className, id, ariaLabel],
  );

  const editor = useEditor({
    extensions,
    // In a room the content is whatever the room holds; Collaboration fills the
    // editor from the Yjs document and content of our own would race it.
    ...(room ? {} : { content: initial.current, contentType: "markdown" as const }),
    autofocus: autoFocus ? "end" : false,
    editorProps,
    onUpdate: ({ editor: current }) => {
      // A room writes its own versions when it goes quiet, so nobody is asked
      // to save: `onChange` is for the editors that are still a view of props.
      if (room) return;
      const markdown = toMarkdown(current);
      lastEmitted.current = markdown;
      onChange(markdown);
    },
  });

  // A `value` changed outside the editor: load it, quietly. Never in a room —
  // there the text belongs to everybody in it, and writing the page's older
  // copy over the live one would undo whatever somebody else just typed.
  useEffect(() => {
    if (room || !editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value, room]);

  return (
    <div data-slot="markdown-editor" className="flex flex-col">
      {/*
       * The formatting is where the words are: a bubble over the selection
       * rather than a strip above the editor. A Document, a description and a
       * comment are all read far more often than they are formatted, and a
       * toolbar that is always there is chrome on every one of those readings.
       * What to *insert* — a table, a divider, a code block — is the `/` menu,
       * which is where it belongs: those are not things a selection becomes.
       */}
      {editor && mode === "block" ? (
        <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }}>
          <Toolbar editor={editor} />
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      className={cn(active && "bg-accent")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * What a selection can become. Rendered inside a `BubbleMenu`, so it exists
 * only while there is something selected — exported because that makes it
 * unreachable to a test with no layout, and the buttons are worth testing.
 */
export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      code: current.isActive("code"),
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullets: current.isActive("bulletList"),
      numbers: current.isActive("orderedList"),
      tasks: current.isActive("taskList"),
      quote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-md"
    >
      <ToolButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Code" active={state.code} onClick={() => chain().toggleCode().run()}>
        <Code />
      </ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolButton
        label="Heading 1"
        active={state.h1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolButton>
      <ToolButton
        label="Heading 2"
        active={state.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolButton>
      <ToolButton
        label="Heading 3"
        active={state.h3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolButton
        label="Bullet list"
        active={state.bullets}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.numbers}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="Task list"
        active={state.tasks}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecks />
      </ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolButton
        label="Quote"
        active={state.quote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={state.codeBlock}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <SquareCode />
      </ToolButton>
    </div>
  );
}
