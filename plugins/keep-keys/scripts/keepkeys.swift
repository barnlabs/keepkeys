import AppKit
import CryptoKit
import Foundation
import Security

private let keepKeysVersion = "0.2.0"
private let keychainService = "net.barnlabs.keepkeys"
private let maximumSecretBytes = 2_048
private let maximumCapturedBytes = 1_048_576

private struct KeepKeysFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct EntryMetadata: Codable {
    let version: Int
    let variable: String
    let description: String
}

private struct SecretRecord {
    let metadata: EntryMetadata
    var secret: String
}

private struct RunRequest {
    let name: String
    let purpose: String
    let program: URL
    let arguments: [String]
    let workingDirectory: URL?
    let fingerprint: String
}

private func emit(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    else {
        FileHandle.standardOutput.write(
            Data("{\"message\":\"KeepKeys could not encode its result.\",\"status\":\"error\"}\n".utf8)
        )
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

private func fail(_ message: String) -> Never {
    emit(["status": "error", "message": message])
    Foundation.exit(1)
}

private func hasControlCharacters(_ value: String) -> Bool {
    value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
}

private func validName(_ value: String) -> Bool {
    guard value.utf8.count <= 128,
          let first = value.utf8.first,
          (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
    else {
        return false
    }
    return value.utf8.allSatisfy { byte in
        (byte >= 65 && byte <= 90)
            || (byte >= 97 && byte <= 122)
            || (byte >= 48 && byte <= 57)
            || byte == 45
            || byte == 46
            || byte == 95
    }
}

private func validVariable(_ value: String) -> Bool {
    let reserved: Set<String> = [
        "BASH_ENV", "CDPATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
        "ENV", "GIT_SSH", "GIT_SSH_COMMAND", "HOME", "IFS", "LD_LIBRARY_PATH",
        "LD_PRELOAD", "LOGNAME", "NODE_OPTIONS", "OLDPWD", "PATH", "PERL5OPT",
        "PWD", "PYTHONHOME", "PYTHONPATH", "RUBYOPT", "SHELL", "SSH_AUTH_SOCK",
        "TEMP", "TMP", "TMPDIR", "USER",
    ]
    guard value.utf8.count <= 128,
          let first = value.utf8.first,
          (first >= 65 && first <= 90) || first == 95,
          value.utf8.allSatisfy({ byte in
              (byte >= 65 && byte <= 90) || (byte >= 48 && byte <= 57) || byte == 95
          }),
          !reserved.contains(value),
          !value.hasPrefix("DYLD_"),
          !value.hasPrefix("LD_")
    else {
        return false
    }
    return true
}

private func validateSecret(_ value: String) throws {
    let size = value.utf8.count
    guard size >= 8 else {
        throw KeepKeysFailure(message: "Secret values must contain at least 8 UTF-8 bytes.")
    }
    guard size <= maximumSecretBytes else {
        throw KeepKeysFailure(
            message: "Secret values must not exceed \(maximumSecretBytes) UTF-8 bytes."
        )
    }
}

private func validDescription(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 240 && !hasControlCharacters(value)
}

private func keychainQuery(name: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: name,
    ]
}

private enum KeychainStore {
    static func exists(name: String) throws -> Bool {
        var query = keychainQuery(name: name)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = false
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess {
            return true
        }
        if status == errSecItemNotFound {
            return false
        }
        throw KeepKeysFailure(message: "Keychain lookup failed (OSStatus \(status)).")
    }

    static func store(name: String, variable: String, description: String, secret: String) throws {
        try validateSecret(secret)
        guard validDescription(description) else {
            throw KeepKeysFailure(message: "Descriptions must be one visible line of at most 240 bytes.")
        }
        let metadata = EntryMetadata(version: 1, variable: variable, description: description)
        let encodedMetadata = try JSONEncoder().encode(metadata)
        var encodedSecret = Data(secret.utf8)
        defer { encodedSecret.resetBytes(in: 0..<encodedSecret.count) }

        var add = keychainQuery(name: name)
        add[kSecAttrLabel as String] = "KeepKeys · \(name)"
        add[kSecAttrDescription as String] = description
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        add[kSecAttrSynchronizable as String] = kCFBooleanFalse
        add[kSecAttrGeneric as String] = encodedMetadata
        add[kSecValueData as String] = encodedSecret

        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus == errSecSuccess {
            return
        }
        if addStatus != errSecDuplicateItem {
            throw KeepKeysFailure(message: "Keychain write failed (OSStatus \(addStatus)).")
        }

        let update: [String: Any] = [
            kSecAttrDescription as String: description,
            kSecAttrGeneric as String: encodedMetadata,
            kSecValueData as String: encodedSecret,
        ]
        let updateStatus = SecItemUpdate(
            keychainQuery(name: name) as CFDictionary,
            update as CFDictionary
        )
        guard updateStatus == errSecSuccess else {
            throw KeepKeysFailure(message: "Keychain update failed (OSStatus \(updateStatus)).")
        }
    }

    static func load(name: String) throws -> SecretRecord {
        var query = keychainQuery(name: name)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            throw KeepKeysFailure(message: "No KeepKeys secret is stored as '\(name)'.")
        }
        guard status == errSecSuccess,
              let row = result as? [String: Any],
              let returnedSecretData = row[kSecValueData as String] as? Data,
              let metadataData = row[kSecAttrGeneric as String] as? Data
        else {
            throw KeepKeysFailure(message: "Keychain read failed (OSStatus \(status)).")
        }
        var secretData = Data(returnedSecretData)
        defer { secretData.resetBytes(in: 0..<secretData.count) }
        let metadata: EntryMetadata
        do {
            metadata = try JSONDecoder().decode(EntryMetadata.self, from: metadataData)
        } catch {
            throw KeepKeysFailure(
                message: "The Keychain item is not a supported KeepKeys record."
            )
        }
        guard metadata.version == 1,
              validVariable(metadata.variable),
              validDescription(metadata.description),
              let secret = String(data: secretData, encoding: .utf8)
        else {
            throw KeepKeysFailure(message: "The Keychain item has invalid KeepKeys metadata.")
        }
        try validateSecret(secret)
        return SecretRecord(metadata: metadata, secret: secret)
    }

    static func entries() throws -> [[String: String]] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return []
        }
        guard status == errSecSuccess else {
            throw KeepKeysFailure(message: "Keychain list failed (OSStatus \(status)).")
        }

        let rows: [[String: Any]]
        if let many = result as? [[String: Any]] {
            rows = many
        } else if let one = result as? [String: Any] {
            rows = [one]
        } else {
            rows = []
        }
        return rows.compactMap { row -> [String: String]? in
            guard let name = row[kSecAttrAccount as String] as? String,
                  let metadataData = row[kSecAttrGeneric as String] as? Data,
                  let metadata = try? JSONDecoder().decode(EntryMetadata.self, from: metadataData),
                  metadata.version == 1,
                  validName(name),
                  validVariable(metadata.variable),
                  validDescription(metadata.description)
            else {
                return nil
            }
            return [
                "name": name,
                "variable": metadata.variable,
                "description": metadata.description,
            ]
        }.sorted { ($0["name"] ?? "") < ($1["name"] ?? "") }
    }

    static func remove(name: String) throws {
        let status = SecItemDelete(keychainQuery(name: name) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw KeepKeysFailure(message: "Keychain deletion failed (OSStatus \(status)).")
    }
}

