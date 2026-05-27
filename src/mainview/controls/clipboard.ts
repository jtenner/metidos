export function copyTextToClipboard(text: string): void {
  const payload = text.trim();
  if (!payload) {
    return;
  }

  const fallbackCopy = (): boolean => {
    if (typeof document === "undefined") {
      return false;
    }
    const textarea = document.createElement("textarea");
    textarea.value = payload;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  };

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    void navigator.clipboard.writeText(payload).catch(() => {
      fallbackCopy();
    });
    return;
  }

  fallbackCopy();
}
