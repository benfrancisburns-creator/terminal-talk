#requires -Version 5.1

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path .).Path
$Bundle = Join-Path $Root 'docs\assets\ad\ai-video-upload-bundle'
$Assets = Join-Path $Bundle 'assets'
$Audio = Join-Path $Bundle 'audio'
$Prompts = Join-Path $Bundle 'prompts'
$EdgeScript = Join-Path $Root 'app\edge_tts_speak.py'

New-Item -ItemType Directory -Path $Bundle, $Assets, $Audio, $Prompts -Force | Out-Null

$assetMap = @(
  @{ Source = 'docs\assets\ad\production-pack\terminal-talk-mascot-character-reference.png'; Name = '01-mascot-character-reference.png' },
  @{ Source = 'docs\assets\ad\production-pack\terminal-talk-mascot-transparent.png'; Name = '02-mascot-transparent.png' },
  @{ Source = 'docs\assets\ad\production-pack\terminal-talk-speech-bubble-transparent.png'; Name = '03-speech-bubble-transparent.png' },
  @{ Source = 'docs\assets\ad\production-pack\terminal-talk-brand-reference-sheet.png'; Name = '04-brand-reference-sheet.png' },
  @{ Source = 'docs\assets\ad\terminal-talk-command-center.png'; Name = '05-command-center-reference.png' },
  @{ Source = 'docs\assets\wallpaper\terminal-talk-wallpaper.png'; Name = '06-terminal-talk-wallpaper.png' }
)

foreach ($asset in $assetMap) {
  $src = Join-Path $Root $asset.Source
  if (!(Test-Path -LiteralPath $src)) { throw "Missing asset: $src" }
  Copy-Item -LiteralPath $src -Destination (Join-Path $Assets $asset.Name) -Force
}

