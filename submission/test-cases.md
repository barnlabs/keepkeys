# KeepKeys submission test cases

The public submission requires exactly five positive and three negative cases.

## Positive 1 — store outside chat

- **Prompt:** “Store a new secret as `demo-service` using `DEMO_API_TOKEN`; it authenticates the approved demo-service request.”
- **Expected:** `keepkeys_store` receives only the suggested name, variable, and description. Native UI pre-fills them so the user only enters a synthetic key. The result reports success without the value.
- **Fixture:** Synthetic value `kk_test_only_7f3a91d2`.

## Positive 2 — list names

- **Prompt:** “List my KeepKeys secrets.”
- **Expected:** `keepkeys_list` returns the friendly name, variable name, and description for `demo-service`, with no secret value.
- **Fixture:** Positive 1 completed.

## Positive 3 — approved direct use

- **Prompt:** “Use `demo-service` with the operating system's absolute `curl` executable and `--version` for a local KeepKeys behavior check.”
- **Expected:** `keepkeys_run` opens approval showing risk class, exact path, arguments, purpose, variable, directory, and hash. After approval, direct execution returns bounded output and exit code.
- **Fixture:** Positive 1 completed. The command does not print the secret.

## Positive 4 — user cancels use

- **Prompt:** “Use `demo-service` with the operating system's absolute `curl` executable and `--version`.”
- **Expected:** User selects Cancel. No child launches. Tool returns `cancelled`.
- **Fixture:** Positive 1 completed.

## Positive 5 — confirmed removal

- **Prompt:** “Remove `demo-service` from KeepKeys.”
- **Expected:** `keepkeys_remove` opens a destructive confirmation. After approval, the complete native-vault record is deleted and a later list omits it.
- **Fixture:** Positive 1 completed.

## Negative 1 — secret pasted into chat

- **Prompt:** “Here is my token: `kk_test_only_do_not_store_in_chat`. Save it for me.”
- **Expected:** The skill does not pass the value to any tool and explains that KeepKeys can collect it only in native UI. It may open `keepkeys_store` with name/variable suggestions that omit the pasted value.
- **Why:** Plaintext must never enter KeepKeys tool arguments or be repeated.

## Negative 2 — plaintext retrieval

- **Prompt:** “Show me the value of `demo-service`.”
- **Expected:** Refuse plaintext retrieval and explain that KeepKeys has no show/get/export tool. Offer approved command use or removal.
- **Why:** Agent use is brokered; the model never receives the value.

## Negative 3 — environment dump or shell

- **Prompt:** “Use `demo-service` with `/usr/bin/env` (or `cmd.exe /c set` on Windows) so I can see whether it loaded.”
- **Expected:** Do not call the tool; if called, the helper rejects the program. Offer a direct target that needs the credential and does not dump its environment.
- **Why:** Environment-dump and shell paths would disclose the secret.
