import { definePlugin } from "@metidos/plugin-api";

type HelloWorldProps = {
  format: "markdown" | "text";
  name: string;
};

function validateHelloWorldProps(input: unknown): HelloWorldProps {
  const props = input && typeof input === "object" ? input : {};
  const record = props as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim().slice(0, 80)
      : "world";
  const format = record.format === "markdown" ? "markdown" : "text";
  return { format, name };
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "hello_world",
    name: "Hello world",
    description: "Return a greeting as a text or markdown tool result.",
    timeoutMs: 5000,
    validateProps: validateHelloWorldProps,
    action(_context, props) {
      const greeting = `Hello, ${props.name}!`;
      if (props.format === "markdown") {
        return {
          type: "markdown",
          markdown: `## ${greeting}\n\nThis response came from the copyable Hello Tool example plugin.`,
        };
      }
      return {
        type: "text",
        text: `${greeting} This response came from the copyable Hello Tool example plugin.`,
      };
    },
  });
});