$lines = @(
  @{ Id = '001'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:00.7'; End = '00:04.3'; Text = 'Terminal Talk online. Bring every session into view.' },
  @{ Id = '002'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:05.2'; End = '00:07.0'; Text = 'Frontend, report.' },
  @{ Id = '003'; Role = 'Frontend'; Voice = 'en-GB-SoniaNeural'; Start = '00:07.2'; End = '00:10.3'; Text = 'Settings panel is clean. Voice controls are ready.' },
  @{ Id = '004'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:11.0'; End = '00:12.3'; Text = 'Backend?' },
  @{ Id = '005'; Role = 'Backend'; Voice = 'en-GB-ThomasNeural'; Start = '00:12.7'; End = '00:15.4'; Text = 'Hooks are live. Queue handling is stable.' },
  @{ Id = '006'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:16.1'; End = '00:18.0'; Text = 'Tests and docs, status.' },
  @{ Id = '007'; Role = 'Tests'; Voice = 'en-US-GuyNeural'; Start = '00:18.2'; End = '00:20.2'; Text = 'Checks green. No blockers.' },
  @{ Id = '008'; Role = 'Docs'; Voice = 'en-US-JennyNeural'; Start = '00:20.5'; End = '00:22.7'; Text = 'Landing page assets updated.' },
  @{ Id = '009'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:23.5'; End = '00:25.8'; Text = 'Codex, give me the review queue.' },
  @{ Id = '010'; Role = 'Codex'; Voice = 'en-US-DavisNeural'; Start = '00:26.0'; End = '00:28.0'; Text = 'Review queue clear.' },
  @{ Id = '011'; Role = 'Claude'; Voice = 'en-GB-LibbyNeural'; Start = '00:28.6'; End = '00:30.9'; Text = 'Implementation notes captured.' },
  @{ Id = '012'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:31.4'; End = '00:35.2'; Text = 'Decision point: merge after review, then deploy.' },
  @{ Id = '013'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:36.0'; End = '00:39.0'; Text = 'Hey Jarvis clip received. Priority audio goes first.' },
  @{ Id = '014'; Role = 'Mascot'; Voice = 'en-GB-RyanNeural'; Start = '00:40.0'; End = '00:45.4'; Text = 'Every terminal has a voice now. Keep building. I will keep watch.' },
  @{ Id = '015'; Role = 'Narrator'; Voice = 'en-GB-SoniaNeural'; Start = '00:46.2'; End = '00:51.0'; Text = 'Terminal Talk gives Claude Code and Codex a voice, so you can keep building while the work speaks back.' }
)

function New-LocalVoiceFile([string]$Text, [string]$OutWav, [string]$Role) {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-GB' } |
    Select-Object -First 1
  if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
  $synth.Rate = if ($Role -eq 'Narrator') { -1 } else { 0 }
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($OutWav)
  $synth.Speak($Text)
  $synth.Dispose()
}

function New-VoiceFile($Line) {
  $safeRole = $Line.Role.ToLowerInvariant()
  $base = Join-Path $Audio ("$($Line.Id)-$safeRole")
  $mp3 = "$base.mp3"
  $wav = "$base.wav"
  Remove-Item -LiteralPath $mp3, $wav -Force -ErrorAction SilentlyContinue

  $edgeOk = $false
  if (Test-Path -LiteralPath $EdgeScript) {
    try {
      $Line.Text | python $EdgeScript $Line.Voice $mp3 2>$null
      $edgeOk = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $mp3) -and (Get-Item -LiteralPath $mp3).Length -gt 500)
    } catch {
      $edgeOk = $false
    }
  }
  if ($edgeOk) { return [System.IO.Path]::GetFileName($mp3) }

  New-LocalVoiceFile $Line.Text $wav $Line.Role
  return [System.IO.Path]::GetFileName($wav)
}

$manifest = foreach ($line in $lines) {
  $file = New-VoiceFile $line
  [pscustomobject]@{
    id = $line.Id
    role = $line.Role
    start = $line.Start
    end = $line.End
    audio = "audio/$file"
    text = $line.Text
  }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Bundle 'dialogue-manifest.json') -Encoding utf8
$manifest | ForEach-Object {
  "$($_.id),$($_.role),$($_.start),$($_.end),$($_.audio),""$($_.text.Replace('"', '""'))"""
} | Set-Content -LiteralPath (Join-Path $Bundle 'dialogue-timing.csv') -Encoding utf8

@'
# Runway Act-Two Prompt

Upload `assets/01-mascot-character-reference.png` as the character image.
Use a driving performance video where the performer says the mascot lines from `dialogue-manifest.json`.

Prompt:

Animate this exact pixel-art Terminal Talk mascot as a confident software command-center operator.
The mascot is coordinating several terminal sessions in a futuristic software command center.
Keep the orange pixel-art body, square eyes, smile, chunky legs, simple rectangular silhouette, and white pixel speech bubble design.
The mascot speaks clearly, turns toward terminal panels, gestures like a calm technical lead, and relays short decisions back to the room.
No humans, weapons, soldiers, explosions, military insignia, or real-world logos.
Do not turn the mascot into a realistic robot or animal.
Keep the motion professional, energetic, premium, and software-focused.

Suggested settings:
- 16:9
- 25-30 seconds per generated segment
- Gesture control on for first pass
- Facial expressiveness 2-3
- If the mascot deforms, reduce expressiveness and disable gesture control
'@ | Set-Content -LiteralPath (Join-Path $Prompts 'runway-act-two.txt') -Encoding utf8

@'
# Sora Storyboard Prompt

Upload:
- assets/04-brand-reference-sheet.png
- assets/05-command-center-reference.png
- assets/06-terminal-talk-wallpaper.png

Prompt:

Create a cinematic animated software command-center video for Terminal Talk.
The scene is a futuristic developer war room, but metaphorical and non-violent.
The exact Terminal Talk mascot will be composited later, so leave a clean center area where the mascot commander can stand.
Around the center, show abstract terminal sessions and project panels for frontend, backend, tests, docs, deployment, Claude Code, and Codex.
Use Terminal Talk's visual language from the references: dark glass, orange pixel mascot energy, cyan terminal glow, green status lights, colourful session dots, and white pixel speech bubble style.
Camera motion: slow push-in, parallax across terminal panels, occasional close-ups of animated code-flow lines, then pull back to a full battlefield overview.
Audio intent: low cinematic technology pulse, soft terminal beeps, calm spoken command-center dialogue.
Avoid readable fake UI text, fake logos, weapons, soldiers, explosions, or game-style combat imagery.
'@ | Set-Content -LiteralPath (Join-Path $Prompts 'sora-storyboard.txt') -Encoding utf8

@'
# Shot List

1. Command center boot-up, empty center, terminal panels waking up.
2. Mascot command position, speech bubble appears, session lines connect outward.
3. Frontend and backend panels report in.
4. Tests, docs, Claude Code, and Codex panels report in.
5. Decision moment: merge after review, then deploy.
6. Hey Jarvis priority clip enters the queue.
7. Pull back to the full room and end on Terminal Talk.

Export each AI-generated clip as MP4 and place the downloads in:

docs/assets/ad/external/

Use filenames:
- 01-command-center-boot.mp4
- 02-mascot-command.mp4
- 03-frontend-backend.mp4
- 04-status-overview.mp4
- 05-decision-point.mp4
- 06-hey-jarvis-priority.mp4
- 07-end-card-pullback.mp4
'@ | Set-Content -LiteralPath (Join-Path $Prompts 'shot-list.txt') -Encoding utf8

Write-Host "OK - wrote AI video upload bundle:"
Write-Host $Bundle
