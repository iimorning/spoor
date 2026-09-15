# Spoor — Privacy Policy

> The English text is the governing version. The Chinese translation is provided for convenience; if the two versions differ, the English version controls.

**Version:** 1.0.0  
**Last updated:** 19 August 2026

**灰阶法典（佛山）科技有限公司** (operating as **Spoor**, "we", "us", or "our") respects your privacy. This Privacy Policy explains what personal data we collect, use, store, and share when you use the Spoor spatial notes canvas and AI personas service (the "**Service**"), and the rights you can exercise.

**Spoor is local-first by default**: most of your canvas content lives on your device, not on our servers. The amount of personal data we handle is therefore much smaller than for typical SaaS products, but please read this policy to understand exactly what does and does not leave your device.

We may update this policy from time to time. Material changes will be communicated in advance via an in-product banner and/or email to your account address.

---

## 1. Data Controller

The data controller for the Service is:

- **Legal entity:** 灰阶法典（佛山）科技有限公司
- **Registered address:** 广东省佛山市禅城区 (Chancheng District, Foshan, Guangdong, China)
- **Privacy contact:** [w978109720@gmail.com](mailto:w978109720@gmail.com)
- **Data Protection Officer (DPO):** Not appointed — for questions, contact [w978109720@gmail.com](mailto:w978109720@gmail.com)

Spoor's Service has multiple processing paths. When you enable **Supabase-based cloud sync** (optional, configurable under Settings), synced canvas data is stored in **your own Supabase project** under your own control. In that case, you (or your organisation) act as an additional data controller for that data; Spoor's role is limited to providing the open-source sync code published under [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/). See §11.1 for details.

---

## 2. What Personal Information We Collect

Spoor operates in **two processing modes** for AI calls. The data we handle depends on which features you use.

### 2.1 Common to all modes

These data points are collected regardless of which mode you operate in:

- **Account credentials** *(only if you sign in to enable cloud sync or hosted AI credits)*: email address, password (one-way hash), session token.
- **Billing data** *(only on paid plans)*: subscription tier, billing cycle, transaction status and ID. We do **not** store full card numbers — see §5.
- **Support communications**: emails, support tickets, or feedback you send to us.
- **Operational metadata from API proxies**: when you use the web app or the bundled desktop build over the network, our Netlify-hosted edge functions log request metadata (timestamp, route, response code, error class) for security, abuse prevention, and capacity planning. **API-key material is not logged**, and request **bodies are not retained** beyond the in-flight call.

### 2.2 What we DO NOT collect by default

- **Canvas content** (notes, screenshots, documents, persona responses, agent dialogues): stored locally in your browser's IndexedDB (web) or under `%LOCALAPPDATA%\com.spoor.app\` on Windows (desktop build). Spoor's servers do **not** receive this content unless you enable cloud sync (§11.1).

### 2.3 Hosted AI mode

When you operate the Service using Spoor's bundled or hosted AI credentials — i.e. on plans that include hosted AI credits (Pro, Studio) or when you use the hosted web demo's built-in provider — your AI **Inputs and Outputs pass through our Netlify-hosted API proxy** en route to the underlying AI provider (Google Gemini, Volcengine Doubao, Xiaomi MiMo, DeepSeek, Metaso, 302.AI, etc.). Spoor processes these Inputs and Outputs solely to deliver the Service.

### 2.4 BYO Key mode

When you paste your own AI provider API key into Settings:
- **Desktop build**: where connectivity permits, the call may be made directly from your device to the chosen provider, **without transiting Spoor's proxy**. In that path Spoor sees neither the request nor the response.
- **Web build**: the call still flows through our Netlify proxy because of CORS and API-key safety; Spoor's proxy sees the request body to forward it.

The in-app Settings panel indicates the active provider and the request route. Choosing to use your own key means the AI provider becomes your direct counterparty under its own privacy policy; Spoor is not a party to that relationship.

---

## 3. How We Use Personal Information

| Purpose | Legal basis (GDPR Art. 6) |
|---|---|
| Provide and operate the Service | Contract performance |
| Process subscription billing | Contract performance |
| Customer support | Contract performance / legitimate interest |
| Operational notices (billing, security, policy updates) | Legitimate interest |
| Fraud prevention and abuse mitigation | Legitimate interest |
| Service improvement and analytics | Legitimate interest |
| Legal and tax compliance | Legal obligation |
| Marketing communications *(not currently sent)* | Consent (opt-in) |

