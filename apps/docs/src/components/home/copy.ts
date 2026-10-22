/// <reference lib="dom" />
/**
 * The landing's copy buttons: a `[data-copy]` button copies its value, says
 * so for a moment, and selects the text beside it where the clipboard is
 * refused. It runs in the browser, so it alone of src/ takes the DOM types.
 */
document.addEventListener("click", (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-copy]");
  if (!button) return;
  const text = button.dataset.copy ?? "";
  const was = button.textContent;
  const done = () => {
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = was), 1400);
  };
  const select = () => {
    const code = button.parentElement?.querySelector("code, p");
    if (!code) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, select);
  else select();
});
