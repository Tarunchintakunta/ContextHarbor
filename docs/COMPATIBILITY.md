# Desktop and meeting compatibility

Every row begins **NOT TESTED**. This document is a test plan, not evidence of support. Record exact OS build, architecture, meeting app/browser version, Electron version, display configuration, audio device, receiver evidence, tester, and date for every result.

## Why desktop plus website

| Form | What it handles well | Gap for this product | Decision |
|---|---|---|---|
| Website only | Uploads, accounts, budgets, typed Q&A | Cannot provide dependable cross-application overlay privacy or universal meeting audio capture | Use for administration and preparation |
| Browser extension | Browser-tab workflows | Does not cover native Teams/Slack and OS-level behavior consistently | Defer |
| Desktop app only | Audio and small answer overlay | Admin workflows and distribution are less convenient | Use for meeting experience |
| Desktop plus web | Local meeting experience and central management | Requires signing, two-platform QA, and a backend | Recommended MVP |

An existing AI policy covers organizational permission, not whether an arbitrary client's documents are authorized for upload. Show the workspace policy reference and require account setup to identify the applicable policy; do not present capture exclusion as concealment of unauthorized recording.

## Target matrix

Initial OS targets are Windows 11 x64 and macOS 14.2+ on Apple Silicon and Intel. Pin an actually supported Electron release; adjust oldest supported OS only through a documented decision. Linux, Windows ARM, and older macOS versions are deferred. Do not advertise an architecture merely because the code compiles.

| Meeting surface | Windows remote audio | macOS remote audio | Window/tab share receiver check | Full-display receiver check |
|---|---|---|---|---|
| Google Meet in Chrome | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED; no universal promise |
| Microsoft Teams desktop | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED; macOS exclusion unsupported as guarantee |
| Slack Huddles desktop | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED; macOS exclusion unsupported as guarantee |

Create separate rows per OS/architecture and sharing mode when executing. Zoom and other meeting applications are out of the initial claimed-support matrix until tested.

## Test protocol

1. Use two actual devices/accounts, one presenting and one receiving. Inspect the receiver's live view and any recording made in the authorized test.
2. Show a unique, nonconfidential marker in the overlay. Move it across the shared area; hide, restore, minimize, change displays, and switch presentation windows.
3. Test single-window share, browser-tab share where applicable, and full-display share independently. Distinguish a visible overlay, black rectangle, and properly excluded window.
4. Repeat immediately after app start and after toggling content protection. A successful API call is not proof of receiver-side exclusion.
5. Test remote speech with headphones and mic off. Then enable the mic and verify channel labels and no duplicate question triggers. Test laptop speakers separately.
6. Deny/revoke permissions, switch Bluetooth devices, unplug the active device, lock/unlock, and sleep/wake. Verify status and explicit recovery.
7. Switch client logins during a pending answer: old capture stops, old text disappears, and no late answer reaches the new client.
8. Record result `PASS`, `FAIL`, or `NOT TESTED`, link evidence, and specify the supported fallback. Failed modes do not become supported because another app worked.

Desktop privacy behavior is constrained by [Electron content protection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable). On macOS, a separate unshared display or tested application-window share is the practical fallback. If full-display invisibility on all macOS meeting apps is mandatory, the current scope is not feasible and must not be sold as achieved.

## Result template

- Build / commit:
- OS / architecture / Electron:
- Meeting app / browser version:
- Share mode / displays / audio device:
- Receiver evidence path:
- Audio capture result:
- Overlay visibility result:
- Focus and shortcut result:
- Recovery result:
- Tester / date:
- Claimed support and limitations:
