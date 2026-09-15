# Spoor Agents

Spoor is built around canvas-native AI agents: small, opinionated thinking partners that live beside the user's notes instead of sitting in a separate chat window. Each agent has a distinct reasoning style, reads selected canvas context, and returns compact insights that can be saved back into the workspace as new notes.

## Agent Model

Spoor treats an agent as a configurable persona with:

- A name and role shown in the canvas UI.
- A system prompt that defines its reasoning style.
- Model settings such as temperature and top-p.
- Canvas context collected from selected or nearby notes.
- Optional image context from connected image nodes when the selected provider supports vision.

The user can keep the default agents, customize their prompts in the Agents Studio, or test them in a sandbox conversation before using them on the canvas.

## Default Agents

### The Mirror of Insight

The Mirror of Insight is a critical reasoning partner. It challenges assumptions, finds weak premises, and asks sharp counter-questions without trying to win an argument. It is useful when a note contains a claim, plan, thesis, or decision that needs pressure testing.

### The Weaver

The Weaver is a synthesis agent. It looks across notes and identifies hidden similarities, oppositions, or complementary patterns. It is designed to produce one concise connection rather than a generic summary.

### The Smoothing Iron

The Smoothing Iron is a language experiment agent. It takes a sentence or draft fragment and explores alternate structures, compressed versions, emotional variants, and syntactic transformations. It is not just a polishing tool; it helps the user understand how language can be rebuilt.

### The Star-Gazer

The Star-Gazer is a scenario thinking agent. It turns uncertain situations into short future-facing reflections, naming possible forks, early signals, second-order effects, and overlooked uncertainty.

### Cosmos Weaver（造宇宙）

Cosmos Weaver turns plain-language pain notes into a science-fiction or fantasy narrative cosmos using open narrative grammar (core structure → metaphor map → role → extensions). It ships with a short Markdown knowledge file of templates and **creative boundaries**: it is a co-author, not a therapist — no diagnosis, prescriptions, or crisis-care claims.

### Character Atelier（角色工坊）

Character Atelier expands cast, scenes, props, and small rituals inside an existing cosmos on the canvas. It shares the same narrative-grammar knowledge base and stays inside the metaphor universe already established by linked notes.

## Trauma Inner Cosmos canvas template

From the canvas history menu, users can create a **Trauma Inner Cosmos** workspace (`Canvas.template = 'cosmos'`) in addition to a blank canvas. The template seeds two theme zones (world / characters), starter notes (four questions + pain prompt), and pre-placed Cosmos Weaver / Character Atelier agent cards with guide edges. The default Main Workspace first-run seed (Memory Architect) is unchanged.

## Canvas Workflow

Agents are designed to work inside a spatial note-taking flow:

1. The user creates or imports notes on the canvas.
2. The user selects a note, drags an agent near a note, or starts an AI action from the toolbar.
3. Spoor extracts clean text from the relevant note content, excluding UI labels where possible.
4. The selected agent receives the note context together with its system prompt.
5. The result appears as an AI note on the canvas, where it can be connected, edited, or followed up.

This keeps AI output in the same thinking space as the original material, so every response can become part of the user's knowledge map.

## Follow-Up Reasoning

When an agent creates an AI note, Spoor stores enough thread metadata to support contextual follow-up. A later question can include:

- The original root note.
- The agent persona used for the first response.
- The dialogue chain of previous AI notes.
- Connected image context when available.

This gives each agent continuity without forcing the user into a linear chat-only interface.

## Multi-Agent Discussion

When an agent card is linked to **at least one other agent** and **one note with content**, a **Discussion** control appears beside Run analysis. Starting a discussion runs one back-and-forth (two turns): each turn becomes a vertical AI card whose `userTurn` shows the speaking persona. Cards share `threadDiscussionId` / `threadDiscussionAgentIds`. The latest reply shows **Continue for another round**, which appends another two-turn exchange. The listener can also interrupt on the leaf card; the next persona in rotation answers with the full discussion transcript.

## Canvas web search

There is no separate Research Lab. Live retrieval happens on the canvas: when Metaso (or hosted search after sign-in) is available, an agent reply can request web, image, video, or podcast hits, and the app attaches them as linked materials.

## Provider Support

Spoor uses a universal AI calling layer that can route prompts to multiple providers, including Gemini, OpenAI-compatible endpoints, Anthropic-style APIs, MiMo, DeepSeek-compatible configuration, custom providers, and optional local GGUF inference in the desktop app.

The design goal is provider flexibility: the agent experience should stay consistent while users keep control over where their data and API keys go.

## Privacy Posture

Spoor is local-first. Canvas data is stored in the user's browser or desktop WebView through IndexedDB, and user-provided API keys are saved locally in settings. The desktop version can optionally use local llama.cpp / GGUF inference for users who want a more private offline workflow.

Agents are therefore not tied to a hosted backend owned by the project. They are a layer on top of the user's own local workspace and chosen model provider.
