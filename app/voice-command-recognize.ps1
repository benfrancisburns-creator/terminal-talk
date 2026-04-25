# Voice-command recognizer — feeds a WAV file through
# System.Speech.Recognition against a small fixed vocabulary, emits a
# JSON intent on stdout.
#
# Called by wake-word-listener.py after it captures ~2.5 s of audio
# post-wake. Separated into PS because System.Speech.Recognition is a
# .NET / Windows-only API and Python bindings are brittle.
#
# Grammar is built in code (Choices + GrammarBuilder) rather than loaded
# from SRGS XML because XML grammars carry an xml:lang which must match
# the installed recognizer's culture exactly. A UK Windows box only
# ships the en-GB recognizer; an en-US SRGS grammar would throw
# "language for the grammar does not match the language of the
# speech recognizer." Programmatic grammars have no xml:lang binding —
# they work on whichever English recognizer the box has.
#
# Keep this vocab in lock-step with ../scripts/run-tests.cjs
# VOICE_COMMAND_ALLOWED + main.js VOICE_COMMAND_ALLOWED. If you add a
# new verb, update both.
#
# Args:
#   WavPath       — absolute path to a 16 kHz mono 16-bit PCM WAV.
#
# Output (stdout, one line of JSON):
#   {"action":"play","confidence":0.87}   — grammar matched
#   {}                                    — no recognition (silence / OOV)
#
# Exit code:
#   0 on any outcome (even no match — caller parses JSON)
#   1 on setup failure (.NET class load fail)

param([Parameter(Mandatory = $true)] [string]$WavPath)

$ErrorActionPreference = 'Stop'

# Map each recognised phrase to its canonical action. Synonyms collapse:
# "skip" -> "next"; "again"/"previous" -> "back".
$phraseToAction = @{
    'play'     = 'play'
    'pause'    = 'pause'
    'resume'   = 'resume'
    'next'     = 'next'
    'skip'     = 'next'
    'back'     = 'back'
    'again'    = 'back'
    'previous' = 'back'
    'stop'     = 'stop'
    'cancel'   = 'cancel'
}

try {
    Add-Type -AssemblyName System.Speech

    # Build the grammar programmatically — no SRGS XML, no culture binding.
    $choices = New-Object System.Speech.Recognition.Choices
    foreach ($phrase in $phraseToAction.Keys) {
        $choices.Add([string]$phrase)
    }
    $builder = New-Object System.Speech.Recognition.GrammarBuilder
    $builder.Append($choices)
    $grammar = New-Object System.Speech.Recognition.Grammar $builder

    # Default ctor picks whatever English recognizer the OS has. On a UK
    # box that's en-GB; on a US box that's en-US. Both work with this
    # XML-less grammar.
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $recognizer.LoadGrammar($grammar)
    $recognizer.SetInputToWaveFile($WavPath)

    # Recognize() is a single-shot blocking call; returns null on
    # silence / unrecognised audio (nothing in the grammar matches).
    # 3-second cap so we can't stall on malformed WAVs — the caller
    # already bounded the capture length at ~2.5 s.
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(3))

    if ($result -and $result.Text) {
        $heard = ([string]$result.Text).ToLower().Trim()
        if ($phraseToAction.ContainsKey($heard)) {
            $payload = @{
                action     = $phraseToAction[$heard]
                confidence = [math]::Round([double]$result.Confidence, 3)
            }
            Write-Output (ConvertTo-Json $payload -Compress)
        } else {
            # Shouldn't happen — grammar only contains phraseToAction
            # keys — but guard the path anyway so an unexpected recogniser
            # output still yields a parseable JSON blob the caller can
            # treat as a no-match.
            Write-Output '{}'
        }
    } else {
        Write-Output '{}'
    }
} catch {
    # Any runtime failure (audio format, .NET class load) — still emit
    # an empty JSON + exit 0 so the caller falls through to the
    # clipboard-read path rather than dying.
    Write-Error $_.Exception.Message
    Write-Output '{}'
} finally {
    if ($recognizer) {
        $recognizer.Dispose()
    }
}
