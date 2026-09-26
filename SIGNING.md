# Signing the installers

CI builds installers on a `v*` tag or a manual run (Actions → CI → Run
workflow). They are unsigned until the secrets below exist in the repo
(Settings → Secrets and variables → Actions); each platform switches on by
itself when its secrets are there, and stays unsigned otherwise.

Unsigned costs: macOS refuses to open the app until the user right-clicks →
Open (or clears the quarantine flag); Windows SmartScreen shows "Windows
protected your PC" and hides the Run button behind "More info".

Prices and eligibility below are what the providers published when this was
written; check them before paying.

## macOS

Needs a paid Apple Developer Program membership (about $99 a year).

1. In Xcode or on developer.apple.com, create a **Developer ID Application**
   certificate and export it from Keychain Access as a `.p12` with a
   password.
2. Add these secrets:

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | `base64 -i certificate.p12` (one line) |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | the Apple account email |
   | `APPLE_PASSWORD` | an app-specific password from account.apple.com |
   | `APPLE_TEAM_ID` | the 10-character Team ID |

The last three are for notarization. A Developer ID signature without
notarization is still refused by Gatekeeper, so set all six.

## Windows

The workflow runs one secret as the sign command, with `%1` standing for the
file to sign:

| Secret | Value |
|---|---|
| `WINDOWS_SIGN_COMMAND` | the provider's command, ending in `%1` |

Since 2023, code-signing keys must live on a hardware token or in a cloud
HSM, so a plain `.pfx` is no longer something a CA sells. What that leaves:

- **Azure Artifact Signing** (formerly Trusted Signing). The cheapest by far,
  a few dollars a month, but individual developers have only been eligible
  in some countries. Its command looks like
  `artifact-signing-cli -e <endpoint> -a <account> -c <profile> %1`, and it
  logs in with the `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and
  `AZURE_TENANT_ID` secrets, which the build step already passes through.
  The CLI has to be installed on the runner first (add a step before the
  build).
- **A cloud-signing certificate from a CA** (DigiCert KeyLocker, SSL.com
  eSigner, Certum SimplySign). A few hundred a year for an OV certificate;
  each ships its own command-line signer.
- **Certum Open Source Code Signing**, much cheaper, but only for an open
  source project.

An OV certificate stops the "unknown publisher" wording at once, but
SmartScreen still warns until the certificate has built up a download
reputation. EV certificates no longer skip that step.

## Linux

Nothing to buy. `.deb` and AppImage are not signed by default. Users verify
them by the checksum published next to the release.
