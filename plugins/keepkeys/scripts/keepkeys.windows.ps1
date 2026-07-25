#requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Script:Version = "0.4.0"
$Script:MetadataPrefix = "net.barnlabs.keepkeys/meta/"
$Script:SecretPrefix = "net.barnlabs.keepkeys/secret/"
$Script:MaximumSecretBytes = 2048
$Script:MaximumCapturedBytes = 1048576
$Script:OmittedOutput = "[OUTPUT OMITTED BY KEEPKEYS: stream exceeded the 1 MiB safety limit]"

[void][Reflection.Assembly]::LoadWithPartialName("PresentationCore")
[void][Reflection.Assembly]::LoadWithPartialName("PresentationFramework")
[void][Reflection.Assembly]::LoadWithPartialName("WindowsBase")

$Script:Pine = [Windows.Media.ColorConverter]::ConvertFromString("#1F2D27")
$Script:Night = [Windows.Media.ColorConverter]::ConvertFromString("#14211D")
$Script:Paper = [Windows.Media.ColorConverter]::ConvertFromString("#FFF8EC")
$Script:Sage = [Windows.Media.ColorConverter]::ConvertFromString("#41544C")
$Script:Ember = [Windows.Media.ColorConverter]::ConvertFromString("#D96C4D")
$Script:Brass = [Windows.Media.ColorConverter]::ConvertFromString("#C79A45")

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace BarnLabs.KeepKeys
{
    public sealed class CredentialItem
    {
        public string TargetName;
        public string UserName;
        public string Comment;
        public byte[] Secret;
    }

    public static class CredentialVault
    {
        private const uint CRED_TYPE_GENERIC = 1;
        private const uint CRED_PERSIST_LOCAL_MACHINE = 2;
        private const int ERROR_NOT_FOUND = 1168;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct CREDENTIAL
        {
            public uint Flags;
            public uint Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public uint CredentialBlobSize;
            public IntPtr CredentialBlob;
            public uint Persist;
            public uint AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

        [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

        [DllImport("Advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr credentials);

        [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDelete(string target, uint type, uint flags);

        [DllImport("Advapi32.dll", SetLastError = false)]
        private static extern void CredFree(IntPtr buffer);

        public static void Write(string target, string userName, string comment, byte[] secret)
        {
            IntPtr blob = IntPtr.Zero;
            try
            {
                blob = Marshal.AllocHGlobal(secret.Length);
                Marshal.Copy(secret, 0, blob, secret.Length);
                CREDENTIAL value = new CREDENTIAL();
                value.Type = CRED_TYPE_GENERIC;
                value.TargetName = target;
                value.Comment = comment;
                value.CredentialBlobSize = (uint)secret.Length;
                value.CredentialBlob = blob;
                value.Persist = CRED_PERSIST_LOCAL_MACHINE;
                value.UserName = userName;
                if (!CredWrite(ref value, 0))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows Credential Manager rejected the write.");
                }
            }
            finally
            {
                if (blob != IntPtr.Zero)
                {
                    for (int index = 0; index < secret.Length; index++)
                    {
                        Marshal.WriteByte(blob, index, 0);
                    }
                    Marshal.FreeHGlobal(blob);
                }
            }
        }

        public static CredentialItem Read(string target, bool includeSecret)
        {
            IntPtr pointer;
            if (!CredRead(target, CRED_TYPE_GENERIC, 0, out pointer))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ERROR_NOT_FOUND) return null;
                throw new Win32Exception(error, "Windows Credential Manager rejected the read.");
            }
            try
            {
                CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
                CredentialItem item = new CredentialItem();
                item.TargetName = credential.TargetName;
                item.UserName = credential.UserName;
                item.Comment = credential.Comment;
                if (includeSecret)
                {
                    item.Secret = new byte[credential.CredentialBlobSize];
                    if (item.Secret.Length > 0)
                    {
                        Marshal.Copy(credential.CredentialBlob, item.Secret, 0, item.Secret.Length);
                    }
                }
                return item;
            }
            finally
            {
                CredFree(pointer);
            }
        }

        public static CredentialItem[] Enumerate(string filter)
        {
            uint count;
            IntPtr pointers;
            if (!CredEnumerate(filter, 0, out count, out pointers))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ERROR_NOT_FOUND) return new CredentialItem[0];
                throw new Win32Exception(error, "Windows Credential Manager rejected enumeration.");
            }
            try
            {
                List<CredentialItem> items = new List<CredentialItem>();
                for (int index = 0; index < (int)count; index++)
                {
                    IntPtr credentialPointer = Marshal.ReadIntPtr(pointers, index * IntPtr.Size);
                    CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPointer, typeof(CREDENTIAL));
                    CredentialItem item = new CredentialItem();
                    item.TargetName = credential.TargetName;
                    item.UserName = credential.UserName;
                    item.Comment = credential.Comment;
                    item.Secret = null;
                    items.Add(item);
                }
                return items.ToArray();
            }
            finally
            {
                CredFree(pointers);
            }
        }

        public static bool Delete(string target)
        {
            if (CredDelete(target, CRED_TYPE_GENERIC, 0)) return true;
            int error = Marshal.GetLastWin32Error();
            if (error == ERROR_NOT_FOUND) return false;
            throw new Win32Exception(error, "Windows Credential Manager rejected deletion.");
        }
    }

    public sealed class CapturedRun
    {
        public int ExitCode;
        public byte[] StandardOutput;
        public byte[] StandardError;
        public bool StandardOutputTruncated;
        public bool StandardErrorTruncated;
    }

    internal sealed class BoundedBuffer
    {
        private readonly MemoryStream stream = new MemoryStream();
        private readonly int limit;
        public bool Truncated;

        public BoundedBuffer(int limit)
        {
            this.limit = limit;
        }

        public void Append(byte[] bytes, int count)
        {
            int available = limit - (int)stream.Length;
            if (available <= 0)
            {
                Truncated = true;
                return;
            }
            int accepted = Math.Min(available, count);
            stream.Write(bytes, 0, accepted);
            if (accepted != count) Truncated = true;
        }

        public byte[] ToArray()
        {
            return stream.ToArray();
        }
    }

    public static class ScopedRunner
    {
        private static string QuoteArgument(string value)
        {
            StringBuilder result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (character == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(character);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        private static async Task Drain(Stream input, BoundedBuffer output)
        {
            byte[] buffer = new byte[8192];
            while (true)
            {
                int count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count == 0) return;
                output.Append(buffer, count);
            }
        }

        public static CapturedRun Run(
            string program,
            string[] arguments,
            string workingDirectory,
            string variable,
            string secret,
            int maximumBytes)
        {
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = program;
            StringBuilder commandLine = new StringBuilder();
            foreach (string argument in arguments)
            {
                if (commandLine.Length > 0) commandLine.Append(' ');
                commandLine.Append(QuoteArgument(argument));
            }
            start.Arguments = commandLine.ToString();
            start.WorkingDirectory = String.IsNullOrEmpty(workingDirectory)
                ? Environment.CurrentDirectory
                : workingDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables.Clear();
            start.EnvironmentVariables[variable] = secret;

            using (Process process = new Process())
            {
                process.StartInfo = start;
                if (!process.Start()) throw new InvalidOperationException("The approved process did not start.");
                process.StandardInput.Close();
                BoundedBuffer stdout = new BoundedBuffer(maximumBytes);
                BoundedBuffer stderr = new BoundedBuffer(maximumBytes);
                Task outputTask = Drain(process.StandardOutput.BaseStream, stdout);
                Task errorTask = Drain(process.StandardError.BaseStream, stderr);
                process.WaitForExit();
                Task.WaitAll(outputTask, errorTask);
                CapturedRun result = new CapturedRun();
                result.ExitCode = process.ExitCode;
                result.StandardOutput = stdout.ToArray();
                result.StandardError = stderr.ToArray();
                result.StandardOutputTruncated = stdout.Truncated;
                result.StandardErrorTruncated = stderr.Truncated;
                return result;
            }
        }
    }
}
'@

