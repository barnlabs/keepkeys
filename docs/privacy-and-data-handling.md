# Privacy and data handling

KeepKeys has no account, cloud service, telemetry, analytics, advertising,
tracking, or BarnLabs-operated credential store. All runtime work is local to
the user's device.

## Data inventory

| Data | Location | Visible to agent | Retention |
| --- | --- | --- | --- |
| Secret value | macOS Keychain, Windows Credential Manager, or Linux Secret Service; transient helper/target memory during store/use | No | Until native confirmed removal |
| Friendly name | Native-vault metadata | Yes when stored, listed, used, or removed | Until removal |
| Variable name | Native-vault metadata | Yes when stored, listed, or displayed for use | Until replacement/removal |
| Description | Native-vault metadata | Yes when stored, listed, or displayed for use | Until replacement/removal |
| Run purpose, path, arguments, cwd, hashes | Native approval window and transient helper memory | Yes; proposed by agent | Not persisted by KeepKeys |
| Bounded redacted stdout/stderr | MCP or Hermes result | Yes | Controlled by the host client |
| Compiled macOS helper cache | `~/Library/Caches/net.barnlabs.keepkeys` | Not credential data | Until cache removal |
| Stable release metadata | `raw.githubusercontent.com/barnlabs/keepkeys/main/update.json` when the user explicitly checks | Version and public Git commit SHAs only | Not persisted by KeepKeys |

Linux Secret Service attributes and labels, macOS Keychain attributes, and
Windows Credential Manager metadata are not treated as secret values. Keep
names and descriptions minimal and operationally useful.

## Collection and transfer

The agent supplies name, variable, description, and a concrete command request.
The user enters the value into the native KeepKeys window. KeepKeys does not
read the clipboard automatically.

- macOS transfers the value directly between AppKit, Security.framework, and
  the approved child environment.
- Windows transfers it between WPF, the Credential Manager API, and the
  approved child environment. Mutable byte arrays are cleared where practical.
- Linux transfers it from Tk to `secret-tool` over standard input, from Secret
  Service through `secret-tool lookup` over standard output, and then to the
  approved child environment. It is never placed in process arguments.

The approved executable and descendants receive the value. They may access the
network, files, logs, or other processes according to their own behavior and OS
permissions. KeepKeys does not inspect or control those destinations.

The optional update checker makes one explicit HTTPS request for a public JSON
manifest. It sends no credential names, values, vault metadata, command data,
device identifier, or analytics, and it never runs automatically. GitHub and
the user's network provider may observe the request under their own policies.

## Logs and diagnostics

KeepKeys emits one JSON result to standard output. It does not intentionally log
secure-field contents, vault value payloads, child environments, or raw
unbounded output. Errors identify the failed local boundary without including a
value.

`keepkeys_doctor` generates a random temporary credential, verifies native-vault
create/update/list/read/delete behavior, and removes it before success. It
never reads an existing user credential.

## Deletion

`keepkeys_remove` requires a native destructive-action confirmation and deletes
the complete named record:

- one Keychain item on macOS;
- paired metadata and value Credential Manager records on Windows;
- one Secret Service item on Linux.

Uninstalling a client integration does not silently delete credentials.
Operating-system vaults control physical storage, backups, journaling, and
remnants; KeepKeys promises logical deletion through the supported API, not
forensic overwrite.

## Storage policy and recovery

macOS records are non-synchronizing and device-only. Windows records use
`CRED_PERSIST_LOCAL_MACHINE`, scoped to the user's local machine. Linux storage
and synchronization behavior is determined by the selected Secret Service
provider; KeepKeys itself adds no sync.

KeepKeys provides no independent backup, recovery, escrow, sharing, rotation, or
account reset. Users remain responsible for the underlying service's credential
recovery and revocation process.