private func activateApplication() {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    application.activate(ignoringOtherApps: true)
}

private func showError(_ message: String) {
    activateApplication()
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "KeepKeys needs a correction"
    alert.informativeText = message
    alert.addButton(withTitle: "Return")
    alert.runModal()
}

private func makeField(
    frame: NSRect,
    value: String,
    placeholder: String,
    accessibilityLabel: String,
    secure: Bool = false
) -> NSTextField {
    let field: NSTextField = secure
        ? NSSecureTextField(frame: frame)
        : NSTextField(frame: frame)
    field.stringValue = value
    field.placeholderString = placeholder
    field.setAccessibilityLabel(accessibilityLabel)
    field.usesSingleLineMode = true
    return field
}

private func makeLabel(_ title: String, frame: NSRect) -> NSTextField {
    let label = NSTextField(labelWithString: title)
    label.frame = frame
    label.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
    label.textColor = .secondaryLabelColor
    return label
}

private func storeInteractively(
    suggestedName: String?,
    suggestedVariable: String?,
    suggestedDescription: String?
) throws
    -> [String: Any]
{
    activateApplication()

    let container = NSView(frame: NSRect(x: 0, y: 0, width: 470, height: 245))
    let nameField = makeField(
        frame: NSRect(x: 0, y: 193, width: 470, height: 28),
        value: suggestedName ?? "",
        placeholder: "github-release",
        accessibilityLabel: "Friendly name"
    )
    let variableField = makeField(
        frame: NSRect(x: 0, y: 133, width: 470, height: 28),
        value: suggestedVariable ?? "",
        placeholder: "GITHUB_TOKEN",
        accessibilityLabel: "Environment variable"
    )
    let descriptionField = makeField(
        frame: NSRect(x: 0, y: 73, width: 470, height: 28),
        value: suggestedDescription ?? "",
        placeholder: "Publishes the approved production deployment",
        accessibilityLabel: "Description"
    )
    let secretField = makeField(
        frame: NSRect(x: 0, y: 13, width: 470, height: 28),
        value: "",
        placeholder: "Enter or paste the secret here",
        accessibilityLabel: "Secret value",
        secure: true
    )
    container.addSubview(makeLabel("Friendly name", frame: NSRect(x: 0, y: 222, width: 470, height: 18)))
    container.addSubview(nameField)
    container.addSubview(makeLabel("Environment variable", frame: NSRect(x: 0, y: 162, width: 470, height: 18)))
    container.addSubview(variableField)
    container.addSubview(makeLabel("Description", frame: NSRect(x: 0, y: 102, width: 470, height: 18)))
    container.addSubview(descriptionField)
    container.addSubview(makeLabel("Secret value", frame: NSRect(x: 0, y: 42, width: 470, height: 18)))
    container.addSubview(secretField)

    while true {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.icon = NSImage(
            systemSymbolName: "key.fill",
            accessibilityDescription: "KeepKeys"
        )
        alert.messageText = "Store a secret for your agent"
        alert.informativeText =
            "The value stays in this Mac's Keychain. It is not returned to the conversation."
        alert.accessoryView = container
        alert.addButton(withTitle: "Store in Keychain")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        if response != .alertFirstButtonReturn {
            secretField.stringValue = ""
            return ["status": "cancelled", "message": "Secret storage was cancelled."]
        }

        let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let variable = variableField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        let description = descriptionField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let secret = secretField.stringValue

        guard validName(name) else {
            showError(
                "Use 1–128 ASCII letters, digits, periods, underscores, or hyphens, beginning with a letter."
            )
            continue
        }
        guard validVariable(variable) else {
            showError(
                "Use an uppercase environment-variable name that is not a shell, loader, runtime, or path-control variable."
            )
            continue
        }
        guard validDescription(description) else {
            showError("Use a one-line description of at most 240 bytes.")
            continue
        }
        do {
            try validateSecret(secret)
        } catch {
            showError(error.localizedDescription)
            continue
        }

        if try KeychainStore.exists(name: name) {
            let overwrite = NSAlert()
            overwrite.alertStyle = .critical
            overwrite.messageText = "Replace '\(name)'?"
            overwrite.informativeText =
                "This permanently replaces the existing KeepKeys value and variable name."
            overwrite.addButton(withTitle: "Replace")
            overwrite.addButton(withTitle: "Cancel")
            if overwrite.runModal() != .alertFirstButtonReturn {
                continue
            }
        }

        try KeychainStore.store(
            name: name,
            variable: variable,
            description: description,
            secret: secret
        )
        secretField.stringValue = ""
        return [
            "status": "ok",
            "message": "Stored '\(name)' in macOS Keychain.",
            "name": name,
            "variable": variable,
            "description": description,
        ]
    }
}

