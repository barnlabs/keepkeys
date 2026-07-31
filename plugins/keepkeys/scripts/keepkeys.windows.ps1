#requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Script:Version = "0.6.0"
$Script:MetadataPrefix = "net.barnlabs.keepkeys/meta/"
$Script:SecretPrefix = "net.barnlabs.keepkeys/secret/"
$Script:MaximumSecretBytes = 2048
$Script:MaximumMetadataBytes = 2560
$Script:MaximumAllowRules = 8
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
    public static class ProcessIdentity
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_BASIC_INFORMATION
        {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2_0;
            public IntPtr Reserved2_1;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr processHandle,
            int processInformationClass,
            ref PROCESS_BASIC_INFORMATION processInformation,
            int processInformationLength,
            out int returnLength
        );

        public static int ParentProcessId()
        {
            PROCESS_BASIC_INFORMATION information =
                new PROCESS_BASIC_INFORMATION();
            int returnLength;
            int status = NtQueryInformationProcess(
                Process.GetCurrentProcess().Handle,
                0,
                ref information,
                Marshal.SizeOf(information),
                out returnLength
            );
            if (status != 0)
            {
                throw new InvalidOperationException(
                    "KeepKeys could not verify its private portal parent."
                );
            }
            return information.InheritedFromUniqueProcessId.ToInt32();
        }

        public static bool IsNodeProcess(int processId)
        {
            using (Process process = Process.GetProcessById(processId))
            {
                return
                    string.Equals(
                        process.ProcessName,
                        "node",
                        StringComparison.OrdinalIgnoreCase
                    ) ||
                    string.Equals(
                        process.ProcessName,
                        "nodejs",
                        StringComparison.OrdinalIgnoreCase
                    );
            }
        }
    }

    public static class CommandLine
    {
        [DllImport("shell32.dll", SetLastError = true)]
        private static extern IntPtr CommandLineToArgvW(
            [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
            out int argumentCount
        );

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);

        public static string[] Parse(string commandLine)
        {
            int argumentCount;
            IntPtr arguments = CommandLineToArgvW(
                commandLine,
                out argumentCount
            );
            if (arguments == IntPtr.Zero)
            {
                throw new InvalidOperationException(
                    "KeepKeys could not parse its private portal parent."
                );
            }
            try
            {
                string[] result = new string[argumentCount];
                for (int index = 0; index < argumentCount; index++)
                {
                    IntPtr value = Marshal.ReadIntPtr(
                        arguments,
                        index * IntPtr.Size
                    );
                    result[index] = Marshal.PtrToStringUni(value);
                }
                return result;
            }
            finally
            {
                LocalFree(arguments);
            }
        }
    }

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

function New-KeepKeysPortalStorageUncertainError {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [Exception]$Cause
    )
    $error = [InvalidOperationException]::new($Message, $Cause)
    $error.Data["storageState"] = "uncertain"
    $error.Data["cleanupKind"] = "native-rollback"
    return $error
}

function ConvertTo-KeepKeysFailure {
    param([Parameter(Mandatory = $true)][Exception]$Exception)
    $failure = @{
        status = "error"
        message = $Exception.Message
    }
    if ($Exception.Data["storageState"] -ceq "uncertain" -and
        $Exception.Data["cleanupKind"] -ceq "native-rollback") {
        $failure.storageState = "uncertain"
        $failure.cleanupKind = "native-rollback"
    }
    return $failure
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
    param(
        [string]$Name,
        [string]$Variable,
        [string]$Description,
        [string]$Provider,
        [string[]]$DocumentationUrls
    )
    if (-not (Test-KeepKeysName $Name)) {
        throw "Use 1-128 ASCII letters, digits, periods, underscores, or hyphens, beginning with a letter."
    }
    if (-not (Test-KeepKeysVariable $Variable)) {
        throw "Use an uppercase environment-variable name that is not a shell, loader, runtime, or path-control variable."
    }
    if (-not (Test-KeepKeysVisibleLine $Description)) {
        throw "Use a one-line description of at most 240 UTF-8 bytes."
    }
    if (-not (Test-KeepKeysVisibleLine $Provider) -or
        [Text.Encoding]::UTF8.GetByteCount($Provider) -gt 80) {
        throw "Use a visible provider name of at most 80 UTF-8 bytes."
    }
    if ($DocumentationUrls.Count -lt 1 -or $DocumentationUrls.Count -gt 3) {
        throw "Use one to three distinct official HTTPS documentation links."
    }
    $distinctDocumentationUrls = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal
    )
    $documentationBytes = 0
    foreach ($url in $DocumentationUrls) {
        if (-not $distinctDocumentationUrls.Add($url)) {
            throw "Use one to three distinct official HTTPS documentation links."
        }
        $documentationBytes += [Text.Encoding]::UTF8.GetByteCount($url)
        try {
            $parsed = [Uri]::new($url, [UriKind]::Absolute)
        } catch {
            throw "Use one to three distinct official HTTPS documentation links."
        }
        if ($parsed.Scheme -cne "https" -or [String]::IsNullOrEmpty($parsed.Host) -or
            -not [String]::IsNullOrEmpty($parsed.UserInfo) -or
            [Text.Encoding]::UTF8.GetByteCount($url) -gt 1024) {
            throw "Use one to three distinct official HTTPS documentation links."
        }
    }
    if ($documentationBytes -gt 1800) {
        throw "Official documentation links must total at most 1800 UTF-8 bytes."
    }
    $serializedMetadata = ConvertTo-KeepKeysMetadataBytes $Provider $DocumentationUrls
    [Array]::Clear($serializedMetadata, 0, $serializedMetadata.Length)
}

