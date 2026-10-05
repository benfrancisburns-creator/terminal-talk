$ErrorActionPreference = 'SilentlyContinue'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$queueDir = Join-Path $ttHome 'queue'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'
$configPath = Join-Path $ttHome 'config.json'
$logFile = Join-Path $queueDir '_hook.log'

# Rotate log past 1 MB so the file never grows unbounded.
try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}
Log "===== hook fired ===== apartment=$([System.Threading.Thread]::CurrentThread.GetApartmentState()) ps=$($PSVersionTable.PSVersion)"

$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }

try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
$transcript = $payload.transcript_path
if ($transcript -match '^/([a-zA-Z])/(.+)$') {
    $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
}
if (-not $transcript -or -not (Test-Path $transcript)) { Log "EXIT: transcript missing: $transcript"; exit 0 }

# --- Register/refresh this session's colour assignment + per-PID session file ---
# The Stop hook is the sole writer of ~/.terminal-talk/session-colours.json, so
# every Claude Code turn guarantees the registry knows about this session.
$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
# Hard-validate sessionShort against [a-f0-9]{8} so a tampered transcript path
# can never escape $queueDir via .. or / when the filename is constructed below.
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) {
    Log "EXIT: invalid sessionShort '$sessionShort' (refusing to write)"
    exit 0
}

# HB2: clear the working flag as early as possible in the Stop hook.
# The heartbeat timer gates on the presence of this flag, so clearing
# it here stops verb emission the instant the response starts playing
# (before audio synth has time to finish). If any of the heavier work
# below fails, the flag still gets cleared — matching the user's
# mental model of "Claude finished, stop saying 'Percolating'".
#
# Also capture turn elapsed seconds: flag content = epoch seconds at
# UserPromptSubmit (set by mark-working.ps1). synth_turn.py reads this
# via --elapsed-sec and appends a "worked for X" clip to the end of
# the response audio.
$workingFlag = Join-Path $ttHome "sessions\$sessionShort-working.flag"
$elapsedSec = 0
try {
    if (Test-Path $workingFlag) {
        try {
            $startSec = [long](Get-Content $workingFlag -Raw -Encoding utf8).Trim()
            $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
            if ($startSec -gt 0 -and $nowSec -ge $startSec) {
                $elapsedSec = [int]($nowSec - $startSec)
            }
        } catch {}
        Remove-Item -Force $workingFlag -ErrorAction SilentlyContinue
        Log "cleared working flag for $sessionShort (elapsed ${elapsedSec}s)"
    }
} catch {}

# Scrape Claude Code's actual terminal footer ("Cooked for 49s" /
# "Sautéed for 1m 0s"). That phrase is render-only — never persisted
# to jsonl or hook payload — so UIA on the Windows Terminal buffer is
# the only path. Guarded: we only accept the scrape if its duration
# is within 3 s of our own measured elapsedSec, so a stale scrollback
# footer from a prior turn can't leak into this turn's audio. Empty
# return means "fall back to synth_turn's own computed phrase".
#
# Why a sub-process: Claude Code invokes this hook as
# `powershell.exe -File ...` which defaults to MTA apartment. UIA's
# RootElement requires STA — in MTA it silently terminates the
# process with no catchable exception. Observed live 2026-04-23:
# hook died between "cleared working flag" and any scrape log line.
# The wrapper script launches a fresh PS with explicit -STA so UIA
# runs in its required apartment; we read the phrase off stdout.
# No terminal scrape. We previously tried to read Claude Code's
# "Cooked for 5m 19s" footer line off the Windows Terminal buffer via
# UIA, but UIA RootElement deadlocks in every process spawned by Claude
# Code's CLI hook tree (inline, subprocess, even ShellExecute-detached
# subprocess). synth_turn.py instead computes elapsed from the JSONL
# transcript timestamps — the same data Claude Code uses — and picks a
# verb from its own past-tense list. Duration matches Claude Code to
# the second; verb varies. Footer phrase is left empty here so
# synth_turn.py takes the JSONL path.
$footerPhrase = ''

