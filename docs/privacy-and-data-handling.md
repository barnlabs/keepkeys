# Privacy and data handling

KeepKeys has no account, analytics, telemetry, cloud vault, advertising identifier, crash-reporting service, or network request of its own.

## Data inventory

| Data | Location | Returned to the agent? | Retention |
| --- | --- | --- | --- |
| Secret value | macOS Keychain; transient process memory during store/use | No | Until the user removes the Keychain item |
| Environment-variable name | Encoded in the Keychain item's metadata | Yes, for store/list and in the approval window | Until removal/replacement |
| Description | Encoded in the Keychain item's metadata | Yes, for store/list and in the approval window | Until removal/replacement |
| Friendly name | Keychain account attribute | Yes, for store/list/use/remove | Until removal |
| Command purpose/path/arguments/cwd/hash | Native approval UI and transient process memory | Supplied by the agent before approval | Not persisted by KeepKeys |
| Child stdout/stderr | Transient bounded buffers | Yes, after redaction | Not persisted by KeepKeys |
| Compiled helper and build-input hash | User-owned cache | Version/status only | Until cache removal or rebuild |

## Network behavior

KeepKeys itself opens no sockets and calls no remote service. An approved child program may use the network; its behavior is outside KeepKeys and is shown as part of the command request.

## Logs and diagnostics

The helper writes one JSON result to standard output and errors as bounded messages. It does not log Keychain payloads, native form contents, process environments, or raw child output. The `doctor` command generates its own temporary value, verifies a write/read/delete round trip, and deletes the test item.

## Metadata visibility

The active agent task can call `keepkeys_list` to receive friendly names,
environment-variable names, and descriptions without a native confirmation.
This is intentional so future tasks can select the correct credential easily.
The plugin skill limits listing to an explicit user request or metadata needed
for the current authorized task. Do not put account identifiers, customer data,
or unnecessary private details in a KeepKeys description.

## Deletion

`keepkeys_remove` requires a native confirmation and deletes the complete named Keychain item—value and metadata—through Security.framework. Uninstalling the plugin or deleting its compiled cache does not silently delete Keychain items. KeepKeys does not claim forensic overwriting of storage managed internally by macOS.

## macOS and backups

Records use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and disable Keychain synchronization for the item. KeepKeys does not provide independent backup or recovery. Users remain responsible for the underlying service’s key rotation and recovery process.
