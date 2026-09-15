# Spoor Skills

Spoor combines spatial note-taking, AI-assisted reasoning, and research workflows into one local-first workspace. This document summarizes the capabilities demonstrated by the project.

## 1. Spatial Knowledge Mapping

Spoor lets users organize ideas on an infinite canvas instead of forcing them into folders, documents, or linear chat threads.

Core capabilities:

- Create and arrange notes freely on a zoomable canvas.
- Connect related ideas with visual edges.
- Preserve the spatial relationship between notes, documents, AI responses, and research findings.
- Use the canvas as a thinking surface for planning, writing, study, and analysis.

## 2. Context-Aware AI Notes

Spoor can turn selected canvas material into AI-generated notes.

Supported actions include:

- Analyze a selected note with a chosen agent persona.
- Ask follow-up questions on an AI note while retaining the original context.
- Synthesize selected notes into longer article-style output.
- Use a bottom toolbar prompt with or without selected note context.
- Keep generated responses editable and reusable on the canvas.

This makes AI output part of the workspace rather than an isolated chat result.

## 3. Multi-Agent Thinking

Spoor includes multiple default AI personas that perform different cognitive jobs:

- Critical questioning through The Mirror of Insight.
- Pattern synthesis through The Weaver.
- Language transformation through The Smoothing Iron.
- Scenario exploration through The Star-Gazer.

Users can also edit agent prompts, tune behavior, and test agents in the Agents Studio.

## 4. Canvas web search

When a Metaso key is configured (or hosted search is available after sign-in), agents on the canvas can request live web, image, video, and podcast results. Hits attach as linked materials next to the reply — not as a separate research workspace.

## 5. Document and Long-Form Knowledge Workflow

Spoor supports more than short sticky notes. It includes workflows for longer material and reference-style writing:

- Import or create longer documents.
- Link documents with canvas notes.
- Generate article drafts from selected note clusters.
- Keep long-form output in Markdown-friendly form.

The goal is to help users move from scattered fragments to coherent written work.

## 6. Local-First Storage

Spoor stores user workspace data locally:

- Web version: browser IndexedDB.
- Windows desktop version: Tauri WebView data under the local app data directory.
- API keys: saved locally in the user's settings.

This reduces dependence on a project-owned backend and makes the app suitable for private thinking workflows.

## 7. Desktop and Web Delivery

Spoor can run as both a hosted web app and a Windows desktop app.

Delivery modes:

- Web app deployed through Netlify.
- Windows desktop app built with Tauri 2.
- Desktop release packaged as an NSIS installer.
- Optional local model workflow through llama.cpp / GGUF on desktop.

## 8. Model Provider Flexibility

Spoor is designed to work with multiple AI providers through a common calling layer.

Supported or planned-compatible provider paths include:

- Gemini.
- OpenAI-compatible APIs.
- Anthropic-style APIs.
- MiMo.
- Custom endpoints.
- Optional local llama.cpp / GGUF inference in desktop mode.

Users can choose the provider that best fits their cost, privacy, and performance needs.

## 9. Multimodal Context

For providers that support vision, Spoor can include connected image nodes as context for agent analysis. This allows notes and images to participate in the same canvas reasoning flow.

Example use cases:

- Analyze a screenshot with nearby notes.
- Ask an agent to interpret visual reference material.
- Keep visual and textual evidence connected in one workspace.

## 10. Internationalized Experience

Spoor includes internationalization support and ships with Chinese and English-facing content. Agent defaults and UI copy can adapt to the user's language context, making the product usable for bilingual workflows.

## Summary

Spoor's main skill is turning AI from a separate chat box into a spatial reasoning layer. It helps users collect material, make connections, challenge ideas, research topics, and develop written output while keeping ownership of their workspace.