> Spoor does not currently run third-party analytics, advertising pixels, or marketing trackers. If this changes, the type, vendor name, and a link to that vendor's own privacy policy will be listed in §4 and announced in advance through the same channel used for policy updates.

---

## 4. Cookies and Tracking Technologies

Spoor uses **no third-party tracking cookies today**. The Service stores only the minimum data needed to function:

| Type | Purpose | Can be disabled |
|---|---|---|
| Strictly necessary | Session token, authentication state, language preference, CSRF token | No |
| Functional | Last-opened canvas pointer, theme preference, ambience toggles | Yes (signing out clears them) |
| Analytics | None deployed | N/A |
| Marketing | None deployed | N/A |

You can clear functional data at any time via Settings → Clear local data, or by signing out and clearing browser storage. The desktop build does not use browser cookies; local preferences are stored in the platform-appropriate user data folder.

---

## 5. Sharing and Disclosure

We do **not** sell your personal information, including under the meaning of "sale" in the California Consumer Privacy Act (CCPA) or analogous laws. We share your information only as follows:

- **AI providers.** To fulfil persona requests, we transmit your Inputs to the provider you have selected (Google Gemini, Volcengine Doubao, Xiaomi MiMo, DeepSeek, Metaso, 302.AI, or any other provider supported by the Service). Each is a separate data controller with its own privacy policy. When your API key is on file (BYO Key), the request is made in your name; when hosted credits are on file, the request is made in our name on your behalf.
- **Payment processor.** Paid-plan card data is processed exclusively by our PCI-DSS-compliant payment processor, **Waffo Pancake**. Spoor never stores raw card data on its own servers.
- **Cloud infrastructure.**
  - **Web build**: Netlify (edge functions, static hosting, redirects).
  - **Optional cloud sync** (only if you enable it): Supabase, configured under **your own account**, using your own project — Spoor's role is limited to the open-source sync code.
  - **Desktop build updates**: GitHub Releases channel used for version checks and installer delivery.
- **Legal and regulatory.** Where required by valid law, court order, or competent authority.
- **Business transfers.** In the event of a merger, acquisition, or asset sale, with prior notice to you and continued protection obligations.
- **With your consent.** For any other purpose for which you provide explicit prior consent.

