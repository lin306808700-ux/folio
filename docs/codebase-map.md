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
- Learning preferences (prefetch toggle): `src/main/muse/learning-settings.js`
- Letters: `src/main/muse/mailbox.js`
- Artifact index: `src/main/muse/artifact-store.js`

Do not infer deletion semantics from UI wording. Verify whether an action should
clear current state, archive data, or permanently delete persisted records.

## Learning Maps

The learning subsystem has its own data contract beyond the shared persistence
rules above. The model itself is specified in
[docs/learning-model.md](learning-model.md) — read that before changing it.

- `list()` returns full maps including chapter bodies. Batch views (tree, mind
  map, board, prefetch queue) use `listMeta()` instead and fetch one node's body
  on demand with `getNode(mapId, nodeId)`.
- `learning-maps.js` keeps a read cache keyed by file stamp; `list`/`get`/
  `updateNode` are called on every interaction and must not re-parse the whole
  file. Writes update the cache in place.
- `load()` normalizes legacy records in place (`origin: 'user'`, `edges: []`,
  `lastReviewedAt: ''`, empty `canon`). There is no migration script and no
  destructive rewrite; defaults persist on the next write.
- Three structural layers, do not collapse them:
  - **canon** — AI-generated domain skeleton. `node.origin === 'canon'` marks
    skeleton nodes; `map.canon` records the generation. This is the denominator.
  - **personal graph** — the tree, expressed by `parentId`.
  - **edges** — the second kind of relation: `prereq` / `peer` / `portal`.
    `parentId` only expresses “belongs to”; peer and cross-domain relations need
    edges. `portal` edges deliberately do **not** create a new map — the target
    domain may not exist yet, so only `targetTitle` is required.
- `computeProgress(map)` is the single source for the two progress metrics
  (coverage = entered / denominator; mastery = Σ weight × decay / denominator).
  Renderer must consume it from `listMeta()` and never re-derive it.
  `basedOn` degrades to `'graph'` for maps without skeleton nodes.
- `masteryScore` is status weight × time decay (half-life 60 days, floored at
  0.5); `stale` marks nodes that have decayed enough to warrant review. Decay
  never mutates persisted `status`.
- `deleteNode` removes the whole subtree, re-points `currentNodeId` to the
  surviving parent, and prunes edges pointing at deleted nodes. The only root
  node cannot be deleted on its own; use `deleteMap` instead.
- Chapter bodies, Q&A records, and quiz records are capped at the newest
  entries. The store normalizes by `createdAt`, so callers may append or
  prepend freely.
- `status` is user-authoritative and may move in both directions. Automatic
  transitions (quiz grading) only ever upgrade, and record their source in
  `verifiedBy` (`manual` | `quiz`). Status changes and quiz submissions also
  reset `lastReviewedAt`.
- Guidance records from chapter quizzes carry both `nodeId` (authoritative) and
  `nodeTitle` (display only). Resolve navigation by `nodeId` first; titles can be
  renamed or duplicated.
- Background chapter prefetch is a user-visible capability: it is gated by
  `learning-settings.js`, per-node failures back off and are eventually skipped
  rather than blocking the queue head. Its queue predicate is `!content` — it
  ignores `status` and `origin` deliberately.
- `content` and `status` are independent facts: `content` means “this page is
  written”, `status` means “how far I have studied”. Prefetch writes bodies for
  `unexplored` nodes on purpose, so **never infer progress from body presence**.
  The bundled demo bakes bodies for all 81 nodes (empty prefetch queue), which is
  what keeps the sample complete in environments with no AI access.
