// bb-plugin-openui frontend. Renders ```openui-lang fences in agent replies
// with OpenUI's React renderer and built-in library. React and the SDK are
// shimmed to BB's copies by `bb plugin build`.
import "@openuidev/react-ui/layered/styles/index.css";
import "./app.css";
import "./ui/components/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useSdk,
  type ExperimentalCodeFenceRendererProps,
} from "@get-bb/plugin-sdk/app";
import { BuiltinActionType, Renderer, type ActionEvent, type ElementNode } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { answerLines, collectForms } from "./ui/answers";
import { DiagramView } from "./ui/Diagram";
import { FenceContext } from "./ui/data";
import { buildLibrary } from "./ui/library";
import { useBbTheme } from "./ui/theme";

const LANGUAGES = ["openui-lang", "openui"] as const;
// Module scope: OpenUI parsers memoize by library identity.
const library = buildLibrary(DiagramView);

/** BB marks its dark theme with a `dark` class on the root element. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** What the user sends on a click: the button's message, then one "question answer" line per form field. */
export function toModelMessage(event: ActionEvent, root: ElementNode | null): string {
  const answers = event.formName !== undefined || event.formState ? answerLines(collectForms(root), event.formState, event.formName) : [];
  return [event.humanFriendlyMessage, ...answers].join("\n");
}

function OpenUiFence({ code, status, message, Original }: ExperimentalCodeFenceRendererProps) {
  const fence = useMemo(() => ({ threadId: message.threadId, messageId: message.id }), [message.threadId, message.id]);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const dark = useDarkMode();
  const theme = useBbTheme(dark);
  const [failed, setFailed] = useState(false);
  const root = useRef<ElementNode | null>(null);

  const onAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === BuiltinActionType.ContinueConversation) {
        void sdk.threads.send({
          threadId: message.threadId,
          mode: "queue-if-active",
          input: [{ type: "text", text: toModelMessage(event, root.current), mentions: [] }],
        });
      } else if (event.type === BuiltinActionType.OpenUrl && typeof event.params?.url === "string") {
        navigate.openUrl(event.params.url);
      }
    },
    [sdk, navigate, message.threadId],
  );

  // A program with no renderable root (bad output, or an interrupted reply) shows as code.
  if (failed && status !== "streaming") return <Original />;
  return (
    <FenceContext.Provider value={fence}>
      <div className="openui-fence">
        {/* Unscoped on purpose: Radix popups (Select, Tooltip) portal to body and need the variables there. */}
        <ThemeProvider mode={dark ? "dark" : "light"} lightTheme={theme} darkTheme={theme}>
          <Renderer
            response={code}
            library={library}
            isStreaming={status === "streaming"}
            onAction={onAction}
            onParseResult={(result) => {
              root.current = result?.root ?? null;
              setFailed(result === null || result.root === null);
            }}
          />
        </ThemeProvider>
      </div>
    </FenceContext.Provider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_codeFenceRenderer({ id: "openui", languages: LANGUAGES, component: OpenUiFence });
});