if ($sessionShort -and $sessionShort.Length -eq 8) {
    $registryPath = Join-Path $ttHome 'session-colours.json'
    $sessionsDir = Join-Path $ttHome 'sessions'
    if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

    # Shared session-registry module -- canonical Read / Touch-Or-Assign /
    # Write-Atomic + per-PID stamp. Replaces ~80 lines of duplication that
    # used to live here AND in speak-on-tool.ps1 AND in statusline.ps1.
    Import-Module (Join-Path $ttHome 'app\session-registry.psm1') -Force -ErrorAction SilentlyContinue

    # Walk up to the long-lived claude.exe pid (see Get-StableClaudePid in
    # session-registry.psm1). speak-response historically reached claude
    # in 1 hop so raw ParentProcessId worked, but using the helper makes
    # all three hooks symmetrical and robust to future spawn-tree changes.
    $claudePid = 0
    try { $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else { Get-StableClaudePid } } catch {}

    # Read-Update-Save must be lock-guarded -- toolbar can be mid-write
    # and would otherwise be stomped. See app/lib/registry-lock.js for
    # the JS-side counterpart this mirrors.
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        if ($locked) {
            $assignments = Read-Registry -RegistryPath $registryPath
            # #6 G4 — branch-tag log emitted by Update-SessionAssignment.
            $null = Update-SessionAssignment -Assignments $assignments -Short $sessionShort `
                                              -SessionId $sessionId -ClaudePid $claudePid -Now $now `
                                              -LogPath $logFile -Caller 'speak-response'
            # #6 G1 + G3 — writer attribution. speak-response runs on Stop
            # (end-of-turn) + Notification; tag its writes so they're
            # distinguishable from the other four registry writers.
            Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                          -Caller 'speak-response' -LogPath $logFile
        } else {
            # #8 — see rationale in app/statusline.ps1. Lock fail → skip
            # write. Response hook's real work (synth + clip queue) is
            # downstream and doesn't depend on the registry bookkeeping.
            $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            try {
                Add-Content -Path $logFile `
                            -Value "$ts save-registry skip from=speak-response reason=lock-timeout short=$sessionShort" `
                            -ErrorAction SilentlyContinue
            } catch {}
        }
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }
    Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid `
                          -SessionId $sessionId -Short $sessionShort -Now $now
}

# Config defaults + overrides.
# edge_clip + openai_clip are read by the highlight-to-speak / question
# hooks, not the response hook. They used to default here too for copy-
# paste consistency; removed once PSScriptAnalyzer started rightly
# flagging them as assigned-but-never-used here.
$edgeResponseVoice = 'en-GB-RyanNeural'
$openaiResponseVoice = 'onyx'
$openaiApiKey = $null
$ttsProvider = 'edge'
$ttsFallbackProvider = 'edge'

$inc = @{
    code_blocks = $false
    inline_code = $false
    urls = $false
    headings = $true
    bullet_markers = $false
    image_alt = $false
}

if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
        # edge_clip + openai_clip are applied by the highlight-to-speak
        # / question / notification hooks, not the response hook — reads
        # removed here to avoid the PSScriptAnalyzer assigned-but-never-
        # used warning. Response-path voices kept.
        if ($cfg.voices.edge_response) { $edgeResponseVoice = $cfg.voices.edge_response }
        if ($cfg.voices.openai_response) { $openaiResponseVoice = $cfg.voices.openai_response }
        if ($cfg.playback.tts_provider) { $ttsProvider = [string]$cfg.playback.tts_provider }
        if ($cfg.playback.tts_fallback_provider) { $ttsFallbackProvider = [string]$cfg.playback.tts_fallback_provider }
        # D2: OpenAI key used to live under $cfg.openai_api_key here. It's
        # now read via Resolve-OpenAiApiKey below, which walks
        # env -> config.secrets.json (safeStorage sidecar)
        # -> config.json legacy -> ~/.claude/.env. Nothing to read here.
        if ($cfg.speech_includes) {
            foreach ($p in $cfg.speech_includes.PSObject.Properties) {
                if ($inc.ContainsKey($p.Name) -and $p.Value -is [bool]) { $inc[$p.Name] = $p.Value }
            }
        }
    } catch { Log "config read fail: $($_.Exception.Message)" }
}

# Per-session overrides from registry beat the global defaults.
$registryPath2 = Join-Path $ttHome 'session-colours.json'
if ((Test-Path $registryPath2) -and $sessionShort) {
    try {
        $reg = Get-Content $registryPath2 -Raw -Encoding utf8 | ConvertFrom-Json
        $entry = $reg.assignments.$sessionShort
        if ($entry) {
            if ($entry.speech_includes) {
                foreach ($p in $entry.speech_includes.PSObject.Properties) {
                    if ($inc.ContainsKey($p.Name) -and $p.Value -is [bool]) { $inc[$p.Name] = $p.Value }
                }
            }
            if ($entry.voice) {
                $edgeResponseVoice = [string]$entry.voice
            }
        }
    } catch {}
}
Log "voices: edge_response=$edgeResponseVoice; includes: code=$($inc.code_blocks) urls=$($inc.urls) bullets=$($inc.bullet_markers)"

# Canonical primary + explicit fallback TTS chain -- see app/tts-helper.psm1.
# Previously the Invoke-TTS function + the openai-key resolution block
# were both duplicated across speak-response.ps1 and speak-notification.ps1
# with subtly different retry counts + timeouts (audit CC-8). Both hooks
# now share the module.
Import-Module (Join-Path $ttHome 'app\tts-helper.psm1') -Force -ErrorAction SilentlyContinue
# Resolve-OpenAiApiKey walks env → config.json → ~/.claude/.env. If the
# config.json already set $openaiApiKey (above), keep that; otherwise
# fall back to the canonical resolver.
if (-not $openaiApiKey) { $openaiApiKey = Resolve-OpenAiApiKey -ConfigPath $configPath }

function Invoke-TTS($text, $edgeVoice, $openAiVoice, $openAiInstructions, $basePath) {
    $result = Invoke-TtsWithFallback `
        -EdgeScriptPath      $edgeScript `
        -EdgeVoice           $edgeVoice `
        -OpenAiVoice         $openAiVoice `
        -Text                $text `
        -BasePath            $basePath `
        -OpenAiApiKey        $openaiApiKey `
        -OpenAiInstructions  $openAiInstructions `
        -OpenAiTimeoutSec    60 `
        -Provider            $ttsProvider `
        -FallbackProvider    $ttsFallbackProvider
    if ($result) { Log "TTS OK: $result" }
    else         { Log "TTS FAIL: no provider produced audio" }
    return $result
}

# --- Dispatch synthesis (2026-07-13, mirrors posix_hooks.spawn_synth) ---
# 1. Toolbar-alive gate: no player means no synthesis. The registry +
#    working-flag bookkeeping above has already run -- state stays
#    correct, we only skip producing audio nobody can hear. (Incident:
#    toolbar off, hooks synthesised thousands of clips + 90-99C CPU.)
# 2. Long-lived daemon over TCP loopback -- skips Python cold-start.
# 3. Streaming spawn, then the legacy inline path, as before. Missing
#    synth-dispatch.psm1 (old install) degrades straight to (3).
Import-Module (Join-Path $ttHome 'app\synth-dispatch.psm1') -Force -ErrorAction SilentlyContinue
if ((Get-Command Test-ToolbarAlive -ErrorAction SilentlyContinue) -and -not (Test-ToolbarAlive)) {
    Log "Stop: toolbar not running -- skipping synth for $sessionShort"
    exit 0
}
if ((Get-Command Invoke-SynthDaemon -ErrorAction SilentlyContinue) -and `
    (Invoke-SynthDaemon -SessionId $sessionId -Transcript $transcript -Mode 'on-stop' `
                        -ElapsedSec $elapsedSec -FooterPhrase $footerPhrase)) {
    Log "Stop: submitted synth via daemon for $sessionShort"
    exit 0
}

# --- Streaming path (primary since v0.2): spawn synth_turn.py detached.
# Gives parallel sentence synthesis, rolling in-order release, and
# coordinates via sync state with the PreToolUse hook so nothing is
# spoken twice. Falls through to the legacy inline path below if the
# script is missing (so an out-of-date install never loses audio).
$synthScript = Join-Path $ttHome 'app\synth_turn.py'
if (Test-Path $synthScript) {
    try {
        $spawnArgs = @(
            '-u',
            $synthScript,
            '--session', $sessionId,
            '--transcript', $transcript,
            '--mode', 'on-stop',
            '--elapsed-sec', [string]$elapsedSec
        )
        if ($footerPhrase) {
            $spawnArgs += '--footer-phrase'
            $spawnArgs += $footerPhrase
        }
        $errPath = Join-Path $queueDir "synth-stop-$sessionShort.err"
        $proc = Start-Process -FilePath 'python' -ArgumentList $spawnArgs -WindowStyle Hidden -WorkingDirectory $ttHome -RedirectStandardError $errPath -PassThru
        Start-Sleep -Milliseconds 250
        if ($proc.HasExited -and $proc.ExitCode -ne 0) {
            $err = if (Test-Path $errPath) { (Get-Content $errPath -Raw).Trim() } else { '' }
            $errSnip = $err.Substring(0, [Math]::Min(500, $err.Length))
            Log "Stop: synth_turn.py exited rc=$($proc.ExitCode) stderr=$errSnip -- falling through to legacy"
        } else {
            Log "Stop: spawned synth_turn.py pid=$($proc.Id) (streaming)"
            exit 0
        }
    } catch {
        Log "Stop: streaming spawn failed, falling through to legacy: $($_.Exception.Message)"
    }
} else {
    Log "Stop: synth_turn.py missing, using legacy path"
}

# --- Legacy inline fallback (pre-streaming behaviour) ---
$lines = Get-Content $transcript
if (-not $lines) { exit 0 }
$text = $null
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    try { $entry = $lines[$i] | ConvertFrom-Json } catch { continue }
    if ($entry.type -ne 'assistant') { continue }
    $content = $entry.message.content
    if (-not $content) { continue }
    $texts = @()
    foreach ($item in $content) {
        if ($item.type -eq 'text' -and $item.text) { $texts += $item.text }
    }
    if ($texts.Count -gt 0) { $text = ($texts -join "`n"); break }
}
if (-not $text) { Log "EXIT: no text"; exit 0 }