function Invoke-KeepKeysPasteAndStore {
    param(
        [scriptblock]$ReadClipboard,
        [scriptblock]$ClearClipboard,
        [scriptblock]$StoreSecret
    )
    $stage = "clipboard-read"
    $candidateSecret = ""
    try {
        $candidateSecret = & $ReadClipboard
        $stage = "clipboard-clear"
        & $ClearClipboard
        $stage = "secret-validation"
        Assert-KeepKeysSecret $candidateSecret
        $stage = "store"
        & $StoreSecret $candidateSecret
    } catch {
        if (-not $_.Exception.Data.Contains("KeepKeysStage")) {
            $_.Exception.Data["KeepKeysStage"] = $stage
        }
        throw
    } finally {
        $candidateSecret = ""
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

function Get-KeepKeysOptions {
    param([string[]]$Values, [string]$Name)
    $matches = [Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $Values.Count; $index++) {
        if ($Values[$index] -cne $Name) { continue }
        if ($index + 1 -ge $Values.Count -or $Values[$index + 1].StartsWith("--")) {
            throw "$Name requires a value."
        }
        $matches.Add($Values[$index + 1])
    }
    return [string[]]$matches.ToArray()
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
    $workArea = [Windows.SystemParameters]::WorkArea
    $window.Title = $Title
    $window.Width = [Math]::Min($Width, [Math]::Max(320, $workArea.Width - 32))
    $window.Height = [Math]::Min($Height, [Math]::Max(320, $workArea.Height - 32))
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
        [switch]$ReadOnly
    )
    $labelControl = [Windows.Controls.TextBlock]::new()
    $labelControl.Text = $Label
    $labelControl.Foreground = New-KeepKeysBrush $Script:Sage
    $labelControl.FontWeight = [Windows.FontWeights]::SemiBold
    $labelControl.Margin = [Windows.Thickness]::new(0, 9, 0, 4)
    [void]$Parent.Children.Add($labelControl)
    $field = [Windows.Controls.TextBox]::new()
    $field.Text = $Value
    $field.IsReadOnly = $ReadOnly
    if ($ReadOnly) {
        $field.Background = New-KeepKeysBrush (
            [Windows.Media.ColorConverter]::ConvertFromString("#F4F0E7")
        )
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
    param(
        [string]$Name,
        [string]$Variable,
        [string]$Description,
        [string]$Provider,
        [string[]]$DocumentationUrls
    )
    Assert-KeepKeysMetadata $Name $Variable $Description $Provider $DocumentationUrls
    $window = New-KeepKeysWindow "KeepKeys - Store a secret" 680 760
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root "Local vault" "Your key goes straight to Credential Manager." `
        "The agent prepared everything else. You only copy the key and approve the paste."
    $body = [Windows.Controls.DockPanel]::new()
    $body.Margin = [Windows.Thickness]::new(28, 14, 28, 22)
    [void]$root.Children.Add($body)
    $buttons = [Windows.Controls.StackPanel]::new()
    $buttons.Orientation = [Windows.Controls.Orientation]::Horizontal
    $buttons.HorizontalAlignment = [Windows.HorizontalAlignment]::Right
    $buttons.Margin = [Windows.Thickness]::new(0, 18, 0, 0)
    [Windows.Controls.DockPanel]::SetDock(
        $buttons,
        [Windows.Controls.Dock]::Bottom
    )
    [void]$body.Children.Add($buttons)
    $scroll = [Windows.Controls.ScrollViewer]::new()
    $scroll.VerticalScrollBarVisibility = [Windows.Controls.ScrollBarVisibility]::Auto
    $scroll.HorizontalScrollBarVisibility = [Windows.Controls.ScrollBarVisibility]::Disabled
    $content = [Windows.Controls.StackPanel]::new()
    $scroll.Content = $content
    [void]$body.Children.Add($scroll)
    [void](New-KeepKeysField $content "Friendly name" $Name -ReadOnly)
    [void](New-KeepKeysField $content "Environment variable" $Variable -ReadOnly)
    [void](New-KeepKeysField $content "Provider" $Provider -ReadOnly)
    [void](New-KeepKeysField $content "Description" $Description -ReadOnly)
    [void](New-KeepKeysField $content "Official documentation" `
        ($DocumentationUrls -join "   ·   ") -ReadOnly)
    $hint = [Windows.Controls.TextBlock]::new()
    $hint.Text = "Copy the key immediately before clicking. KeepKeys clears the current clipboard after reading it, but same-user software or clipboard history may still observe it. The value never enters chat or a tool call."
    $hint.TextWrapping = [Windows.TextWrapping]::Wrap
    $hint.Foreground = New-KeepKeysBrush $Script:Sage
    $hint.Margin = [Windows.Thickness]::new(0, 10, 0, 0)
    [void]$content.Children.Add($hint)
    $errorLabel = [Windows.Controls.TextBlock]::new()
    $errorLabel.Foreground = New-KeepKeysBrush ([Windows.Media.ColorConverter]::ConvertFromString("#A43D2B"))
    $errorLabel.TextWrapping = [Windows.TextWrapping]::Wrap
    $errorLabel.Margin = [Windows.Thickness]::new(0, 8, 0, 0)
    [void]$content.Children.Add($errorLabel)
    $store = New-KeepKeysButton "Paste & Store" $Script:Ember $true
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($store)
    [void]$buttons.Children.Add($cancel)
    $state = @{ Result = $null }
    $cancel.Add_Click({ $window.DialogResult = $false })
    $store.Add_Click({
        try {
            Invoke-KeepKeysPasteAndStore `
                -ReadClipboard {
                    if (-not [Windows.Clipboard]::ContainsText()) {
                        throw "No usable key was found on the clipboard."
                    }
                    return [Windows.Clipboard]::GetText()
                } `
                -ClearClipboard {
                    [Windows.Clipboard]::Clear()
                } `
                -StoreSecret {
                    param([string]$candidateSecret)
                    if ($null -ne [BarnLabs.KeepKeys.CredentialVault]::Read(
                        $Script:MetadataPrefix + $Name,
                        $false
                    )) {
                        $answer = [Windows.MessageBox]::Show(
                            $window,
                            "This replaces the existing KeepKeys value and metadata.",
                            "Replace '$Name'?",
                            [Windows.MessageBoxButton]::YesNo,
                            [Windows.MessageBoxImage]::Warning,
                            [Windows.MessageBoxResult]::No
                        )
                        if ($answer -ne [Windows.MessageBoxResult]::Yes) {
                            $errorLabel.Text = "Replacement was cancelled. KeepKeys already cleared the clipboard; copy the key again if you retry."
                            return
                        }
                    }
                    $state.Result = [pscustomobject]@{
                        Name = $Name
                        Variable = $Variable
                        Description = $Description
                        Provider = $Provider
                        DocumentationUrls = $DocumentationUrls
                        Secret = $candidateSecret
                    }
                    $candidateSecret = ""
                    $window.DialogResult = $true
                }
        } catch {
            $stage = [string]$_.Exception.Data["KeepKeysStage"]
            if ($stage -eq "clipboard-read") {
                $errorLabel.Text = "No usable key was found on the clipboard. Copy the complete key, then press Paste & Store again."
            } elseif ($stage -eq "clipboard-clear") {
                $errorLabel.Text = "KeepKeys could not clear the clipboard, so the key was not stored. Copy it again and retry."
            } elseif ($stage -eq "secret-validation") {
                $errorLabel.Text = "No usable key was found on the clipboard. KeepKeys cleared it; copy the complete key, then press Paste & Store again."
            } else {
                $errorLabel.Text = "Windows Credential Manager could not be accessed. $($_.Exception.Message)"
            }
        }
    })
    $window.Add_ContentRendered({ [void]$store.Focus() })
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

function Show-KeepKeysRevokeDialog {
    param([string]$Name, [string]$Variable, [string]$Description, [int]$RuleCount)
    $window = New-KeepKeysWindow "KeepKeys - Disable automatic approvals" 640 440
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root "Approval policy" "Disable automatic approvals for '$Name'?" `
        "This removes $RuleCount exact-command rule(s). Future uses will show the native approval window again."
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
    $disable = New-KeepKeysButton "Disable automatic approvals" $Script:Brass $false
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($disable)
    [void]$buttons.Children.Add($cancel)
    $disable.Add_Click({ $window.DialogResult = $true })
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

function Get-KeepKeysRuleFromRequest {
    param($Request)
    return [pscustomobject]@{
        purpose = $Request.Purpose
        program = $Request.Program
        fingerprint = $Request.Fingerprint
        arguments = [string[]]$Request.Arguments
        workingDirectory = $Request.WorkingDirectory
        entrypoint = $Request.Entrypoint
        entrypointFingerprint = $Request.EntrypointFingerprint
    }
}

function Assert-KeepKeysAllowRule {
    param($Rule)
    if ($null -eq $Rule -or
        -not (Test-KeepKeysVisibleLine ([string]$Rule.purpose)) -or
        -not [IO.Path]::IsPathRooted([string]$Rule.program) -or
        ([string]$Rule.fingerprint) -cnotmatch "^[a-f0-9]{64}$" -or
        $null -eq $Rule.arguments -or
        @($Rule.arguments).Count -gt 64) {
        throw "The stored KeepKeys allow rule is invalid."
    }
    foreach ($argument in @($Rule.arguments)) {
        if ($null -eq $argument -or
            [Text.Encoding]::UTF8.GetByteCount([string]$argument) -gt 4096 -or
            ([string]$argument).IndexOfAny([char[]]@(0..31)) -ge 0) {
            throw "The stored KeepKeys allow rule is invalid."
        }
    }
    if ($null -ne $Rule.workingDirectory -and
        -not [IO.Path]::IsPathRooted([string]$Rule.workingDirectory)) {
        throw "The stored KeepKeys allow rule is invalid."
    }
    if (($null -eq $Rule.entrypoint) -ne ($null -eq $Rule.entrypointFingerprint) -or
        ($null -ne $Rule.entrypoint -and (
            -not [IO.Path]::IsPathRooted([string]$Rule.entrypoint) -or
            ([string]$Rule.entrypointFingerprint) -cnotmatch "^[a-f0-9]{64}$"
        ))) {
        throw "The stored KeepKeys allow rule is invalid."
    }
}

function Test-KeepKeysAllowRuleMatch {
    param($Rule, $Request)
    try { Assert-KeepKeysAllowRule $Rule } catch { return $false }
    return (
        $Rule.purpose -ceq $Request.Purpose -and
        $Rule.program -ceq $Request.Program -and
        $Rule.fingerprint -ceq $Request.Fingerprint -and
        (Test-KeepKeysStringArrayEqual ([string[]]$Rule.arguments) ([string[]]$Request.Arguments)) -and
        $(if ($null -eq $Rule.workingDirectory -or $null -eq $Request.WorkingDirectory) {
            $null -eq $Rule.workingDirectory -and $null -eq $Request.WorkingDirectory
        } else { $Rule.workingDirectory -ceq $Request.WorkingDirectory }) -and
        $(if ($null -eq $Rule.entrypoint -or $null -eq $Request.Entrypoint) {
            $null -eq $Rule.entrypoint -and $null -eq $Request.Entrypoint -and
            $null -eq $Rule.entrypointFingerprint -and $null -eq $Request.EntrypointFingerprint
        } else {
            $Rule.entrypoint -ceq $Request.Entrypoint -and
            $Rule.entrypointFingerprint -ceq $Request.EntrypointFingerprint
        })
    )
}

function Show-KeepKeysApprovalDialog {
    param($Request, $Credential)
    $window = New-KeepKeysWindow "KeepKeys - Approve secret use" 760 720
    $root = [Windows.Controls.DockPanel]::new()
    $window.Content = $root
    Add-KeepKeysHeader $root $Request.Risk "Allow this command to use '$($Request.Name)'?" `
        "The executable and its child processes can read the secret. Always allow is limited to this exact command identity."
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
    $always = New-KeepKeysButton "Always allow this exact command" $Script:Brass $false
    $cancel = New-KeepKeysButton "Cancel" ([Windows.Media.ColorConverter]::ConvertFromString("#E8E2D7")) $false
    [void]$buttons.Children.Add($allow)
    [void]$buttons.Children.Add($always)
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
        "PROVIDER", $(if ([String]::IsNullOrEmpty($Credential.Provider)) { "(legacy record)" } else { $Credential.Provider }), "",
        "OFFICIAL DOCUMENTATION", $(if ($Credential.DocumentationUrls.Count -eq 0) { "(legacy record)" } else { $Credential.DocumentationUrls -join "`r`n" }), "",
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
    $decision = "cancel"
    $allow.Add_Click({ $decision = "once"; $window.DialogResult = $true })
    $always.Add_Click({ $decision = "always"; $window.DialogResult = $true })
    $cancel.Add_Click({ $window.DialogResult = $false })
    [void]$window.ShowDialog()
    return $decision
}

function ConvertTo-KeepKeysMetadataBytes {
    param([string]$Provider, [string[]]$DocumentationUrls, [object[]]$AllowRules = @())
    if ($AllowRules.Count -gt $Script:MaximumAllowRules) {
        throw "KeepKeys metadata cannot contain more than $($Script:MaximumAllowRules) allow rules."
    }
    foreach ($rule in $AllowRules) { Assert-KeepKeysAllowRule $rule }
    $json = @{
        version = 3
        provider = $Provider
        documentationUrls = $DocumentationUrls
        allowRules = $AllowRules
    } | ConvertTo-Json -Compress -Depth 4
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    if ($bytes.Length -gt $Script:MaximumMetadataBytes) {
        [Array]::Clear($bytes, 0, $bytes.Length)
        throw "Serialized KeepKeys metadata must not exceed $($Script:MaximumMetadataBytes) UTF-8 bytes."
    }
    return $bytes
}

function ConvertFrom-KeepKeysMetadataCredential {
    param([string]$Name, $Credential)
    if ($null -eq $Credential) { return $null }
    if (-not (Test-KeepKeysName $Name) -or
        -not (Test-KeepKeysVariable $Credential.UserName) -or
        -not (Test-KeepKeysVisibleLine $Credential.Comment)) {
        throw "The stored KeepKeys metadata is invalid."
    }
    $provider = ""
    $documentationUrls = [string[]]@()
    $allowRules = [object[]]@()
    try {
        if ($null -ne $Credential.Secret -and $Credential.Secret.Length -gt 0) {
            $metadataJson = [Text.Encoding]::UTF8.GetString($Credential.Secret)
            $metadata = $metadataJson | ConvertFrom-Json
            if ($metadata.version -ne 1 -and $metadata.version -ne 2 -and $metadata.version -ne 3) {
                throw "The stored KeepKeys metadata version is unsupported."
            }
            $provider = [string]$metadata.provider
            $documentationUrls = [string[]]$metadata.documentationUrls
            Assert-KeepKeysMetadata $Name $Credential.UserName `
                $Credential.Comment $provider $documentationUrls
            if ($metadata.version -eq 3) {
                $allowRules = [object[]]@($metadata.allowRules)
                if ($allowRules.Count -gt $Script:MaximumAllowRules) {
                    throw "The stored KeepKeys allow rules exceed the supported limit."
                }
                foreach ($rule in $allowRules) { Assert-KeepKeysAllowRule $rule }
            }
        }
    } finally {
        if ($null -ne $Credential.Secret) {
            [Array]::Clear($Credential.Secret, 0, $Credential.Secret.Length)
        }
    }
    return [pscustomobject]@{
        TargetName = $Credential.TargetName
        UserName = $Credential.UserName
        Comment = $Credential.Comment
        Provider = $provider
        DocumentationUrls = $documentationUrls
        AllowRules = $allowRules
    }
}

function Read-KeepKeysMetadata {
    param([string]$Name)
    $credential = [BarnLabs.KeepKeys.CredentialVault]::Read(
        $Script:MetadataPrefix + $Name,
        $true
    )
    return ConvertFrom-KeepKeysMetadataCredential $Name $credential
}

function Test-KeepKeysStringArrayEqual {
    param([string[]]$First, [string[]]$Second)
    if ($First.Count -ne $Second.Count) { return $false }
    for ($index = 0; $index -lt $First.Count; $index += 1) {
        if ($First[$index] -cne $Second[$index]) { return $false }
    }
    return $true
}

function Test-KeepKeysMetadataEqual {
    param($First, $Second)
    return (
        $null -ne $First -and
        $null -ne $Second -and
        $First.UserName -ceq $Second.UserName -and
        $First.Comment -ceq $Second.Comment -and
        $First.Provider -ceq $Second.Provider -and
        (Test-KeepKeysStringArrayEqual `
            ([string[]]$First.DocumentationUrls) `
            ([string[]]$Second.DocumentationUrls)) -and
        (ConvertTo-Json @($First.AllowRules) -Compress -Depth 6) -ceq
            (ConvertTo-Json @($Second.AllowRules) -Compress -Depth 6)
    )
}

function New-KeepKeysNameMutex {
    param([string]$Name)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Name)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
        } finally { $sha.Dispose() }
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    $mutex = [Threading.Mutex]::new($false, "Local\BarnLabs.KeepKeys.$digest")
    try {
        [void]$mutex.WaitOne()
    } catch [Threading.AbandonedMutexException] {
        # The OS transfers an abandoned per-name lock to this caller.
    }
    return $mutex
}

function Save-KeepKeysAllowRule {
    param([string]$Name, $ExpectedMetadata, $Rule)
    $mutex = New-KeepKeysNameMutex $Name
    try {
    Assert-KeepKeysAllowRule $Rule
    $current = Read-KeepKeysMetadata $Name
    if (-not (Test-KeepKeysMetadataEqual $ExpectedMetadata $current)) {
        throw "The secret metadata changed after approval. KeepKeys refused to save an allow rule."
    }
    $rules = [Collections.Generic.List[object]]::new()
    foreach ($existing in @($current.AllowRules)) { $rules.Add($existing) }
    if (-not (@($rules | Where-Object { Test-KeepKeysAllowRuleMatch $_ ([pscustomobject]@{
        Purpose = $Rule.purpose; Program = $Rule.program; Fingerprint = $Rule.fingerprint;
        Arguments = [string[]]$Rule.arguments; WorkingDirectory = $Rule.workingDirectory;
        Entrypoint = $Rule.entrypoint; EntrypointFingerprint = $Rule.entrypointFingerprint
    }) }).Count -gt 0)) {
        if ($rules.Count -ge $Script:MaximumAllowRules) {
            throw "KeepKeys has reached the maximum number of always-allow rules for this secret."
        }
        $rules.Add($Rule)
    }
    $bytes = ConvertTo-KeepKeysMetadataBytes $current.Provider `
        ([string[]]$current.DocumentationUrls) ([object[]]$rules.ToArray())
    try {
        [BarnLabs.KeepKeys.CredentialVault]::Write(
            $Script:MetadataPrefix + $Name, $current.UserName, $current.Comment, $bytes
        )
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    return Read-KeepKeysMetadata $Name
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

function Clear-KeepKeysAllowRules {
    param([string]$Name, $ExpectedMetadata)
    $mutex = New-KeepKeysNameMutex $Name
    try {
        $current = Read-KeepKeysMetadata $Name
        if (-not (Test-KeepKeysMetadataEqual $ExpectedMetadata $current)) {
            throw "The secret metadata changed before approval rules could be revoked. Try again."
        }
        $count = @($current.AllowRules).Count
        if ($count -eq 0) { return 0 }
        $bytes = ConvertTo-KeepKeysMetadataBytes $current.Provider `
            ([string[]]$current.DocumentationUrls)
        try {
            [BarnLabs.KeepKeys.CredentialVault]::Write(
                $Script:MetadataPrefix + $Name,
                $current.UserName,
                $current.Comment,
                $bytes
            )
        } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
        return $count
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

function Get-KeepKeysCredentials {
    $items = [BarnLabs.KeepKeys.CredentialVault]::Enumerate($Script:MetadataPrefix + "*")
    $results = [Collections.Generic.List[object]]::new()
    foreach ($item in $items) {
        if (-not $item.TargetName.StartsWith(
            $Script:MetadataPrefix,
            [StringComparison]::Ordinal
        )) { continue }
        $name = $item.TargetName.Substring($Script:MetadataPrefix.Length)
        try {
            $metadata = Read-KeepKeysMetadata $name
        } catch {
            continue
        }
        if ($null -ne $metadata) {
            $results.Add($metadata)
        }
    }
    return @($results | Sort-Object {
        $_.TargetName.Substring($Script:MetadataPrefix.Length)
    })
}

function Save-KeepKeysRecord {
    param(
        [string]$Name,
        [string]$Variable,
        [string]$Description,
        [string]$Provider,
        [string[]]$DocumentationUrls,
        [string]$Secret,
        [Nullable[bool]]$ExpectedExisting = $null
    )
    $mutex = New-KeepKeysNameMutex $Name
    try {
    Assert-KeepKeysMetadata $Name $Variable $Description $Provider `
        $DocumentationUrls
    Assert-KeepKeysSecret $Secret
    $secretBytes = [Text.Encoding]::UTF8.GetBytes($Secret)
    $metadataBytes = ConvertTo-KeepKeysMetadataBytes `
        $Provider $DocumentationUrls
    $metadataTarget = $Script:MetadataPrefix + $Name
    $secretTarget = $Script:SecretPrefix + $Name
    $previousMetadata = [BarnLabs.KeepKeys.CredentialVault]::Read(
        $metadataTarget,
        $true
    )
    if ($null -ne $ExpectedExisting -and
        (($null -ne $previousMetadata) -ne [bool]$ExpectedExisting)) {
        if ($null -ne $previousMetadata -and
            $null -ne $previousMetadata.Secret) {
            [Array]::Clear(
                $previousMetadata.Secret,
                0,
                $previousMetadata.Secret.Length
            )
        }
        [Array]::Clear($secretBytes, 0, $secretBytes.Length)
        [Array]::Clear($metadataBytes, 0, $metadataBytes.Length)
        throw (
            "The stored KeepKeys name changed after the phone page opened. " +
            "Start a new phone intake and review the replacement warning."
        )
    }
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
            $Variable,
            $Description,
            $metadataBytes
        )
    } catch {
        $writeFailure = $_
        $rollbackFailures = [Collections.Generic.List[Exception]]::new()
        try {
            if ($null -eq $previousSecret) {
                [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                    $secretTarget
                )
            } else {
                [BarnLabs.KeepKeys.CredentialVault]::Write(
                    $secretTarget,
                    "KEEPKEYS_SECRET",
                    "KeepKeys protected value",
                    $previousSecret.Secret
                )
            }
        } catch {
            $rollbackFailures.Add($_.Exception)
        }
        try {
            if ($null -eq $previousMetadata) {
                [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                    $metadataTarget
                )
            } else {
                [BarnLabs.KeepKeys.CredentialVault]::Write(
                    $metadataTarget,
                    $previousMetadata.UserName,
                    $previousMetadata.Comment,
                    $previousMetadata.Secret
                )
            }
        } catch {
            $rollbackFailures.Add($_.Exception)
        }
        if ($rollbackFailures.Count -gt 0) {
            throw (New-KeepKeysPortalStorageUncertainError `
                -Message (
                    "Credential Manager failed during storage and rollback. " +
                    "Remove '$Name' from KeepKeys before retrying."
                ) `
                -Cause $rollbackFailures[0])
        }
        throw $writeFailure
    } finally {
        [Array]::Clear($secretBytes, 0, $secretBytes.Length)
        [Array]::Clear($metadataBytes, 0, $metadataBytes.Length)
        if ($null -ne $previousSecret -and
            $null -ne $previousSecret.Secret) {
            [Array]::Clear(
                $previousSecret.Secret,
                0,
                $previousSecret.Secret.Length
            )
        }
        if ($null -ne $previousMetadata -and
            $null -ne $previousMetadata.Secret) {
            [Array]::Clear(
                $previousMetadata.Secret,
                0,
                $previousMetadata.Secret.Length
            )
        }
    }
    return @{
        status = "ok"
        message = "Stored '$Name' in Windows Credential Manager."
        name = $Name
        variable = $Variable
        description = $Description
        provider = $Provider
        documentationUrls = $DocumentationUrls
    }
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

function Test-KeepKeysPortalParent {
    param([int]$ParentProcessId)
    try {
        if (-not [BarnLabs.KeepKeys.ProcessIdentity]::IsNodeProcess(
            $ParentProcessId
        )) {
            return $false
        }
        $process = Get-WmiObject -Class Win32_Process -Filter (
            "ProcessId = $ParentProcessId"
        ) -ErrorAction Stop
        if ($null -eq $process -or
            [String]::IsNullOrWhiteSpace($process.CommandLine)) {
            return $false
        }
        $arguments = [BarnLabs.KeepKeys.CommandLine]::Parse(
            $process.CommandLine
        )
        if ($arguments.Length -lt 2) {
            return $false
        }
        $expectedPortal = [IO.Path]::GetFullPath(
            (Join-Path $PSScriptRoot "keepkeys-portal.mjs")
        )
        $parentScript = [IO.Path]::GetFullPath($arguments[1])
        return [String]::Equals(
            $parentScript,
            $expectedPortal,
            [StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Read-KeepKeysPortalSecret {
    $expectedDigest = [string]$env:KEEPKEYS_PORTAL_CAPABILITY_SHA256
    $expectedParent = [string]$env:KEEPKEYS_PORTAL_PARENT_PID
    $env:KEEPKEYS_PORTAL_CAPABILITY_SHA256 = $null
    $env:KEEPKEYS_PORTAL_PARENT_PID = $null
    $parentPid = 0
    if (-not [Console]::IsInputRedirected -or
        $expectedDigest -cnotmatch "^[a-f0-9]{64}$" -or
        -not [int]::TryParse($expectedParent, [ref]$parentPid) -or
        $parentPid -le 0 -or
        $parentPid -ne [BarnLabs.KeepKeys.ProcessIdentity]::ParentProcessId() -or
        -not (Test-KeepKeysPortalParent $parentPid)) {
        throw (
            "The private phone-intake commit requires the live KeepKeys " +
            "portal channel."
        )
    }
    $stream = [Console]::OpenStandardInput()
    $capability = [byte[]]::new(32)
    $capabilityCount = 0
    while ($capabilityCount -lt $capability.Length) {
        $read = $stream.Read(
            $capability,
            $capabilityCount,
            $capability.Length - $capabilityCount
        )
        if ($read -eq 0) { break }
        $capabilityCount += $read
    }
    if ($capabilityCount -ne $capability.Length) {
        [Array]::Clear($capability, 0, $capability.Length)
        throw (
            "The private phone-intake channel ended before authorization."
        )
    }
    $expectedBytes = [byte[]]::new(32)
    $actualBytes = $null
    try {
        for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
            $expectedBytes[$index] = [Convert]::ToByte(
                $expectedDigest.Substring($index * 2, 2),
                16
            )
        }
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $actualBytes = $sha256.ComputeHash($capability)
        } finally {
            $sha256.Dispose()
        }
        $difference = 0
        for ($index = 0; $index -lt $actualBytes.Length; $index += 1) {
            $difference = $difference -bor (
                $actualBytes[$index] -bxor $expectedBytes[$index]
            )
        }
        if ($difference -ne 0) {
            throw (
                "The private phone-intake channel was not authorized."
            )
        }
    } finally {
        [Array]::Clear($capability, 0, $capability.Length)
        [Array]::Clear($expectedBytes, 0, $expectedBytes.Length)
        if ($null -ne $actualBytes) {
            [Array]::Clear($actualBytes, 0, $actualBytes.Length)
        }
    }
    $buffer = [byte[]]::new($Script:MaximumSecretBytes + 1)
    $count = 0
    while ($count -lt $buffer.Length) {
        $read = $stream.Read($buffer, $count, $buffer.Length - $count)
        if ($read -eq 0) { break }
        $count += $read
    }
    if ($count -gt $Script:MaximumSecretBytes) {
        [Array]::Clear($buffer, 0, $buffer.Length)
        throw (
            "Secret values must not exceed " +
            "$($Script:MaximumSecretBytes) UTF-8 bytes."
        )
    }
    try {
        $utf8 = [Text.UTF8Encoding]::new($false, $true)
        return [pscustomobject]@{
            Buffer = $buffer
            Secret = $utf8.GetString($buffer, 0, $count)
        }
    } catch {
        [Array]::Clear($buffer, 0, $buffer.Length)
        throw "The phone submitted an invalid UTF-8 key."
    }
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
        $firstMetadataBytes = ConvertTo-KeepKeysMetadataBytes `
            "KeepKeys Doctor" `
            ([string[]]@("https://github.com/barnlabs/keepkeys"))
        try {
            [BarnLabs.KeepKeys.CredentialVault]::Write(
                $metadataTarget,
                "KEEPKEYS_DOCTOR",
                "Temporary KeepKeys Credential Manager verification",
                $firstMetadataBytes
            )
        } finally {
            [Array]::Clear(
                $firstMetadataBytes,
                0,
                $firstMetadataBytes.Length
            )
        }
        $firstRead = [BarnLabs.KeepKeys.CredentialVault]::Read($secretTarget, $true)
        $firstMetadata = Read-KeepKeysMetadata $name
        $firstListed = @(
            Get-KeepKeysCredentials | Where-Object {
                $_.TargetName -ceq $metadataTarget
            }
        )
        $firstValue = [Text.Encoding]::UTF8.GetString($firstRead.Secret)
        [Array]::Clear($firstRead.Secret, 0, $firstRead.Secret.Length)
        $firstMatches = (
            $firstValue -ceq $first -and
            $firstMetadata.UserName -ceq "KEEPKEYS_DOCTOR" -and
            $firstMetadata.Comment -ceq "Temporary KeepKeys Credential Manager verification" -and
            $firstMetadata.Provider -ceq "KeepKeys Doctor" -and
            $firstMetadata.DocumentationUrls.Count -eq 1 -and
            $firstMetadata.DocumentationUrls[0] -ceq "https://github.com/barnlabs/keepkeys" -and
            $firstListed.Count -eq 1 -and
            (Test-KeepKeysMetadataEqual $firstMetadata $firstListed[0])
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
        $secondMetadataBytes = ConvertTo-KeepKeysMetadataBytes `
            "BarnLabs" `
            ([string[]]@(
                "https://github.com/barnlabs/keepkeys",
                "https://github.com/barnlabs/keepkeys/blob/main/README.md"
            ))
        try {
            [BarnLabs.KeepKeys.CredentialVault]::Write(
                $metadataTarget,
                "KEEPKEYS_DOCTOR_UPDATED",
                "Updated temporary KeepKeys verification",
                $secondMetadataBytes
            )
        } finally {
            [Array]::Clear(
                $secondMetadataBytes,
                0,
                $secondMetadataBytes.Length
            )
        }
        $secondRead = [BarnLabs.KeepKeys.CredentialVault]::Read($secretTarget, $true)
        $secondMetadata = Read-KeepKeysMetadata $name
        $secondValue = [Text.Encoding]::UTF8.GetString($secondRead.Secret)
        [Array]::Clear($secondRead.Secret, 0, $secondRead.Secret.Length)
        $secondMatches = (
            $secondValue -ceq $second -and
            $secondMetadata.UserName -ceq "KEEPKEYS_DOCTOR_UPDATED" -and
            $secondMetadata.Comment -ceq "Updated temporary KeepKeys verification" -and
            $secondMetadata.Provider -ceq "BarnLabs" -and
            $secondMetadata.DocumentationUrls.Count -eq 2 -and
            $secondMetadata.DocumentationUrls[1] -ceq "https://github.com/barnlabs/keepkeys/blob/main/README.md"
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
    $uncertainError = New-KeepKeysPortalStorageUncertainError `
        -Message "Synthetic rollback uncertainty." `
        -Cause ([Exception]::new("Synthetic rollback failure."))
    $uncertainFailure = ConvertTo-KeepKeysFailure -Exception $uncertainError
    if ($uncertainFailure.status -cne "error" -or
        $uncertainFailure.storageState -cne "uncertain" -or
        $uncertainFailure.cleanupKind -cne "native-rollback") {
        throw "Credential Manager rollback-uncertainty self-test failed."
    }
    if (-not (Test-KeepKeysName "github-release") -or
        -not (Test-KeepKeysName "new-key") -or
        (Test-KeepKeysName "../../escape") -or
        -not (Test-KeepKeysVariable "GITHUB_TOKEN") -or
        (Test-KeepKeysVariable "PATH") -or
        (Test-KeepKeysVariable "LD_PRELOAD")) {
        throw "Validation self-test failed."
    }
    Assert-KeepKeysMetadata "new-key" "SECRET_KEY" `
        "Credential for future approved agent commands" "Example" `
        ([string[]]@("https://docs.example.com/api"))
    Assert-KeepKeysMetadata "new-key" "SECRET_KEY" `
        "Credential for future approved agent commands" "Example" `
        ([string[]]@(
            "https://docs.example.com/API",
            "https://docs.example.com/api"
        ))
    $invalidDocumentationRejected = $false
    try {
        Assert-KeepKeysMetadata "new-key" "SECRET_KEY" `
            "Credential for future approved agent commands" "Example" `
            ([string[]]@("http://docs.example.com/api"))
    } catch {
        $invalidDocumentationRejected = $true
    }
    if (-not $invalidDocumentationRejected) {
        throw "Documentation validation self-test failed."
    }
    $oversizedMetadataRejected = $false
    try {
        $expandingMetadataValue = [String]::new([char]92, 1300)
        $oversizedMetadata = ConvertTo-KeepKeysMetadataBytes `
            $expandingMetadataValue ([string[]]@("https://docs.example.com/api"))
        [Array]::Clear($oversizedMetadata, 0, $oversizedMetadata.Length)
    } catch {
        $oversizedMetadataRejected = (
            $_.Exception.Message -like "*$($Script:MaximumMetadataBytes)*"
        )
    }
    if (-not $oversizedMetadataRejected) {
        throw "Credential Manager metadata-size self-test failed."
    }
    $positiveCapture = @{
        Cleared = $false
        Stored = $false
    }
    Invoke-KeepKeysPasteAndStore `
        -ReadClipboard { "synthetic-store-secret" } `
        -ClearClipboard { $positiveCapture.Cleared = $true } `
        -StoreSecret {
            param([string]$value)
            $positiveCapture.Stored = $value -ceq "synthetic-store-secret"
        }
    $rejectedCapture = @{
        Cleared = $false
        Stored = $false
    }
    $invalidCaptureRejected = $false
    try {
        Invoke-KeepKeysPasteAndStore `
            -ReadClipboard { "short" } `
            -ClearClipboard { $rejectedCapture.Cleared = $true } `
            -StoreSecret { $rejectedCapture.Stored = $true }
    } catch {
        $invalidCaptureRejected = (
            [string]$_.Exception.Data["KeepKeysStage"] -ceq "secret-validation"
        )
    }
    if (-not $positiveCapture.Cleared -or -not $positiveCapture.Stored -or
        -not $invalidCaptureRejected -or -not $rejectedCapture.Cleared -or
        $rejectedCapture.Stored) {
        throw "Paste & Store boundary self-test failed."
    }
    $metadataBytes = ConvertTo-KeepKeysMetadataBytes "Example" `
        ([string[]]@("https://docs.example.com/api"))
    try {
        $metadata = ([Text.Encoding]::UTF8.GetString($metadataBytes) | ConvertFrom-Json)
        if ($metadata.version -ne 3 -or $metadata.provider -cne "Example" -or
            $metadata.allowRules.Count -ne 0 -or
            $metadata.documentationUrls[0] -cne "https://docs.example.com/api") {
            throw "Metadata encoding self-test failed."
        }
    } finally {
        [Array]::Clear($metadataBytes, 0, $metadataBytes.Length)
    }
    $decodedBytes = ConvertTo-KeepKeysMetadataBytes "Example" `
        ([string[]]@("https://docs.example.com/api"))
    $decodedMetadata = ConvertFrom-KeepKeysMetadataCredential "new-key" `
        ([pscustomobject]@{
            TargetName = $Script:MetadataPrefix + "new-key"
            UserName = "SECRET_KEY"
            Comment = "Credential for future approved agent commands"
            Secret = $decodedBytes
        })
    if ($decodedMetadata.Provider -cne "Example" -or
        $decodedMetadata.DocumentationUrls.Count -ne 1 -or
        $decodedMetadata.AllowRules.Count -ne 0 -or
        $decodedMetadata.DocumentationUrls[0] -cne "https://docs.example.com/api") {
        throw "Metadata parsing self-test failed."
    }
    $legacyBytes = [Text.Encoding]::UTF8.GetBytes(@{
        version = 2; provider = "Example";
        documentationUrls = [string[]]@("https://docs.example.com/api")
    } | ConvertTo-Json -Compress)
    $legacyMetadata = ConvertFrom-KeepKeysMetadataCredential "new-key" `
        ([pscustomobject]@{
            TargetName = $Script:MetadataPrefix + "new-key"; UserName = "SECRET_KEY";
            Comment = "Credential for future approved agent commands"; Secret = $legacyBytes
        })
    if ($legacyMetadata.AllowRules.Count -ne 0) {
        throw "Legacy metadata compatibility self-test failed."
    }
    $legacyV1Bytes = [Text.Encoding]::UTF8.GetBytes(@{
        version = 1; provider = "Example";
        documentationUrls = [string[]]@("https://docs.example.com/api")
    } | ConvertTo-Json -Compress)
    $legacyV1Metadata = ConvertFrom-KeepKeysMetadataCredential "new-key" `
        ([pscustomobject]@{
            TargetName = $Script:MetadataPrefix + "new-key"; UserName = "SECRET_KEY";
            Comment = "Credential for future approved agent commands"; Secret = $legacyV1Bytes
        })
    if ($legacyV1Metadata.AllowRules.Count -ne 0) {
        throw "Legacy v1 metadata compatibility self-test failed."
    }
    $syntheticRequest = [pscustomobject]@{
        Purpose = "Publish synthetic release"; Program = "C:\\Tools\\publisher.exe";
        Fingerprint = ("a" * 64); Arguments = [string[]]@("--channel", "synthetic");
        WorkingDirectory = "C:\\Work"; Entrypoint = $null; EntrypointFingerprint = $null
    }
    $syntheticRule = Get-KeepKeysRuleFromRequest $syntheticRequest
    $differentPurpose = Get-KeepKeysRuleFromRequest $syntheticRequest
    $differentPurpose.purpose = "Publish a different release"
    $staleFingerprint = Get-KeepKeysRuleFromRequest $syntheticRequest
    $staleFingerprint.fingerprint = ("b" * 64)
    if (-not (Test-KeepKeysAllowRuleMatch $syntheticRule $syntheticRequest) -or
        (Test-KeepKeysAllowRuleMatch $differentPurpose $syntheticRequest) -or
        (Test-KeepKeysAllowRuleMatch $staleFingerprint $syntheticRequest)) {
        throw "Always-allow exact command self-test failed."
    }
    $ruleMetadataBytes = ConvertTo-KeepKeysMetadataBytes "Example" `
        ([string[]]@("https://docs.example.com/api")) ([object[]]@($syntheticRule))
    try {
        $ruleMetadata = ([Text.Encoding]::UTF8.GetString($ruleMetadataBytes) | ConvertFrom-Json)
        if ($ruleMetadata.version -ne 3 -or $ruleMetadata.allowRules.Count -ne 1 -or
            -not (Test-KeepKeysAllowRuleMatch $ruleMetadata.allowRules[0] $syntheticRequest)) {
            throw "Always-allow metadata self-test failed."
        }
    } finally { [Array]::Clear($ruleMetadataBytes, 0, $ruleMetadataBytes.Length) }
    $changedMetadata = [pscustomobject]@{
        UserName = $decodedMetadata.UserName
        Comment = $decodedMetadata.Comment
        Provider = $decodedMetadata.Provider
        DocumentationUrls = [string[]]@("https://docs.example.com/changed")
    }
    if (Test-KeepKeysMetadataEqual $decodedMetadata $changedMetadata) {
        throw "Metadata recheck self-test failed."
    }
    $marker = "synthetic-test-secret"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($marker))
    $redacted = Protect-KeepKeysOutput "before $marker $encoded after" $marker
    if ($redacted.Contains($marker) -or $redacted.Contains($encoded)) {
        throw "Redaction self-test failed."
    }
    $probeRoot = Join-Path ([IO.Path]::GetTempPath()) (
        "keepkeys-scope-" + [Guid]::NewGuid().ToString("N").ToLowerInvariant()
    )
    $probePath = Join-Path $probeRoot "KeepKeysScopeProbe.exe"
    $probeSource = @'
using System;

public static class KeepKeysScopeProbe
{
    public static int Main()
    {
        string secret = Environment.GetEnvironmentVariable("KEEPKEYS_TEST") ?? "";
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        Console.Out.Write(secret + "|" + path);
        return 0;
    }
}
'@
    [void][IO.Directory]::CreateDirectory($probeRoot)
    try {
        Add-Type -TypeDefinition $probeSource -Language CSharp `
            -OutputAssembly $probePath -OutputType ConsoleApplication
        $run = [BarnLabs.KeepKeys.ScopedRunner]::Run(
            $probePath,
            [string[]]@(),
            $probeRoot,
            "KEEPKEYS_TEST",
            $marker,
            $Script:MaximumCapturedBytes
        )
    } finally {
        if (Test-Path -LiteralPath $probeRoot) {
            Remove-Item -LiteralPath $probeRoot -Recurse -Force
        }
    }
    $output = Protect-KeepKeysOutput ([Text.Encoding]::UTF8.GetString($run.StandardOutput)) $marker
    if ($run.ExitCode -ne 0 -or
        $output -cne "[REDACTED BY KEEPKEYS]|" -or
        $output.Contains($marker)) {
        throw "Scoped-process self-test failed."
    }
    return @{
        status = "ok"
        message = "KeepKeys Windows validation, Paste & Store, scoped-process, and redaction self-tests passed."
        version = $Script:Version
    }
}

try {
    if ($args.Count -eq 0) {
        throw "Usage: keepkeys <store|rotate|revoke|list|remove|run|status|doctor|--self-test>"
    }
    $action = $args[0]
    $rest = if ($args.Count -gt 1) { [string[]]$args[1..($args.Count - 1)] } else { [string[]]@() }
    switch ($action) {
        "store" {
            $serializedMutation = [string]$env:KEEPKEYS_SERIALIZED_MUTATION
            $env:KEEPKEYS_SERIALIZED_MUTATION = $null
            if ($serializedMutation -cne "1") {
                throw (
                    "KeepKeys store and remove actions must use the shared per-name " +
                    "coordinator."
                )
            }
            $name = Get-KeepKeysOption $rest "--name" -Required
            $variable = (Get-KeepKeysOption $rest "--variable" -Required).ToUpperInvariant()
            $description = Get-KeepKeysOption $rest "--description" -Required
            $provider = Get-KeepKeysOption $rest "--provider" -Required
            $documentationUrls = Get-KeepKeysOptions $rest "--documentation-url"
            $expectedExistingValue = Get-KeepKeysOption $rest "--expect-existing"
            $expectedExisting = $null
            if (-not [String]::IsNullOrEmpty($expectedExistingValue)) {
                if ($expectedExistingValue -cne "yes" -and $expectedExistingValue -cne "no") {
                    throw "The rotation existence check is invalid."
                }
                $expectedExisting = $expectedExistingValue -ceq "yes"
            }
            Assert-KeepKeysMetadata $name $variable $description $provider $documentationUrls
            $entered = Show-KeepKeysStoreDialog $name $variable $description `
                $provider $documentationUrls
            if ($null -eq $entered) {
                $result = @{ status = "cancelled"; message = "Secret storage was cancelled." }
                break
            }
            try {
                $result = Save-KeepKeysRecord `
                    $entered.Name `
                    $entered.Variable `
                    $entered.Description `
                    $entered.Provider `
                    $entered.DocumentationUrls `
                    $entered.Secret `
                    $expectedExisting
            } finally {
                $entered.Secret = ""
            }
        }
        "rotate" {
            $serializedMutation = [string]$env:KEEPKEYS_SERIALIZED_MUTATION
            $env:KEEPKEYS_SERIALIZED_MUTATION = $null
            if ($serializedMutation -cne "1") {
                throw "KeepKeys rotate actions must use the shared per-name coordinator."
            }
            $name = Get-KeepKeysOption $rest "--name" -Required
            if (-not (Test-KeepKeysName $name)) {
                throw "The requested KeepKeys name is invalid."
            }
            $metadata = Read-KeepKeysMetadata $name
            if ($null -eq $metadata) {
                throw "No KeepKeys secret is stored as '$name'."
            }
            $entered = Show-KeepKeysStoreDialog $name $metadata.UserName `
                $metadata.Comment $metadata.Provider $metadata.DocumentationUrls
            if ($null -eq $entered) {
                $result = @{ status = "cancelled"; message = "Secret rotation was cancelled." }
                break
            }
            try {
                $result = Save-KeepKeysRecord `
                    $entered.Name `
                    $entered.Variable `
                    $entered.Description `
                    $entered.Provider `
                    $entered.DocumentationUrls `
                    $entered.Secret `
                    $true
            } finally { $entered.Secret = "" }
        }
        "revoke" {
            $serializedMutation = [string]$env:KEEPKEYS_SERIALIZED_MUTATION
            $env:KEEPKEYS_SERIALIZED_MUTATION = $null
            if ($serializedMutation -cne "1") {
                throw "KeepKeys revoke actions must use the shared per-name coordinator."
            }
            $name = Get-KeepKeysOption $rest "--name" -Required
            if (-not (Test-KeepKeysName $name)) {
                throw "The requested KeepKeys name is invalid."
            }
            $metadata = Read-KeepKeysMetadata $name
            if ($null -eq $metadata) {
                $result = @{ status = "ok"; message = "No KeepKeys item named '$name' exists."; revokedRules = 0 }
                break
            }
            $ruleCount = @($metadata.AllowRules).Count
            if ($ruleCount -eq 0) {
                $result = @{ status = "ok"; message = "No always-allow rules are stored for '$name'."; revokedRules = 0 }
                break
            }
            if (-not (Show-KeepKeysRevokeDialog $name $metadata.UserName $metadata.Comment $ruleCount)) {
                $result = @{ status = "cancelled"; message = "Always-allow revocation was cancelled." }
                break
            }
            $revoked = Clear-KeepKeysAllowRules $name $metadata
            $result = @{ status = "ok"; message = "Disabled automatic approvals for '$name'."; revokedRules = $revoked }
        }
        "_portal-commit" {
            $name = Get-KeepKeysOption $rest "--name" -Required
            $variable = (Get-KeepKeysOption $rest "--variable" -Required).ToUpperInvariant()
            $description = Get-KeepKeysOption $rest "--description" -Required
            $provider = Get-KeepKeysOption $rest "--provider" -Required
            $documentationUrls = Get-KeepKeysOptions $rest "--documentation-url"
            $expectedValue = Get-KeepKeysOption $rest "--expect-existing" -Required
            if ($expectedValue -cne "yes" -and $expectedValue -cne "no") {
                throw "The private phone-intake replacement state is invalid."
            }
            $nativeSelfTestValue = Get-KeepKeysOption `
                $rest "--native-self-test"
            if ([String]::IsNullOrEmpty($nativeSelfTestValue)) {
                $nativeSelfTestValue = "no"
            }
            if ($nativeSelfTestValue -cne "no" -and
                $nativeSelfTestValue -cne "round-trip" -and
                $nativeSelfTestValue -cne "create-to-replace" -and
                $nativeSelfTestValue -cne "replace-to-create") {
                throw "The private native portal test request is invalid."
            }
            $nativeSelfTest = $nativeSelfTestValue -cne "no"
            $nativeSelfTestFlag = [string]$env:KEEPKEYS_PORTAL_NATIVE_TEST
            $env:KEEPKEYS_PORTAL_NATIVE_TEST = $null
            if ($nativeSelfTest -and (
                $nativeSelfTestFlag -cne "1" -or
                -not $name.StartsWith(
                    "keepkeys-portal-test-",
                    [StringComparison]::Ordinal
                ) -or
                (
                    $nativeSelfTestValue -ceq "replace-to-create" -and
                    $expectedValue -cne "yes"
                ) -or
                (
                    $nativeSelfTestValue -cne "replace-to-create" -and
                    $expectedValue -cne "no"
                )
            )) {
                throw "KeepKeys rejected an unauthorized native portal test."
            }
            Assert-KeepKeysMetadata $name $variable $description $provider `
                $documentationUrls
            $submitted = Read-KeepKeysPortalSecret
            $secretTarget = $Script:SecretPrefix + $name
            $metadataTarget = $Script:MetadataPrefix + $name
            try {
                if ($nativeSelfTestValue -ceq "replace-to-create") {
                    [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                        $metadataTarget
                    )
                    [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                        $secretTarget
                    )
                    $rejected = $false
                    try {
                        [void](Save-KeepKeysRecord `
                            $name `
                            $variable `
                            $description `
                            $provider `
                            $documentationUrls `
                            $submitted.Secret `
                            $true)
                    } catch {
                        $rejected = $_.Exception.Message -ceq (
                            "The stored KeepKeys name changed after the phone " +
                            "page opened. Start a new phone intake and review " +
                            "the replacement warning."
                        )
                        if (-not $rejected) { throw }
                    }
                    $metadataAfter = [BarnLabs.KeepKeys.CredentialVault]::Read(
                        $metadataTarget,
                        $true
                    )
                    $secretAfter = [BarnLabs.KeepKeys.CredentialVault]::Read(
                        $secretTarget,
                        $true
                    )
                    try {
                        if (-not $rejected -or
                            $null -ne $metadataAfter -or
                            $null -ne $secretAfter) {
                            throw (
                                "The temporary native portal " +
                                "replace-to-create rejection did not verify."
                            )
                        }
                    } finally {
                        if ($null -ne $metadataAfter -and
                            $null -ne $metadataAfter.Secret) {
                            [Array]::Clear(
                                $metadataAfter.Secret,
                                0,
                                $metadataAfter.Secret.Length
                            )
                        }
                        if ($null -ne $secretAfter -and
                            $null -ne $secretAfter.Secret) {
                            [Array]::Clear(
                                $secretAfter.Secret,
                                0,
                                $secretAfter.Secret.Length
                            )
                        }
                    }
                    $result = @{
                        status = "ok"
                        message = (
                            "Temporary native portal replace-to-create " +
                            "rejection verified."
                        )
                        cleaned = $true
                        scenario = $nativeSelfTestValue
                    }
                } else {
                    $result = Save-KeepKeysRecord `
                        $name `
                        $variable `
                        $description `
                        $provider `
                        $documentationUrls `
                        $submitted.Secret `
                        ($expectedValue -ceq "yes")
                if ($nativeSelfTest) {
                    $storedSecret = $null
                    $storedMetadata = $null
                    $matches = $false
                    try {
                        $storedSecret = [BarnLabs.KeepKeys.CredentialVault]::Read(
                            $secretTarget,
                            $true
                        )
                        $storedMetadata = Read-KeepKeysMetadata $name
                        if ($null -ne $storedSecret -and
                            $null -ne $storedSecret.Secret -and
                            $null -ne $storedMetadata) {
                            $utf8 = [Text.UTF8Encoding]::new($false, $true)
                            $loadedSecret = $utf8.GetString(
                                $storedSecret.Secret
                            )
                            $matches = (
                                $loadedSecret -ceq $submitted.Secret -and
                                $storedMetadata.UserName -ceq $variable -and
                                $storedMetadata.Comment -ceq $description -and
                                $storedMetadata.Provider -ceq $provider -and
                                (Test-KeepKeysStringArrayEqual `
                                    ([string[]]$storedMetadata.DocumentationUrls) `
                                    ([string[]]$documentationUrls))
                            )
                            $loadedSecret = ""
                        }
                        if ($nativeSelfTestValue -ceq "create-to-replace") {
                            $raceSecret = $submitted.Secret + "-replacement-race"
                            $raceRejected = $false
                            try {
                                [void](Save-KeepKeysRecord `
                                    $name `
                                    $variable `
                                    $description `
                                    $provider `
                                    $documentationUrls `
                                    $raceSecret `
                                    $false)
                            } catch {
                                $raceRejected = $_.Exception.Message -ceq (
                                    "The stored KeepKeys name changed after " +
                                    "the phone page opened. Start a new phone " +
                                    "intake and review the replacement warning."
                                )
                                if (-not $raceRejected) { throw }
                            } finally {
                                $raceSecret = ""
                            }
                            $secretAfterRace = (
                                [BarnLabs.KeepKeys.CredentialVault]::Read(
                                    $secretTarget,
                                    $true
                                )
                            )
                            $metadataAfterRace = Read-KeepKeysMetadata $name
                            try {
                                $preserved = $false
                                if ($null -ne $secretAfterRace -and
                                    $null -ne $secretAfterRace.Secret -and
                                    $null -ne $metadataAfterRace) {
                                    $loadedAfterRace = $utf8.GetString(
                                        $secretAfterRace.Secret
                                    )
                                    $preserved = (
                                        $loadedAfterRace -ceq
                                            $submitted.Secret -and
                                        $metadataAfterRace.UserName -ceq
                                            $variable -and
                                        $metadataAfterRace.Comment -ceq
                                            $description -and
                                        $metadataAfterRace.Provider -ceq
                                            $provider -and
                                        (Test-KeepKeysStringArrayEqual `
                                            ([string[]]$metadataAfterRace.DocumentationUrls) `
                                            ([string[]]$documentationUrls))
                                    )
                                    $loadedAfterRace = ""
                                }
                                $matches = (
                                    $matches -and
                                    $raceRejected -and
                                    $preserved
                                )
                            } finally {
                                if ($null -ne $secretAfterRace -and
                                    $null -ne $secretAfterRace.Secret) {
                                    [Array]::Clear(
                                        $secretAfterRace.Secret,
                                        0,
                                        $secretAfterRace.Secret.Length
                                    )
                                }
                            }
                        }
                    } finally {
                        if ($null -ne $storedSecret -and
                            $null -ne $storedSecret.Secret) {
                            [Array]::Clear(
                                $storedSecret.Secret,
                                0,
                                $storedSecret.Secret.Length
                            )
                        }
                        [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                            $metadataTarget
                        )
                        [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                            $secretTarget
                        )
                    }
                    $metadataAfter = [BarnLabs.KeepKeys.CredentialVault]::Read(
                        $metadataTarget,
                        $true
                    )
                    $secretAfter = [BarnLabs.KeepKeys.CredentialVault]::Read(
                        $secretTarget,
                        $true
                    )
                    try {
                        if (-not $matches -or
                            $null -ne $metadataAfter -or
                            $null -ne $secretAfter) {
                            throw (
                                "The temporary native portal Credential " +
                                "Manager round trip did not verify."
                            )
                        }
                    } finally {
                        if ($null -ne $metadataAfter -and
                            $null -ne $metadataAfter.Secret) {
                            [Array]::Clear(
                                $metadataAfter.Secret,
                                0,
                                $metadataAfter.Secret.Length
                            )
                        }
                        if ($null -ne $secretAfter -and
                            $null -ne $secretAfter.Secret) {
                            [Array]::Clear(
                                $secretAfter.Secret,
                                0,
                                $secretAfter.Secret.Length
                            )
                        }
                    }
                    $result = @{
                        status = "ok"
                        message = (
                            "Temporary native portal Credential Manager " +
                            "scenario and cleanup verified."
                        )
                        cleaned = $true
                        scenario = $nativeSelfTestValue
                    }
                }
                }
            } finally {
                if ($nativeSelfTest) {
                    [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                        $Script:MetadataPrefix + $name
                    )
                    [void][BarnLabs.KeepKeys.CredentialVault]::Delete(
                        $Script:SecretPrefix + $name
                    )
                }
                $submitted.Secret = ""
                [Array]::Clear(
                    $submitted.Buffer,
                    0,
                    $submitted.Buffer.Length
                )
            }
        }
        "list" {
            $entries = @(
                Get-KeepKeysCredentials | ForEach-Object {
                    @{
                        name = $_.TargetName.Substring($Script:MetadataPrefix.Length)
                        variable = $_.UserName
                        description = $_.Comment
                        provider = $_.Provider
                        documentationUrls = $_.DocumentationUrls
                    }
                }
            )
            $result = @{ status = "ok"; entries = $entries }
        }
        "remove" {
            $serializedMutation = [string]$env:KEEPKEYS_SERIALIZED_MUTATION
            $env:KEEPKEYS_SERIALIZED_MUTATION = $null
            if ($serializedMutation -cne "1") {
                throw (
                    "KeepKeys store and remove actions must use the shared per-name " +
                    "coordinator."
                )
            }
            $name = Get-KeepKeysOption $rest "--name" -Required
            if (-not (Test-KeepKeysName $name)) {
                throw "The requested KeepKeys name is invalid."
            }
            $metadataTarget = $Script:MetadataPrefix + $name
            $secretTarget = $Script:SecretPrefix + $name
            $mutex = New-KeepKeysNameMutex $name
            try {
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
            } finally {
                $mutex.ReleaseMutex()
                $mutex.Dispose()
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
            $metadata = Read-KeepKeysMetadata $request.Name
            if ($null -eq $metadata) {
                throw "No KeepKeys secret is stored as '$($request.Name)'."
            }
            $matchingRule = @($metadata.AllowRules | Where-Object {
                Test-KeepKeysAllowRuleMatch $_ $request
            } | Select-Object -First 1)
            $approval = if ($matchingRule.Count -eq 1) {
                "always"
            } else {
                Show-KeepKeysApprovalDialog $request $metadata
            }
            if ($approval -ceq "cancel") {
                $result = @{ status = "cancelled"; message = "Command use was cancelled." }
                break
            }
            if ($approval -ceq "always" -and $matchingRule.Count -eq 0) {
                $metadata = Save-KeepKeysAllowRule $request.Name $metadata `
                    (Get-KeepKeysRuleFromRequest $request)
            }
            $record = [BarnLabs.KeepKeys.CredentialVault]::Read(
                $secretTarget,
                $true
            )
            if ($null -eq $record) {
                throw "No KeepKeys secret is stored as '$($request.Name)'."
            }
            $secret = ""
            try {
                $secret = [Text.Encoding]::UTF8.GetString($record.Secret)
                $refreshedMetadata = Read-KeepKeysMetadata $request.Name
                if (-not (Test-KeepKeysMetadataEqual $metadata $refreshedMetadata)) {
                    throw "The secret metadata changed after approval. KeepKeys refused to run."
                }
            } finally {
                [Array]::Clear($record.Secret, 0, $record.Secret.Length)
            }
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
    Write-KeepKeysJson (ConvertTo-KeepKeysFailure $_.Exception)
    exit 1
}