private func removeInteractively(name: String) throws -> [String: Any] {
    guard validName(name) else {
        throw KeepKeysFailure(message: "The requested KeepKeys name is invalid.")
    }
    guard try KeychainStore.exists(name: name) else {
        return ["status": "ok", "message": "No KeepKeys item named '\(name)' exists.", "removed": false]
    }

    activateApplication()
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Remove '\(name)' from KeepKeys?"
    alert.informativeText =
        "This deletes the credential from macOS Keychain. The action cannot be undone."
    alert.addButton(withTitle: "Remove")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else {
        return ["status": "cancelled", "message": "Secret removal was cancelled."]
    }
    try KeychainStore.remove(name: name)
    return ["status": "ok", "message": "Removed '\(name)' from macOS Keychain.", "removed": true]
}

private func executableFingerprint(_ url: URL) throws -> String {
    let data: Data
    do {
        data = try Data(contentsOf: url, options: [.mappedIfSafe])
    } catch {
        throw KeepKeysFailure(message: "KeepKeys could not read the requested executable.")
    }
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func resolvedExecutable(_ rawPath: String) throws -> URL {
    guard rawPath.hasPrefix("/"), !hasControlCharacters(rawPath) else {
        throw KeepKeysFailure(message: "KeepKeys requires an absolute executable path.")
    }
    let resolved = URL(fileURLWithPath: rawPath).resolvingSymlinksInPath().standardizedFileURL
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
          !isDirectory.boolValue,
          FileManager.default.isExecutableFile(atPath: resolved.path)
    else {
        throw KeepKeysFailure(message: "The requested program is not an executable file.")
    }
    let blocked = Set(["bash", "csh", "dash", "env", "fish", "ksh", "printenv", "sh", "tcsh", "zsh"])
    if blocked.contains(resolved.lastPathComponent.lowercased()) {
        throw KeepKeysFailure(
            message: "KeepKeys rejects shells and environment-dump programs. Use a direct executable."
        )
    }
    return resolved
}

private func resolvedWorkingDirectory(_ rawPath: String?) throws -> URL? {
    guard let rawPath else {
        return nil
    }
    guard rawPath.hasPrefix("/"), !hasControlCharacters(rawPath) else {
        throw KeepKeysFailure(message: "The working directory must be an absolute path.")
    }
    let resolved = URL(fileURLWithPath: rawPath).resolvingSymlinksInPath().standardizedFileURL
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
          isDirectory.boolValue
    else {
        throw KeepKeysFailure(message: "The requested working directory does not exist.")
    }
    return resolved
}

private func displayArgument(_ value: String) -> String {
    if value.isEmpty {
        return "\"\""
    }
    if value.unicodeScalars.allSatisfy({
        CharacterSet.alphanumerics.contains($0) || "-._/:=@%+,".unicodeScalars.contains($0)
    }) {
        return value
    }
    return "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
}

private func approveRun(_ request: RunRequest, metadata: EntryMetadata) -> Bool {
    activateApplication()
    let command = ([request.program.path] + request.arguments).map(displayArgument).joined(separator: " ")
    let details = """
    Purpose
    \(request.purpose)

    Secret
    \(request.name) → \(metadata.variable)

    Description
    \(metadata.description)

    Executable
    \(request.program.path)

    SHA-256
    \(request.fingerprint)

    Arguments
    \(request.arguments.isEmpty ? "(none)" : command)

    Working directory
    \(request.workingDirectory?.path ?? "(none)")

    Environment
    Cleared, then \(metadata.variable) is added for this child process only.
    """

    let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 540, height: 285))
    textView.string = details
    textView.isEditable = false
    textView.isSelectable = true
    textView.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)
    textView.textContainerInset = NSSize(width: 10, height: 10)
    textView.setAccessibilityLabel("Exact KeepKeys command request")

    let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 285))
    scrollView.documentView = textView
    scrollView.hasVerticalScroller = true
    scrollView.borderType = .bezelBorder

    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.icon = NSImage(
        systemSymbolName: "key.horizontal.fill",
        accessibilityDescription: "KeepKeys"
    )
    alert.messageText = "Allow this command to use '\(request.name)'?"
    alert.informativeText =
        "The program and any child processes can read the secret. Review every detail before allowing it."
    alert.accessoryView = scrollView
    alert.addButton(withTitle: "Allow once")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
}

