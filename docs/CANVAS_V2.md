# Canvas V2 — Work zones & side-panel chat

V2 shifts canvas context from **edge-linked halos** to **drawn work zones + explicit scope**, with persona chat in a right-side panel and **excerpt-to-canvas** from replies.

Default: **on** for new installs (`localStorage` key absent). Disable with:

```js
localStorage.setItem('spoor.canvasV2Enabled', 'false')
```

## MVP loop

| Step | User action | System behavior |
|------|-------------|-----------------|
| 放进去 | Draw a work zone → drag a persona in (first one claims it as **xx的房间**) → drag notes into that room, or create/paste/upload with the card center inside it | Empty zone is unbound until a persona card enters; notes get `contextScopeAgentId` from the bound persona |
| 聊起来 | Click Ask / agent card → side panel opens → optional marquee of **in-zone** cards for focus | Chat uses scoped cards; in-zone selection becomes **本轮重点**, rest of the zone is **工作区背景**. Selection outside the zone is canvas-only, not chat focus. |
| 摘出来 | Select text or full reply → **摘录到画布** | New note/AI card near persona, scoped + linked to thread message |

## Concepts

- **Work zone** — User-drawn rectangle. The first agent/Ask card whose center enters it binds the room (`{{name}}的房间`). Other personas cannot be dropped into a claimed room. Overlaps: **smallest zone wins**.
- **Context scope** — `contextScopeAgentId` on a node. Set by **drag into zone**, **creating/pasting a card whose center is already in a bound room**, or **one-time migration**. Never by nearest-agent at runtime.
- **Persona anchor** — `type: 'agent'` or `type: 'ask'`. Opens side-panel chat on click. Ask always speaks as 阿狸; agent prompts only apply when that agent card is opened.
- **Reference edges** — Always visible. They are user-drawn links for association and layout, not chat memory.

## Data (Dexie v13+)

| Store / field | Purpose |
|---------------|---------|
| `canvasWorkZones` | Drawn rectangles (`personaNodeId`, x, y, width, height) |
| `canvasPersonaThreads` | Side-panel messages per `canvasId:agentNodeId`; `composerDraft` keeps unsent input |
| `CanvasNode.contextScopeAgentId` | Which persona’s work zone owns this card |
| `CanvasNode.sourceThreadId` / `sourceMessageId` | Provenance for excerpted cards |

## Key modules

| File | Role |
|------|------|
| `src/utils/workZoneGeometry.ts` | Rect hit-testing, overlap rules |
| `src/utils/agentWorkZone.ts` | Scope collection, drag-end assignment, context payload |
| `src/utils/syncWorkZoneScopes.ts` | Reconcile all node scopes from zones |
| `src/utils/migrateCanvasToWorkZones.ts` | One-time edge/BFS migration per canvas |
| `src/utils/excerptToCanvas.ts` | Chat → canvas card |
| `src/components/canvas/CanvasChatPanel.tsx` | Side-panel UI |
| `src/components/canvas/WorkZoneRegionsLayer.tsx` | Zone rendering |

## Manual QA checklist

Use this while accepting V2 in the app.

### Work zones

- [ ] Toolbar **draw work zone** toggles crosshair; drag creates a rectangle (min ~48px) labeled **空房间** until a persona enters.
- [ ] Drag 阿狸 or an agent card into an empty zone: label becomes **xx的房间**; drawing a zone over an existing persona binds that occupant.
- [ ] Another persona dragged into a claimed room snaps back; notes can still enter.
- [ ] Dragging a note **into** a zone sets scope (only that persona’s chat sees it in background).
- [ ] Plus / upload / paste / pocket-pin / book extract **inside** a bound room stamps scope immediately (no extra drag).
- [ ] Book **思维导图**: stacked theme pile beside the book, no auto edges; if the book is in a bound room the pile joins that room’s chat even when it sits just outside the rectangle.
- [ ] Dragging **out** of all zones clears scope.
- [ ] Overlapping zones: card belongs to **smaller** zone.
- [ ] Delete / Backspace removes selected zone.

### Side-panel chat

- [ ] Closing the panel keeps unsent composer text; reopening the same persona restores it.
- [ ] Marquee **inside** the work zone: selected in-zone cards appear as focus count; **清除** clears selection.
- [ ] Marquee cards **outside** the zone: they select on the canvas but do **not** add chat focus.
- [ ] Enter draw-work-zone mode: existing zones show resize handles; drag a corner/edge to grow or shrink; cursor inside a zone is grab and drags the whole rectangle; scopes resync after move/resize.
- [ ] Reply streams; panel scrolls to latest.
- [ ] Book / AI-card text selection → **问 AI** opens that room’s side panel with the quote in the composer (no edge required). Cards outside every room show a “put it in a room” alert.
- [ ] Side-panel voice hotwords come from this persona’s work zone and recent thread, not from wired neighbors.

### Excerpt

- [ ] Text selection → **摘录** creates a note near the persona with scope (can excerpt the same reply more than once).
- [ ] Full assistant message → **摘到画布** creates an AI card and marks that message (**已摘到画布**); that full reply cannot be excerpted again.
- [ ] Thinking traces and search hits can be excerpted or dragged more than once; they do not set **已摘到画布**.
- [ ] Live web search hits appear under the assistant reply in the side panel; **摘录** or drag a hit onto the canvas (no auto-spawned source cards).
- [ ] Brain icon beside the persona name opens that turn’s thinking; excerpt or drag the thinking card onto the canvas.

### Layout & chrome

- [ ] Bottom toolbar centered on canvas; zoom bottom-right on canvas.
- [ ] With chat open: toolbar/zoom stay on canvas, not squeezed toward sidebar.
- [ ] Fullscreen: toolbar + zoom visible; exit fullscreen: no clipping (hard refresh if HMR looked wrong).

### Legacy / settings

- [ ] Old canvas: opening once runs migration (scope from edges); edges still in DB.
- [ ] User-drawn edges always stay visible; they are layout notes, not AI memory.
- [ ] V1 inline Ask composer hidden on agent/Ask cards when V2 on.
- [ ] Failed canvas AI / illustration cards have no Retry (retry lives in the side panel). V1 still retries in place.
- [ ] Ask cards have no reply-stack toggle; leftover collapsed piles unfold to saved positions.

## Tests

```bash
npm test -- tests/utils/canvasV2.test.ts \
  tests/utils/syncWorkZoneScopes.test.ts \
  tests/utils/migrateCanvasToWorkZones.test.ts \
  tests/utils/excerptToCanvas.test.ts \
  tests/utils/askSearchHits.test.ts \
  tests/components/canvas/ChatSearchHits.test.tsx \
  tests/utils/agentWorkZone.test.ts \
  tests/utils/sourceSelectionAsk.test.ts \
  tests/utils/volcAsrBias.test.ts \
  tests/services/spawnBookExpandCards.test.ts \
  tests/services/askThreadStack.test.ts
```

Coverage focus: geometry, scope sync, migration idempotency, excerpt DB writes, focus/background context text, drag-end assign/clear.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Layout wrong until restart | Dev HMR stale DOM/CSS — hard refresh or restart app |
| Zone draw does nothing | Draw tool off, or the rectangle is under ~48px. Empty rooms are allowed; they stay **空房间** until a persona enters |
| Chat empty context | Cards not in zone (no `contextScopeAgentId`) |
| V2 off | `localStorage.spoor.canvasV2Enabled === 'false'` |
