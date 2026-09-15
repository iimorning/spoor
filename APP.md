# Spoor App

Spoor is a local-first spatial notes canvas with AI personas. It is designed for people who think by arranging fragments, connecting ideas, and gradually turning scattered material into structured knowledge.

## Problem

Most AI tools are built around linear chat. That is useful for quick answers, but it creates several problems for deeper work:

- Good ideas get buried in long chat transcripts.
- Notes, sources, images, and AI responses live in separate places.
- The user has to repeatedly explain context to the model.
- Research output often disappears after a single conversation.
- Privacy-sensitive thinking depends on hosted tools by default.

Spoor addresses this by making the canvas the main interface. AI works on top of the user's notes, not outside them.

## Solution

Spoor gives users an infinite canvas where notes, documents, research findings, images, and AI responses can be arranged spatially. Users can select material on the canvas and ask specialized AI personas to analyze it, connect it, rewrite it, or explore future scenarios.

Instead of producing disposable chat messages, Spoor turns AI responses into editable canvas notes. The result is a growing knowledge map where human thinking and AI reasoning stay connected.

## Core Features

### Infinite Canvas Notes

Users can create, move, zoom, connect, and organize notes freely. This supports non-linear thinking, brainstorming, writing, research, and planning.

### AI Personas

Spoor includes four default agents:

- The Mirror of Insight for critical questioning.
- The Weaver for pattern discovery and synthesis.
- The Smoothing Iron for language experimentation.
- The Star-Gazer for future scenario thinking.

Each agent has its own prompt, tone, and reasoning role.

### Contextual AI Follow-Up

AI notes can be followed up with additional questions. Spoor preserves the original note context and agent identity so the conversation can continue without losing its place on the canvas.

### Long-Form Synthesis

Selected notes can be synthesized into longer article-style output. This helps users move from fragments and research notes to drafts, outlines, essays, or structured explanations.

### Local-First Data

Spoor stores canvas data locally through IndexedDB. In the desktop app, data lives inside the local Tauri WebView storage. User API keys are saved locally in settings.

### Web and Desktop Builds

Spoor runs as a web app and as a Windows desktop application. The desktop version is packaged with Tauri and can optionally work with local GGUF inference through llama.cpp.

## Demo

Web demo: https://scribe-ai-canvas.netlify.app/

Desktop release: https://github.com/iimorning/spoor/releases/latest

Repository: https://github.com/iimorning/spoor

## Tech Stack

- React
- TypeScript
- Vite
- Tauri 2
- Rust
- Dexie
- IndexedDB
- Tailwind CSS
- i18next
- Netlify
- llama.cpp / GGUF optional local inference
- Gemini, OpenAI-compatible, MiMo, Anthropic-style, and custom provider paths

## Architecture Overview

The frontend is a React and Vite application. Canvas state, notes, agent configuration, and user data are stored locally with Dexie on top of IndexedDB. AI calls go through a shared service layer that maps a common prompt interface to different providers.

The desktop app is built with Tauri 2. It provides a native Windows package while keeping the same React interface. Local model support is handled through the Rust side by spawning llama.cpp-compatible binaries when configured.

## How To Run Locally

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build the web app:

```bash
npm run build
```

Build the Windows desktop app:

```bash
npm run tauri:build
```

## Why It Matters

Spoor explores a different shape for AI productivity software. It treats AI as a set of thinking behaviors inside a personal workspace, not as a single assistant trapped in a chat window. By combining a spatial canvas, local-first storage, configurable agents, and research workflows, Spoor helps users build durable knowledge from everyday thinking.

## Submission Summary

Spoor is best submitted under the Agent and Application tracks. It demonstrates a complete user-facing app with canvas-native AI agents, context-aware reasoning, research assistance, and privacy-conscious local storage.