- `learning-prompts.js` is the single generation contract shared by the
  interactive path (`muse-handlers.js`) and the background path
  (`learning-prefetch.js`). Keep them fed with the same inputs or the two paths
  will produce chapters that disagree about scope:
  - `kind: 'content'` requires `outlineTitles` (title-only indented tree) and
    `siblingTitles`. Without neighbourhood context every chapter re-explains the
    background, so chapters overlap and the structure loosens. `outlineTitles`
    is deliberately title-only — `nodeDirectory` carries internal ids for the
    grading prompt and must not be reused here.
  - `kind: 'skeleton'` may return **three** levels; `parseSkeletonNodes` walks
    them recursively under a depth (3) and total-node (120) cap and writes real
    parent ids. Branch nodes are written before their children, so insertion
    order matters only for readability.
  - The chapter skeleton is `### 技术要点 → ### 深入讲解 → ### 实例 →
    ### 常见误区与考点` (h3, matching every chapter already in the repo).
    Section 3 is `### 代码实例` for engineering topics and `### 实例与证据` for
    non-engineering ones — the contract is topic-adaptive, not tech-only.
- The bundled demo's chapter sources live in
  `scripts/builtin-agent-3month/`: `outline.js` (tree, statuses, timeline,
  edges), `dialogue.js` (Q&A + quizzes), and several `chapters*.md` files.
  `generate-builtin-3month-demo.js` loads **every** `chapters.md` /
  `chapters-*.md` in that directory and fails on a duplicate node id across
  files — split files on purpose so a one-chapter diff stays small.
  `scripts/verify-demo.js` prints an inspection report; run it after touching
  the demo.
- Provider failures can arrive as **plain stdout text**. `qodercli` writes quota
  and auth errors to stdout (`Qoder API error: FORBIDDEN - {…}`), which a naive
  stream reader cannot tell apart from model output. `src/shared/ai-error.js`
  holds the single predicate for that shape:
  - `model-provider.js` turns it into a thrown error (in both the one-shot and
    streaming Qoder paths), so a failed call can never look like a success.
  - `learning-prefetch.js` drops it and records a failure instead of persisting.
  - `seedBuiltinMaps` treats stored pollution as “no content”, so a seed can
    repair it — otherwise the non-empty garbage permanently blocks the backfill.
  The predicate is deliberately length-capped and narrow: it must never match
  real prose (a chapter explaining `403 FORBIDDEN` is not an error).
- Requiring `learning-maps.js` seeds the built-in maps as a **module side
  effect**. It is skipped under `node:test` (guarded by `NODE_TEST_CONTEXT`) so
  running the suite never rewrites the developer's real
  `~/.folio/muse/learning-maps.json`.
- `addNodes` exists because skeleton generation inserts tens of nodes at once;
  do not loop `addNode` over IPC for that. It skips items whose parent is
  missing and throws when nothing valid remains.
- Expansion actions are four orthogonal directions, not variations of one:
  drill (children), spread (peers — insert under the **parent**, otherwise the
  tree degenerates into a chain), portal (edges), and breadcrumb navigation.
- `learning-seeds.js` is the only place built-in maps enter the store. It must
  preserve the whole three-layer shape (`origin`, `edges`, `qa`, `quiz`,
  `lastReviewedAt`, `canon`) — dropping a field silently degrades the seed back
  into a plain tree, which is exactly the bug the model was built to fix.
- Seed timestamps may be written as relative days (`createdDaysAgo`,
  `reviewedDaysAgo`, `daysAgo`) and are materialized at load. A map that
  demonstrates decay **must** be dated relative to today, or it rots on the
  calendar. Nodes given no review time keep `lastReviewedAt: ''` — never invent
  a decay start for them.
- The published demo map (`builtin-learning-maps.demo.json`) is a deliberately
  complete example of a map after months of use. Regenerate it with
  `node scripts/generate-builtin-3month-demo.js`; sources live in
  `scripts/builtin-agent-3month/`. The generator reuses chapter bodies from the
  file it is about to overwrite, so re-running is stable.
- Replacing a built-in map takes a new id plus an entry in
  `DEPRECATED_BUILTIN_IDS`; the superseded map is removed on startup (built-in
  ids only, user maps are never touched).

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
