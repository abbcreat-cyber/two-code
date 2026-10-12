param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$PreviousExecutable
)
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($Executable)
$previous=[IO.Path]::GetFullPath($PreviousExecutable)
$allowed='D:\Apps\TwoCode\releases\'
foreach($path in @($target,$previous)) {
  if (!$path.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($path) -ne 'Two Code.exe') {throw 'Unexpected application path'}
}
if (!(Test-Path -LiteralPath $target)) {throw 'Release executable is missing'}
$oldProcesses=@(Get-Process -Name 'Two Code' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $previous})
$windows=@($oldProcesses | Where-Object {$_.MainWindowHandle -ne 0})
if ($oldProcesses.Count -gt 0 -and $windows.Count -eq 0) {throw 'Old instance has no closeable window; not forcing termination'}
foreach($window in $windows) {if (!$window.CloseMainWindow()) {throw 'Normal window close was refused'}}
$deadline=[DateTime]::UtcNow.AddSeconds(30)
while (@(Get-Process -Name 'Two Code' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $previous}).Count -gt 0) {
  if ([DateTime]::UtcNow -ge $deadline) {throw 'Old instance did not exit normally; not starting a competing version'}
  Start-Sleep -Milliseconds 200
}
$release=Split-Path (Split-Path $target -Parent) -Parent
$icon=Join-Path $release 'two-code-starship-transparent.ico'
Copy-Item -LiteralPath 'D:\projects\two-code\packages\desktop\build\icon.ico' -Destination $icon
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut('C:\Users\12647\Desktop\Two Code.lnk')
$link.TargetPath=$target
$link.WorkingDirectory=Split-Path $target -Parent
$link.IconLocation=$icon+',0'
$link.Save()
$runAsNode=[Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
try {
  [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
  $started=Start-Process -FilePath $target -WorkingDirectory (Split-Path $target -Parent) -WindowStyle Normal -PassThru
} finally {[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$runAsNode,'Process')}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TwoCodeWindowCheck { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'
$deadline=[DateTime]::UtcNow.AddSeconds(30)
do {
  Start-Sleep -Milliseconds 300
  $running=Get-Process -Id $started.Id -ErrorAction Stop
  if ($running.MainWindowHandle -ne 0 -and [TwoCodeWindowCheck]::IsWindowVisible($running.MainWindowHandle)) {break}
  if ([DateTime]::UtcNow -ge $deadline) {throw 'New version did not display its window'}
} while ($true)
[pscustomobject]@{Pid=$running.Id;Executable=$running.Path;Version=$running.MainModule.FileVersionInfo.ProductVersion;WindowTitle=$running.MainWindowTitle;Visible=[TwoCodeWindowCheck]::IsWindowVisible($running.MainWindowHandle);Responding=$running.Responding;ShortcutTarget=$shell.CreateShortcut('C:\Users\12647\Desktop\Two Code.lnk').TargetPath} | ConvertTo-Json
