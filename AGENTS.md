<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- BEGIN @agent-native/skills -->
## Efficient Fable

When operating as Claude Fable or another explicitly Fable-class expensive model, preserve Fable for the judgment layer: decomposition, architecture and product tradeoffs, synthesis, risk calls, and final review. Delegate token-heavy research, coding, testing, file inventory, repetitive edits, and independent implementation slices to cheaper subagents when available. Write delegated prompts as self-contained handoff packets with objective, scope, out-of-scope areas, expected evidence, verification commands, and stop conditions. For testing, Fable should suggest the validation direction and important scripts or browser checks, then lighter agents can run them, reduce logs, collect screenshots, and report exact failures and likely causes. Treat delegated reports as leads: Fable should verify important cited files, failures, and high-risk diffs before relying on them. Do not make unsupported quality or speed guarantees; frame savings as workload-dependent.
<!-- END @agent-native/skills -->
