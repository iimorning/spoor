# Spoor — Terms of Service

> The English text is the governing version. The Chinese translation is provided for convenience; if the two versions differ, the English version controls.

**Version:** 1.1.0  
**Last updated:** 20 August 2026

---

## 1. Acceptance of Terms

Welcome to **Spoor** ("Spoor", "we", "us", or "our").

We are **灰阶法典（佛山）科技有限公司** (Huijie Fadian (Foshan) Technology Co., Ltd.), a company duly organized under the laws of the People's Republic of China, with our registered address in Chancheng District, Foshan, Guangdong, China (广东省佛山市禅城区).

These Terms of Service (the "**Terms**") govern your access to and use of our AI-powered spatial notes service, including the canvas, AI personas (the Mirror of Insight, the Weaver, the Smoothing Iron, the Star-Gazer, and others), and any related features made available at [https://spoor.ink](https://spoor.ink) or via the Spoor desktop build (the "**Service**").

By creating an account, subscribing to a plan, or otherwise using the Service, you confirm that you (a) are at least 18 years of age, (b) have read, understood, and agree to be bound by these Terms, (c) acknowledge our Privacy Policy, and (d) have the authority to enter into this agreement on your own behalf or on behalf of the organisation you represent.

> If you do not agree to these Terms, do not use the Service. Continued use after any update constitutes acceptance of the revised Terms.

---

## 2. Description of the Service

**2.1 What we provide.** Spoor provides an AI-driven spatial notes canvas. Users arrange notes, screenshots, documents, research findings, and AI-generated responses on a single infinite canvas, then call on AI personas to question, connect, rewrite, and research their ideas. The Service is delivered as a digital Software-as-a-Service (SaaS) product, accessible via web browser or via the Spoor desktop build (NSIS installer for Windows / Tauri runtime).

**2.2 Digital nature.** The Service is a digital, intangible product. Access is activated upon successful payment (where applicable) or, in the case of Free plans, immediately upon registration. Because delivery is instantaneous, refunds are subject to specific limits described in Section 7.

**2.3 AI model providers.** The Service interoperates with third-party AI model and search providers, which may include Google (Gemini / `@google/genai`), Volcengine Ark (Doubao), Xiaomi MiMo, DeepSeek, Metaso, 302.AI, and any other provider configured by either you or us. **For Free-tier users who provide their own API key (BYO Key — see §9.5), the provider is your direct counterparty**; we are not a party to that transaction and do not see or bill your provider. For Pro and signed-in Free users using Spoor's hosted AI, our providers are listed in the Settings panel of the application. The performance and availability of the Service may depend on these third parties. We will notify users of any material service disruption.

**2.4 Local-first data.** The Free tier stores all canvas content locally in your browser's IndexedDB (web) or on your local disk (desktop build). Spoor's servers **do not receive this content** unless you explicitly sign in to enable optional Supabase-based cloud sync as described in our [Supabase setup guide](./SUPABASE.md).

---

## 3. Account Registration

**3.1 Account creation.** To use the Service you must create an account using accurate and complete information, or sign in via an existing provider. You are responsible for safeguarding your login credentials and for all activity that occurs under your account.

**3.2 Account security.**
- If you detect any unauthorised use, immediately contact [w978109720@gmail.com](mailto:w978109720@gmail.com).
- Do not share login credentials with any third party.
- Keep your billing email address current.

**3.3 Organisation accounts.** If you register on behalf of a company or other organisation, you represent that you have authority to bind that entity to these Terms.

---

## 4. Plans

We offer subscription plans to access the Service. The current plans and pricing are described in detail on our pricing page ([https://spoor.ink/pricing](https://spoor.ink/pricing)). The Free plan is offered without charge.

We reserve the right to modify plan features, introduce new plans, or retire existing plans at any time. Price changes are governed by §5.1.

> **Note on local-first:** The Free plan stores content locally on your device. You do not need a Spoor account merely to use the desktop build with your own AI provider credentials. An account is required to enable paid plans, cloud sync, hosted AI credits, or to issue subscriptions.

---

## 5. Billing & Payment

**5.1 Auto-renewal authorisation.** When you provide a payment method and subscribe to a paid plan, you explicitly authorise Spoor to charge your payment method the then-current subscription fee at the start of each billing cycle and at the start of every renewal cycle thereafter, until you cancel in accordance with §6. **For annual subscriptions, we will send a renewal notice at least 7 days before the renewal date.**

**5.2 Free plan.** No payment is required for the Free plan. By using the Free plan, you agree that any AI inference cost incurred through AI personas is billed by the provider you select (Google, Volcengine, etc.) under that provider's own terms, when using your own API key. Spoor does not charge, process, transmit, or store your payment card details for the Free plan.

**5.3 Hosted AI credits.** Signed-in Free accounts receive a one-time hosted allowance of 500,000 text tokens, 10 generated images, and 30 minutes of voice writing (speech recognition plus up to 20,000 characters of speech synthesis). The allowance does not reset each month. Pro plans use the same hosted path without those caps. You may instead provide your own API keys; usage on your keys is billed by that provider and does not count against the Spoor allowance.

**5.4 Payment processor.** Paid-plan payment data is processed exclusively by our PCI-DSS-compliant payment processor (**Waffo Pancake**). Spoor never stores raw payment card data on its own servers.

**5.5 Taxes.** Unless otherwise stated, listed prices do not include applicable taxes (including VAT, GST, sales tax, etc.). Where required by law, we will collect and remit applicable taxes.

---

## 6. Cancellation

**6.1 How to cancel.** You may cancel your subscription at any time, in any of the following ways:

- **Online (recommended):** Settings → Subscription → Cancel
- **Email:** Send a cancellation request from the email associated with your account to [w978109720@gmail.com](mailto:w978109720@gmail.com).

Cancellation takes effect at the end of the current billing cycle. We will send a confirmation email within 10 minutes.

**6.2 Effect of cancellation.**
- You retain full access until the end of the current billing cycle.
- No further billing cycles will be charged.
- Cloud-synced account data will be retained for 30 days after cancellation and then deleted in accordance with our Privacy Policy. **Locally stored canvas data is unaffected by cancellation of the cloud subscription; it remains on your device until you delete it.**
- If you remain within any refund window described in §7, you may still request a refund after cancellation.

**6.3 Effect of downgrade.** Downgrading to a lower tier (e.g. Pro → Free) takes effect at the end of the current billing cycle. Features unique to the higher tier may be disabled at that time.

---

## 7. Refund Policy

**7.1 General policy.** Because the Service is digital and access is granted immediately upon payment, subscription fees are non-refundable except as described in this Section.

**7.2 Refundable situations.**
- **New-subscriber 7-day guarantee.** First-time subscribers may request a full refund within 7 days of the initial charge, provided usage has not exceeded 20% of the plan's monthly allocation.
- **Duplicate charges.** Charges made in error due to a confirmed billing error are fully refundable.
- **Verified service interruption (>72 hours).** Prolonged service interruptions caused by Spoor may be refunded pro-rata or compensated by extending the subscription period at your option.
- **Statutory rights.** Where applicable law (for example, EU/UK 14-day cooling-off periods, Australian Consumer Law, or California consumer rights) grants a right of withdrawal or refund, that right is preserved.

**7.3 How to request.** Email [w978109720@gmail.com](mailto:w978109720@gmail.com) with your account email, the transaction ID, and the reason for the refund. We confirm within 2 business days and process eligible refunds within 5–10 business days via the original payment method.

**7.4 Non-refundable items.**
- Fees for any billing cycle in which the Service has been used (except as described in §7.2).
- Annual subscription fees where the refund request is made more than 30 days after the initial purchase.
- Accounts closed for breach of these Terms or the Acceptable Use Policy (§10).

**7.5 BYO-Key provider costs.** Spoor does not bill Free-tier users for AI usage and cannot issue refunds for charges levied directly by your third-party AI provider (Google, Volcengine, etc.) under your own API key. Please contact your provider directly for those matters.

---

## 8. Billing Disputes

If you believe a charge is incorrect, please contact [w978109720@gmail.com](mailto:w978109720@gmail.com) **before initiating a chargeback with your bank or payment provider**. We commit to responding within 2 business days and resolving confirmed billing errors within 5 business days.

---

## 9. AI Content & Intellectual Property

**9.1 Output ownership.** Subject to your compliance with these Terms, AI-generated content produced from your inputs ("**Outputs**") belongs to you. You may use the Outputs for any lawful purpose permitted by §10, including personal notes, business automation, research, and creative work.

**9.2 Input licence.** By submitting content ("**Inputs**") to the Service, you grant Spoor a limited, non-exclusive licence to use those Inputs solely to provide the Service to you (including, where applicable, transmitting them to the AI provider you have selected). **We will not use your Inputs to train any AI model without your explicit consent.**

**9.3 Third-party AI model providers.** Spoor relies on third-party model and search providers (including Google, Volcengine, Xiaomi MiMo, DeepSeek, Metaso, 302.AI). Outputs may reflect characteristics and limitations of those providers' models. We do not guarantee the accuracy, originality, or non-infringement of any Output, and we are not responsible for content produced by a model whose API key you supply (BYO Key).

**9.4 No-output warranty.** AI-generated content may contain errors, omissions, or out-of-date information. You are responsible for reviewing and verifying any Output before relying on it.

**9.5 BYO Key — your direct relationship with the provider.** When you provide your own API key for an AI provider on the Free plan, you enter into a direct commercial relationship with that provider under its own terms. Spoor:
- Does not see, transmit, store, or proxy the API key beyond what's required to make the call from your device;
- Does not bill you for the resulting usage;
- Does not act as a reseller, agent, or co-party of the provider; and
- Is not a party to, and bears no liability under, your agreement with the provider.

If your provider revokes your key, raises quota limits, or terminates your access, Spoor is unable to restore service for the affected persona and is not liable for any resulting loss.

---

## 10. Acceptable Use

The dedicated [Acceptable Use Policy](https://spoor.ink/aup) (the "**AUP**") is incorporated into these Terms. If this Section and the AUP differ on a content-safety point, the AUP controls for that point.

**10.1 Permitted uses.** You may use the Service only for lawful purposes consistent with these Terms and the AUP, including personal note-taking, research, business productivity, education, and creative work.

**10.2 Prohibited generated content.** You must not use the Service — including hosted, text-driven AI image generation — to generate, request, or distribute any of the following. Each item is independently prohibited (this list is not a summary of “illegal content” in the abstract):
- **Pornography / NSFW content.**
- **Violence / gore.**
- **Hate speech.**
- **Child-unsafe content (CSAM)** and any sexual content involving minors.
- **Deepfakes / impersonation** of real persons, including non-consensual intimate imagery.
- **Copyright / trademark infringement.**

**10.3 Other prohibited uses.** You also agree not to:
- Generate content that is otherwise illegal, defamatory, harassing, deceptive, or fraudulent.
- Create malware, phishing material, or cybersecurity attack tools.
- Circumvent or interfere with any security feature of the Service, including prompt-safety scanning.
- Resell or sublicense access without Spoor's prior written consent.
- Violate any applicable law, regulation, or card-network rule (where paid plans use a card-accepting processor).

**10.4 AI-specific prohibitions.** You specifically agree not to:
- Use any Input, Output, model response, or derivative data obtained from the Service to train, fine-tune, benchmark, or otherwise develop any AI or machine-learning model that competes, directly or indirectly, with the Spoor product or with the AI providers Spoor relies on.
- Mass-scrape, extract, or harvest model Outputs for purposes beyond your personal authorised use.
- Misrepresent AI-generated content as the work of a licensed human professional (such as a medical doctor, attorney, or financial advisor) in any context where such misrepresentation could cause harm.
- Submit jailbreak prompts intended to bypass the AUP or safety filters.

**10.5 Moderation of hosted image prompts.** Before hosted text-to-image generation runs, Spoor submits the user prompt to Waffo Pancake Prompt Sift (`scan-prompt`). Generation proceeds only on an `allow` verdict. `block` and `review` do not generate an image and do not consume a successful generation.

**10.6 Reporting.** Content-policy violations must be reported through the dedicated channels in the AUP — the [report form](https://spoor.ink/report) or [w978109720+aup@gmail.com](mailto:w978109720+aup@gmail.com) — not only via general customer support.

**10.7 Enforcement.** We may warn, remove content, limit hosted AI, suspend or terminate accounts, and refer illegal L1 activity to authorities, as described in the AUP. Accounts closed for AUP breach are not entitled to refunds under §7.4.

---

## 11. Data, Privacy & Security

**11.1 Local-first by default.** Free-tier canvas content lives on your device. Spoor's servers do not receive it. Optional Supabase-based cloud sync, when enabled, transmits encrypted canvas snapshots to your own Supabase project under your control — see our [Supabase setup guide](./SUPABASE.md).

**11.2 Privacy policy.** Your use of the Service is governed by our Privacy Policy, available as a dedicated page at [https://spoor.ink/privacy](https://spoor.ink/privacy) and linked from the landing, pricing, and community footers.

**11.3 Payment data.** Paid-plan card data is processed exclusively by our PCI-DSS-compliant payment processor (**Waffo Pancake**); Spoor never stores raw card data on its own servers.

**11.4 Data retention.**
- Free-tier local canvas data lives on your device and is removed by you when you uninstall the application or clear browser storage.
- Account and cloud-synced data is retained for 30 days after cancellation, then deleted in accordance with our Privacy Policy.

---

## 12. Disclaimers & Limitation of Liability

**12.1 Disclaimer.** The Service is provided on an "**as is**" and "**as available**" basis, without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, or accuracy of any AI Output.

**12.2 AI-output disclaimer.** ⚠️ **AI outputs may be inaccurate, incomplete, or out of date. Do not use them as legal, medical, financial, or other professional advice.** Always verify with a qualified professional before acting on AI-generated content.

**12.3 Limitation of liability.** To the maximum extent permitted by applicable law, Spoor shall not be liable for any indirect, incidental, consequential, special, exemplary, or punitive damages. Spoor's total aggregate liability for any claim arising out of or relating to the Service shall not exceed the greater of (a) the amount you have paid Spoor in the 12 months preceding the event giving rise to the claim, or (b) USD 100 (or equivalent).

**12.4 Nothing in these Terms** is intended to exclude or limit any statutory rights you may have that cannot be excluded or limited under the laws of the People's Republic of China.

---

## 13. Term & Termination

These Terms remain in effect for as long as you use the Service. We may suspend or terminate your account if you materially breach these Terms, engage in suspected fraud, or are required to do so by law. If we terminate the Service for reasons other than your breach, we will refund any prepaid, unused portion on a pro-rata basis. You may delete your account at any time by contacting [w978109720@gmail.com](mailto:w978109720@gmail.com) or by using the in-app Settings → Account → Delete flow (if available).

---

## 14. Governing Law & Disputes

These Terms are governed by the laws of the People's Republic of China. Before initiating any formal proceeding, please contact [w978109720@gmail.com](mailto:w978109720@gmail.com) to attempt informal resolution. Disputes that cannot be resolved informally shall be submitted to the people's court with jurisdiction at our domicile in Chancheng District, Foshan, Guangdong, China.

---

## 15. General Provisions

We may update these Terms from time to time. Material changes will be communicated by email at least 14 days before the effective date, and announced in the application when you next sign in. Continued use after the effective date constitutes acceptance of the revised Terms. If any provision is held unenforceable, the remaining provisions remain in full effect. These Terms, together with the Privacy Policy and the Acceptable Use Policy, constitute the entire agreement between you and Spoor.

---

## 16. Contact

For questions about these Terms, billing, refunds, cancellation, privacy, or security, email [w978109720@gmail.com](mailto:w978109720@gmail.com). **To report AUP / generated-content violations, use the dedicated form at [https://spoor.ink/report](https://spoor.ink/report) or [w978109720+aup@gmail.com](mailto:w978109720+aup@gmail.com).** You may also cancel a paid plan in-app: Settings → Subscription → Cancel.

- **Legal entity:** 灰阶法典（佛山）科技有限公司
- **Postal address:** 广东省佛山市禅城区
- **Website:** [https://spoor.ink](https://spoor.ink)

By using the Service or by clicking "I agree" at checkout, you confirm that you have read and agree to these Terms.
