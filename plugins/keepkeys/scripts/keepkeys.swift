import AppKit
import CryptoKit
import Darwin
import Foundation
import Security

private let keepKeysVersion = "0.5.0"
private let keychainService = "net.barnlabs.keepkeys"
private let maximumSecretBytes = 2_048
private let maximumCapturedBytes = 1_048_576
private let portalCapabilityBytes = 32
private let portalReplacementStateMessage =
    "The stored KeepKeys name changed after the phone page opened. "
    + "Start a new phone intake and review the replacement warning."

private struct KeepKeysFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct EntryMetadata: Codable, Equatable {
    let version: Int
    let variable: String
    let description: String
    let provider: String?
    let documentationURLs: [String]?

    init(
        version: Int,
        variable: String,
        description: String,
        provider: String? = nil,
        documentationURLs: [String]? = nil
    ) {
        self.version = version
        self.variable = variable
        self.description = description
        self.provider = provider
        self.documentationURLs = documentationURLs
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case variable
        case description
        case provider
        case documentationURLs
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        variable = try values.decode(String.self, forKey: .variable)
        description = try values.decode(String.self, forKey: .description)
        provider = try values.decodeIfPresent(String.self, forKey: .provider)
        documentationURLs = try values.decodeIfPresent(
            [String].self,
            forKey: .documentationURLs
        )
    }
}

private struct EntrySummary {
    let name: String
    let metadata: EntryMetadata
    let createdAt: Date?
    let modifiedAt: Date?
}

private struct SecretRecord {
    let metadata: EntryMetadata
    var secret: String
}

private enum ExecutionRisk: String {
    case routine
    case network
    case interpreter

    var title: String {
        switch self {
        case .routine:
            return "Direct executable"
        case .network:
            return "Network-capable executable"
        case .interpreter:
            return "Script interpreter"
        }
    }

    var explanation: String {
        switch self {
        case .routine:
            "KeepKeys verified the executable itself. Its child processes still inherit the approved secret."
        case .network:
            "This program can send the credential or derived data over the network. Approve only the exact destination and action you intend."
        case .interpreter:
            "This program can execute script code. KeepKeys also fingerprints the detected entrypoint when one is present."
        }
    }
}

private struct RunRequest {
    let name: String
    let purpose: String
    let program: URL
    let arguments: [String]
    let workingDirectory: URL?
    let fingerprint: String
    let entrypoint: URL?
    let entrypointFingerprint: String?
    let risk: ExecutionRisk
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

private enum StoreCaptureFailure: LocalizedError {
    case clipboardChanged
    case clipboardClearFailed
    case invalidSecret
    case replacementCancelled

