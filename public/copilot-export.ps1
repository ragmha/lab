# Copies raw files only; JSON parsing belongs to the browser.
[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$File,
    [string]$Session,
    [string]$Output,
    [switch]$Capture,
    [switch]$List,
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CopilotArgs = @()
)

$ErrorActionPreference = 'Stop'
try {
    if ($Help) {
        Write-Output @'
Usage:
  .\copilot-export.ps1 [-File path | -Session id] [-Output new-path]
  .\copilot-export.ps1 -List
  .\copilot-export.ps1 -Capture -Output new-path -CopilotArgs @('--model', 'model')

Without -File or -Session, lists session IDs and asks you to select one.
Sessions: $COPILOT_HOME/session-state/<id>/events.jsonl (default: ~/.copilot)
Default copy destination: ./copilot-export.jsonl (or .json for a .json source).
Capture starts a NEW copilot invocation; it cannot recover past telemetry.
Raw files may contain conversations, paths, tool data, or secrets. Review locally.
No parsing, redaction, uploading, installation, or execution-policy changes.
'@
        exit 0
    }
    if ($File -and $Session) { throw 'Choose -File or -Session, not both.' }
    if (!$Capture -and $CopilotArgs.Count) { throw 'CLI arguments require -Capture.' }
    if ($Capture) {
        if ($File -or $Session -or $List) { throw '-Capture cannot select an existing file.' }
        if (!$Output) { throw '-Capture requires -Output new-path.' }
        $cli = Get-Command copilot -CommandType Application, ExternalScript -ErrorAction Stop
    } else {
        if ($List -and ($File -or $Session -or $Output)) { throw '-List cannot be combined with file options.' }
        $homePath = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
        $root = Join-Path $homePath 'session-state'
        if (!$File -and !$Session) {
            $sessions = @()
            if (Test-Path -LiteralPath $root -PathType Container) {
                $sessions = @(Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name | Where-Object {
                    Test-Path -LiteralPath (Join-Path $_.FullName 'events.jsonl') -PathType Leaf
                })
            }
            if (!$sessions.Count) { throw "No session events.jsonl files found under $root. Use -File path." }
            for ($i = 0; $i -lt $sessions.Count; $i++) {
                $source = Get-Item -LiteralPath (Join-Path $sessions[$i].FullName 'events.jsonl')
                Write-Output ("{0}) {1}  modified {2}" -f ($i + 1), $sessions[$i].Name, $source.LastWriteTime.ToString('o'))
            }
            if ($List) { exit 0 }
            $choice = Read-Host 'Select a session number (no default)'
            $number = 0
            if (![int]::TryParse($choice, [ref]$number) -or $number -lt 1 -or $number -gt $sessions.Count) {
                throw 'Selection required: choose a listed number, or use -Session id or -File path.'
            }
            $Session = $sessions[$number - 1].Name
        }
        if ($Session) {
            if ($Session -eq '.' -or $Session -eq '..' -or $Session -match '[/\\]') { throw 'Use a session ID, not a path.' }
            $File = Join-Path (Join-Path $root $Session) 'events.jsonl'
        }
        $source = Get-Item -LiteralPath $File -ErrorAction Stop
        if ($source.PSIsContainer) { throw "Source is not a file: $File" }
        if (!$source.Length) { throw "Source is empty: $File" }
        $extension = [IO.Path]::GetExtension($source.Name)
        if ($extension -notin '.json', '.jsonl') { throw 'Source must be a .json or .jsonl file.' }
        if (!$Output) { $Output = Join-Path (Get-Location).Path "copilot-export$extension" }
    }
    if ([IO.Path]::GetExtension($Output) -notin '.json', '.jsonl') { throw 'Output must end in .json or .jsonl.' }
    $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
    Write-Output 'Privacy warning: this is a RAW file, not redacted. It may contain private content or secrets. Review before sharing.'
    $destination = [IO.File]::Open($resolved, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        if (!$Capture) {
            $inputFile = [IO.File]::OpenRead($source.FullName)
            try { $inputFile.CopyTo($destination) } finally { $inputFile.Dispose() }
        }
    } finally { $destination.Dispose() }
    if ($Capture) {
        # Restore every child-only setting even when the CLI fails.
        $settings = @{
            COPILOT_OTEL_ENABLED = 'true'
            COPILOT_OTEL_EXPORTER_TYPE = 'file'
            COPILOT_OTEL_FILE_EXPORTER_PATH = $resolved
            COPILOT_OTEL_CAPTURE_CONTENT = 'false'
            OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'false'
        }
        $previous = @{}
        foreach ($name in $settings.Keys) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        }
        $code = 0
        try {
            foreach ($name in $settings.Keys) {
                [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
            }
            & $cli.Source @CopilotArgs
            $code = $LASTEXITCODE
        } finally {
            foreach ($name in $settings.Keys) {
                [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
            }
        }
        if (!(Test-Path -LiteralPath $resolved -PathType Leaf) -or !(Get-Item -LiteralPath $resolved).Length) {
            [Console]::Error.WriteLine("Error: capture produced no telemetry (file missing or empty): $resolved")
        } else {
            Write-Output "Drag this raw file into the viewer:`n$resolved"
        }
        exit $code
    }
    Write-Output "Drag this raw file into the viewer:`n$resolved"
} catch {
    [Console]::Error.WriteLine("Error: $($_.Exception.Message)")
    exit 1
}
