# Privacy and data handling

KeepKeys has no account, cloud service, telemetry, analytics, advertising,
tracking, or BarnLabs-operated credential store. Native storage and command use
stay on the host. Optional phone intake crosses the user's private Tailscale
network directly to that host.

## Data inventory

| Data | Location | Visible to agent | Retention |
| --- | --- | --- | --- |
| Secret value | macOS Keychain, Windows Credential Manager, or Linux Secret Service; transient helper/target memory during store/use | No | Until native confirmed removal |
| Friendly name | Native-vault metadata | Yes when stored, listed, used, or removed | Until removal |
| Variable name | Native-vault metadata | Yes when stored, listed, or displayed for use | Until replacement/removal |
| Description | Native-vault metadata | Yes when stored, listed, or displayed for use | Until replacement/removal |
| Provider and official documentation URLs | Native-vault metadata | Yes when stored, listed, or displayed | Until replacement/removal |
| Clipboard value | Shared operating-system clipboard plus transient native-helper memory after explicit **Paste & Store** | Not through KeepKeys; same-user software may observe it | Helper clears the current clipboard immediately after capture; OS history or another process may retain a prior copy |
| Phone-submitted value | Phone browser memory, phone clipboard, encrypted tailnet connection, transient localhost portal memory, redirected native-helper stdin, then the host vault | No | Portal buffers are cleared where supported after one authenticated submission attempt; the phone OS or browser may retain a copy |
| One-time phone URL and expiry | Tool result, active conversation, and transient portal process | Yes | Link expires after ten minutes and stops working after the first authenticated submission attempt |
| Tailscale user login for the active page | Transient portal memory from a Tailscale Serve identity header | No | Until success, failure, or ten-minute expiry |
| Run purpose, path, arguments, cwd, hashes | Native approval window and transient helper memory | Yes; proposed by agent | Not persisted by KeepKeys |
| Bounded redacted stdout/stderr | MCP or Hermes result | Yes | Controlled by the host client |
| Compiled macOS helper cache | `~/Library/Caches/net.barnlabs.keepkeys` | Not credential data | Until cache removal |
| Stable release metadata | `raw.githubusercontent.com/barnlabs/keepkeys/main/update.json` when the user explicitly checks | Version and public Git commit SHAs only | Not persisted by KeepKeys |

Linux Secret Service attributes and labels, macOS Keychain attributes, and
Windows Credential Manager metadata are not treated as secret values. Keep
names, descriptions, provider names, and documentation links minimal,
official, and operationally useful.

## Collection and transfer

The agent supplies name, variable, description, provider, one to three official
HTTPS documentation links, and a concrete command request. The user copies the
credential from its provider and presses **Paste & Store** in the native
KeepKeys window. The helper reads the clipboard only in direct response to that
click and immediately clears the current clipboard. It does not monitor, poll,
or inspect the clipboard in the background, and KeepKeys exposes no
clipboard-reading tool. A coding host with unrestricted same-user command
execution can use operating-system clipboard APIs independently of KeepKeys, so
users should copy only when the Store window is ready and click immediately.

When the user asks to store from a phone, KeepKeys returns a one-time
tailnet-only URL. The phone and host must already be signed into the same
Tailscale network. The page receives the value only after the user presses
**Paste & Store**, forwards it to the host's native vault through a private
capability-framed pipe, and closes. The native helper accepts that pipe only
from the exact bundled portal parent. KeepKeys cannot clear the phone clipboard
or its history. It never enables Tailscale Funnel, opens the page to the public
internet, or sends the value to BarnLabs.

- macOS transfers the value between AppKit's pasteboard API,
  Security.framework, and the approved child environment.
- Windows transfers it between WPF's clipboard API, the Credential Manager API,
  and the approved child environment. Mutable byte arrays are cleared where
  practical.
- Linux transfers it from Tk's clipboard API to `secret-tool` over standard
  input, from Secret
  Service through `secret-tool lookup` over standard output, and then to the
  approved child environment. It is never placed in process arguments.

The approved executable and descendants receive the value. They may access the
network, files, logs, or other processes according to their own behavior and OS
permissions. KeepKeys does not inspect or control those destinations.

The optional update checker makes one explicit HTTPS request for a public JSON
manifest. It sends no credential names, values, vault metadata, command data,
device identifier, or analytics, and it never runs automatically. GitHub and
the user's network provider may observe the request under their own policies.

Tailscale and the user's identity provider can observe ordinary connection,
device, and identity metadata for phone intake under their own policies. The
key travels through Tailscale's encrypted connection to the host and KeepKeys
does not send it to the Tailscale control plane as application data.

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
- paired metadata and value Secret Service items on Linux.

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
