@{
    # S3 of the v0.4 quality tier. PSScriptAnalyzer config for the
    # terminal-talk PowerShell surface: hooks/*.ps1 + app/*.ps1/*.psm1
    # + install.ps1 + uninstall.ps1 + scripts/*.ps1.
    #
    # Severity floor = Warning. Info-level findings noted but not
    # blocking. Rationale: Information-level rules include stylistic
    # nudges (e.g. "use advanced functions") that don't apply to our
    # orchestration scripts.

    Severity = @('Error', 'Warning')

    # Rules we deliberately exclude with rationale:
    ExcludeRules = @(
        # Our hooks read their single config line from stdin and write
        # exactly one status line. No WhatIf / Confirm semantics needed —
        # would add noise to a tool that's always non-interactive.
        'PSUseShouldProcessForStateChangingFunctions',

        # Our modules intentionally use global state for registry caching.
        # Rule ~always fires false-positive for this pattern.
        'PSAvoidGlobalVars',

        # Write-Host is the correct primitive for our install/uninstall/
        # hook scripts — they explicitly write to the user's console and
        # must NOT participate in pipelines (their callers are Claude
        # Code's Stop hook, install.ps1 interactive prompts, etc.).
        # This mirrors our ESLint rule decision to leave no-console off.
        'PSAvoidUsingWriteHost',

        # `try { fs-op } catch {}` is idiomatic for best-effort file/
        # registry cleanup where we don't care if the op fails. Same
        # rationale as ESLint's `no-empty: { allowEmptyCatch: true }`.
        # Mirrors the JS side's treatment of the same pattern.
        'PSAvoidUsingEmptyCatchBlock',

        # `Invoke-EdgeTts` / `Invoke-OpenAiTts` — the `Tts` suffix is an
        # acronym (Text-To-Speech), not a grammatical plural. Renaming
        # to `Invoke-EdgeSpeech` etc. would ripple through every hook
        # and module that imports them. Industry-standard cmdlet names
        # like `ConvertTo-Json` accept the same pattern.
        'PSUseSingularNouns'
    )
}
