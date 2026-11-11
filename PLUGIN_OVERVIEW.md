## What you get

- Agents can put OpenUI Lang programs in their replies (` ```openui-lang ` blocks). BB draws them inline with OpenUI's React renderer and its built-in component library: cards, charts, tables, forms, tabs and more.
- Buttons and forms send the user's answer back into the thread as their next message.
- `check_openui` and `openui_examples` tools let an agent check a block or see working examples first.

## Requirements and costs

- BB 0.49 or later (uses the experimental code-fence renderer slot).
- About 8,000 tokens of instructions (OpenUI's generated prompt) in each session a person reads. Worker threads get none.
- No OpenUI Gateway and no API key. Gateway's automatic error correction is not used, so a block with no renderable root shows as code.
- Network: blocks load the image URLs the agent writes (OpenUI's prompt suggests picsum.photos), and source/citation components load site icons from Google's favicon service. These see your IP address and the domains shown.
- Form input is not saved: it resets when the reply scrolls out of view or the thread reloads.
- Running it together with genui gives agents two UI languages and both prompts. Turn one off.
