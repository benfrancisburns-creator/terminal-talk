# Terminal Talk Agent Notes

- Terminal Talk auto-registers Claude Code and Codex sessions through hooks and Desktop session-file watchers.
- Do not call `terminal_talk_register_session` from Claude Code or Codex Desktop just to make the current session visible. Use `terminal_talk_list_sessions` to inspect registry state.
- Use `terminal_talk_register_session` only for external desktop assistants that do not have hook or session-file identity.