[void](Add-Type -TypeDefinition $nativeSource -Language CSharp)

function Write-KeepKeysJson {
    param([Parameter(Mandatory = $true)][hashtable]$Value)
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 8))
}

function Stop-KeepKeys {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-KeepKeysJson @{ status = "error"; message = $Message }
    exit 1
}

function Test-KeepKeysName {
    param([string]$Value)
    return $null -ne $Value -and $Value -cmatch '^[A-Za-z][A-Za-z0-9._-]{0,127}$'
}

function Test-KeepKeysVariable {
    param([string]$Value)
    $reserved = @(
        "BASH_ENV", "CDPATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
        "ENV", "GIT_SSH", "GIT_SSH_COMMAND", "HOME", "IFS", "LD_LIBRARY_PATH",
        "LD_PRELOAD", "LOGNAME", "NODE_OPTIONS", "OLDPWD", "PATH", "PERL5OPT",
        "PWD", "PYTHONHOME", "PYTHONPATH", "RUBYOPT", "SHELL", "SSH_AUTH_SOCK",
        "TEMP", "TMP", "TMPDIR", "USER"
    )
    return (
        $null -ne $Value -and
        $Value -cmatch '^[A-Z_][A-Z0-9_]{0,127}$' -and
        $reserved -cnotcontains $Value -and
        -not $Value.StartsWith("DYLD_", [StringComparison]::Ordinal) -and
        -not $Value.StartsWith("LD_", [StringComparison]::Ordinal)
    )
}

function Test-KeepKeysVisibleLine {
    param([string]$Value)
    if ([String]::IsNullOrEmpty($Value)) { return $false }
    if ([Text.Encoding]::UTF8.GetByteCount($Value) -gt 240) { return $false }
    foreach ($character in $Value.ToCharArray()) {
        if ([Char]::IsControl($character)) { return $false }
    }
    return $true
}

function Assert-KeepKeysSecret {
    param([string]$Value)
    $size = [Text.Encoding]::UTF8.GetByteCount($Value)
    if ($size -lt 8) {
        throw "Secret values must contain at least 8 UTF-8 bytes."
    }
    if ($size -gt $Script:MaximumSecretBytes) {
        throw "Secret values must not exceed $($Script:MaximumSecretBytes) UTF-8 bytes."
    }
}

function Assert-KeepKeysMetadata {
    param([string]$Name, [string]$Variable, [string]$Description)
    if (-not (Test-KeepKeysName $Name)) {
        throw "Use 1-128 ASCII letters, digits, periods, underscores, or hyphens, beginning with a letter."
    }
    if (-not (Test-KeepKeysVariable $Variable)) {
        throw "Use an uppercase environment-variable name that is not a shell, loader, runtime, or path-control variable."
    }
    if (-not (Test-KeepKeysVisibleLine $Description)) {
        throw "Use a one-line description of at most 240 UTF-8 bytes."
    }
}

function Get-KeepKeysOption {
    param([string[]]$Values, [string]$Name, [switch]$Required)
    $index = [Array]::IndexOf($Values, $Name)
    if ($index -lt 0) {
        if ($Required) { throw "$Name is required." }
        return $null
    }
    if ($index + 1 -ge $Values.Count -or $Values[$index + 1].StartsWith("--")) {
        throw "$Name requires a value."
    }
    return $Values[$index + 1]
}

function New-KeepKeysBrush {
    param([Windows.Media.Color]$Color)
    $brush = [Windows.Media.SolidColorBrush]::new($Color)
    $brush.Freeze()
    return $brush
}

