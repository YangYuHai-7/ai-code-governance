---
name: next-ai-draw-io
description: Create and edit editable draw.io diagrams through an explicitly configured local Next AI Draw.io MCP server. Use for architecture diagrams, process maps, and flowcharts when the task needs a draw.io canvas.
---

# Next AI Draw.io adapter

This is an AICG-authored adapter for the Next AI Draw.io MCP server, not a Skill published by the upstream project. The upstream application and MCP server are licensed under Apache-2.0. The upstream repository is https://github.com/DayuanJiang/next-ai-draw-io and the reviewed source revision is `623eb91e579465dabe2794da5aac2dfaceba0f71`.

Use this Skill only after the project owner selects it and a compatible `drawio` MCP server is separately installed and connected in the selected AI client. Never download, install, execute, or enable an MCP server merely because this Skill appears in a governance plan. Prefer a pinned `@next-ai-drawio/mcp-server@0.4.1` package over `@latest`, and review the package and client configuration before enabling it.

For a new diagram, start a session, read the drawing guide, create cells, inspect the rendered result, then export an editable `.drawio` file into the user's chosen workspace. Load existing diagrams before editing and preserve manual changes. The MCP preview binds to `127.0.0.1` and saves session diagrams in `~/.next-ai-drawio/` by default. Obtain approval before sending confidential project material to any external AI provider.

If the MCP server is unavailable, report that the adapter is installed but the tool is not ready. Offer a diagram format supported by the current environment.
