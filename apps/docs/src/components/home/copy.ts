/// <reference lib="dom" />
/**
 * The landing's copy buttons. Each `[data-copy]` button is rendered hidden, so
 * nobody meets a button that cannot work, and shown here. A click copies its
 * value, says "Copied" on the button and to a screen reader, and, where the
 * clipboard is refused, selects the element its `data-copy-target` names so
 * the reader can copy it by hand. (This module is browser code; the reference
 * above gives the docs' TypeScript program the DOM's types.)
 */
const announcer = document.createElement("span");
announcer.setAttribute("role", "status");
announcer.style.cssText =
  "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
document.body.append(announcer);

const timers = new WeakMap<HTMLButtonElement, number>();

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.hidden = false;
  button.addEventListener("click", () => {
    const label = (button.dataset.label ??= button.textContent ?? "");
    clearTimeout(timers.get(button));
    const done = () => {
      button.textContent = "Copied";
      announcer.textContent = "Copied to the clipboard";
      timers.set(
        button,
        window.setTimeout(() => {
          button.textContent = label;
          announcer.textContent = "";
        }, 1400),
      );
    };
    const select = () => {
      const target = document.getElementById(button.dataset.copyTarget ?? "");
      if (!target) return;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      announcer.textContent = "Selected; copy it with your keyboard";
    };
    const text = button.dataset.copy ?? "";
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, select);
    else select();
  });
}
