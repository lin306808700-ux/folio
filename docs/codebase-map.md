# Codebase Map

This is the working knowledge base for Folio. Keep it concise and update it
when ownership boundaries, data flows, or product contracts change.

## Runtime Architecture

Folio is an Electron application with four important boundaries:

1. `src/renderer/src/`: React UI. It owns presentation and transient UI state.
2. `src/preload/index.js`: context-isolated API exposed as `window.electronAPI`.
3. `src/main/`: Electron main process, persistence, routing, IPC, tools, and safety.
4. `src/shared/`: provider-neutral model clients used by the main process.

The renderer must not access Node APIs directly. Any new cross-process operation
needs a main IPC handler, a preload method, and a renderer type declaration.

## Request And Streaming Flow

```text
ChatPage
  -> useChatMessages.doSend
  -> callAIStream (renderer utility)
  -> preload ai API
  -> main IPC ai handler
  -> muse/router
     -> normal chat: chat-handler.handleChatStream
     -> complex task: react-engine
  -> ai:streamChunk / ai:streamEnd
  -> useStreamHandler
  -> MessageBubble renderers
```

Primary files:

| Concern | Owner |
| --- | --- |
| Chat composition | `src/renderer/src/components/ChatPage/index.tsx` |
| Message state and sending | `ChatPage/hooks/useChatMessages.ts` |
| Stream buffering and protocol state | `ChatPage/hooks/useStreamHandler.ts` |
| Protocol parsing | `ChatPage/hooks/response-parser.ts` |
| Bubble dispatch | `ChatPage/components/MessageBubble.tsx` |
| Main streaming | `src/main/chat-handler.js` |
| Chat/ReAct routing | `src/main/muse/router.js` |
| Agent loop | `src/main/muse/react-engine.js` |

### Streaming Protocols

The model may emit markers including `ARTIFACT:`, `RICH_FORM:`, `SCRIPT_BLOCK:`,
`COMMAND_OPTIONS:`, and `MUSE_TASK:`. During streaming, the renderer replaces raw
payloads with a compact generation status. At stream end it parses the complete
payload into a typed card.

Cancellation is a cross-process contract:

- The renderer freezes immediately, discards buffered/protocol content, and clears
  `protocolStreaming` before waiting for IPC.
- `ai.abortStream` aborts normal chat and requests ReAct cancellation.
- Aborted content must not be parsed, executed, stored as a completed response, or
  rendered as raw protocol text.

## Session And History Model

`src/main/database.js` stores chat history newest-first in `history.json`. Each
record contains the current query, result, and an optional cumulative message list.

The active chat is transient renderer state:

- `useHistoryRecords` converts stored records to chronological bubbles.
- Initial display is the newest 5 bubbles.
- Each load-more action prepends 5 older bubbles.
- “新会话” writes `chatClearedAt`, clears visible history pagination, and resets the
  backend session. It does not delete records from the 历史 page.

## Agent And Task Execution

- `src/main/muse/router.js` selects conversational versus agentic execution.
- `src/main/muse/react-engine.js` owns the ReAct loop, interruption, checkpoints,
  planning behavior, and tool-call progression.
- `src/main/task-engine/` owns persistent task state and tool execution.
- `src/main/task-engine/tools/` contains file, command, memory, and
  environment tools.
- `src/main/sandbox.js`, `command-policy.js`, and `security-analyzer.js` enforce
  workspace and command safety.

Cancellation must be checked before and after expensive or side-effecting work.
Never commit the result of an in-flight task after its state becomes cancelled.

## Renderer Product Structure

Routes are declared in `src/renderer/src/App.tsx`:

| Route | UI |
| --- | --- |
| `/` | Lightweight continuation screen in `components/MuseSpace/` |
| `/chat` | Main chat workspace |
| `/learning` | Persistent learning maps, knowledge nodes, mastery evidence, and current position |
| `/ideas` | 缪斯: 来信 and 目标 only |
| `/artifacts` | 作品 gallery |
| `/history` | Saved conversation records |

Shared chrome:

- `FloatingNav.tsx`: app navigation and theme control.
- `PageShell.tsx`: page title, description, count, actions, toolbar, content scroll.
- `GlobalAmbient.tsx`: the only owner of the full-window atmospheric background.
- `ThemeContext.tsx` and `styles/index.css`: semantic light/dark tokens.

Avoid page-local visual systems. Pages should remain transparent over the global
background and use semantic theme tokens. Operational content should favor scanning
and repeated action over decorative cards and animation.

## Persistence

Most app data lives below Electron `app.getPath('userData')` or the Muse home
directory. Important owners:

- General JSON data: `src/main/database.js`
- Muse config and paths: `src/main/muse/config.js`
- Tasks: `src/main/muse/tasks.js` and `src/main/task-engine/state.js`
- Goals: `src/main/muse/goals.js`
- Learning maps: `src/main/muse/learning-maps.js`
- Letters: `src/main/muse/mailbox.js`
- Artifact index: `src/main/muse/artifact-store.js`

Do not infer deletion semantics from UI wording. Verify whether an action should
clear current state, archive data, or permanently delete persisted records.

## Known Technical Debt

- Renderer bundle is approximately 2.6 MiB; routes are eagerly imported.
- Renderer `typecheck` is not functional until a `tsconfig.json` is added.
- `ChatPage/index.tsx` remains large and coordinates many independent panels.
- Protocol behavior exists across renderer and main process and needs contract tests.
- Some older documents and comments still describe removed or consolidated UI.

## Documentation Maintenance

Update this file when:

- a route or page ownership boundary changes;
- an IPC method is added or renamed;
- message/session persistence semantics change;
- a streaming protocol or cancellation behavior changes;
- verification commands or known constraints change.

Keep `AGENTS.md` as the short entry point. Put durable subsystem detail here rather
than expanding the entry point indefinitely.
