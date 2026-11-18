param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $projectRoot 'public\assets\data'
$export = Get-Content -LiteralPath (Join-Path $projectRoot 'work\export-manifest.json') -Raw | ConvertFrom-Json
$resources = Get-Content -LiteralPath (Join-Path $projectRoot 'work\resource-map.json') -Raw | ConvertFrom-Json
$projectAsset = @($export.texts | Where-Object { $_.name -eq 'Gorogoa.project' })
if ($projectAsset.Count -ne 1) { throw '正式版项目配置不唯一' }
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

function Convert-Element([System.Xml.XmlElement]$element) {
    $attrs = [ordered]@{}
    foreach ($attribute in $element.Attributes) {
        if ($attribute.Name -notin @('lastModified', 'lastModifiedByUser')) { $attrs[$attribute.Name] = [string]$attribute.Value }
    }
    $children = [System.Collections.Generic.List[object]]::new()
    foreach ($child in $element.ChildNodes) {
        if ($child.NodeType -eq [System.Xml.XmlNodeType]::Element -and $child.get_LocalName() -ne 'fieldModificationLog') {
            $children.Add((Convert-Element $child))
        } elseif ($child.NodeType -in @([System.Xml.XmlNodeType]::Text, [System.Xml.XmlNodeType]::CDATA, [System.Xml.XmlNodeType]::SignificantWhitespace)) {
            $children.Add([ordered]@{ type = '#text'; attrs = [ordered]@{}; children = @(); text = [string]$child.Value })
        }
    }
    return [ordered]@{ type = [string]$element.get_LocalName(); attrs = $attrs; children = @($children) }
}
$script:verifiedElements = 0
$script:verifiedAttributes = 0
$script:verifiedTextNodes = 0
function Compare-Element([System.Xml.XmlElement]$element, $actual, [string]$location) {
    $expectedType = $element.get_LocalName()
    if ($actual['type'] -cne $expectedType) { throw "节点类型不符：$location ($expectedType != $($actual['type']))" }
    $script:verifiedElements++
    $expectedAttrs = @($element.Attributes | Where-Object { $_.get_Name() -notin @('lastModified','lastModifiedByUser') })
    if ($actual['attrs'].Count -ne $expectedAttrs.Count) { throw "属性数量不符：$location" }
    foreach ($attribute in $expectedAttrs) {
        $key = $attribute.get_Name()
        if (@($actual['attrs'].Keys) -cnotcontains $key -or $actual['attrs'][$key] -cne $attribute.Value) { throw "属性不符：$location/$key" }
        $script:verifiedAttributes++
    }
    $expectedChildren = @($element.ChildNodes | Where-Object { ($_.NodeType -eq [System.Xml.XmlNodeType]::Element -and $_.get_LocalName() -ne 'fieldModificationLog') -or $_.NodeType -in @([System.Xml.XmlNodeType]::Text,[System.Xml.XmlNodeType]::CDATA,[System.Xml.XmlNodeType]::SignificantWhitespace) })
    if ($actual['children'].Count -ne $expectedChildren.Count) { throw "子节点数量不符：$location" }
    for ($i=0; $i -lt $expectedChildren.Count; $i++) {
        $child=$expectedChildren[$i]; $jsonChild=$actual['children'][$i]
        if ($child.NodeType -eq [System.Xml.XmlNodeType]::Element) { Compare-Element $child $jsonChild "$location/$i" }
        else {
            if ($jsonChild['type'] -cne '#text' -or $jsonChild['text'] -cne $child.Value -or $jsonChild['attrs'].Count -ne 0 -or $jsonChild['children'].Count -ne 0) { throw "文本节点不符：$location/$i" }
            $script:verifiedTextNodes++
        }
    }
}
function Export-Tree($asset, [string]$filename, [string]$expectedRoot) {
    $inputPath = Join-Path $projectRoot $asset.file
    $actualHash = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $asset.sha256) { throw "原始导出哈希不符：$inputPath" }
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.IgnoreWhitespace = $true
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new([System.IO.File]::ReadAllText($inputPath)), $settings)
    $document = [System.Xml.XmlDocument]::new()
    $document.XmlResolver = $null
    try { $document.Load($reader) } finally { $reader.Dispose() }
    if ($document.DocumentElement.get_LocalName() -ne $expectedRoot) { throw "XML 根类型不符：$filename" }
    $tree = if (-not $VerifyOnly) { Convert-Element $document.DocumentElement }
    $outputPath = Join-Path $dataRoot $filename
    if (-not $VerifyOnly) { $json = $tree | ConvertTo-Json -Depth 100 -Compress
    [System.IO.File]::WriteAllText($outputPath, $json, [System.Text.UTF8Encoding]::new($false)) }
    $actual = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json -AsHashtable -Depth 100
    Compare-Element $document.DocumentElement $actual $expectedRoot
    return [ordered]@{ sourceFile = $asset.file; sourceSha256 = $actualHash; outputFile = 'assets/data/' + $filename; outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $outputPath).Length }
}
$projectResult = Export-Tree $projectAsset[0] 'runtime-project.json' 'project'
$chapterSaves = [ordered]@{}
foreach ($chapterId in @('chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5', 'end')) {
    $resource = @($resources.resources | Where-Object { $_.name -eq "chapters/$chapterId" })
    if ($resource.Count -ne 1 -or $resource[0].fileId -ne 5) { throw "$chapterId 资源映射不唯一或不属于已确认的 resources.assets" }
    $key = 'resources-assets/' + $resource[0].pathId
    $asset = @($export.texts | Where-Object { $_.key -eq $key })
    if ($asset.Count -ne 1) { throw "$chapterId 存档资源不唯一" }
    $chapterSaves[$chapterId] = Export-Tree $asset[0] "runtime-$chapterId-save.json" 'GameSaveData'
}
$manifest = [ordered]@{ schemaVersion = 1; shape = '{ type, attrs, children, text? }'; stripped = @('fieldModificationLog', 'lastModified', 'lastModifiedByUser'); project = $projectResult; chapter1Save = $chapterSaves['chapter1']; chapterSaves = $chapterSaves; saveKind = 'chapterCheckpoint' }
$manifestJson = $manifest | ConvertTo-Json -Depth 8
if (-not $VerifyOnly) { [System.IO.File]::WriteAllText((Join-Path $dataRoot 'runtime-manifest.json'), $manifestJson, [System.Text.UTF8Encoding]::new($false)) }
Write-Output ($manifest | ConvertTo-Json -Depth 8 -Compress)
Write-Output ($( [ordered]@{ result = '逐节点原始XML保真核对通过'; elements = $script:verifiedElements; attributes = $script:verifiedAttributes; textNodes = $script:verifiedTextNodes } ) | ConvertTo-Json -Compress)