$clean = $text

# Markdown tables: speak the shape and a compact first-row sample instead
# of feeding raw pipe separators to TTS.
function Convert-TableCellSummary($cell) {
    $s = [string]$cell
    $s = [regex]::Replace($s, '<[^>]+>', ' ')
    $s = [regex]::Replace($s, '\[([^\]]+)\]\([^)]+\)', '$1')
    $s = [regex]::Replace($s, '`+([^`\n]+?)`+', '$1')
    $s = [regex]::Replace($s, '[*_~|]+', ' ')
    $s = [regex]::Replace($s, '\s+', ' ').Trim()
    return $s
}
$clean = [regex]::Replace(
    $clean,
    '(?m)^[ \t]*\|(.+)\|[ \t]*\r?\n^[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*\r?\n((?:^[ \t]*\|.+\|[ \t]*\r?\n?)+)',
    {
        param($m)
        $headers = @($m.Groups[1].Value -split '\|' | ForEach-Object { Convert-TableCellSummary $_ } | Where-Object { $_ })
        $rowLines = @($m.Groups[2].Value -split "\r?\n" | Where-Object { $_ -match '^\s*\|' })
        $rowCount = $rowLines.Count
        if ($headers.Count -eq 0) { return "Table with $rowCount rows.`n" }
        $plural = if ($rowCount -eq 1) { 'row' } else { 'rows' }
        $sample = ''
        if ($rowLines.Count -gt 0) {
            $first = @((($rowLines[0] -replace '^\s*\||\|\s*$', '') -split '\|') | ForEach-Object { Convert-TableCellSummary $_ })
            $pairs = New-Object System.Collections.ArrayList
            $max = [Math]::Min([Math]::Min($headers.Count, $first.Count), 3)
            for ($i = 0; $i -lt $max; $i++) {
                if ($headers[$i] -and $first[$i]) { [void]$pairs.Add("$($headers[$i]): $($first[$i])") }
            }
            if ($pairs.Count -gt 0) { $sample = ' First row: ' + (($pairs.ToArray()) -join '; ') + '.' }
        }
        return "Table with $rowCount $plural. Columns: $($headers -join ', ').$sample`n"
    }
)

