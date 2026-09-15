# Spoor — Acceptable Use Policy (AUP)

> The English text is the governing version. The Chinese translation is provided for convenience; if the two versions differ, the English version controls.

**Version:** 1.0.0  
**Last updated:** 20 August 2026  
**Related:** [Terms of Service](https://spoor.ink/terms) · [Report a violation](https://spoor.ink/report)

This Acceptable Use Policy (the "**AUP**") is part of the Spoor Terms of Service. It applies to every user of the Service, including hosted AI image generation driven by your text prompts.

---

## 1. Scope

This policy applies to all of the following:

- **Text:** AI-generated writing, chat, code, essays, and similar material.
- **Images:** AI-generated or AI-edited pictures and illustrations (including hosted text-to-image).
- **Audio:** AI speech recognition and speech synthesis used in voice writing, where available.
- **User input (prompts):** text prompts, instructions, and any other input you submit to generate or transform content.
- **Shared material:** listings or other content you publish in the Spoor community, if you use that feature.

---

## 2. Content standards and prohibited categories

Spoor **prohibits** using the Service to generate, request, upload, or share any of the following six categories. Each category is listed separately and is independently prohibited:

- **Pornography / NSFW content** — sexual, pornographic, or otherwise not-safe-for-work imagery or text, including explicit nudity generated on request.
- **Violence / gore** — graphic violence, gore, torture, or content that glorifies real-world violent harm.
- **Hate speech** — content that attacks, dehumanises, or incites hatred or violence against a person or group based on protected characteristics (including race, ethnicity, nationality, religion, sex, gender, sexual orientation, disability, or similar status).
- **Child-unsafe content (CSAM)** — child sexual abuse material, sexualisation of minors, or any sexual content involving anyone 17 or under, whether real or fictional.
- **Deepfakes / impersonation** — AI-synthesised images, audio, or video that impersonate a real person, or that are intended to mislead others about origin or authenticity, including non-consensual intimate imagery of real people.
- **Copyright / trademark infringement** — content that copies or trades on another party’s copyrighted work, trademark, or other IP without a lawful basis.

The remainder of this AUP explains how we apply those categories, how we moderate, and how you can report violations.

### 2.1 Zero tolerance

The following are blocked immediately. We may also report them to competent authorities where required by law:

- Child sexual exploitation (CSAM) or any sexual content involving minors.
- Content that promotes or assists terrorism, violent extremism, or mass violence.
- Guidance for producing weapons of mass destruction.
- Incitement to genocide or ethnic hatred.
- Non-consensual deepfake sexual content of a real person.

### 2.2 Additional restrictions

Hosted image generation does **not** permit adult/NSFW content, even with an age gate. The following are also restricted or prohibited in context:

- Graphic violence outside a clearly fictional, educational, or documentary framing that does not depict real-world gore.
- Political deepfakes or other material designed to mislead the public.
- Medical, legal, or financial advice presented as professional counsel.

### 2.3 Other prohibited conduct

- Generating or spreading false information intended to deceive.
- Impersonating a real person, brand, or institution.
- Infringing intellectual-property, portrait, or privacy rights.
- Presenting AI output as human-authored professional work in a way that could cause harm.
- Bulk spam, fraud, or malware.
- Jailbreak prompts intended to bypass safety systems, including this AUP or Waffo Prompt Sift.

---

## 3. Content moderation

We use automated checks, human review of reports, and periodic sampling.

### 3.1 Automated checks (real time)

- **Input filtering:** before hosted text-to-image generation, we send the user prompt to **Waffo Pancake Prompt Sift** (`scan-prompt`). Generation proceeds only when the verdict is `allow`. `block` and `review` (including service-degraded review) do not generate an image.
- **Provider-side filters:** image providers may apply their own safety settings in addition to Prompt Sift.
- **Usage patterns:** we may throttle or refuse abusive automated calling of hosted AI.

### 3.2 Human review

- Reports submitted through the [content report form](https://spoor.ink/report) or the dedicated report mailbox are reviewed by a person on the trust-and-safety rotation (not an unattended inbox).
- Automatically blocked prompts are not generated; repeat or severe cases may be queued for account review.

### 3.3 Sampling

- We periodically sample hosted-generation logs (prompts are scanned in transit; Prompt Sift does not retain prompt text after the verdict) and community listings.
- We tune filters when we find false positives or missed cases.

### 3.4 Severity scale

| Level | Description | Review | Action |
|---|---|---|---|
| L1 Severe | Child safety, terrorism | Auto-block + human confirm | Immediate ban + report to authorities where required |
| L2 High | Confirmed NSFW, gore, hate, deepfake, IP theft | Auto-block + priority review | Remove content + suspend hosted AI / account |
| L3 Medium | Other AUP breaches | Human review of reports | Warning + removal |
| L4 Low | Minor first-time issues | Report-triggered | Warning + ask to correct |

---

## 4. When to report

Please report:

- Content or behaviour that violates this AUP.
- Child-safety or terrorism concerns.
- AI impersonation or other harm to your rights.
- Hosted images or community listings that should not have been generated or published.

Reporting principles: we keep reporter identity confidential to the extent permitted by law; reports are reviewed on the merits; malicious false reports may themselves be treated as an AUP violation.

---

## 5. Reporting channels (dedicated)

Do **not** use the general support mailbox as your only path for AUP issues. Use one of these dedicated channels:

- **Report form (preferred):** [https://spoor.ink/report](https://spoor.ink/report)
- **AUP report mailbox:** [w978109720+aup@gmail.com](mailto:w978109720+aup@gmail.com) — put `[Spoor AUP]` in the subject and include URLs, timestamps, and a short description.
- **Appeals:** same mailbox with subject `[Spoor AUP appeal]`.

General product or billing questions remain at [w978109720@gmail.com](mailto:w978109720@gmail.com) and are not the AUP queue.

---

## 6. Response times

| Type | First response | Resolution target |
|---|---|---|
| L1 Severe | Within 2 hours | Within 24 hours |
| L2 High | Within 24 hours | Within 3 business days |
| L3 Medium | Within 3 business days | Within 7 business days |
| L4 Low | Within 5 business days | Within 15 business days |

If we need more time, we will say so. Flow: receipt (automatic acknowledgement where the form/mailer provides it) → severity grade → review → decision → enforcement → notice where we have a contact address.

---

## 7. Enforcement

We only list measures we can actually take:

| Step | Measure | Typical use |
|---|---|---|
| 1. Warning | Written warning | First L4 |
| 2. Removal | Delete or hide the generated/published item | Confirmed L3–L4 |
| 3. Feature limit | Reduce or pause hosted image/AI quota | Repeat L3 or a single L2 |
| 4. Suspension | Temporarily disable the account / hosted AI | L2 or accumulated breaches |
| 5. Permanent ban | Terminate access | L1 or repeated L2 |
| 6. Legal referral | Report to law enforcement and cooperate with investigations | Suspected illegal L1 |

---

## 8. Appeals

If you disagree with an enforcement decision, email [w978109720+aup@gmail.com](mailto:w978109720+aup@gmail.com) within **14 days** with subject `[Spoor AUP appeal]`, the original request id if we provided one, and why you believe the decision was wrong. A reviewer who did not make the original decision will re-check. We aim to finish appeals within **10 business days**.

---

## 9. Updates

We may update this AUP. Material changes will follow the same notice rules as the Terms of Service (email at least 14 days in advance where we have an account email). Continued use after the effective date is acceptance of the updated AUP.

---

## 10. Contact

- **AUP / report mailbox:** [w978109720+aup@gmail.com](mailto:w978109720+aup@gmail.com)
- **Report form:** [https://spoor.ink/report](https://spoor.ink/report)
- **Legal entity:** 灰阶法典（佛山）科技有限公司
- **Postal address:** 广东省佛山市禅城区
- **Website:** [https://spoor.ink](https://spoor.ink)
