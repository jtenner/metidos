export function escapeInlineJsonForHtml(json: string): string {
  const escapedParts: string[] = [];
  for (const character of json) {
    switch (character) {
      case "<":
        escapedParts.push("\\u003c");
        break;
      case ">":
        escapedParts.push("\\u003e");
        break;
      case "&":
        escapedParts.push("\\u0026");
        break;
      case "/":
        escapedParts.push("\\/");
        break;
      case "\u2028":
        escapedParts.push("\\u2028");
        break;
      case "\u2029":
        escapedParts.push("\\u2029");
        break;
      default: {
        const codePoint = character.charCodeAt(0);
        escapedParts.push(
          codePoint <= 0x1f
            ? `\\u${codePoint.toString(16).padStart(4, "0")}`
            : character,
        );
      }
    }
  }
  return escapedParts.join("");
}

export function injectMainviewHtmlBootstrapElement(
  staticHtml: string,
  bootstrapElement: string | null,
): string {
  // bootstrapElement is intentionally pre-rendered by trusted server helpers;
  // runtime JSON content must pass through escapeInlineJsonForHtml before this
  // insertion point.
  if (!bootstrapElement) {
    return staticHtml;
  }
  return staticHtml.includes("</head>")
    ? staticHtml.replace("</head>", `${bootstrapElement}\n\t</head>`)
    : `${bootstrapElement}\n${staticHtml}`;
}