    var errorDescription: String? {
        switch self {
        case .clipboardChanged:
            return "The clipboard changed while KeepKeys was reading it. Copy the complete key, then press Paste & Store again."
        case .clipboardClearFailed:
            return "KeepKeys could not clear the clipboard, so the key was not stored. Copy it again and retry."
        case .invalidSecret:
            return "No usable key was found on the clipboard. KeepKeys cleared it; copy the complete key, then press Paste & Store again."
        case .replacementCancelled:
            return "Replacement was cancelled. KeepKeys already cleared the clipboard; copy the key again if you retry."
        }
    }
}

private func performPasteAndStore(
    readClipboard: () -> (value: String, version: Int),
    currentClipboardVersion: () -> Int,
    clearClipboard: () -> Int,
    storeSecret: (String) throws -> Void
) throws {
    let captured = readClipboard()
    var secret = captured.value
    defer { secret = "" }
    guard currentClipboardVersion() == captured.version else {
        throw StoreCaptureFailure.clipboardChanged
    }
    guard clearClipboard() != captured.version else {
        throw StoreCaptureFailure.clipboardClearFailed
    }
    do {
        try validateSecret(secret)
    } catch {
        throw StoreCaptureFailure.invalidSecret
    }
    try storeSecret(secret)
}

private func validDescription(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 240 && !hasControlCharacters(value)
}

private func validProvider(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 80 && !hasControlCharacters(value)
}

private func validDocumentationURL(_ value: String) -> Bool {
    guard value.utf8.count <= 1_024,
          !hasControlCharacters(value),
          let components = URLComponents(string: value),
          components.scheme?.lowercased() == "https",
          components.host?.isEmpty == false,
          components.user == nil,
          components.password == nil
    else {
        return false
    }
    return true
}

private func validMetadata(_ metadata: EntryMetadata) -> Bool {
    guard (metadata.version == 1 || metadata.version == 2),
          validVariable(metadata.variable),
          validDescription(metadata.description)
    else {
        return false
    }
    if metadata.version == 1 {
        return true
    }
    guard let provider = metadata.provider,
          let documentationURLs = metadata.documentationURLs,
          validProvider(provider),
          (1...3).contains(documentationURLs.count),
          Set(documentationURLs).count == documentationURLs.count,
          documentationURLs.reduce(0, { $0 + $1.utf8.count }) <= 1_800,
          documentationURLs.allSatisfy(validDocumentationURL)
    else {
        return false
    }
    return true
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

    static func store(
        name: String,
        variable: String,
        description: String,
        provider: String,
        documentationURLs: [String],
        secret: String
    ) throws {
        try validateSecret(secret)
        let metadata = EntryMetadata(
            version: 2,
            variable: variable,
            description: description,
            provider: provider,
            documentationURLs: documentationURLs
        )
        guard validMetadata(metadata) else {
            throw KeepKeysFailure(message: "The agent supplied invalid KeepKeys metadata.")
        }
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
        guard validMetadata(metadata),
              let secret = String(data: secretData, encoding: .utf8)
        else {
            throw KeepKeysFailure(message: "The Keychain item has invalid KeepKeys metadata.")
        }
        try validateSecret(secret)
        return SecretRecord(metadata: metadata, secret: secret)
    }

    static func metadata(name: String) throws -> EntryMetadata {
        var query = keychainQuery(name: name)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnAttributes as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            throw KeepKeysFailure(message: "No KeepKeys secret is stored as '\(name)'.")
        }
        guard status == errSecSuccess,
              let row = result as? [String: Any],
              let metadataData = row[kSecAttrGeneric as String] as? Data,
              let metadata = try? JSONDecoder().decode(EntryMetadata.self, from: metadataData),
              validMetadata(metadata)
        else {
            throw KeepKeysFailure(message: "The Keychain item has invalid KeepKeys metadata.")
        }
        return metadata
    }

