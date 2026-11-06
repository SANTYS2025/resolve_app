# Genera los iconos y pantallas de inicio de Android a partir de la carpeta assets/.
# Equivale a `npx capacitor-assets generate --android`, pero sin depender de sharp.
# Uso (desde la raíz del proyecto):  powershell -ExecutionPolicy Bypass -File scripts\android-iconos.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$res = Join-Path $root 'android\app\src\main\res'
if (-not (Test-Path $res)) { throw "No existe $res. Ejecuta antes: npx cap add android" }

$navy = [System.Drawing.Color]::FromArgb(255, 0, 0, 50) # #000032, el azul del logo

function Resize-Png([string]$source, [string]$dest, [int]$w, [int]$h, [bool]$contain) {
  $src = [System.Drawing.Image]::FromFile($source)
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.Clear($navy)
      if ($contain) {
        $scale = [Math]::Min($w / $src.Width, $h / $src.Height)
        $dw = [int][Math]::Round($src.Width * $scale)
        $dh = [int][Math]::Round($src.Height * $scale)
        $x = [int](($w - $dw) / 2)
        $y = [int](($h - $dh) / 2)
        $g.DrawImage($src, $x, $y, $dw, $dh)
      } else {
        $g.DrawImage($src, 0, 0, $w, $h)
      }
    } finally { $g.Dispose() }
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally { $src.Dispose() }
}

$icon = Join-Path $assets 'icon-only.png'
$foreground = Join-Path $assets 'icon-foreground.png'
$splash = Join-Path $assets 'splash.png'

$mipmaps = @{
  'mdpi'    = @{ icon = 48;  fg = 108 }
  'hdpi'    = @{ icon = 72;  fg = 162 }
  'xhdpi'   = @{ icon = 96;  fg = 216 }
  'xxhdpi'  = @{ icon = 144; fg = 324 }
  'xxxhdpi' = @{ icon = 192; fg = 432 }
}

foreach ($densidad in $mipmaps.Keys) {
  $s = $mipmaps[$densidad]
  $dir = Join-Path $res "mipmap-$densidad"
  Resize-Png $icon (Join-Path $dir 'ic_launcher.png') $s.icon $s.icon $false
  Resize-Png $icon (Join-Path $dir 'ic_launcher_round.png') $s.icon $s.icon $false
  Resize-Png $foreground (Join-Path $dir 'ic_launcher_foreground.png') $s.fg $s.fg $false
}

$splashes = @{
  'drawable'                  = @(480, 320)
  'drawable-land-mdpi'        = @(480, 320)
  'drawable-land-hdpi'        = @(800, 480)
  'drawable-land-xhdpi'       = @(1280, 720)
  'drawable-land-xxhdpi'      = @(1600, 960)
  'drawable-land-xxxhdpi'     = @(1920, 1280)
  'drawable-port-mdpi'        = @(320, 480)
  'drawable-port-hdpi'        = @(480, 800)
  'drawable-port-xhdpi'       = @(720, 1280)
  'drawable-port-xxhdpi'      = @(960, 1600)
  'drawable-port-xxxhdpi'     = @(1280, 1920)
}

foreach ($carpeta in $splashes.Keys) {
  $size = $splashes[$carpeta]
  Resize-Png $splash (Join-Path $res "$carpeta\splash.png") $size[0] $size[1] $true
}

# El fondo del icono adaptativo debe ser el azul del logo, no el blanco por defecto.
$bgFile = Join-Path $res 'values\ic_launcher_background.xml'
@'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000032</color>
</resources>
'@ | Set-Content -Path $bgFile -Encoding UTF8

Write-Host "Iconos, icono adaptativo y splash generados desde assets/ en $res"
