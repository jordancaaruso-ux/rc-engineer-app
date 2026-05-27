# Optional: KiCad MCP + Cursor

You can stay **100% manual** in KiCad for rev A. If you want Cursor to **read/edit** KiCad projects programmatically:

1. Install **KiCad 10.x** (match major version to MCP project requirements).
2. Pick one maintained MCP server (examples; verify README before install):
   - [KiCAD MCP Server](https://github.com/mixelpixx/KiCAD-MCP-Server)
   - [kicad-mcp-pro](https://github.com/oaslananka/kicad-mcp-pro)
3. Configure **Cursor MCP** to point at the server; open this repo’s KiCad project path.

**Caveats:** MCP tools vary in maturity; always **verify ERC/DRC** in KiCad after automated edits. Treat as **accelerator**, not proof of correctness.

Made-with: Cursor