function New-KeepKeysWindow {
    param([string]$Title, [double]$Width, [double]$Height)
    $window = [Windows.Window]::new()
    $window.Title = $Title
    $window.Width = $Width
    $window.Height = $Height
    $window.ResizeMode = [Windows.ResizeMode]::NoResize
    $window.WindowStartupLocation = [Windows.WindowStartupLocation]::CenterScreen
    $window.Background = New-KeepKeysBrush $Script:Paper
    $window.FontFamily = [Windows.Media.FontFamily]::new("Segoe UI")
    $window.Topmost = $true
    $window.Add_ContentRendered({ $this.Topmost = $false })
    return $window
}

function Add-KeepKeysHeader {
    param(
        [Windows.Controls.DockPanel]$Root,
        [string]$Eyebrow,
        [string]$Title,
        [string]$Body
    )
    $header = [Windows.Controls.Grid]::new()
    $header.Background = New-KeepKeysBrush $Script:Pine
    $header.Margin = [Windows.Thickness]::new(0)
    $header.Height = 150
    [Windows.Controls.DockPanel]::SetDock($header, [Windows.Controls.Dock]::Top)
    [void]$header.ColumnDefinitions.Add([Windows.Controls.ColumnDefinition]::new())
    $imageColumn = [Windows.Controls.ColumnDefinition]::new()
    $imageColumn.Width = [Windows.GridLength]::new(108)
    [void]$header.ColumnDefinitions.Add($imageColumn)

    $copy = [Windows.Controls.StackPanel]::new()
    $copy.Margin = [Windows.Thickness]::new(26, 20, 12, 18)
    [Windows.Controls.Grid]::SetColumn($copy, 0)
    $eyebrowLabel = [Windows.Controls.TextBlock]::new()
    $eyebrowLabel.Text = $Eyebrow.ToUpperInvariant()
    $eyebrowLabel.Foreground = New-KeepKeysBrush $Script:Brass
    $eyebrowLabel.FontWeight = [Windows.FontWeights]::Bold
    $eyebrowLabel.FontSize = 11
    [void]$copy.Children.Add($eyebrowLabel)
    $titleLabel = [Windows.Controls.TextBlock]::new()
    $titleLabel.Text = $Title
    $titleLabel.Foreground = [Windows.Media.Brushes]::White
    $titleLabel.FontWeight = [Windows.FontWeights]::Bold
    $titleLabel.FontSize = 24
    $titleLabel.Margin = [Windows.Thickness]::new(0, 4, 0, 5)
    $titleLabel.TextWrapping = [Windows.TextWrapping]::Wrap
    [void]$copy.Children.Add($titleLabel)
    $bodyLabel = [Windows.Controls.TextBlock]::new()
    $bodyLabel.Text = $Body
    $bodyLabel.Foreground = New-KeepKeysBrush ([Windows.Media.ColorConverter]::ConvertFromString("#D9E2DD"))
    $bodyLabel.FontSize = 12
    $bodyLabel.TextWrapping = [Windows.TextWrapping]::Wrap
    [void]$copy.Children.Add($bodyLabel)
    [void]$header.Children.Add($copy)

    $assetRoot = $env:KEEPKEYS_ASSETS_DIR
    if (-not [String]::IsNullOrEmpty($assetRoot)) {
        $imagePath = Join-Path $assetRoot "keykeeper.png"
        if (Test-Path -LiteralPath $imagePath -PathType Leaf) {
            try {
                $bitmap = [Windows.Media.Imaging.BitmapImage]::new()
                $bitmap.BeginInit()
                $bitmap.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
                $bitmap.UriSource = [Uri]::new($imagePath)
                $bitmap.EndInit()
                $bitmap.Freeze()
                $image = [Windows.Controls.Image]::new()
                $image.Source = $bitmap
                $image.Width = 86
                $image.Height = 116
                $image.Stretch = [Windows.Media.Stretch]::Uniform
                $image.Margin = [Windows.Thickness]::new(6, 14, 16, 12)
                [Windows.Controls.Grid]::SetColumn($image, 1)
                [void]$header.Children.Add($image)
            } catch {
                # Branding image failure must not weaken or block a security decision.
            }
        }
    }
    [void]$Root.Children.Add($header)
}

function New-KeepKeysField {
    param(
        [Windows.Controls.Panel]$Parent,
        [string]$Label,
        [string]$Value,
        [switch]$Secret
    )
    $labelControl = [Windows.Controls.TextBlock]::new()
    $labelControl.Text = $Label
    $labelControl.Foreground = New-KeepKeysBrush $Script:Sage
    $labelControl.FontWeight = [Windows.FontWeights]::SemiBold
    $labelControl.Margin = [Windows.Thickness]::new(0, 9, 0, 4)
    [void]$Parent.Children.Add($labelControl)
    if ($Secret) {
        $field = [Windows.Controls.PasswordBox]::new()
        $field.PasswordChar = [char]0x2022
    } else {
        $field = [Windows.Controls.TextBox]::new()
        $field.Text = $Value
    }
    $field.Height = 35
    $field.Padding = [Windows.Thickness]::new(8, 6, 8, 6)
    $field.BorderBrush = New-KeepKeysBrush ([Windows.Media.ColorConverter]::ConvertFromString("#D9D4C9"))
    $field.BorderThickness = [Windows.Thickness]::new(1)
    [void]$Parent.Children.Add($field)
    return $field
}

function New-KeepKeysButton {
    param([string]$Label, [Windows.Media.Color]$Color, [bool]$Primary)
    $button = [Windows.Controls.Button]::new()
    $button.Content = $Label
    $button.Padding = [Windows.Thickness]::new(18, 8, 18, 8)
    $button.Margin = [Windows.Thickness]::new(8, 0, 0, 0)
    $button.BorderThickness = [Windows.Thickness]::new(0)
    $button.Background = New-KeepKeysBrush $Color
    $button.Foreground = if ($Primary) {
        [Windows.Media.Brushes]::White
    } else {
        New-KeepKeysBrush $Script:Night
    }
    $button.FontWeight = [Windows.FontWeights]::SemiBold
    return $button
}