private final class BoundedCapture: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var data = Data()
    private(set) var truncated = false

    func append(_ chunk: Data) {
        lock.lock()
        defer { lock.unlock() }
        let available = maximumCapturedBytes - data.count
        if available <= 0 {
            truncated = true
            return
        }
        if chunk.count > available {
            data.append(chunk.prefix(available))
            truncated = true
        } else {
            data.append(chunk)
        }
    }

    func snapshot() -> (Data, Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (data, truncated)
    }
}

private func drain(_ handle: FileHandle, into capture: BoundedCapture) {
    while true {
        do {
            guard let chunk = try handle.read(upToCount: 8_192), !chunk.isEmpty else {
                return
            }
            capture.append(chunk)
        } catch {
            return
        }
    }
}

private func redactionPatterns(for secret: String) -> [String] {
    var patterns = Set([secret])
    let bytes = Data(secret.utf8)
    patterns.insert(bytes.base64EncodedString())
    patterns.insert(bytes.map { String(format: "%02x", $0) }.joined())
    patterns.insert(bytes.map { String(format: "%02X", $0) }.joined())
    if let encoded = secret.addingPercentEncoding(withAllowedCharacters: .alphanumerics) {
        patterns.insert(encoded)
    }
    if let jsonData = try? JSONEncoder().encode(secret),
       var jsonString = String(data: jsonData, encoding: .utf8),
       jsonString.count >= 2
    {
        jsonString.removeFirst()
        jsonString.removeLast()
        patterns.insert(jsonString)
    }
    return patterns.filter { !$0.isEmpty }.sorted { $0.count > $1.count }
}