# Code blocks: three-way decision per fenced block. See app/lib/text.js
# for the full rationale. Short version: stripping 100% of fenced
# content silently drops prose-in-fences (handoff messages, quoted log
# excerpts, LLM copy-paste blocks). Language-tagged fences are always
# stripped; un-tagged fences get a syntax-heuristic check — only strip
# if the body has real code signals.
$codeSignals = @(
    '\b(def|function|fn|class)\s+\w+\s*[({:<]'
    '(?m)^\s*(import|from|require|using|package)\s+[\w.]'
    '(?m)^\s*(if|else|elif|for|while|try|except|catch|with|switch)\s*\('
    '(?m)^\s*(if|elif|else|for|while|try|except|with|def|class)\b[^.!?\n]{0,120}:\s*$'
    '(?m)^\s*[#$>]\s+\S'
    '(?m)^\s*(npm|yarn|git|pip|apt|sudo|rm|mkdir|cd|ls|cp|mv|cat|echo|curl|python|python3|node|docker|kubectl|taskkill|chmod|ssh|scp|make|cmake)\s+[-\w/]'
    '\b(Get|Set|New|Remove|Test|Invoke|Start|Stop|Write|Read|Import|Export|Add)-[A-Z]\w+\s'
    '(?m)^\s*[\{\[]\s*$'
    '(?m)^\s*"[\w.-]+":\s*(null|true|false|-?\d|"|\{|\[)'
    '=>\s*[\w(\{\[]'
    '->\s*\w'
    '::\s*\w'
    ';\s*\n'
)