function Show-KeepKeysStoreDialog {
    param([string]$Name, [string]$Variable, [string]$Description)
    $window = New-KeepKeysWindow "KeepKeys - Store a secret" 650 680
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root "Local vault" "You type the key. The agent never sees it." `
        "Review the reusable name and variable, then enter only the secret value."
    $body = [Windows.Controls.StackPanel]::new()
    $body.Margin = [Windows.Thickness]::new(28, 14, 28, 22)
    [void]$root.Children.Add($body)
    $nameField = New-KeepKeysField $body "Friendly name" $Name
    $variableField = New-KeepKeysField $body "Environment variable" $Variable
    $descriptionField = New-KeepKeysField $body "Description" $Description
    $secretField = New-KeepKeysField $body "Secret value" "" -Secret
    $hint = [Windows.Controls.TextBlock]::new()
    $hint.Text = "Stored in Windows Credential Manager. Never written to a .env file or returned to chat."
    $hint.TextWrapping = [Windows.TextWrapping]::Wrap
    $hint.Foreground = New-KeepKeysBrush $Script:Sage
    $hint.Margin = [Windows.Thickness]::new(0, 10, 0, 0)
    [void]$body.Children.Add($hint)
    $errorLabel = [Windows.Controls.TextBlock]::new()
    $errorLabel.Foreground = New-KeepKeysBrush ([Windows.Media.ColorConverter]::ConvertFromString("#A43D2B"))
    $errorLabel.TextWrapping = [Windows.TextWrapping]::Wrap
    $errorLabel.Margin = [Windows.Thickness]::new(0, 8, 0, 0)
    [void]$body.Children.Add($errorLabel)
    $buttons = [Windows.Controls.StackPanel]::new()
    $buttons.Orientation = [Windows.Controls.Orientation]::Horizontal
    $buttons.HorizontalAlignment = [Windows.HorizontalAlignment]::Right
    $buttons.Margin = [Windows.Thickness]::new(0, 18, 0, 0)
    [void]$body.Children.Add($buttons)
    $store = New-KeepKeysButton "Store securely" $Script:Ember $true
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($store)
    [void]$buttons.Children.Add($cancel)
    $state = @{ Result = $null }
    $cancel.Add_Click({ $window.DialogResult = $false })
    $store.Add_Click({
        $candidateName = $nameField.Text.Trim()
        $candidateVariable = $variableField.Text.Trim().ToUpperInvariant()
        $candidateDescription = $descriptionField.Text.Trim()
        $candidateSecret = $secretField.Password
        try {
            Assert-KeepKeysMetadata $candidateName $candidateVariable $candidateDescription
            Assert-KeepKeysSecret $candidateSecret
            if ($null -ne [BarnLabs.KeepKeys.CredentialVault]::Read(
                $Script:MetadataPrefix + $candidateName,
                $false
            )) {
                $answer = [Windows.MessageBox]::Show(
                    $window,
                    "This replaces the existing KeepKeys value and metadata.",
                    "Replace '$candidateName'?",
                    [Windows.MessageBoxButton]::YesNo,
                    [Windows.MessageBoxImage]::Warning,
                    [Windows.MessageBoxResult]::No
                )
                if ($answer -ne [Windows.MessageBoxResult]::Yes) { return }
            }
            $state.Result = [pscustomobject]@{
                Name = $candidateName
                Variable = $candidateVariable
                Description = $candidateDescription
                Secret = $candidateSecret
            }
            $secretField.Clear()
            $window.DialogResult = $true
        } catch {
            $errorLabel.Text = $_.Exception.Message
            [void]$secretField.Focus()
        }
    })
    $window.Add_ContentRendered({ [void]$secretField.Focus() })
    $shown = $window.ShowDialog()
    if ($shown -ne $true) { return $null }
    return $state.Result
}

function Show-KeepKeysRemoveDialog {
    param([string]$Name, [string]$Variable, [string]$Description)
    $window = New-KeepKeysWindow "KeepKeys - Remove a secret" 620 420
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root "Destructive action" "Remove '$Name'?" `
        "This deletes the complete Credential Manager item. KeepKeys cannot undo it."
    $body = [Windows.Controls.StackPanel]::new()
    $body.Margin = [Windows.Thickness]::new(28, 20, 28, 24)
    [void]$root.Children.Add($body)
    $card = [Windows.Controls.TextBlock]::new()
    $card.Text = "$Variable`n$Description"
    $card.Background = [Windows.Media.Brushes]::White
    $card.Foreground = New-KeepKeysBrush $Script:Night
    $card.Padding = [Windows.Thickness]::new(15)
    $card.TextWrapping = [Windows.TextWrapping]::Wrap
    [void]$body.Children.Add($card)
    $buttons = [Windows.Controls.StackPanel]::new()
    $buttons.Orientation = [Windows.Controls.Orientation]::Horizontal
    $buttons.HorizontalAlignment = [Windows.HorizontalAlignment]::Right
    $buttons.Margin = [Windows.Thickness]::new(0, 24, 0, 0)
    [void]$body.Children.Add($buttons)
    $remove = New-KeepKeysButton "Remove secret" ([Windows.Media.ColorConverter]::ConvertFromString("#A43D2B")) $true
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($remove)
    [void]$buttons.Children.Add($cancel)
    $remove.Add_Click({ $window.DialogResult = $true })
    $cancel.Add_Click({ $window.DialogResult = $false })
    return $window.ShowDialog() -eq $true
}

