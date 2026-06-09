# Generates Android launcher mipmaps from app/src/main/ic_launcher_source.png
param(
    [string]$Source = "$PSScriptRoot\..\app\src\main\ic_launcher_source.png",
    [string]$ResRoot = "$PSScriptRoot\..\app\src\main\res"
)

if (-not (Test-Path $Source)) {
    Write-Error "Source not found: $Source"
    exit 1
}

Add-Type -AssemblyName System.Drawing

function Save-Bitmap($bmp, $path) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Resize-Centered($src, $size, $paddingRatio) {
    $canvas = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $pad = [int]($size * $paddingRatio)
    $inner = $size - 2 * $pad
    $scale = [Math]::Min($inner / $src.Width, $inner / $src.Height)
    $w = [int]($src.Width * $scale)
    $h = [int]($src.Height * $scale)
    $x = ($size - $w) / 2
    $y = ($size - $h) / 2
    $g.DrawImage($src, $x, $y, $w, $h)
    $g.Dispose()
    return $canvas
}

$srcImg = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

# Legacy launcher icons (square)
$sizes = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}
foreach ($kv in $sizes.GetEnumerator()) {
    $bmp = Resize-Centered $srcImg $kv.Value 0.08
    Save-Bitmap $bmp (Join-Path $ResRoot "$($kv.Key)\ic_launcher.png")
    Save-Bitmap $bmp (Join-Path $ResRoot "$($kv.Key)\ic_launcher_round.png")
    $bmp.Dispose()
}

# Adaptive foreground (108dp @ density) — safe zone ~18% padding
$fgSizes = @{
    "drawable-mdpi"    = 108
    "drawable-hdpi"    = 162
    "drawable-xhdpi"   = 216
    "drawable-xxhdpi"  = 324
    "drawable-xxxhdpi" = 432
}
foreach ($kv in $fgSizes.GetEnumerator()) {
    $bmp = Resize-Centered $srcImg $kv.Value 0.12
    Save-Bitmap $bmp (Join-Path $ResRoot "$($kv.Key)\ic_launcher_foreground.png")
    $bmp.Dispose()
}

$srcImg.Dispose()
Write-Host "Launcher icons generated under $ResRoot"