    static func summaries() throws -> [EntrySummary] {
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
        return rows.compactMap { row -> EntrySummary? in
            guard let name = row[kSecAttrAccount as String] as? String,
                  let metadataData = row[kSecAttrGeneric as String] as? Data,
                  let metadata = try? JSONDecoder().decode(EntryMetadata.self, from: metadataData),
                  validMetadata(metadata),
                  validName(name),
                  validVariable(metadata.variable)
            else {
                return nil
            }
            return EntrySummary(
                name: name,
                metadata: metadata,
                createdAt: row[kSecAttrCreationDate as String] as? Date,
                modifiedAt: row[kSecAttrModificationDate as String] as? Date
            )
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func entries() throws -> [[String: Any]] {
        try summaries().map { summary in
            [
                "name": summary.name,
                "variable": summary.metadata.variable,
                "description": summary.metadata.description,
                "provider": summary.metadata.provider ?? "",
                "documentationUrls": summary.metadata.documentationURLs ?? [],
            ]
        }
    }

    static func remove(name: String) throws {
        let status = SecItemDelete(keychainQuery(name: name) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw KeepKeysFailure(message: "Keychain deletion failed (OSStatus \(status)).")
    }
}

private enum Brand {
    static let pine = NSColor(
        calibratedRed: 31.0 / 255.0,
        green: 45.0 / 255.0,
        blue: 39.0 / 255.0,
        alpha: 1
    )
    static let nightPine = NSColor(
        calibratedRed: 20.0 / 255.0,
        green: 33.0 / 255.0,
        blue: 29.0 / 255.0,
        alpha: 1
    )
    static let ember = NSColor(
        calibratedRed: 217.0 / 255.0,
        green: 108.0 / 255.0,
        blue: 77.0 / 255.0,
        alpha: 1
    )
    static let brass = NSColor(
        calibratedRed: 199.0 / 255.0,
        green: 154.0 / 255.0,
        blue: 69.0 / 255.0,
        alpha: 1
    )
    static let paper = NSColor(
        calibratedRed: 1,
        green: 248.0 / 255.0,
        blue: 236.0 / 255.0,
        alpha: 1
    )
    static let sage = NSColor(
        calibratedRed: 65.0 / 255.0,
        green: 84.0 / 255.0,
        blue: 76.0 / 255.0,
        alpha: 1
    )
}

private func loadBrandImage(named name: String) -> NSImage? {
    guard let assetsDirectory = ProcessInfo.processInfo.environment["KEEPKEYS_ASSETS_DIR"] else {
        return nil
    }
    let url = URL(fileURLWithPath: assetsDirectory, isDirectory: true)
        .appendingPathComponent(name, isDirectory: false)
    return NSImage(contentsOf: url)
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
    suggestedDescription: String?,
    suggestedProvider: String?,
    suggestedDocumentationURLs: [String]
) throws
    -> [String: Any]
{
    guard let suggestedName,
          let suggestedVariable,
          let suggestedDescription,
          let suggestedProvider
    else {
        throw KeepKeysFailure(
            message: "The agent must supply the name, variable, description, provider, and documentation before KeepKeys opens."
        )
    }
    let name = suggestedName.trimmingCharacters(in: .whitespacesAndNewlines)
    let variable = suggestedVariable.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let description = suggestedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    let provider = suggestedProvider.trimmingCharacters(in: .whitespacesAndNewlines)
    let documentationURLs = suggestedDocumentationURLs.map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let metadata = EntryMetadata(
        version: 2,
        variable: variable,
        description: description,
        provider: provider,
        documentationURLs: documentationURLs
    )
    guard validName(name), validMetadata(metadata) else {
        throw KeepKeysFailure(
            message: "The agent supplied invalid KeepKeys metadata. No clipboard data was accessed."
        )
    }

    activateApplication()
    let container = NSView(frame: NSRect(x: 0, y: 0, width: 500, height: 300))
    container.addSubview(
        makeLabel("AGENT-PREPARED CREDENTIAL", frame: NSRect(x: 0, y: 276, width: 500, height: 18))
    )
    let summary = NSTextView(frame: NSRect(x: 0, y: 0, width: 496, height: 62))
    summary.string = "\(name)  →  \(variable)\n\(provider)\n\(description)"
    summary.isEditable = false
    summary.isSelectable = true
    summary.drawsBackground = false
    summary.font = NSFont.systemFont(ofSize: 13, weight: .medium)
    summary.textColor = .labelColor
    summary.textContainerInset = NSSize(width: 8, height: 6)
    summary.isHorizontallyResizable = false
    summary.textContainer?.widthTracksTextView = true
    summary.setAccessibilityLabel("Agent-prepared credential details")

    let summaryScroll = NSScrollView(
        frame: NSRect(x: 0, y: 204, width: 500, height: 65)
    )
    summaryScroll.documentView = summary
    summaryScroll.hasVerticalScroller = true
    summaryScroll.hasHorizontalScroller = false
    summaryScroll.borderType = .bezelBorder
    container.addSubview(summaryScroll)

    container.addSubview(
        makeLabel("OFFICIAL DOCUMENTATION", frame: NSRect(x: 0, y: 177, width: 500, height: 18))
    )
    let links = NSTextView(frame: NSRect(x: 0, y: 0, width: 496, height: 82))
    links.string = documentationURLs.map { "• \($0)" }.joined(separator: "\n")
    links.isEditable = false
    links.isSelectable = true
    links.drawsBackground = false
    links.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    links.textColor = .linkColor
    links.textContainerInset = NSSize(width: 8, height: 6)
    links.setAccessibilityLabel("Official documentation links")

    let documentationScroll = NSScrollView(
        frame: NSRect(x: 0, y: 78, width: 500, height: 94)
    )
    documentationScroll.documentView = links
    documentationScroll.hasVerticalScroller = true
    documentationScroll.borderType = .bezelBorder
    container.addSubview(documentationScroll)

    let clipboardNotice = NSTextField(
        wrappingLabelWithString:
            "Copy the key immediately before clicking. KeepKeys clears the current clipboard after reading it, but same-user software or clipboard history may still observe it. The value never enters chat or a tool call."
    )
    clipboardNotice.frame = NSRect(x: 0, y: 0, width: 500, height: 54)
    clipboardNotice.font = NSFont.systemFont(ofSize: 12)
    clipboardNotice.textColor = .secondaryLabelColor
    clipboardNotice.setAccessibilityLabel("Clipboard privacy notice")
    container.addSubview(clipboardNotice)

    while true {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.icon = loadBrandImage(named: "icon.png") ?? NSImage(
            systemSymbolName: "key.fill",
            accessibilityDescription: "KeepKeys"
        )
        alert.messageText = "Your key goes straight to Keychain."
        alert.informativeText =
            "The agent prepared everything else. You only copy the key and approve the paste."
        alert.accessoryView = container
        alert.addButton(withTitle: "Paste & Store")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        if response != .alertFirstButtonReturn {
            return ["status": "cancelled", "message": "Secret storage was cancelled."]
        }
        do {
            let pasteboard = NSPasteboard.general
            try performPasteAndStore(
                readClipboard: {
                    let version = pasteboard.changeCount
                    return (pasteboard.string(forType: .string) ?? "", version)
                },
                currentClipboardVersion: { pasteboard.changeCount },
                clearClipboard: { pasteboard.clearContents() },
                storeSecret: { secret in
                    if try KeychainStore.exists(name: name) {
                        let overwrite = NSAlert()
                        overwrite.alertStyle = .critical
                        overwrite.messageText = "Replace '\(name)'?"
                        overwrite.informativeText =
                            "This permanently replaces the existing KeepKeys value and variable name."
                        overwrite.addButton(withTitle: "Replace")
                        overwrite.addButton(withTitle: "Cancel")
                        if overwrite.runModal() != .alertFirstButtonReturn {
                            throw StoreCaptureFailure.replacementCancelled
                        }
                    }
                    try KeychainStore.store(
                        name: name,
                        variable: variable,
                        description: description,
                        provider: provider,
                        documentationURLs: documentationURLs,
                        secret: secret
                    )
                }
            )
        } catch let error as StoreCaptureFailure {
            if let message = error.errorDescription {
                showError(message)
            }
            continue
        }
        return [
            "status": "ok",
            "message": "Stored '\(name)' in macOS Keychain.",
            "name": name,
            "variable": variable,
            "description": description,
            "provider": provider,
            "documentationUrls": documentationURLs,
        ]
    }
}

private func constantTimeEqual(_ first: String, _ second: String) -> Bool {
    let firstBytes = Array(first.utf8)
    let secondBytes = Array(second.utf8)
    guard firstBytes.count == secondBytes.count else {
        return false
    }
    var difference: UInt8 = 0
    for index in firstBytes.indices {
        difference |= firstBytes[index] ^ secondBytes[index]
    }
    return difference == 0
}

private func processArguments(_ processID: Int32) -> [String]? {
    var query: [Int32] = [CTL_KERN, KERN_PROCARGS2, processID]
    var byteCount = 0
    let sizeStatus = query.withUnsafeMutableBufferPointer {
        sysctl($0.baseAddress, UInt32($0.count), nil, &byteCount, nil, 0)
    }
    guard sizeStatus == 0, byteCount > MemoryLayout<Int32>.size else {
        return nil
    }
    var buffer = [UInt8](repeating: 0, count: byteCount)
    let readStatus = query.withUnsafeMutableBufferPointer { queryPointer in
        buffer.withUnsafeMutableBytes { bufferPointer in
            sysctl(
                queryPointer.baseAddress,
                UInt32(queryPointer.count),
                bufferPointer.baseAddress,
                &byteCount,
                nil,
                0
            )
        }
    }
    guard readStatus == 0, byteCount > MemoryLayout<Int32>.size else {
        return nil
    }
    var argumentCount: Int32 = 0
    withUnsafeMutableBytes(of: &argumentCount) { destination in
        buffer.withUnsafeBytes { source in
            destination.copyBytes(
                from: source.prefix(MemoryLayout<Int32>.size)
            )
        }
    }
    guard argumentCount > 0 else {
        return nil
    }
    var cursor = MemoryLayout<Int32>.size
    while cursor < byteCount, buffer[cursor] != 0 {
        cursor += 1
    }
    while cursor < byteCount, buffer[cursor] == 0 {
        cursor += 1
    }
    var arguments: [String] = []
    while cursor < byteCount, arguments.count < Int(argumentCount) {
        let start = cursor
        while cursor < byteCount, buffer[cursor] != 0 {
            cursor += 1
        }
        guard let argument = String(
            bytes: buffer[start..<cursor],
            encoding: .utf8
        ) else {
            return nil
        }
        arguments.append(argument)
        while cursor < byteCount, buffer[cursor] == 0 {
            cursor += 1
        }
    }
    return arguments.count == Int(argumentCount) ? arguments : nil
}

private func portalParentIsBundledPortal(_ parentPID: Int32) -> Bool {
    var path = [CChar](repeating: 0, count: 4_096)
    let length = proc_pidpath(parentPID, &path, UInt32(path.count))
    guard length > 0,
          let arguments = processArguments(parentPID),
          arguments.count > 1,
          let assetsDirectory =
              ProcessInfo.processInfo.environment["KEEPKEYS_ASSETS_DIR"]
    else {
        return false
    }
    let executableName = URL(fileURLWithPath: String(cString: path))
        .lastPathComponent
        .lowercased()
    let expectedPortal = URL(fileURLWithPath: assetsDirectory)
        .deletingLastPathComponent()
        .appendingPathComponent("scripts", isDirectory: true)
        .appendingPathComponent("keepkeys-portal.mjs")
        .resolvingSymlinksInPath()
        .standardizedFileURL
    let parentScript = URL(fileURLWithPath: arguments[1])
        .resolvingSymlinksInPath()
        .standardizedFileURL
    return (executableName == "node" || executableName == "nodejs") &&
        parentScript == expectedPortal
}

private func authorizePortalChannel() throws {
    let environment = ProcessInfo.processInfo.environment
    let expectedDigest = environment["KEEPKEYS_PORTAL_CAPABILITY_SHA256"] ?? ""
    let expectedParent = environment["KEEPKEYS_PORTAL_PARENT_PID"] ?? ""
    unsetenv("KEEPKEYS_PORTAL_CAPABILITY_SHA256")
    unsetenv("KEEPKEYS_PORTAL_PARENT_PID")
    guard isatty(STDIN_FILENO) == 0,
          expectedDigest.count == 64,
          expectedDigest.allSatisfy({
              ("0"..."9").contains($0) || ("a"..."f").contains($0)
          }),
          let parentPID = Int32(expectedParent),
          parentPID > 0,
          parentPID == getppid(),
          portalParentIsBundledPortal(parentPID)
    else {
        throw KeepKeysFailure(
            message: "The private phone-intake commit requires the live KeepKeys portal channel."
        )
    }
    var capability = Data()
    while capability.count < portalCapabilityBytes {
        let remaining = portalCapabilityBytes - capability.count
        guard let chunk = try FileHandle.standardInput.read(upToCount: remaining),
              !chunk.isEmpty
        else {
            break
        }
        capability.append(chunk)
    }
    defer { capability.resetBytes(in: 0..<capability.count) }
    guard capability.count == portalCapabilityBytes else {
        throw KeepKeysFailure(
            message: "The private phone-intake channel ended before authorization."
        )
    }
    let actualDigest = SHA256.hash(data: capability)
        .map { String(format: "%02x", $0) }
        .joined()
    guard constantTimeEqual(actualDigest, expectedDigest) else {
        throw KeepKeysFailure(
            message: "The private phone-intake channel was not authorized."
        )
    }
}

private func requirePortalReplacementState(
    name: String,
    expectedExisting: Bool
) throws {
    guard try KeychainStore.exists(name: name) == expectedExisting else {
        throw KeepKeysFailure(message: portalReplacementStateMessage)
    }
}

private func portalReplacementStateWasRejected(
    name: String,
    expectedExisting: Bool
) throws -> Bool {
    do {
        try requirePortalReplacementState(
            name: name,
            expectedExisting: expectedExisting
        )
        return false
    } catch let error as KeepKeysFailure {
        guard error.message == portalReplacementStateMessage else {
            throw error
        }
        return true
    }
}

private func storeFromPortal(arguments: [String]) throws -> [String: Any] {
    guard let rawName = try parseOption(arguments, name: "--name"),
          let rawVariable = try parseOption(arguments, name: "--variable"),
          let rawDescription = try parseOption(arguments, name: "--description"),
          let rawProvider = try parseOption(arguments, name: "--provider"),
          let expectedValue = try parseOption(arguments, name: "--expect-existing")
    else {
        throw KeepKeysFailure(message: "The private phone-intake request is incomplete.")
    }
    let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
    let variable = rawVariable.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let description = rawDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    let provider = rawProvider.trimmingCharacters(in: .whitespacesAndNewlines)
    let documentationURLs = try parseOptions(arguments, name: "--documentation-url").map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let metadata = EntryMetadata(
        version: 2,
        variable: variable,
        description: description,
        provider: provider,
        documentationURLs: documentationURLs
    )
    guard validName(name), validMetadata(metadata) else {
        throw KeepKeysFailure(message: "The agent supplied invalid KeepKeys metadata.")
    }
    guard expectedValue == "yes" || expectedValue == "no" else {
        throw KeepKeysFailure(message: "The private phone-intake replacement state is invalid.")
    }
    let nativeSelfTestValue = try parseOption(arguments, name: "--native-self-test") ?? "no"
    let nativeSelfTestScenarios: Set<String> = [
        "round-trip",
        "create-to-replace",
        "replace-to-create",
    ]
    guard nativeSelfTestValue == "no"
            || nativeSelfTestScenarios.contains(nativeSelfTestValue)
    else {
        throw KeepKeysFailure(message: "The private native portal test request is invalid.")
    }
    let nativeSelfTest = nativeSelfTestValue != "no"
    let nativeSelfTestFlag =
        ProcessInfo.processInfo.environment["KEEPKEYS_PORTAL_NATIVE_TEST"]
    unsetenv("KEEPKEYS_PORTAL_NATIVE_TEST")
    if nativeSelfTest {
        guard nativeSelfTestFlag == "1",
              name.hasPrefix("keepkeys-portal-test-"),
              (
                  nativeSelfTestValue == "replace-to-create"
                      ? expectedValue == "yes"
                      : expectedValue == "no"
              )
        else {
            throw KeepKeysFailure(
                message: "KeepKeys rejected an unauthorized native portal test."
            )
        }
    }
    try authorizePortalChannel()
    if nativeSelfTest {
        try KeychainStore.remove(name: name)
    }
    defer {
        if nativeSelfTest {
            try? KeychainStore.remove(name: name)
        }
    }
    if nativeSelfTestValue == "create-to-replace" {
        var baselineSecret = UUID().uuidString + UUID().uuidString
        defer { baselineSecret = "" }
        try KeychainStore.store(
            name: name,
            variable: variable,
            description: description,
            provider: provider,
            documentationURLs: documentationURLs,
            secret: baselineSecret
        )
        let rejected = try portalReplacementStateWasRejected(
            name: name,
            expectedExisting: false
        )
        var stored = try KeychainStore.load(name: name)
        let preserved =
            stored.secret == baselineSecret
            && stored.metadata == metadata
        stored.secret = ""
        try KeychainStore.remove(name: name)
        guard rejected, preserved, !(try KeychainStore.exists(name: name)) else {
            throw KeepKeysFailure(
                message: "The temporary native portal create-to-replace rejection did not verify."
            )
        }
        return [
            "status": "ok",
            "message": "Temporary native portal create-to-replace rejection verified.",
            "cleaned": true,
            "scenario": nativeSelfTestValue,
        ]
    }
    if nativeSelfTestValue == "replace-to-create" {
        let rejected = try portalReplacementStateWasRejected(
            name: name,
            expectedExisting: true
        )
        guard rejected, !(try KeychainStore.exists(name: name)) else {
            throw KeepKeysFailure(
                message: "The temporary native portal replace-to-create rejection did not verify."
            )
        }
        return [
            "status": "ok",
            "message": "Temporary native portal replace-to-create rejection verified.",
            "cleaned": true,
            "scenario": nativeSelfTestValue,
        ]
    }
    let expectedExisting = expectedValue == "yes"
    try requirePortalReplacementState(
        name: name,
        expectedExisting: expectedExisting
    )

    var secretData = try FileHandle.standardInput.read(
        upToCount: maximumSecretBytes + 1
    ) ?? Data()
    defer { secretData.resetBytes(in: 0..<secretData.count) }
    guard secretData.count <= maximumSecretBytes,
          var secret = String(data: secretData, encoding: .utf8)
    else {
        throw KeepKeysFailure(message: "The phone submitted an invalid UTF-8 key.")
    }
    defer { secret = "" }
    try validateSecret(secret)
    try KeychainStore.store(
        name: name,
        variable: variable,
        description: description,
        provider: provider,
        documentationURLs: documentationURLs,
        secret: secret
    )
    if nativeSelfTest {
        var stored = try KeychainStore.load(name: name)
        defer { stored.secret = "" }
        let listed = try KeychainStore.entries().contains { entry in
            entry["name"] as? String == name
                && entry["variable"] as? String == variable
        }
        let matches =
            stored.secret == secret
            && stored.metadata.variable == variable
            && stored.metadata.description == description
            && stored.metadata.provider == provider
            && stored.metadata.documentationURLs == documentationURLs
            && listed
        try KeychainStore.remove(name: name)
        guard matches, !(try KeychainStore.exists(name: name)) else {
            throw KeepKeysFailure(
                message: "The temporary native portal Keychain round trip did not verify."
            )
        }
        return [
            "status": "ok",
            "message": "Temporary native portal Keychain round trip verified.",
            "cleaned": true,
            "scenario": nativeSelfTestValue,
        ]
    }
    return [
        "status": "ok",
        "message": "Stored '\(name)' in macOS Keychain.",
        "name": name,
        "variable": variable,
        "description": description,
        "provider": provider,
        "documentationUrls": documentationURLs,
    ]
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
    alert.icon = loadBrandImage(named: "icon.png")
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
    let displayedArguments = request.arguments.map(displayArgument).joined(separator: " ")
    let entrypointDetails: String
    if let entrypoint = request.entrypoint,
       let entrypointFingerprint = request.entrypointFingerprint
    {
        entrypointDetails = """

        Script entrypoint
        \(entrypoint.path)

        Entrypoint SHA-256
        \(entrypointFingerprint)
        """
    } else {
        entrypointDetails = ""
    }
    let provider = metadata.provider ?? "(legacy record)"
    let documentationURLs = metadata.documentationURLs ?? []
    let details = """
    Risk
    \(request.risk.title)

    \(request.risk.explanation)

    Purpose
    \(request.purpose)

    Secret
    \(request.name) → \(metadata.variable)

    Description
    \(metadata.description)

    Provider
    \(provider)

    Official documentation
    \(documentationURLs.isEmpty ? "(legacy record)" : documentationURLs.joined(separator: "\n"))

    Executable
    \(request.program.path)

    SHA-256
    \(request.fingerprint)
    \(entrypointDetails)

    Arguments
    \(request.arguments.isEmpty ? "(none)" : displayedArguments)

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
    alert.icon = loadBrandImage(named: "icon.png") ?? NSImage(
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
    if let entrypoint = request.entrypoint,
       let entrypointFingerprint = request.entrypointFingerprint,
       try executableFingerprint(entrypoint) != entrypointFingerprint
    {
        record.secret = ""
        throw KeepKeysFailure(
            message: "The script entrypoint changed after approval details were prepared. KeepKeys refused to run it."
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

private func runApproved(_ request: RunRequest, metadata: EntryMetadata) throws -> [String: Any] {
    guard approveRun(request, metadata: metadata) else {
        return ["status": "cancelled", "message": "Command use was cancelled."]
    }
    var record = try KeychainStore.load(name: request.name)
    guard record.metadata == metadata else {
        record.secret = ""
        throw KeepKeysFailure(
            message: "The secret metadata changed after approval. KeepKeys refused to run."
        )
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

private func parseOptions(_ args: [String], name: String) throws -> [String] {
    var values: [String] = []
    for index in args.indices where args[index] == name {
        let valueIndex = args.index(after: index)
        guard valueIndex < args.endIndex, !args[valueIndex].hasPrefix("--") else {
            throw KeepKeysFailure(message: "\(name) requires a value.")
        }
        values.append(args[valueIndex])
    }
    return values
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
    let executableName = program.lastPathComponent.lowercased()
    let networkExecutables: Set<String> = [
        "aws", "az", "curl", "docker", "gcloud", "gh", "git", "kubectl",
        "npm", "pnpm", "rsync", "scp", "ssh", "wget", "yarn",
    ]
    let interpreters: Set<String> = [
        "bun", "deno", "java", "node", "perl", "php", "python", "python3", "ruby",
    ]
    let risk: ExecutionRisk
    if interpreters.contains(executableName) {
        risk = .interpreter
    } else if networkExecutables.contains(executableName) {
        risk = .network
    } else {
        risk = .routine
    }
    var entrypoint: URL?
    var entrypointFingerprint: String?
    if risk == .interpreter, let firstArgument = arguments.first {
        let candidate: URL
        if firstArgument.hasPrefix("/") {
            candidate = URL(fileURLWithPath: firstArgument)
        } else if let cwd {
            candidate = cwd.appendingPathComponent(firstArgument)
        } else {
            candidate = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent(firstArgument)
        }
        let resolvedCandidate = candidate.resolvingSymlinksInPath().standardizedFileURL
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(
            atPath: resolvedCandidate.path,
            isDirectory: &isDirectory
        ), !isDirectory.boolValue {
            entrypoint = resolvedCandidate
            entrypointFingerprint = try executableFingerprint(resolvedCandidate)
        }
    }
    return RunRequest(
        name: name,
        purpose: purpose,
        program: program,
        arguments: arguments,
        workingDirectory: cwd,
        fingerprint: try executableFingerprint(program),
        entrypoint: entrypoint,
        entrypointFingerprint: entrypointFingerprint,
        risk: risk
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
        provider: "BarnLabs",
        documentationURLs: ["https://github.com/barnlabs/keepkeys"],
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
        provider: "BarnLabs",
        documentationURLs: ["https://github.com/barnlabs/keepkeys/blob/main/README.md"],
        secret: secondSecret
    )
    var secondLoad = try KeychainStore.load(name: name)
    let secondMatches =
        secondLoad.secret == secondSecret
        && secondLoad.metadata.variable == "KEEPKEYS_DOCTOR_UPDATED"
        && secondLoad.metadata.description == "Updated temporary KeepKeys verification"
        && secondLoad.metadata.provider == "BarnLabs"
        && secondLoad.metadata.documentationURLs
            == ["https://github.com/barnlabs/keepkeys/blob/main/README.md"]
    secondLoad.secret = ""
    let listed = try KeychainStore.entries().contains { entry in
        entry["name"] as? String == name
            && entry["variable"] as? String == "KEEPKEYS_DOCTOR_UPDATED"
            && entry["description"] as? String == "Updated temporary KeepKeys verification"
            && entry["provider"] as? String == "BarnLabs"
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
          validName("new-key"),
          !validName("../../escape"),
          validVariable("GITHUB_TOKEN"),
          !validVariable("PATH"),
          !validVariable("DYLD_INSERT_LIBRARIES"),
          validProvider("GitHub"),
          validDocumentationURL("https://docs.github.com/en/rest"),
          !validDocumentationURL("http://docs.example.com")
    else {
        throw KeepKeysFailure(message: "Validation self-test failed.")
    }
    var successCleared = false
    var successStored = false
    try performPasteAndStore(
        readClipboard: { ("synthetic-store-secret", 41) },
        currentClipboardVersion: { 41 },
        clearClipboard: {
            successCleared = true
            return 42
        },
        storeSecret: { value in
            successStored = value == "synthetic-store-secret"
        }
    )
    var rejectedCleared = false
    var rejectedStored = false
    var invalidCaptureRejected = false
    do {
        try performPasteAndStore(
            readClipboard: { ("short", 51) },
            currentClipboardVersion: { 51 },
            clearClipboard: {
                rejectedCleared = true
                return 52
            },
            storeSecret: { _ in rejectedStored = true }
        )
    } catch StoreCaptureFailure.invalidSecret {
        invalidCaptureRejected = true
    }
    guard successCleared,
          successStored,
          invalidCaptureRejected,
          rejectedCleared,
          !rejectedStored
    else {
        throw KeepKeysFailure(message: "Paste & Store boundary self-test failed.")
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
            version: 2,
            variable: "KEEPKEYS_TEST",
            description: "Synthetic scoped-process self-test",
            provider: "BarnLabs",
            documentationURLs: ["https://github.com/barnlabs/keepkeys"]
        ),
        secret: marker
    )
    let request = RunRequest(
        name: "self-test",
        purpose: "Verify scoped environment and output redaction",
        program: environmentPrinter,
        arguments: [],
        workingDirectory: nil,
        fingerprint: try executableFingerprint(environmentPrinter),
        entrypoint: nil,
        entrypointFingerprint: nil,
        risk: .routine
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
        "message": "KeepKeys validation, Paste & Store, scoped-process, and redaction self-tests passed.",
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
                suggestedDescription: parseOption(rest, name: "--description"),
                suggestedProvider: parseOption(rest, name: "--provider"),
                suggestedDocumentationURLs: parseOptions(rest, name: "--documentation-url")
            )
        case "_portal-commit":
            result = try storeFromPortal(arguments: Array(args.dropFirst()))
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
            let metadata = try KeychainStore.metadata(name: request.name)
            result = try runApproved(request, metadata: metadata)
        case "status":
            result = [
                "status": "ok",
                "message": "KeepKeys helper is available.",
                "platform": "macOS",
                "version": keepKeysVersion,
                "vault": "macOS Keychain",
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
