$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'work\export-manifest.json') -Raw | ConvertFrom-Json
$map = Get-Content -LiteralPath (Join-Path $projectRoot 'work\resource-map.json') -Raw | ConvertFrom-Json
$dataRoot = Join-Path $projectRoot 'public\assets\data'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$pathById = @{}
foreach ($entry in $map.resources) { if ($entry.fileId -eq 5 -and -not $pathById.ContainsKey($entry.pathId)) { $pathById[$entry.pathId] = $entry.name } }
$textureByPath = @{}
foreach ($texture in $manifest.textures) {
    $resourcePath = $null
    if ($texture.key.StartsWith('resources-assets/')) { $id = ($texture.key -split '/')[1]; $resourcePath = $pathById[$id] }
    $texture | Add-Member -NotePropertyName resourcePath -NotePropertyValue $resourcePath -Force
    if ($resourcePath) { $textureByPath[$resourcePath] = $texture }
}
$atlasEntries = [System.Collections.Generic.List[object]]::new()
$missing = [System.Collections.Generic.List[string]]::new()
foreach ($text in $manifest.texts) {
    $id = ($text.key -split '/')[1]; $resourcePath = $pathById[$id]
    if (-not $resourcePath -or -not $resourcePath.StartsWith('packed/') -or $text.preview -notmatch '<PackedTextures>') { continue }
    [xml]$xml = Get-Content -LiteralPath (Join-Path $projectRoot $text.file) -Raw
    if ($xml.DocumentElement.Name -ne 'PackedTextures') { continue }
    foreach ($packed in $xml.PackedTextures.PackedTexture) {
        $texturePath = $resourcePath.Replace('/xml/', '/') + '.' + $packed.index
        $texture = $textureByPath[$texturePath]
        if (-not $texture -or $texture.status -ne 'converted') { $missing.Add($texturePath); continue }
        foreach ($region in $packed.Texture) {
            $atlasEntries.Add([ordered]@{ source = $region.source.Replace('\','/'); textureKey = $texture.key; textureUrl = $texture.url; u = [int]$region.u; v = [int]$region.v; w = [int]$region.w; h = [int]$region.h; offsetX = [int]$region.offsetX; offsetY = [int]$region.offsetY; originalW = [int]$region.originalW; originalH = [int]$region.originalH })
        }
    }
}
$projectText = $manifest.texts | Where-Object name -eq 'Gorogoa.project' | Select-Object -First 1
[xml]$project = Get-Content -LiteralPath (Join-Path $projectRoot $projectText.file) -Raw
$nodeCounts = [ordered]@{}
foreach ($name in @('Card','Scene','SceneLocation','SceneLayer','StateFlag','StateTransition','LocationTransition','AtomicPredicate','CompoundPredicate','MotionKeyframes','CardLink','Script')) { $nodeCounts[$name] = $project.SelectNodes("//$name").Count }
$cards = @($project.project.cards.Card | ForEach-Object { [ordered]@{ id = $_.id; guid = $_.guid; startingLocation = $_.startingLocation; scenes = $_.scenes.Scene.Count } })
$summary = [ordered]@{ sourceProjectSha256 = $projectText.sha256; startingCard = $project.project.staringCard; counts = $nodeCounts; cards = $cards; scriptClasses = @($project.SelectNodes('//Script') | Group-Object className | ForEach-Object { [ordered]@{ name = $_.Name; count = $_.Count } }); missingAtlases = @($missing | Select-Object -Unique); atlasRegions = $atlasEntries.Count }
@{ textures = $manifest.textures; sourceBundleSha256 = $manifest.sourceBundleSha256; failures = $manifest.failures } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $projectRoot 'public\assets\manifest.json') -Encoding utf8
@{ entries = @($atlasEntries); missingAtlases = $summary.missingAtlases } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dataRoot 'atlases.json') -Encoding utf8
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $dataRoot 'project-summary.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $projectRoot $projectText.file) -Destination (Join-Path $dataRoot 'project.xml')
Write-Output ($summary | ConvertTo-Json -Depth 4 -Compress)

