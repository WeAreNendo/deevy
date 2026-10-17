import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * The typography of everything Humans and Agents write: read mode and the
 * editor share it, so switching between them does not reflow (deevy-ui).
 * Code is coloured by lowlight in both — rehype-highlight here, the code block
 * extension there — one engine, one palette (index.css, `.hljs-*`).
 */
export const proseClassName = cn(
  "prose-deevy flex flex-col gap-3 text-sm/6 text-foreground",
  "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-2",
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-2",
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1",
  "[&_h4]:text-sm [&_h4]:font-medium",
  "[&_a]:text-link [&_a]:underline [&_a]:underline-offset-4",
  "[&_strong]:font-semibold",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs/5",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  // A task list is two DOMs: Tiptap's node view (`ul[data-type=taskList] > li >
  // label + div`, and the li carries no data-type of its own — only the static
  // renderHTML does) and remark-gfm's (`ul.contains-task-list > li.task-list-item
  // > input + text`). Both key on the list, so each item is one row: the
  // checkbox at the left, the text beside it.
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0",
  "[&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0",
  "[&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:items-start [&_ul[data-type=taskList]>li]:gap-2",
  "[&_ul.contains-task-list>li]:flex [&_ul.contains-task-list>li]:items-start [&_ul.contains-task-list>li]:gap-2",
  "[&_ul[data-type=taskList]>li>label]:mt-1 [&_ul[data-type=taskList]>li>label]:flex [&_ul[data-type=taskList]>li>label]:shrink-0",
  "[&_ul[data-type=taskList]>li>div]:min-w-0 [&_ul[data-type=taskList]>li>div]:flex-1",
  "[&_ul.contains-task-list>li>input]:mt-1 [&_ul.contains-task-list>li>input]:shrink-0",
  "[&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-primary",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
  "[&_img]:max-w-full [&_img]:rounded-md",
);

/**
 * A Document, a description or a comment. Markdown is the format Humans and
 * Agents both write, so it is rendered rather than shown as source.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn(proseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
