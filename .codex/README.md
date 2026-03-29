## Local Superpowers Install

This repository vendors `obra/superpowers` in `.codex/superpowers`.

The path `.agents/skills/superpowers` is a symlink to the local skills directory:

```text
.agents/skills/superpowers -> ../../.codex/superpowers/skills
```

To refresh the vendored copy, sync it again from the global install or from the upstream repository.

Current Codex documentation still describes native discovery from `~/.agents/skills/` at startup, so this repo-local layout is useful for keeping the files here but may not replace the global install by itself.