function Get-KeepKeysFingerprint {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Resolve-KeepKeysProgram {
    param([string]$Path)
    if (-not [IO.Path]::IsPathRooted($Path)) {
        throw "KeepKeys requires an absolute executable path."
    }
    foreach ($character in $Path.ToCharArray()) {
        if ([Char]::IsControl($character)) {
            throw "KeepKeys requires an absolute executable path."
        }
    }
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.PSIsContainer) { throw "The requested program is not an executable file." }
    $resolved = $item.FullName
    $blocked = @(
        "cmd.exe", "cscript.exe", "mshta.exe", "powershell.exe", "pwsh.exe",
        "rundll32.exe", "wscript.exe"
    )
    if ($blocked -contains [IO.Path]::GetFileName($resolved).ToLowerInvariant()) {
        throw "KeepKeys rejects shells and dynamic script hosts. Use a direct executable."
    }
    return $resolved
}

function Resolve-KeepKeysDirectory {
    param([AllowNull()][string]$Path)
    if ($null -eq $Path) { return $null }
    if (-not [IO.Path]::IsPathRooted($Path)) {
        throw "The working directory must be an absolute path."
    }
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if (-not $item.PSIsContainer) {
        throw "The requested working directory does not exist."
    }
    return $item.FullName
}

function New-KeepKeysRunRequest {
    param(
        [string]$Name,
        [string]$Purpose,
        [string]$Program,
        [string[]]$ProgramArguments,
        [AllowNull()][string]$WorkingDirectory
    )
    if (-not (Test-KeepKeysName $Name)) {
        throw "The requested KeepKeys name is invalid."
    }
    if (-not (Test-KeepKeysVisibleLine $Purpose)) {
        throw "The purpose must be one visible line of at most 240 bytes."
    }
    if ($ProgramArguments.Count -gt 64) {
        throw "Arguments must be visible strings within KeepKeys limits."
    }
    foreach ($value in $ProgramArguments) {
        if ([Text.Encoding]::UTF8.GetByteCount($value) -gt 4096) {
            throw "Arguments must be visible strings within KeepKeys limits."
        }
        foreach ($character in $value.ToCharArray()) {
            if ([Char]::IsControl($character)) {
                throw "Arguments must be visible strings within KeepKeys limits."
            }
        }
    }
    $resolvedProgram = Resolve-KeepKeysProgram $Program
    $resolvedDirectory = Resolve-KeepKeysDirectory $WorkingDirectory
    $fileName = [IO.Path]::GetFileName($resolvedProgram).ToLowerInvariant()
    $network = @(
        "aws.exe", "az.exe", "curl.exe", "docker.exe", "gcloud.exe", "gh.exe",
        "git.exe", "kubectl.exe", "npm.exe", "pnpm.exe", "scp.exe", "ssh.exe",
        "wget.exe", "yarn.exe"
    )
    $interpreters = @("bun.exe", "deno.exe", "java.exe", "node.exe", "perl.exe", "php.exe", "python.exe", "ruby.exe")
    $risk = "DIRECT EXECUTABLE"
    if ($network -contains $fileName) { $risk = "NETWORK-CAPABLE EXECUTABLE" }
    if ($interpreters -contains $fileName) { $risk = "SCRIPT INTERPRETER" }
    $entrypoint = $null
    $entrypointFingerprint = $null
    if ($risk -eq "SCRIPT INTERPRETER" -and $ProgramArguments.Count -gt 0) {
        $candidate = $ProgramArguments[0]
        if (-not [IO.Path]::IsPathRooted($candidate) -and $null -ne $resolvedDirectory) {
            $candidate = Join-Path $resolvedDirectory $candidate
        }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $entrypoint = (Get-Item -LiteralPath $candidate).FullName
            $entrypointFingerprint = Get-KeepKeysFingerprint $entrypoint
        }
    }
    return [pscustomobject]@{
        Name = $Name
        Purpose = $Purpose
        Program = $resolvedProgram
        Arguments = [string[]]$ProgramArguments
        WorkingDirectory = $resolvedDirectory
        Fingerprint = Get-KeepKeysFingerprint $resolvedProgram
        Risk = $risk
        Entrypoint = $entrypoint
        EntrypointFingerprint = $entrypointFingerprint
    }
}