private func redact(_ text: String, secret: String) -> String {
    redactionPatterns(for: secret).reduce(text) { partial, pattern in
        partial.replacingOccurrences(of: pattern, with: "[REDACTED BY KEEPKEYS]")
    }
}

private func safeCapturedText(_ capture: BoundedCapture, secret: String) -> (String, Bool) {
    let (data, truncated) = capture.snapshot()
    if truncated {
        return (
            "[OUTPUT OMITTED BY KEEPKEYS: stream exceeded the 1 MiB safety limit]",
            true
        )
    }
    return (redact(String(decoding: data, as: UTF8.self), secret: secret), false)
}

private func executeProcess(_ request: RunRequest, record: inout SecretRecord) throws -> [String: Any] {
    let currentFingerprint = try executableFingerprint(request.program)
    guard currentFingerprint == request.fingerprint else {
        record.secret = ""
        throw KeepKeysFailure(
            message: "The executable changed after approval details were prepared. KeepKeys refused to run it."
        )
    }

    let process = Process()
    process.executableURL = request.program
    process.arguments = request.arguments
    process.currentDirectoryURL = request.workingDirectory
    process.environment = [record.metadata.variable: record.secret]

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    try process.run()

    let outputCapture = BoundedCapture()
    let errorCapture = BoundedCapture()
    let readers = DispatchGroup()
    readers.enter()
    DispatchQueue.global(qos: .userInitiated).async {
        drain(outputPipe.fileHandleForReading, into: outputCapture)
        readers.leave()
    }
    readers.enter()
    DispatchQueue.global(qos: .userInitiated).async {
        drain(errorPipe.fileHandleForReading, into: errorCapture)
        readers.leave()
    }

    process.waitUntilExit()
    readers.wait()

    let secret = record.secret
    let (stdout, stdoutTruncated) = safeCapturedText(outputCapture, secret: secret)
    let (stderr, stderrTruncated) = safeCapturedText(errorCapture, secret: secret)

    record.secret = ""

    return [
        "status": "ok",
        "exitCode": Int(process.terminationStatus),
        "stdout": stdout,
        "stderr": stderr,
        "stdoutTruncated": stdoutTruncated,
        "stderrTruncated": stderrTruncated,
        "message": "Approved command finished with exit code \(process.terminationStatus).",
    ]
}

