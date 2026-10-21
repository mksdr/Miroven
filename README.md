# Miroven

**English** · [한국어](README.ko.md)

A local-first personal journal that encrypts your entries and photos on your device. Start without an account, then optionally connect to Miroven-API to sync encrypted data across devices.

## Features

- Write, edit, and search entries with up to four photos per entry
- On-device encrypted storage, PIN lock, encrypted file backups, and recovery
- Optional email-code sign-in and encrypted sync with explicit conflict resolution
- References to earlier entries and an encrypted personal profile
- English and Korean interfaces, themes, and adjustable text size

## Get started

Requires Node.js 22.13 or later and npm. CI and Docker builds use Node.js 24.22.1. From the repository root:

```sh
cd web
npm ci
npm run dev
```

Leave `NEXT_PUBLIC_MIROVEN_API_URL` unset to use the app locally without a server. See the [example environment](web/.env.example) for build configuration.

| Goal | Where to go |
| --- | --- |
| Learn to use the app | Open `/guide` in your running app |
| Develop and run checks | [Client development](https://github.com/mksdr/Miroven/wiki/Client-Development) |
| Host the static app | [Self-hosting](https://github.com/mksdr/Miroven/wiki/Self-Hosting) |
| Understand architecture and encryption | [Project Wiki](https://github.com/mksdr/Miroven/wiki) |
| Report bugs or contribute | [Contributing](CONTRIBUTING.md) |
| Report a vulnerability | [Security reporting](SECURITY.md) |

## Keeping your journal safe

Signing in and unlocking the vault are separate steps. Opening an existing vault on another device requires its recovery code. Browser storage is not guaranteed to persist; keep an encrypted backup and its recovery code in separate, safe locations.

The server can see metadata such as email addresses, timestamps, and ciphertext sizes. Encryption cannot protect against a modified client, XSS, or access to an unlocked device. Read the [security boundaries and known limitations](https://github.com/mksdr/Miroven/wiki/Security-Model).

## Related projects

- **Miroven**: the journal client in this repository
- **Miroven-API**: the optional authentication, encrypted sync, and file storage server
- **Miroven-Web**: the product website, help, and hosted-service policies

Technical documentation is maintained in the [mksdr/Miroven Wiki](https://github.com/mksdr/Miroven/wiki). Hosted-service availability and operating policies will be announced separately when the service launches.

## License

[GNU AGPL-3.0-only](LICENSE). Third-party dependencies and codecs retain their respective licenses; the app provides their notices at `/notice`.