function Show-KeepKeysApprovalDialog {
    param($Request, $Credential)
    $window = New-KeepKeysWindow "KeepKeys - Approve secret use" 760 720
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root $Request.Risk "Allow this command to use '$($Request.Name)'?" `
        "Approval is one-time. The executable and its child processes can read the secret."
    $body = [Windows.Controls.DockPanel]::new()
    $body.Margin = [Windows.Thickness]::new(28, 18, 28, 24)
    [void]$root.Children.Add($body)
    $buttons = [Windows.Controls.StackPanel]::new()
    $buttons.Orientation = [Windows.Controls.Orientation]::Horizontal
    $buttons.HorizontalAlignment = [Windows.HorizontalAlignment]::Right
    $buttons.Margin = [Windows.Thickness]::new(0, 14, 0, 0)
    [Windows.Controls.DockPanel]::SetDock($buttons, [Windows.Controls.Dock]::Bottom)
    [void]$body.Children.Add($buttons)
    $allow = New-KeepKeysButton "Allow once" $Script:Ember $true
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($allow)
    [void]$buttons.Children.Add($cancel)
    $argumentText = if ($Request.Arguments.Count -eq 0) {
        "(none)"
    } else {
        (($Request.Arguments | ForEach-Object -Begin { $index = 0 } -Process {
            $line = "[$index] $_"
            $index += 1
            $line
        }) -join "`r`n")
    }
    $details = @(
        "PURPOSE", $Request.Purpose, "",
        "SECRET", "$($Request.Name) -> $($Credential.UserName)", "",
        "DESCRIPTION", $Credential.Comment, "",
        "EXECUTABLE", $Request.Program, "",
        "SHA-256", $Request.Fingerprint, ""
    )
    if ($null -ne $Request.Entrypoint) {
        $details += @("SCRIPT ENTRYPOINT", $Request.Entrypoint, "SHA-256 $($Request.EntrypointFingerprint)", "")
    }
    $details += @(
        "ARGUMENTS", $argumentText, "",
        "WORKING DIRECTORY", $(if ($null -eq $Request.WorkingDirectory) { "(none)" } else { $Request.WorkingDirectory }), "",
        "ENVIRONMENT", "Cleared, then $($Credential.UserName) is added for this child only."
    )
    $text = [Windows.Controls.TextBox]::new()
    $text.Text = $details -join "`r`n"
    $text.IsReadOnly = $true
    $text.AcceptsReturn = $true
    $text.TextWrapping = [Windows.TextWrapping]::Wrap
    $text.VerticalScrollBarVisibility = [Windows.Controls.ScrollBarVisibility]::Auto
    $text.FontFamily = [Windows.Media.FontFamily]::new("Cascadia Mono, Consolas")
    $text.FontSize = 11
    $text.Padding = [Windows.Thickness]::new(14)
    $text.Background = [Windows.Media.Brushes]::White
    $text.Foreground = New-KeepKeysBrush $Script:Night
    [void]$body.Children.Add($text)
    $allow.Add_Click({ $window.DialogResult = $true })
    $cancel.Add_Click({ $window.DialogResult = $false })
    return $window.ShowDialog() -eq $true
}

function Get-KeepKeysCredentials {
    $items = [BarnLabs.KeepKeys.CredentialVault]::Enumerate($Script:MetadataPrefix + "*")
    return @(
        $items |
            Where-Object {
                $_.TargetName.StartsWith($Script:MetadataPrefix, [StringComparison]::Ordinal) -and
                (Test-KeepKeysName $_.TargetName.Substring($Script:MetadataPrefix.Length)) -and
                (Test-KeepKeysVariable $_.UserName) -and
                (Test-KeepKeysVisibleLine $_.Comment)
            } |
            Sort-Object { $_.TargetName.Substring($Script:MetadataPrefix.Length) }
    )
}

function Get-KeepKeysRedactionPatterns {
    param([string]$Secret)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Secret)
    $hexLower = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    $hexUpper = $hexLower.ToUpperInvariant()
    $json = ConvertTo-Json $Secret -Compress
    $jsonEscaped = if ($json.Length -ge 2) { $json.Substring(1, $json.Length - 2) } else { $json }
    return @(
        $Secret,
        [Convert]::ToBase64String($bytes),
        $hexLower,
        $hexUpper,
        [Uri]::EscapeDataString($Secret),
        $jsonEscaped
    ) | Where-Object { -not [String]::IsNullOrEmpty($_) } | Sort-Object Length -Descending -Unique
}

function Protect-KeepKeysOutput {
    param([string]$Value, [string]$Secret)
    $protected = $Value
    foreach ($pattern in (Get-KeepKeysRedactionPatterns $Secret)) {
        $protected = $protected.Replace($pattern, "[REDACTED BY KEEPKEYS]")
    }
    return $protected
}

function Invoke-KeepKeysRun {
    param($Request, $Credential, [string]$Secret)
    if ((Get-KeepKeysFingerprint $Request.Program) -cne $Request.Fingerprint) {
        throw "The executable changed after approval details were prepared. KeepKeys refused to run it."
    }
    if ($null -ne $Request.Entrypoint -and
        (Get-KeepKeysFingerprint $Request.Entrypoint) -cne $Request.EntrypointFingerprint) {
        throw "The script entrypoint changed after approval details were prepared. KeepKeys refused to run it."
    }
    $run = [BarnLabs.KeepKeys.ScopedRunner]::Run(
        $Request.Program,
        [string[]]$Request.Arguments,
        $Request.WorkingDirectory,
        $Credential.UserName,
        $Secret,
        $Script:MaximumCapturedBytes
    )
    $stdout = if ($run.StandardOutputTruncated) {
        $Script:OmittedOutput
    } else {
        Protect-KeepKeysOutput ([Text.Encoding]::UTF8.GetString($run.StandardOutput)) $Secret
    }
    $stderr = if ($run.StandardErrorTruncated) {
        $Script:OmittedOutput
    } else {
        Protect-KeepKeysOutput ([Text.Encoding]::UTF8.GetString($run.StandardError)) $Secret
    }
    return @{
        status = "ok"
        exitCode = $run.ExitCode
        stdout = $stdout
        stderr = $stderr
        stdoutTruncated = $run.StandardOutputTruncated
        stderrTruncated = $run.StandardErrorTruncated
        message = "Approved command finished with exit code $($run.ExitCode)."
    }
}

function Invoke-KeepKeysDoctor {
    $name = "keepkeys-doctor-" + [Guid]::NewGuid().ToString("N").ToLowerInvariant()
    $metadataTarget = $Script:MetadataPrefix + $name
    $secretTarget = $Script:SecretPrefix + $name
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $firstBuffer = [byte[]]::new(32)
    $secondBuffer = [byte[]]::new(32)
    try {
        $random.GetBytes($firstBuffer)
        $random.GetBytes($secondBuffer)
        $first = [Convert]::ToBase64String($firstBuffer)
        $second = [Convert]::ToBase64String($secondBuffer)
    } finally {
        [Array]::Clear($firstBuffer, 0, $firstBuffer.Length)
        [Array]::Clear($secondBuffer, 0, $secondBuffer.Length)
        $random.Dispose()
    }
    try {
        $firstBytes = [Text.Encoding]::UTF8.GetBytes($first)
        [BarnLabs.KeepKeys.CredentialVault]::Write(
            $secretTarget,
            "KEEPKEYS_SECRET",
            "KeepKeys protected value",
            $firstBytes
        )
        [Array]::Clear($firstBytes, 0, $firstBytes.Length)
        [BarnLabs.KeepKeys.CredentialVault]::Write(
            $metadataTarget,
            "KEEPKEYS_DOCTOR",
            "Temporary KeepKeys Credential Manager verification",
            [byte[]]::new(0)
        )
        $firstRead = [BarnLabs.KeepKeys.CredentialVault]::Read($secretTarget, $true)
        $firstMetadata = [BarnLabs.KeepKeys.CredentialVault]::Read($metadataTarget, $false)
        $firstValue = [Text.Encoding]::UTF8.GetString($firstRead.Secret)
        [Array]::Clear($firstRead.Secret, 0, $firstRead.Secret.Length)
        $firstMatches = (
            $firstValue -ceq $first -and
            $firstMetadata.UserName -ceq "KEEPKEYS_DOCTOR" -and
            $firstMetadata.Comment -ceq "Temporary KeepKeys Credential Manager verification"
        )
        $firstValue = ""
        $secondBytes = [Text.Encoding]::UTF8.GetBytes($second)
        [BarnLabs.KeepKeys.CredentialVault]::Write(
            $secretTarget,
            "KEEPKEYS_SECRET",
            "KeepKeys protected value",
            $secondBytes
        )
        [Array]::Clear($secondBytes, 0, $secondBytes.Length)
        [BarnLabs.KeepKeys.CredentialVault]::Write(
            $metadataTarget,
            "KEEPKEYS_DOCTOR_UPDATED",
            "Updated temporary KeepKeys verification",
            [byte[]]::new(0)
        )
        $secondRead = [BarnLabs.KeepKeys.CredentialVault]::Read($secretTarget, $true)
        $secondMetadata = [BarnLabs.KeepKeys.CredentialVault]::Read($metadataTarget, $false)
        $secondValue = [Text.Encoding]::UTF8.GetString($secondRead.Secret)
        [Array]::Clear($secondRead.Secret, 0, $secondRead.Secret.Length)
        $secondMatches = (
            $secondValue -ceq $second -and
            $secondMetadata.UserName -ceq "KEEPKEYS_DOCTOR_UPDATED" -and
            $secondMetadata.Comment -ceq "Updated temporary KeepKeys verification"
        )
        $secondValue = ""
    } finally {
        [void][BarnLabs.KeepKeys.CredentialVault]::Delete($metadataTarget)
        [void][BarnLabs.KeepKeys.CredentialVault]::Delete($secretTarget)
        $first = ""
        $second = ""
    }
    if (-not $firstMatches -or -not $secondMatches -or
        $null -ne [BarnLabs.KeepKeys.CredentialVault]::Read($metadataTarget, $false) -or
        $null -ne [BarnLabs.KeepKeys.CredentialVault]::Read($secretTarget, $false)) {
        throw "The temporary Credential Manager round trip did not verify."
    }
    return @{
        status = "ok"
        message = "Temporary Credential Manager add, metadata list, update, read, and deletion all verified."
        platform = "Windows"
        version = $Script:Version
    }
}

function Invoke-KeepKeysSelfTest {
    if (-not (Test-KeepKeysName "github-release") -or
        (Test-KeepKeysName "../../escape") -or
        -not (Test-KeepKeysVariable "GITHUB_TOKEN") -or
        (Test-KeepKeysVariable "PATH") -or
        (Test-KeepKeysVariable "LD_PRELOAD")) {
        throw "Validation self-test failed."
    }
    $marker = "synthetic-test-secret"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($marker))
    $redacted = Protect-KeepKeysOutput "before $marker $encoded after" $marker
    if ($redacted.Contains($marker) -or $redacted.Contains($encoded)) {
        throw "Redaction self-test failed."
    }
    $powershell = Join-Path $PSHOME "powershell.exe"
    $probe = (
        '$secretValue = [Environment]::GetEnvironmentVariable(''KEEPKEYS_TEST'');' +
        '$pathValue = [Environment]::GetEnvironmentVariable(''PATH'');' +
        '[Console]::Out.Write($secretValue + ''|'' + $pathValue)'
    )
    $run = [BarnLabs.KeepKeys.ScopedRunner]::Run(
        $powershell,
        [string[]]@("-NoLogo", "-NoProfile", "-NonInteractive", "-Command", $probe),
        $PSHOME,
        "KEEPKEYS_TEST",
        $marker,
        $Script:MaximumCapturedBytes
    )
    $output = Protect-KeepKeysOutput ([Text.Encoding]::UTF8.GetString($run.StandardOutput)) $marker
    if ($run.ExitCode -ne 0 -or
        $output -cne "[REDACTED BY KEEPKEYS]|" -or
        $output.Contains($marker)) {
        throw "Scoped-process self-test failed."
    }
    return @{
        status = "ok"
        message = "KeepKeys Windows validation, scoped-process, and redaction self-tests passed."
        version = $Script:Version
    }
}

try {
    if ($args.Count -eq 0) {
        throw "Usage: keepkeys <store|list|remove|run|status|doctor|--self-test>"
    }
    $action = $args[0]
    $rest = if ($args.Count -gt 1) { [string[]]$args[1..($args.Count - 1)] } else { [string[]]@() }
    switch ($action) {
        "store" {
            $name = Get-KeepKeysOption $rest "--name" -Required
            $variable = (Get-KeepKeysOption $rest "--variable" -Required).ToUpperInvariant()
            $description = Get-KeepKeysOption $rest "--description" -Required
            Assert-KeepKeysMetadata $name $variable $description
            $entered = Show-KeepKeysStoreDialog $name $variable $description
            if ($null -eq $entered) {
                $result = @{ status = "cancelled"; message = "Secret storage was cancelled." }
                break
            }
            $secretBytes = [Text.Encoding]::UTF8.GetBytes($entered.Secret)
            $metadataTarget = $Script:MetadataPrefix + $entered.Name
            $secretTarget = $Script:SecretPrefix + $entered.Name
            $previousMetadata = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $metadataTarget,
                $false
            )
            $previousSecret = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $secretTarget,
                $true
            )
            try {
                [BarnLabs.KeepKeys.CredentialVault]::Write(
                    $secretTarget,
                    "KEEPKEYS_SECRET",
                    "KeepKeys protected value",
                    $secretBytes
                )
                [BarnLabs.KeepKeys.CredentialVault]::Write(
                    $metadataTarget,
                    $entered.Variable,
                    $entered.Description,
                    [byte[]]::new(0)
                )
            } catch {
                $writeFailure = $_
                try {
                    if ($null -eq $previousSecret) {
                        [void][BarnLabs.KeepKeys.CredentialVault]::Delete($secretTarget)
                    } else {
                        [BarnLabs.KeepKeys.CredentialVault]::Write(
                            $secretTarget,
                            "KEEPKEYS_SECRET",
                            "KeepKeys protected value",
                            $previousSecret.Secret
                        )
                    }
                    if ($null -eq $previousMetadata) {
                        [void][BarnLabs.KeepKeys.CredentialVault]::Delete($metadataTarget)
                    } else {
                        [BarnLabs.KeepKeys.CredentialVault]::Write(
                            $metadataTarget,
                            $previousMetadata.UserName,
                            $previousMetadata.Comment,
                            [byte[]]::new(0)
                        )
                    }
                } catch {
                    throw "Credential Manager failed during storage and rollback. Remove '$($entered.Name)' from KeepKeys before retrying."
                }
                throw $writeFailure
            } finally {
                [Array]::Clear($secretBytes, 0, $secretBytes.Length)
                if ($null -ne $previousSecret -and $null -ne $previousSecret.Secret) {
                    [Array]::Clear(
                        $previousSecret.Secret,
                        0,
                        $previousSecret.Secret.Length
                    )
                }
                $entered.Secret = ""
            }
            $result = @{
                status = "ok"
                message = "Stored '$($entered.Name)' in Windows Credential Manager."
                name = $entered.Name
                variable = $entered.Variable
                description = $entered.Description
            }
        }
        "list" {
            $entries = @(
                Get-KeepKeysCredentials | ForEach-Object {
                    @{
                        name = $_.TargetName.Substring($Script:MetadataPrefix.Length)
                        variable = $_.UserName
                        description = $_.Comment
                    }
                }
            )
            $result = @{ status = "ok"; entries = $entries }
        }
        "remove" {
            $name = Get-KeepKeysOption $rest "--name" -Required
            if (-not (Test-KeepKeysName $name)) {
                throw "The requested KeepKeys name is invalid."
            }
            $metadataTarget = $Script:MetadataPrefix + $name
            $secretTarget = $Script:SecretPrefix + $name
            $credential = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $metadataTarget,
                $false
            )
            if ($null -eq $credential) {
                $result = @{
                    status = "ok"
                    message = "No KeepKeys item named '$name' exists."
                    removed = $false
                }
                break
            }
            if (-not (Show-KeepKeysRemoveDialog $name $credential.UserName $credential.Comment)) {
                $result = @{ status = "cancelled"; message = "Secret removal was cancelled." }
                break
            }
            $removedMetadata = [BarnLabs.KeepKeys.CredentialVault]::Delete(
                $metadataTarget
            )
            $removedSecret = [BarnLabs.KeepKeys.CredentialVault]::Delete(
                $secretTarget
            )
            $removed = $removedMetadata -or $removedSecret
            $result = @{
                status = "ok"
                message = "Removed '$name' from Windows Credential Manager."
                removed = $removed
            }
        }
        "run" {
            $separator = [Array]::IndexOf($rest, "--")
            if ($separator -lt 0) {
                throw "Run requests require '--' before the executable."
            }
            $options = if ($separator -gt 0) { [string[]]$rest[0..($separator - 1)] } else { [string[]]@() }
            $command = if ($separator + 1 -lt $rest.Count) {
                [string[]]$rest[($separator + 1)..($rest.Count - 1)]
            } else {
                [string[]]@()
            }
            if ($command.Count -eq 0) { throw "Run requests require an executable." }
            $request = New-KeepKeysRunRequest `
                (Get-KeepKeysOption $options "--name" -Required) `
                (Get-KeepKeysOption $options "--purpose" -Required) `
                $command[0] `
                $(if ($command.Count -gt 1) { [string[]]$command[1..($command.Count - 1)] } else { [string[]]@() }) `
                (Get-KeepKeysOption $options "--cwd")
            $metadataTarget = $Script:MetadataPrefix + $request.Name
            $secretTarget = $Script:SecretPrefix + $request.Name
            $metadata = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $metadataTarget,
                $false
            )
            if ($null -eq $metadata) {
                throw "No KeepKeys secret is stored as '$($request.Name)'."
            }
            if (-not (Show-KeepKeysApprovalDialog $request $metadata)) {
                $result = @{ status = "cancelled"; message = "Command use was cancelled." }
                break
            }
            $record = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $secretTarget,
                $true
            )
            $refreshedMetadata = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $metadataTarget,
                $false
            )
            if ($null -eq $record -or
                $null -eq $refreshedMetadata -or
                $refreshedMetadata.UserName -cne $metadata.UserName -or
                $refreshedMetadata.Comment -cne $metadata.Comment) {
                throw "The secret metadata changed after approval. KeepKeys refused to run."
            }
            $secret = [Text.Encoding]::UTF8.GetString($record.Secret)
            [Array]::Clear($record.Secret, 0, $record.Secret.Length)
            Assert-KeepKeysSecret $secret
            try {
                $result = Invoke-KeepKeysRun $request $metadata $secret
            } finally {
                $secret = ""
            }
        }
        "status" {
            $result = @{
                status = "ok"
                message = "KeepKeys Windows helper is available."
                platform = "Windows"
                version = $Script:Version
                vault = "Windows Credential Manager"
                plaintextRetrieval = $false
            }
        }
        "doctor" {
            $result = Invoke-KeepKeysDoctor
        }
        "--self-test" {
            $result = Invoke-KeepKeysSelfTest
        }
        default {
            throw "Unknown KeepKeys action '$action'."
        }
    }
    Write-KeepKeysJson $result
} catch {
    Stop-KeepKeys $_.Exception.Message
}