private func runApproved(_ request: RunRequest, record: inout SecretRecord) throws -> [String: Any] {
    guard approveRun(request, metadata: record.metadata) else {
        record.secret = ""
        return ["status": "cancelled", "message": "Command use was cancelled."]
    }
    return try executeProcess(request, record: &record)
}

private func parseOption(_ args: [String], name: String) throws -> String? {
    guard let index = args.firstIndex(of: name) else {
        return nil
    }
    let valueIndex = args.index(after: index)
    guard valueIndex < args.endIndex, !args[valueIndex].hasPrefix("--") else {
        throw KeepKeysFailure(message: "\(name) requires a value.")
    }
    return args[valueIndex]
}

private func parseRun(_ args: [String]) throws -> RunRequest {
    guard let separator = args.firstIndex(of: "--") else {
        throw KeepKeysFailure(message: "Run requests require '--' before the executable.")
    }
    let optionArgs = Array(args[..<separator])
    let commandArgs = Array(args[args.index(after: separator)...])
    guard let name = try parseOption(optionArgs, name: "--name"),
          let purpose = try parseOption(optionArgs, name: "--purpose"),
          let rawProgram = commandArgs.first
    else {
        throw KeepKeysFailure(message: "Run requests require name, purpose, and executable.")
    }
    guard validName(name) else {
        throw KeepKeysFailure(message: "The requested KeepKeys name is invalid.")
    }
    guard purpose.utf8.count <= 240, !hasControlCharacters(purpose) else {
        throw KeepKeysFailure(message: "The purpose must be one visible line of at most 240 bytes.")
    }
    let arguments = Array(commandArgs.dropFirst())
    guard arguments.count <= 64,
          arguments.allSatisfy({ $0.utf8.count <= 4_096 && !hasControlCharacters($0) })
    else {
        throw KeepKeysFailure(message: "Arguments must be visible strings within KeepKeys limits.")
    }
    let program = try resolvedExecutable(rawProgram)
    let cwd = try resolvedWorkingDirectory(parseOption(optionArgs, name: "--cwd"))
    return RunRequest(
        name: name,
        purpose: purpose,
        program: program,
        arguments: arguments,
        workingDirectory: cwd,
        fingerprint: try executableFingerprint(program)
    )
}

private func runDoctor() throws -> [String: Any] {
    let name = "keepkeys-doctor-\(UUID().uuidString.lowercased())"
    let firstSecret = UUID().uuidString + UUID().uuidString
    let secondSecret = UUID().uuidString + UUID().uuidString
    defer { try? KeychainStore.remove(name: name) }
    try KeychainStore.store(
        name: name,
        variable: "KEEPKEYS_DOCTOR",
        description: "Temporary KeepKeys Keychain verification",
        secret: firstSecret
    )
    var firstLoad = try KeychainStore.load(name: name)
    let firstMatches =
        firstLoad.secret == firstSecret
        && firstLoad.metadata.variable == "KEEPKEYS_DOCTOR"
        && firstLoad.metadata.description == "Temporary KeepKeys Keychain verification"
    firstLoad.secret = ""

    try KeychainStore.store(
        name: name,
        variable: "KEEPKEYS_DOCTOR_UPDATED",
        description: "Updated temporary KeepKeys verification",
        secret: secondSecret
    )
    var secondLoad = try KeychainStore.load(name: name)
    let secondMatches =
        secondLoad.secret == secondSecret
        && secondLoad.metadata.variable == "KEEPKEYS_DOCTOR_UPDATED"
        && secondLoad.metadata.description == "Updated temporary KeepKeys verification"
    secondLoad.secret = ""
    let listed = try KeychainStore.entries().contains { entry in
        entry["name"] == name
            && entry["variable"] == "KEEPKEYS_DOCTOR_UPDATED"
            && entry["description"] == "Updated temporary KeepKeys verification"
    }

    try KeychainStore.remove(name: name)
    guard firstMatches, secondMatches, listed, !(try KeychainStore.exists(name: name)) else {
        throw KeepKeysFailure(message: "The temporary Keychain round trip did not verify.")
    }
    return [
        "status": "ok",
        "message": "Temporary Keychain add, metadata list, update, read, and deletion all verified.",
        "platform": "macOS",
        "version": keepKeysVersion,
    ]
}

