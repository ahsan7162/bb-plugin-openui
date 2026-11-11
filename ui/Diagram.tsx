// Diagram renderer: hands the Mermaid source to BB's own chat Markdown as a
// ```mermaid fence, so BB draws it like any Mermaid block in a reply (its
// theme, source toggle and full-screen view), with no Mermaid in this bundle.
import { Markdown } from "@get-bb/plugin-sdk/app";
import { useIsStreaming, type ComponentRenderer } from "@openuidev/react-lang";
import { mermaidFence } from "./mermaidFence";

export const DiagramView: ComponentRenderer<{ mermaid: string }> = ({ props }) => {
  const streaming = useIsStreaming();
  const source = (props.mermaid ?? "").trim();
  // Half-written Mermaid fails to parse; draw once the block is complete.
  if (streaming) return <div role="status" aria-label="Drawing diagram" className="openui-diagram-pending" />;
  if (source === "") return null;
  return <Markdown content={mermaidFence(source)} className="openui-diagram min-w-0 text-sm" />;
};
