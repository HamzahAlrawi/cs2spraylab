param(
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$IncludeGameAssets
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
$files = [Collections.Generic.SortedSet[string]]::new([StringComparer]::Ordinal)
$tracked = git -C $root -c core.quotepath=false ls-files
if ($LASTEXITCODE -ne 0) { throw 'Could not list tracked source files' }
foreach ($file in $tracked) { [void]$files.Add($file) }
$data = Get-Content -LiteralPath (Join-Path $root 'src/range/game-data.json') -Raw | ConvertFrom-Json
if ($IncludeGameAssets) {
    foreach ($id in @($data.weapons.PSObject.Properties.Name) + @('usp', 'knife')) {
        foreach ($file in @("models/$id.glb", "models/view-$id.glb", "models/$id.png", "audio/$id.wav")) {
            [void]$files.Add("public/revamp/$file")
        }
    }
    foreach ($file in @('models/target.glb', 'models/target.png', 'models/range-kit.glb', 'textures/wall.webp', 'textures/wall-normal.webp', 'textures/floor.webp', 'textures/floor-normal.webp')) {
        [void]$files.Add("public/revamp/$file")
    }
}
foreach ($file in $files) {
    $full = [IO.Path]::GetFullPath((Join-Path $root $file))
    if (!$full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe archive path: $file" }
    if (!(Test-Path -LiteralPath $full -PathType Leaf)) { throw "Missing release file: $file" }
    if ($file -match '(^|/)(node_modules|research|\.git|\.codex|docs/ai-agents)(/|$)' -or $file -match '\.(dll|exe|vpk|blend\d*)$') { throw "Unexpected private or scratch file: $file" }
}
$commit = git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Commit the source before packaging' }
git -C $root diff-index --quiet HEAD --
if ($LASTEXITCODE -ne 0) { throw 'Commit tracked source changes before packaging so release.json identifies the packaged revision' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in $files) {
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root $file), $file.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
        }
        $entry = $archive.CreateEntry('release.json')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try {
            $writer.Write((@{ sourceCommit = $commit; gameBuild = $data.build; nativeAssetsIncluded = [bool]$IncludeGameAssets; nodeModulesIncluded = $false; setup = 'npm ci' } | ConvertTo-Json))
        } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Get-Item -LiteralPath $destination | Select-Object FullName, Length
Get-FileHash -LiteralPath $destination -Algorithm SHA256
