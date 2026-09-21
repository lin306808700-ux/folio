# Folio Agent Guide

Read this file before exploring the repository. Use `docs/codebase-map.md` as the
canonical project map and only inspect the modules relevant to the current task.

## Project Shape

- Electron main process: `src/main/`
- Context-isolated bridge: `src/preload/index.js`
- React renderer: `src/renderer/src/`
- Shared model clients: `src/shared/`
- MCP server: `src/mcp-server/`
- Architecture and subsystem notes: `docs/`

## Start Here By Task

- Chat UI or message behavior: `src/renderer/src/components/ChatPage/`
- Streaming, stop generation, protocol parsing: `ChatPage/hooks/useStreamHandler.ts`
- Sending, retries, session clearing: `ChatPage/hooks/useChatMessages.ts`
- Restoring older bubbles: `ChatPage/hooks/useHistoryRecords.ts`
- Learning model (skeleton, progress metrics, edges): `docs/learning-model.md`
- Learning maps storage and derived progress: `src/main/muse/learning-maps.js`
- Learning prompts (chapter, ask, drill, spread, portal, skeleton):
  `src/main/muse/learning-prompts.js`
- Learning UI (map, board, reader): `pages/LearningMapPage.tsx` plus
  `components/LearningMindMap.tsx`, `LearningBoard.tsx`, `LearningBookReader.tsx`
- Main-process AI streaming: `src/main/chat-handler.js`
- Chat versus agent routing: `src/main/muse/router.js`
- ReAct execution: `src/main/muse/react-engine.js`
- Tasks and tools: `src/main/task-engine/`
- IPC surface: `src/main/ipc/` plus `src/preload/index.js`
- Top-level pages and navigation: `src/renderer/src/App.tsx`,
  `components/FloatingNav.tsx`, and `pages/`

## Current Product Conventions

- Navigation labels are: 对话, 学习图谱, 变更分析, 缪斯, 作品, 历史.
- Business pages use `components/PageShell.tsx`; do not add page-specific full
  screen gradients, star fields, or competing page shells.
- The 缪斯 page intentionally contains only 来信 and 目标. Tasks belong to the
  chat workspace. Growth/data are not primary tabs.
- Global atmosphere is owned by `components/GlobalAmbient.tsx`. Its canvas uses
  28 particles, DPR capped at 1.25, follows display refresh rate, and skips draws
  while the document is hidden.
- Prefer quiet desktop-tool UI: 8px card radius, one primary action per page,
  restrained color, and no decorative permanent animation in content pages.
- Do not expose protocol payloads such as `ARTIFACT:`, `MUSE_TASK:`,
  `SCRIPT_BLOCK:`, or raw JSON in message bubbles.

## Important Behavioral Contracts

- Opening chat restores the newest 5 message bubbles, not 5 conversation pairs.
  “加载更早的对话” prepends 5 bubbles at a time.
- Starting a new session stores `chatClearedAt`, resets the model session, clears
  visible bubbles, and removes the load-more affordance. Old data remains in 历史.
- Stop generation must immediately discard typewriter buffers and protocol drafts,
  remove `protocolStreaming`, stop the loading UI, and call `ai.abortStream`.
- Main-process streaming must check its AbortSignal before parsing protocols,
  executing tools, saving history, or committing generated artifacts.
- History is newest-first on disk. Renderer bubbles must be converted back to
  chronological order before display.

## Verification

- Renderer production build: `cd src/renderer && npm run build`
- Core tests: `npm test`
- `src/renderer/package.json` has a `typecheck` script, but the repository currently
  has no renderer `tsconfig.json`; do not treat that command as valid verification.
- The production bundle is currently about 2.6 MiB and still needs route-level code
  splitting. Size warnings are known, not build failures.
- Do not modify generated `src/renderer/dist/bundle.js` manually; it is updated by
  the renderer build.

## Editing Safety

- The worktree is commonly dirty. Preserve unrelated user changes.
- Keep renderer protocol parsing and main-process protocol handling aligned.
- When changing an IPC contract, update main handler, preload bridge, and renderer
  type declarations together.
- Prefer focused tests around cancellation, persistence, and task state transitions;
  these flows cross process boundaries and regress easily.