function Test-LooksLikeCode($body) {
    if (-not $body -or -not $body.Trim()) { return $false }
    $hits = 0
    foreach ($pat in $codeSignals) {
        if ([regex]::IsMatch($body, $pat)) {
            $hits++
            if ($hits -ge 2) { return $true }
        }
    }
    return $false
}

function Convert-CodeLanguageName($lang) {
    $key = ([string]$lang).Trim().ToLowerInvariant()
    $names = @{
        js='javascript'; jsx='javascript'; cjs='javascript'; mjs='javascript'
        ts='typescript'; tsx='typescript'; py='python'
        ps1='powershell'; psm1='powershell'; pwsh='powershell'
        sh='shell'; bash='shell'; zsh='shell'; yml='yaml'
    }
    if ($names.ContainsKey($key)) { return $names[$key] }
    return $key
}

function Convert-CodeIdentifierToWords($name) {
    $s = [string]$name
    $s = [regex]::Replace($s, '([a-z])([A-Z])', '$1 $2')
    $s = [regex]::Replace($s, '([A-Z])([A-Z][a-z])', '$1 $2')
    $s = [regex]::Replace($s, '[-_]+', ' ')
    $s = [regex]::Replace($s, '\s+', ' ').Trim().ToLowerInvariant()
    return $s
}

function Convert-CodeBlockLabel($label) {
    $s = [string]$label
    $s = [regex]::Replace($s, '[`*_#~|]+', ' ')
    $s = [regex]::Replace($s, '[^A-Za-z0-9]+', ' ')
    $s = [regex]::Replace($s, '\s+', ' ').Trim().ToLowerInvariant()
    if (-not $s) { return '' }
    $words = @($s -split '\s+' | Where-Object { $_ })
    if ($words.Count -gt 10) { $words = $words[0..9] }
    return ($words -join ' ')
}

function Convert-CommentContext($line) {
    $source = [string]$line
    $source = [regex]::Replace($source, '^[+\- ]', '').Trim()
    $source = [regex]::Replace($source, '^(?://|#|--)\s?', '').Trim()
    $source = [regex]::Replace($source, '^/\*+\s?', '').Trim()
    $source = [regex]::Replace($source, '^\*\s?', '').Trim()
    $source = [regex]::Replace($source, '\*+/$', '').Trim()
    $source = [regex]::Replace($source, '^(?:[-*+]|\d+\.)\s+', '').Trim()
    if (-not $source) { return '' }
    if ($source -match '^(?:param|returns?|throws?|todo|fixme|copyright|license|eslint|ts-ignore)\b') { return '' }
    if ($source -match '[{};=<>]|=>|\b(?:const|let|var|return|if|else|for|while)\b') { return '' }
    $source = @($source -split '[.!?]\s+|\s+(?:—|--|-)\s+', 2)[0]
    $label = Convert-CodeBlockLabel $source
    if (-not $label) { return '' }
    $words = @($label -split '\s+' | Where-Object { $_ })
    if ($words.Count -lt 4 -or $words.Count -gt 12) { return '' }
    return "the $label area"
}