private func runSelfTests() throws -> [String: Any] {
    guard validName("github-release"),
          !validName("../../escape"),
          validVariable("GITHUB_TOKEN"),
          !validVariable("PATH"),
          !validVariable("DYLD_INSERT_LIBRARIES")
    else {
        throw KeepKeysFailure(message: "Validation self-test failed.")
    }
    let marker = "synthetic-test-secret"
    let sample = "before \(marker) \(Data(marker.utf8).base64EncodedString()) after"
    let redacted = redact(sample, secret: marker)
    guard !redacted.contains(marker),
          !redacted.contains(Data(marker.utf8).base64EncodedString())
    else {
        throw KeepKeysFailure(message: "Redaction self-test failed.")
    }
    let truncatedCapture = BoundedCapture()
    truncatedCapture.append(Data(repeating: 65, count: maximumCapturedBytes))
    truncatedCapture.append(Data("prefix-\(Data(marker.utf8).base64EncodedString())".utf8))
    let (truncatedText, wasTruncated) = safeCapturedText(truncatedCapture, secret: marker)
    guard wasTruncated,
          truncatedText == "[OUTPUT OMITTED BY KEEPKEYS: stream exceeded the 1 MiB safety limit]",
          !truncatedText.contains(marker)
    else {
        throw KeepKeysFailure(message: "Truncation fail-closed self-test failed.")
    }
    let environmentPrinter = URL(fileURLWithPath: "/usr/bin/env")
    var record = SecretRecord(
        metadata: EntryMetadata(
            version: 1,
            variable: "KEEPKEYS_TEST",
            description: "Synthetic scoped-process self-test"
        ),
        secret: marker
    )
    let request = RunRequest(
        name: "self-test",
        purpose: "Verify scoped environment and output redaction",
        program: environmentPrinter,
        arguments: [],
        workingDirectory: nil,
        fingerprint: try executableFingerprint(environmentPrinter)
    )
    let processResult = try executeProcess(request, record: &record)
    guard processResult["exitCode"] as? Int == 0,
          let stdout = processResult["stdout"] as? String,
          stdout.contains("KEEPKEYS_TEST=[REDACTED BY KEEPKEYS]"),
          !stdout.contains(marker),
          record.secret.isEmpty
    else {
        throw KeepKeysFailure(message: "Scoped-process self-test failed.")
    }
    return [
        "status": "ok",
        "message": "KeepKeys validation, scoped-process, and redaction self-tests passed.",
        "version": keepKeysVersion,
    ]
}

private func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let action = args.first else {
        fail("Usage: keepkeys <store|list|remove|run|status|doctor|--self-test>")
    }

    do {
        let result: [String: Any]
        switch action {
        case "store":
            let rest = Array(args.dropFirst())
            result = try storeInteractively(
                suggestedName: parseOption(rest, name: "--name"),
                suggestedVariable: parseOption(rest, name: "--variable"),
                suggestedDescription: parseOption(rest, name: "--description")
            )
        case "list":
            result = ["status": "ok", "entries": try KeychainStore.entries()]
        case "remove":
            let rest = Array(args.dropFirst())
            guard let name = try parseOption(rest, name: "--name") else {
                throw KeepKeysFailure(message: "Remove requires --name.")
            }
            result = try removeInteractively(name: name)
        case "run":
            let request = try parseRun(Array(args.dropFirst()))
            var record = try KeychainStore.load(name: request.name)
            result = try runApproved(request, record: &record)
            record.secret = ""
        case "status":
            result = [
                "status": "ok",
                "message": "KeepKeys helper is available.",
                "platform": "macOS",
                "version": keepKeysVersion,
                "plaintextRetrieval": false,
            ]
        case "doctor":
            result = try runDoctor()
        case "--self-test":
            result = try runSelfTests()
        default:
            throw KeepKeysFailure(message: "Unknown KeepKeys action '\(action)'.")
        }
        emit(result)
    } catch {
        fail(error.localizedDescription)
    }
}

main()
