# Security Policy

## Reporting a vulnerability

Please report security issues privately, not in public issues:

- **GitHub:** use **Security › Report a vulnerability** on this repository (private vulnerability reporting), or
- **Email:** [christopher.starford@accenture.com](mailto:christopher.starford@accenture.com)

Include the App version (shown in the App header), what you found, and how to reproduce it. You'll get an acknowledgement within 3 business days.

## Fix windows

| Severity | Fix delivered within |
|---|---|
| Critical | 10 days |
| High | 4 weeks |
| Medium, Low | Next scheduled release |

These follow the Cribl Marketplace's remediation requirements. Fixes are released as a new version and noted in [CHANGELOG.md](CHANGELOG.md).

## Supported versions

The latest minor release receives security fixes. Upgrade with **Apps › Installed › Lookup Manager › Upgrade**; saved lookups and sharing are kept.

## How the App handles security

- **Authentication and authorization:** the App runs inside Cribl; Cribl authenticates every call. Interactive use runs with the signed-in member's permissions (Open mode). The backend function runs only with the grants declared in `config/policies.yml`, limited to what scheduled refresh needs.
- **Secrets:** the App never handles credentials directly. API tokens are stored by an administrator as encrypted App KV entries and injected by Cribl's proxy (`headers.inject`). The App does not log or display them.
- **Network:** external calls go only through Cribl's proxy, to hosts in `config/proxies.yml` (two public feeds, GET only) or hosts an administrator authorizes.
- **Data:** the App reads source data only to build lookups and writes only to the targets the member selects. It sends no data to the developer or any third party.
- **Dependencies:** releases require `npm audit --audit-level=high` to pass (enforced in CI).

Known considerations: bearer tokens injected for third-party APIs may expire and must be refreshed by an administrator; Splunk-through-worker setups may disable TLS verification for self-signed Splunk certificates on the private network.