function Convert-VisibleContextScope($body) {
    $codeScope = ''
    $contextScope = ''
    $proseScope = ''
    $lines = @(([string]$body) -split "\r?\n" | Select-Object -First 260)
    foreach ($raw in $lines) {
        $line = [regex]::Replace([string]$raw, '^\s*\d+\s*(?:→|\||:|\t)\s?', '')
        if (-not $line.Trim()) { continue }
        if (-not $codeScope) {
            if (
                $line -match '(?m)^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$-]*)' -or
                $line -match '(?m)^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>' -or
                $line -match '(?m)^[ \t]*def\s+([A-Za-z_]\w*)' -or
                $line -match '(?m)^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)' -or
                $line -match '(?m)^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)' -or
                $line -match '(?m)^[ \t]*(?:export\s+)?class\s+([A-Z][A-Za-z0-9_]*)' -or
                $line -match '(?m)^[ \t]*(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)'
            ) {
                $codeScope = Convert-CodeIdentifierToWords $Matches[1]
            }
        }
        if (-not $contextScope) {
            if (
                $line -match '^[ \t]{0,3}#{1,6}\s+(.{1,100}?)\s*$' -or
                $line -match '^[ \t]*#region\s+(.{1,100}?)\s*$' -or
                $line -match '^[ \t]*(?://|#|--)\s*(?:section|feature|region|phase|step|panel|toolbar|settings|audio|speech|narration|codex|claude|tts)\s*[:\-]\s*(.{1,100}?)\s*$' -or
                $line -match '^[ \t]*(?:test\.)?(?:describe|context)\s*\(\s*[''"]([^''"]{1,100})[''"]'
            ) {
                $label = Convert-CodeBlockLabel $Matches[1]
                if ($label) {
                    if ($line -match '\b(?:describe|context)\s*\(') { $contextScope = "the $label tests" }
                    else { $contextScope = "the $label section" }
                }
            }
        }
        if (-not $proseScope) { $proseScope = Convert-CommentContext $line }
        if ($codeScope -and $contextScope) { break }
    }
    if ($codeScope) { return $codeScope }
    if ($contextScope) { return $contextScope }
    return $proseScope
}

function Convert-CodeBlockFocus($body) {
    $bodyText = [string]$body
    if ($bodyText -match '(?m)^[ \t]*(?:export\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)') {
        $name = Convert-CodeIdentifierToWords $Matches[1]
        return "defines the $name class"
    }
    if (
        $bodyText -match '(?m)^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(' -or
        $bodyText -match '(?m)^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(' -or
        $bodyText -match '(?m)^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>' -or
        $bodyText -match '(?m)^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)'
    ) {
        $name = Convert-CodeIdentifierToWords $Matches[1]
        return "defines the $name function"
    }
    if ($bodyText -match '\b(?:describe|it|test)\s*\(\s*[''"]([^''"]{1,100})[''"]') {
        $label = Convert-CodeBlockLabel $Matches[1]
        if ($label) { return "contains the $label tests" }
    }
    $scope = Convert-VisibleContextScope $bodyText
    if ($scope) { return "around $scope" }
    return ''
}

function Convert-CodeBlockSummary($lang, $body) {
    $bodyText = [string]$body
    $lines = @($bodyText -split "\r?\n" | Where-Object { $_.Trim() }).Count
    if ($lines -eq 0) { return ' ' }
    $language = Convert-CodeLanguageName $lang
    $languagePhrase = if ($language) { " of $language" } else { '' }
    $shape = ''
    $focus = Convert-CodeBlockFocus $bodyText
    if ($focus) {
        $shape = ", $focus"
    } elseif ($bodyText -match '(?m)^[ \t]*(?:export\s+)?class\s+[A-Za-z_$][\w$]*') {
        $shape = ', defines a class'
    } elseif (
        $bodyText -match '(?m)^[ \t]*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(' -or
        $bodyText -match '(?m)^[ \t]*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(' -or
        $bodyText -match '(?m)^[ \t]*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>' -or
        $bodyText -match '(?m)^[ \t]*function\s+[A-Z][A-Za-z]+-[A-Z][A-Za-z]+'
    ) {
        $shape = ', defines a function'
    } elseif ($bodyText -match '\b(?:describe|it|test)\s*\(\s*[''"]') {
        $shape = ', contains tests'
    } elseif ($bodyText -match '(?m)^\s*(?:npm|yarn|pnpm|git|pip|python|python3|node|pwsh|powershell|docker|kubectl)\s+[-\w/]') {
        $shape = ', shows shell commands'
    } elseif ($bodyText -match '(?m)^\s*[\{\[]\s*$' -or $bodyText -match '(?m)^\s*"[\w.-]+":\s*') {
        $shape = ', shows data'
    }
    $plural = if ($lines -eq 1) { 'line' } else { 'lines' }
    return " Code block: $lines $plural$languagePhrase$shape. "
}