The Spoor codebase is open source under the [PolyForm Noncommercial 1.0.0 License](https://polyformproject.org/licenses/noncommercial/1.0.0/) and publicly auditable at [https://github.com/iimorning/spoor](https://github.com/iimorning/spoor). No personal data is hard-coded or hard-shipped through the source.

---

## 6. Security Measures

- **Transport encryption**: TLS / HTTPS for all client-server traffic.
- **Local-first storage**: canvas content lives on your device by default; compromising Spoor's servers does not expose your canvas data.
- **Authentication**: passwords stored using a one-way hash; session tokens are short-lived; cookies are flagged `HttpOnly` and `SameSite=Lax` where applicable.
- **Access control**: principle of least privilege; maintainer-side administrative access is logged and reviewed.
- **Open-source review**: the codebase is publicly auditable at [https://github.com/iimorning/spoor](https://github.com/iimorning/spoor).

In the event of a personal-data breach affecting your rights, we will notify you and the relevant supervisory authority within 72 hours of discovery.

---

## 7. Data Retention

| Data type | Retention | After expiry |
|---|---|---|
| Account credentials | While account is active | Deleted on account closure |
| Subscription billing records | 7 years (to meet tax / accounting obligations) | Archived encrypted, then deleted |
| Support correspondence | 2 years | Securely deleted |
| API-proxy operational logs (metadata only, not Inputs) | 90 days | Auto-purged |
| Canvas content (local) | Stored on your device until you delete or uninstall the app | Your control, not ours |
| Cloud-synced canvas content (Supabase) | While sync is enabled; 30 days after sync disabled | Deleted automatically |

---

## 8. Your Data Rights

To exercise any of the rights below, contact [w978109720@gmail.com](mailto:w978109720@gmail.com). We will respond within 30 calendar days.

| Right | Description |
|---|---|
| Right to be informed | Understand what we collect and use, as set out above |
| Right of access | Obtain a copy of your personal information |
| Right to rectification | Correct inaccurate or incomplete data |
| Right to erasure ("right to be forgotten") | Request deletion under applicable conditions |
| Right to restrict processing | Pause data processing in defined circumstances |
| Right to data portability | Receive your data in a machine-readable format |
| Right to object | Object to processing based on legitimate interest or for marketing |
| Right to withdraw consent | Withdraw any consent-based processing |

You also have the right to lodge a complaint with your local data protection authority (for example, the CAC in China, the CNIL in France, the ICO in the UK, or the California AG).

> **Self-service paths.** Because most of your canvas content is local-first, you can exercise the strongest forms of these rights directly in-app:
> - **Export**: Settings → Export canvas (JSON / Markdown / PDF bundle).
> - **Delete**: Settings → Clear local data, or uninstall the desktop build.
> - **Rectify**: edit any note on the canvas.
> Cloud-synced content follows the same controls in **your own Supabase project**.

---

## 9. Marketing Communications and Opt-Out

Spoor does not currently send marketing email. Should this change in the future:

By your consent, we may send product news, feature updates, and usage tips via email. You can opt out at any time:
- Click "unsubscribe" in any marketing email.
- Disable marketing notifications in Settings (when available).
- Contact [w978109720@gmail.com](mailto:w978109720@gmail.com).

Opting out does not affect service-essential notices (billing, security, policy updates).

---

## 10. International Data Transfers

Spoor uses infrastructure and providers located in multiple jurisdictions, including the United States, Singapore, the European Union, and China (for example: Netlify and GitHub in the United States; AI providers that may process data in the United States, Singapore, the EU, or China depending on the provider you select; Waffo Pancake for payments). When data is transferred across borders, we safeguard it through:

- Selection of providers with documented equivalent protection levels where possible.
- Standard Contractual Clauses (SCC) or comparable safeguards with processors where applicable.
- **Minimisation**: most user-generated canvas content never leaves your device; only authentication, billing, and operational telemetry cross borders, and only when those features are used.

Data-subject rights enumerated in §8 apply regardless of where the data is processed.

---

## 11. Children's Privacy

The Service is intended for users aged 16 and over. We do not knowingly collect personal information from anyone below that age.

If you believe a child has provided information to us, please contact [w978109720@gmail.com](mailto:w978109720@gmail.com) and we will delete it promptly. Users below 16 must have verifiable parental or guardian consent before using the Service; please do not allow them to use the Service without it.

Paid plans and account registration under the Terms of Service additionally require that you are at least 18 years of age.

### 11.1 Self-managed Supabase sync (additional note)

When you configure cloud sync under Settings, you provide your own Supabase project URL and an API key. At that point:

- You create an account directly with Supabase; [Supabase's own privacy policy](https://supabase.com/privacy) governs what it collects about your Supabase account.
- The sync code (open source at [https://github.com/iimorning/spoor](https://github.com/iimorning/spoor)) writes canvas snapshots to your own project's storage using row-level security rules.
- Spoor does not store a copy of your synced content on its own servers and has no way to read it.
- Deleting your Supabase data is your responsibility — see our [Supabase setup guide](./SUPABASE.md) and [Supabase documentation](https://supabase.com/docs).

---

## 12. Third-Party Links and Services

The Service may contain links to third-party sites and references to third-party services — for example, the project's GitHub repository at [https://github.com/iimorning/spoor](https://github.com/iimorning/spoor), the AI providers listed in §5, and the Supabase project you configure for sync. This policy applies only to data Spoor directly processes. For third-party sites, please review their own privacy policies, especially the AI providers' model-training and data-retention practices.

---

## 13. Changes to This Policy

For material changes, we will notify you at least 14 days in advance via an in-product banner and/or email at your account address. The "Last updated" date at the top of this document will be revised accordingly. Continued use after the effective date constitutes acceptance of the revised policy.

A public version history is maintained on the Privacy Policy page at [https://spoor.ink/privacy](https://spoor.ink/privacy) so that the version in force at any past date can be reproduced.

---

## 14. Contact

For privacy, support, billing, or security questions, email [w978109720@gmail.com](mailto:w978109720@gmail.com).

- **Legal entity:** 灰阶法典（佛山）科技有限公司
- **Postal address:** 广东省佛山市禅城区
- **Hours:** Monday–Friday 10:00–18:00 (China Standard Time, UTC+8)
- **Website:** [https://spoor.ink](https://spoor.ink)