$codeBlocks = New-Object System.Collections.ArrayList
$clean = [regex]::Replace($clean, '(?s)```(\w*)\r?\n?(.*?)```', {
    param($m)
    $lang = $m.Groups[1].Value.Trim()
    $body = $m.Groups[2].Value
    if ($inc.code_blocks) {
        $i = $codeBlocks.Add(' ' + $body + ' ')
        return "`0CB${i}`0"
    }
    if ($lang -or (Test-LooksLikeCode $body)) {
        return Convert-CodeBlockSummary $lang $body
    }
    # Un-tagged, no code signals — speak the body as prose.
    return $body
})
if ($inc.inline_code) {
    # GFM-balanced inline code. See app/lib/text.js for rationale.
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', '$2')
} else {
    # Preserve:
    #   (1) keyboard shortcuts (`Ctrl+R`)
    #   (2) short identifier-like inline code (`session_id`, `/clear`,
    #       `main.js`, `pid=0`) — prose content, not code syntax.
    # Strip real code (parens, operators, shell commands with flags).
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', {
        param($m)
        $content = $m.Groups[2].Value
        if ($content -match '^\s*`?\s*(Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+') {
            return $content
        }
        $t = $content.Trim()
        if ($t.Length -eq 0 -or $t.Length -gt 30) { return ' ' }
        if ($t -match "`n") { return ' ' }
        if ($t -match '[(){}]|=>|->(?![a-z])|::|;\s*\S|\s--?\w') { return ' ' }
        return $content
    })
}
# Safety net: strip any surviving backticks.
$clean = $clean -replace '`', ''
if (-not $inc.image_alt) {
    $clean = [regex]::Replace($clean, '!\[[^\]]*\]\([^)]+\)', ' ')
} else {
    $clean = [regex]::Replace($clean, '!\[([^\]]*)\]\([^)]+\)', '$1')
}
$clean = [regex]::Replace($clean, '\[([^\]]+)\]\([^)]+\)', '$1')
if (-not $inc.urls) { $clean = [regex]::Replace($clean, 'https?://\S+|www\.\S+', ' ', 'IgnoreCase') }
if (-not $inc.headings) {
    $clean = [regex]::Replace($clean, '(?m)^\s*#{1,6}\s*.*$', ' ')
} else {
    $clean = [regex]::Replace($clean, '(?m)^\s*#{1,6}\s*(.+?)\s*$', {
        param($m)
        $h = $m.Groups[1].Value.Trim()
        if ($h) { "Section: $h." } else { ' ' }
    })
}
# Triple *** / ___ before double — see app/lib/text.js for full rationale.
# Without this, ***bold-italic*** strips to *bold-italic* and TTS reads
# the stray asterisks aloud. `\n` exclusion on every arm prevents a
# leftover single `*` pairing across newlines with an unrelated stray.
$clean = $clean -replace '\*\*\*([^*\n]+)\*\*\*', '$1'
$clean = $clean -replace '___([^_\n]+)___', '$1'
$clean = $clean -replace '\*\*([^*\n]+)\*\*', '$1'
$clean = $clean -replace '__([^_]+)__', '$1'
$clean = $clean -replace '\*([^*\n]+)\*', '$1'
function Convert-BulletLine($content, $prefix = '') {
    $c = ([string]$content).TrimEnd()
    if (-not $c) { return '' }
    if ($c -notmatch '[.!?:;]$') { $c = $c + '.' }
    if ($prefix) { return $prefix + $c }
    return $c
}
function Convert-MarkedListsToNumbers($text) {
    $unorderedN = 0
    $orderedActive = $false
    $orderedNext = 1
    $out = New-Object System.Collections.ArrayList
    foreach ($line in ([string]$text -split "`n", -1)) {
        $m = [regex]::Match($line, '^[ \t]*([-*+]|\d+[.)])[ \t]+(.+?)[ \t]*$')
        if (-not $m.Success) {
            $unorderedN = 0
            if ($line -notmatch '^[ \t]') {
                $orderedActive = $false
                $orderedNext = 1
            }
            [void]$out.Add($line)
            continue
        }

        $marker = $m.Groups[1].Value
        if ($marker -match '^[-*+]$') {
            $unorderedN++
            [void]$out.Add(("$unorderedN. " + (Convert-BulletLine $m.Groups[2].Value)))
            continue
        }

        $unorderedN = 0
        $rawNumber = [int]([regex]::Match($marker, '\d+').Value)
        if ($rawNumber -gt 1) {
            $spokenNumber = $rawNumber
        } elseif ($orderedActive) {
            $spokenNumber = $orderedNext
        } else {
            $spokenNumber = 1
        }
        $orderedActive = $true
        $orderedNext = $spokenNumber + 1
        [void]$out.Add(("$spokenNumber. " + (Convert-BulletLine $m.Groups[2].Value)))
    }
    return (($out.ToArray()) -join "`n")
}
if ($inc.bullet_markers) {
    $clean = Convert-MarkedListsToNumbers $clean
} else {
    $clean = [regex]::Replace($clean, '(?m)^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*', '')
    # Strip "- " / "* " / "+ " / "N. " markers AND add implicit period so
    # each bullet reads as its own sentence. Without this each multi-line
    # bullet list flattens to one run-on sentence downstream.
    $clean = [regex]::Replace($clean, '(?m)^[ \t]*([-*+]|\d+\.)[ \t]+(.+?)[ \t]*$', {
        param($m)
        $content = $m.Groups[2].Value.TrimEnd()
        if (-not $content) { return '' }
        if ($content -match '[.!?:;]$') { $content } else { $content + '.' }
    })
}
# Keyboard modifiers: cover all common modifiers in one sweep so
# `Ctrl+Shift+A` reads as "control shift A", not "control Shift+A".
# See app/lib/text.js for full rationale.
$clean = [regex]::Replace(
    $clean,
    '\b(Ctrl|Control|Cmd|Command|Shift|Alt|Option|Win|Windows|Super|Meta)\+',
    {
        param($m)
        $modMap = @{
            'ctrl'='control'; 'control'='control'
            'cmd'='command'; 'command'='command'
            'shift'='shift'; 'alt'='alt'; 'option'='option'
            'win'='windows'; 'windows'='windows'
            'super'='super'; 'meta'='meta'
        }
        $modMap[$m.Groups[1].Value.ToLower()] + ' '
    },
    'IgnoreCase'
)
# Tilde — edge-tts pronounces as "tilda" which is universally wrong.
# Drop the character; see app/lib/text.js for full rationale.
$clean = $clean -replace '~', ''
# "live" at sentence end is ambiguous to TTS and can be pronounced like
# "I live in a house". For status/deploy phrasing, rewrite the
# current/running sense to unambiguous words.
$clean = [regex]::Replace($clean, '\b[Dd]one and live\b', {
    param($m)
    if ($m.Value[0] -eq 'D') { 'Done and running' } else { 'done and running' }
})
$clean = [regex]::Replace($clean, '\b[Nn]ow live\b', {
    param($m)
    if ($m.Value[0] -eq 'N') { 'Now running' } else { 'now running' }
})
$clean = [regex]::Replace($clean, '\b([Ii]s|[Aa]re) live\b', '$1 running')
$clean = [regex]::Replace(
    $clean,
    '\blive (install|app|toolbar|version|session|registry|config|configuration|runtime|files?|audio)\b',
    { param($m) 'active ' + $m.Groups[1].Value },
    'IgnoreCase'
)
# Restore preserved code blocks.
if ($codeBlocks.Count -gt 0) {
    $clean = [regex]::Replace($clean, "`0CB(\d+)`0", { param($m) $codeBlocks[[int]$m.Groups[1].Value] })
}
$clean = [regex]::Replace($clean, '\s+', ' ').Trim()
if (-not $clean) { exit 0 }
if ($clean.Length -gt 4000) { $clean = $clean.Substring(0, 4000) }

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'

# Questions-first extraction removed 2026-04-22 — extracting every
# `?`-ending sentence and playing it before the body caused three
# problems in practice: (1) order mismatch with the terminal, (2)
# false positives from `?` inside inline code, (3) duplication of
# questions in both Q-clip and body-clip form. Audio tracks terminal
# order 1:1 now. This fallback path (non-streaming Stop) rarely runs
# — synth_turn.py is the primary — but keeping parity across mirrors.

# Main response clip
$baseFile = Join-Path $queueDir ($timestamp + '-' + $sessionShort)
$out = Invoke-TTS -text $clean -edgeVoice $edgeResponseVoice -openAiVoice $openaiResponseVoice `
    -openAiInstructions 'Speak in a calm, clear, conversational tone. Natural pacing, slight warmth.' `
    -basePath $baseFile
if ($out) { Log "DONE: $out" } else { Log "EXIT: all TTS providers failed" }
exit 0
