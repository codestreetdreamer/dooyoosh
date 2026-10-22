# Payment providers for an Uzbekistan-registered fashion e-shop

Researched 2026-10-22 by Payments & Orders. Sources are official provider pages, provider docs, the Central Bank of Uzbekistan (CBU) and lex.uz, unless a row says otherwise.
**Rule used:** anything I could not confirm on a primary source is marked **UNVERIFIED**. Fees and terms are only what the provider publishes. Real contract terms come from their sales managers.

---

## TL;DR

| | Can a UZ entity onboard? | Uzcard/Humo | Visa/MC from UZ banks | Visa/MC **issued abroad** | Currencies | Sandbox | Integration style |
|---|---|---|---|---|---|---|---|
| **Payme Business** (АО «PAYME», CBU licence #3) | Yes: MChJ, YaTT and other legal forms. Self-employed only for QR/invoice | ✅ | ✅ | **UNVERIFIED** for Merchant API. Payme's newer "Payment API" docs say buyers from ~210 countries can pay (see notes) | UZS (Merchant API amounts in tiyin) | ✅ test.paycom.uz, uses `test_key` + Merchant ID from the cabinet | **Callbacks**: Payme calls our JSON-RPC (`CheckPerformTransaction`/`Create`/`Perform`/`Cancel`/`CheckTransaction`) + redirect to checkout.paycom.uz |
| **Click** (АО «Click», CBU licence #1) | Yes: self-employed, YaTT, MChJ/AJ. The self-employed tier is QR-only | ✅ | ✅ ("Visa domestic" 2.5%) | **UNVERIFIED**. The tariff only lists "Visa domestic" | UZS (`amount` in soums) | ✅ Click's emulator software for Prepare/Complete. Needs service_id/secret_key from contract | **Callbacks**: Click calls our `Prepare` (action=0) and `Complete` (action=1), MD5 `sign_string` |
| **Uzum Bank – Checkout** (bank) | Yes, via Uzum Bank Partners. Exact legal forms **UNVERIFIED** | ✅ | ✅ | **UNVERIFIED** | Spec takes an ISO 4217 code; every example uses 860 (UZS). Other currencies **UNVERIFIED** | ✅ Test cards in docs. Test keys come from an Uzum manager | **Redirect/hosted form** + server callbacks (retried up to 5×). Auto-fiscalization |
| **Octo** (Octo LLC × Octobank JSC) | Yes, but you **need an Octobank account**, KYC, a **.uz domain** and a **static IP** | ✅ 0.8% | ✅ 1.5%* | ✅ **3.5%** published* | `currency` param accepts e.g. USD, UZS, RUB | ✅ `"test": true` on `prepare_payment`. Creds from the octo.uz cabinet after bank KYC | **Redirect** (`octo_pay_url`) + `notify_url` callback, or a direct API |
| **ATMOS** (CBU licence #4) | Yes (application + manager) | ✅ | ✅ | ❌ FAQ says cards "issued by banks of the Republic of Uzbekistan" | UZS (amounts in tiyin) | ✅ "test environment" mentioned, creds from manager | API / hosted page / widget |
| **Paylov** (АО «Octagram», CBU licence #40) | Yes (merchant onboarding) | ✅ | ✅ | **UNVERIFIED**. Docs have a "Visa/Master **USD** payments" mode | UZS (860) or **USD (840)**, with optional CBU-rate conversion | Docs show sandbox consumer key/secret. How to get them: **UNVERIFIED** | **Redirect** payment link (my.paylov.uz) + `transaction.check`/`transaction.perform` callbacks (Basic auth) |
| Stripe | ❌ Uzbekistan not on the supported-countries list | – | – | – | – | – | – |
| PayPal | ❌ Uzbekistan not on PayPal's country list | – | – | – | – | – | – |
| Paddle | ❌ for us. UZ is allowed as a seller country, but **physical goods are prohibited** | – | – | – | – | – | – |
| 2Checkout (Verifone) | ⚠️ Possible. UZ isn't on the excluded lists, but underwriting is manual and physical goods are "on request" | ❌ | ✅ | ✅ | 100+ currencies | ✅ Demo mode | Hosted checkout (ConvertPlus) + IPN |
| Checkout.com | ❌/**UNVERIFIED**. No sign it onboards UZ entities (direct licences in APAC, MENAP, UK/EEA, US) | – | – | – | – | – | – |

\*Octo rates are from Octobank's own page (VISA/MC 3.5%, UZCARD/HUMO 0.8%). The split between UZ-issued (1.5%) and foreign-issued (3.5%) cards comes from frank.uz, a secondary aggregator.

---

## Recommendation (plain language)

### (a) Launch in Uzbekistan only (UZS)
1. **Use Payme first, Click second.** Almost every local buyer has one of the two apps. Both work the same way: they call our server to check and then confirm an order. That fits our design: reserve stock before redirecting, check the reservation in `Check`/`Prepare`, commit in `Perform`/`Complete`, and make every callback idempotent.
2. **Register as an MChJ (LLC) or a YaTT (sole trader).** Both can sign Payme and Click contracts. Self-employed status is not enough for a website with billing integration: Payme lets only legal entities including IP run online cashboxes, and Click's self-employed tier is QR-only. Money must land in the **business settlement account (расчётный счёт)**, not on a card.
3. **Fiscal receipts are mandatory**, so plan for them from day one (see Legal). Every product needs an **IKPU/MXIK code** (from tasnif.soliq.uz) and a VAT flag. Payme, Click and Uzum all fiscalize if we send that data.
4. **Optional third option:** Uzum Checkout, a hosted card form with built-in fiscalization. It's a backup if Payme or Click has an outage.

### (b) Accepting international cards (Visa/Mastercard issued abroad)
1. **Stripe, PayPal and Paddle are out** for a UZ entity. Stripe and PayPal don't support Uzbekistan, and Paddle bans physical goods.
2. **Best documented local option: Octo (Octobank).** It's the only UZ provider I found that **publishes a rate for foreign-issued Visa/MC (3.5%)** and documents a `currency` parameter including USD. What it costs us:
   - an Octobank account
   - bank KYC
   - a **.uz domain**
   - a **static IP**
   - a public offer page and a refund policy on the site
   - payouts within ~5 business days (per frank.uz)
3. **Ask before you sign:** Payme's newer "Payment API" docs (docs.payme.uz) say buyers from ~210 countries can pay with Visa/MC, list UZS among the currencies, and have Visa/MC test cards. These docs are white-labelled Flitt (they literally say "Explore the methods to integrate Flitt"). Whether a UZ merchant actually gets foreign-card acceptance on a Payme contract is **UNVERIFIED**. Ask Payme in writing. Ask Paylov the same about its "Visa/Master USD" mode.
4. **Alternative:** a second legal entity in a Stripe country (e.g. Poland or Estonia) just for international sales. That means extra tax, accounting and transfer-pricing work, so ask an accountant first.
5. **Legal check before taking USD from foreigners:** selling goods to non-residents is an export under UZ currency rules. The customs and currency-control steps for cross-border e-commerce shipments are **UNVERIFIED** here; ask your bank or a lawyer.

**Bottom line:** launch with **Payme + Click in UZS**, built behind our `PaymentProvider` interface. Add **Octo** (or Payme's Visa/MC product if they confirm it in writing) as the international-card adapter later. Nothing in the schema changes, because amounts are integer minor units with a `currency` column.

---

## Per-provider notes

### Payme Business (Paycom), АО «PAYME»
- **Who can connect:**
  - The cashbox docs list legal forms "ИП, ЧП, ФХ, ДХ, ХТ, ООО, СП ООО, ИП ООО, АО, …". So YaTT (ИП) and MChJ (ООО) are both OK.
  - The partner page also lists the self-employed, but only for QR/invoice products.
  - Source: https://business.help.paycom.uz/ and https://b2b-partner.payme.uz/ru/
- **Documents:** passport copy, registration certificate (guvohnoma), VAT certificate if you have one. An online contract needs scans. (b2b-partner.payme.uz/ru)
- **Steps:** register in Payme Business → add the business → sign the contract with АО «PAYME» → add a cashbox ("with billing" for an online store). (business.help.paycom.uz)
- **Cards:**
  - Payme help says UZCARD, HUMO, VISA and Master. The partner FAQ says "any card the buyer has in Payme".
  - Foreign-issued cards on the Merchant API: **UNVERIFIED**.
- **Fees (partner page, undated):** the page shows these rates: 1% (on-site QR), 1% (payme GO), **2%** (online with billing/E-Commerce) and **1.5%** (online without billing). The table's layout is garbled, so which rate goes with which product is **UNVERIFIED**. Confirm with Payme. The page promises connection and the first 3 months of service free. (b2b-partner.payme.uz/ru)
- **Payout:** to the settlement account within 1 banking day. A corporate card is not allowed "by law". (b2b-partner.payme.uz/ru)
- **Integration:**
  - The Merchant API is JSON-RPC 2.0 over HTTPS, and we must always return **HTTP 200**. Errors go in the JSON body; a non-200 response counts as error -32400.
  - Methods: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`.
  - Checkout opens via a GET/POST "чек" to checkout.paycom.uz.
  - Sources: https://developer.help.paycom.uz/protokol-merchant-api/ , https://developer.help.paycom.uz/metody-merchant-api/ , https://developer.help.paycom.uz/initsializatsiya-platezhey/
- **Sandbox:** https://test.paycom.uz/instruction
  - You need the **Merchant ID** of a cashbox created in the Payme Business cabinet. Auth uses **`test_key`**.
  - Required scenarios: create→cancel, create→perform, create→perform→cancel, bad auth, non-existent account. Use a "one-time account" (одноразовый счёт) for store orders.
  - So **we need at least a cabinet and a cashbox to get a Merchant ID**. Until then we build against a local mock.
- **Payme "Payment API" (docs.payme.uz):**
  - A separate, Flitt-based API with redirect, embedded and direct modes, plus callbacks (retries at 2s, 60s, 300s, 600s, 3600s, 86400s) and SHA1 signatures.
  - It serves partners in Georgia, Uzbekistan, Moldova, Armenia and Kazakhstan, and says buyers can pay "from all countries where Visa and MasterCard cards are issued".
  - The public test merchant is `4056281` with secret `test`. Test cards cover Humo, Uzcard, Visa and MC.
  - How this product relates to the Payme Business contract and its pricing: **UNVERIFIED**.
  - Sources: https://docs.payme.uz/supported-countries/ , https://docs.payme.uz/api/testing/ , https://docs.payme.uz/api/order-parameters/ , https://docs.payme.uz/api/callbacks/

### Click, АО «Click»
- **Who can connect:** "Self-employed individuals, individual entrepreneurs (IE), legal entities (LLC, JSC)". The self-employed tier accepts payments without a contract, via QR. (https://business.click.uz/en)
- **Documents:**
  - director's passport copy
  - guvohnoma
  - an active business bank account with its MFO code
  - PSIC (IKPU), VAT, receipt type and unit of measure, which they need to set up fiscalization
  - The contract is signed via **Didox** with an e-signature, or on paper. (business.click.uz/en)
- **Fees (business.click.uz, read 2026-10-22):**
  - Website integration: Uzcard/Humo **1.5–2.5%**, Visa domestic **2.5%**
  - "Billing/Integration – Goods": **2%**, Visa domestic **2.5%**
- **Cards:** the tariff only names **"Visa domestic"**. Foreign-issued cards: **UNVERIFIED** (probably not).
- **Integration:** SHOP API. Click calls our **Prepare** (action=0) and **Complete** (action=1) URLs.
  - Signature: `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)`. Complete swaps in `merchant_prepare_id`.
  - Click's docs tell online shops to **reserve the goods at Prepare**.
  - Credentials (merchant_id, service_id, merchant_user_id, secret_key) are issued on registration.
  - Sources: https://docs.click.uz/en/click-api-request/ , https://docs.click.uz/en/merchant-api-request/
- **Sandbox:** Click provides emulator software that plays the Prepare/Complete scenarios against our URLs. https://docs.click.uz/click-api-testing/
- **Static IP / TAS-IX:** if our server is outside TAS-IX, we must give Click our domain, IP and port for firewall allow-listing. This comes from secondary sources (a GitHub skill file and the Odoo app page), so it's **UNVERIFIED** on docs.click.uz. **Risk for Vercel:** inbound IPs aren't fixed per project. Confirm with Click.
- **Terms:** Typical Conditions v3.3, https://click.uz/click/click_terms_ru.pdf. The merchant must pass connection testing (Annex 1) and provide documents (Annex 3).

### Uzum Bank – Checkout / Merchant API
- **Partner page:** https://merchants.uzumbank.uz/ru/
  - "Online by API" lets buyers pay with Uzum, Humo, Uzcard, Visa and MasterCard.
  - Published fee only for **Uzum to'lov QR**: Uzum card 0%, other banks 0.4%. **No published e-commerce rate.**
- **Docs:** https://developer.uzumbank.uz/en/checkout (Uzum Checkout v1.10.3)
  - Hosted form, one-step and two-step payments, card binding, refunds, and **automatic receipt fiscalization** on one-step payments.
  - Auth with `X-Terminal-Id` + `X-API-Key`.
  - `currency` is an ISO 4217 code ("Uzbek sum is UZS – 860").
  - Session lasts 600–1800 s.
  - Callbacks must get HTTP 200, otherwise they're retried up to 5×.
  - Test cards: HUMO `9860 0901 0121 9724`, UzCard `8600 3129 2957 7175`, 3-DS code `777777`.
  - Test/production access is given after testing.
- **Merchant API** (https://developer.uzumbank.uz/en/merchant): for payments inside the Uzum app. Webhooks `/check`, `/create`, `/confirm`, `/reverse`, `/status`, with Basic auth.
- Required documents, legal forms and foreign cards: **UNVERIFIED**.

### Octo (Octobank)
- **Requirements** (Octobank's own procedure PDF, https://octobank.uz/assets/components/table_07/protsedura_podklyucheniya_internet_ekvayringa.pdf):
  - merchant offer + KYC/compliance → octo.uz cabinet → test integration via help.octo.uz → the bank checks the tests → production
  - **static IP**, HTTPS + SSL, proof of domain ownership, a **site in the .UZ zone**
  - card-brand logos on the site
  - a customer registration form, an offer-acceptance checkbox before "Pay", and a public offer covering ordering, payment, returns/refunds, delivery, security and privacy
- **Account:** "you must have a bank account with Octobank JSC". You also need a registered UZ legal entity. (https://octobank.uz/en/for-business/e-commerce)
- **Fees:**
  - Octobank page: VISA/MasterCard 3.5%, UZCARD/HUMO 0.8%
  - frank.uz (secondary): foreign-issued Visa/MC/UnionPay 3.5%, UZ-issued Visa/MC 1.5%, Apple/Google Pay 3.5%, payout within 5 business days (https://frank.uz/en/banks/octobank/acquiring/internet-ekvayring-octo)
- **API** (https://help.octo.uz/en/payment-via-web/one-stage.html):
  - `POST https://secure.octo.uz/prepare_payment` with `octo_shop_id`, `octo_secret`, `shop_transaction_id` (dedup), `currency` ("USD, UZS, RUB"), `basket` with `spic`/`package_code`/`inn`/`nds` for fiscalization, `notify_url`, `return_url` and `ttl`
  - set **`"test": true`** for test transactions
  - returns `octo_pay_url` for the redirect
  - one-stage or two-stage (`auto_capture`)

### ATMOS (АО «National Innovative Payment Technologies»)
- https://atmos.uz/en/faq says it accepts Uzcard, HUMO, Visa and Mastercard **"issued by banks of the Republic of Uzbekistan"**, plus Click, Payme and Uzum as methods. Fees are custom ("commercial proposal"). They offer an API, a hosted page and a widget, and go through testing before going live.
- So ATMOS is not the answer for foreign cards.

### Paylov (АО «Octagram»)
- Docs: https://developer.paylov.uz/merchants/paylov-payment-gateway and https://developer.paylov.uz/merchants/creating-payment-link
  - We register a callback URL. Paylov calls it with Basic auth for `transaction.check` and `transaction.perform`.
  - The payment link is `https://my.paylov.uz/checkout/create/{base64(query)}`.
  - `currency_id` 860 = UZS or 840 = USD, with `convert_to` at the CBU rate. A specific "Visa/Master USD payments" parameter set is documented.
  - There's also an OFD/fiscalization API.
- Fees, documents and foreign issuance: **UNVERIFIED**.

### Non-UZ providers
- **Stripe:** https://stripe.com/global (read 2026-10-22). The supported-country list has no Uzbekistan (it does list Poland, Estonia and the UAE). The page says "Payments not supported yet" for businesses outside the list.
- **PayPal:** PayPal's country list (https://www.paypal.com/webapps/mpp/country-worldwide) includes Kazakhstan, Kyrgyzstan and Tajikistan but **not Uzbekistan**. paypal.com/uz serves the US site.
- **Paddle:** Uzbekistan is not on the unsupported-seller list (https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle). But the AUP, updated 13 Apr 2026, lists **"Physical products or products that require physical delivery"** as prohibited (https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle). Not usable.
- **2Checkout/Verifone:**
  - Restricted jurisdictions: Cuba, Iran, North Korea, Syria, Crimea, Donetsk, Luhansk.
  - PSP merchants not accepted from a list that includes Tajikistan and Turkmenistan but **not Uzbekistan** (https://docs.2checkout.com/get-started/getting-started/help-and-faqs).
  - Physical goods are "available upon request". Every account starts in **demo mode**.
  - Approval for a UZ fashion shop and the payout mechanics: **UNVERIFIED**.
- **Checkout.com:** "Direct acquiring licenses in APAC, MENAP, UK and EEA, and the US", 57 domestic processing countries (https://www.checkout.com/solutions/international-coverage). It's enterprise-sales only, and I found **no evidence** it onboards UZ-registered merchants (**UNVERIFIED**, likely no).

---

## Central Bank register (who is licensed)
CBU "Реестр платёжных организаций", sheet dated **01.04.2026**, file last modified 16 Jun 2026: https://cbu.uz/ru/payment-systems/registers/payment-organizations/

| Brand | Company | Licence | Issued |
|---|---|---|---|
| Click | АО "Click" | #1 | 28.03.2020 |
| Payme | АО "PAYME" | #3 | 04.04.2020 |
| ATMOS | AO "National Innovative Payment Technologies" | #4 | 04.04.2020 |
| Paylov | AO "OCTAGRAM" | #40 | 10.03.2022 |
| Multicard | AO "MULTICARD PAYMENT" | #26 | – |
| Paynet | AO "PAYNET" | #35 | – |
| Uzum Nasiya | АО "SOLUTIONS LAB" | #36 | – |

Uzum Bank and Octobank are banks, so they don't appear in this register.

---

## Legal requirements that affect the build

1. **Fiscal receipt (virtual cash register / OFD)**
   - The E-commerce Law (ZRU-792, 29.09.2022), https://lex.uz/docs/6213428:
     - sales must go through a **virtual cash register** that sends settlement data to the tax authority online
     - for electronic payments, the **electronic receipt must be sent to the buyer** by phone number, email or personal account
   - CM Resolution 943 (23.11.2019) requires online cash registers or virtual cash systems to be in the state register: https://www.lex.uz/acts/4603329
   - **Impact on our code:**
     - every SKU needs an **IKPU/MXIK code** (tasnif.soliq.uz), a package/unit code and a VAT flag
     - we send the basket to the provider (Payme `detail`, Click fiscal settings, Octo `basket`, Uzum auto-fiscalization) or to our own OFD
     - we store the receipt URL on the order
     - refunds need a refund receipt
2. **Separate bank accounts for e-commerce**
   - PD/Resolution №885 of 26.12.2024 (https://lex.uz/en/docs/7285113) says **self-employed** e-commerce sellers must settle "exclusively using separate bank accounts".
   - It's one more reason to use a YaTT or MChJ with a proper settlement account.
3. **Personal-data localisation (Law "On personal data", art. 27¹)**
   - **Article 27¹ was rewritten** by ZRU-1125 of **26.03.2026**, in force from publication on **27.03.2026**: https://lex.uz/docs/8104580 and the current text at https://lex.uz/docs/4396419 (edition dated 12.09.2026)
   - **Only these must be stored in Uzbekistan:**
     - biometric data
     - genetic data
     - data of telecom operators' users
   - **Any other personal data may be stored or processed abroad if one of these holds:**
     - (a) the country is recognised as giving equal protection (the Cabinet of Ministers keeps the list)
     - (b) the operator adopts standard contractual clauses or binding corporate rules approved by the authorised body
     - (c) the operator complies with international data-management standards on the authorised body's list
   - Databases that must be stored in Uzbekistan must also be registered in the State Register of personal-data databases (art. 20, as amended by the same law).
   - **What this means for us:** customer names, addresses and phones in **Frankfurt Supabase are not automatically illegal** any more. But we must meet one of (a), (b) or (c). Whether Germany or the EU is on the Cabinet list is **UNVERIFIED**. A lawyer should confirm which route applies before launch. *(This updates Backend & Database's earlier warning, which matched the pre-2026 wording.)*

---

## What I need from Mirfozil (for the deploy checklist)
1. Legal form: **MChJ or YaTT**, with a settlement account (bank + MFO).
2. Apply to **Payme Business** (cashbox "with billing") → send me the **Merchant ID + test_key** in our 1:1 chat, not the group.
3. Apply to **Click** → send me **merchant_id, service_id, merchant_user_id, secret_key**, 1:1.
4. IKPU/MXIK codes for the product categories (clothing), and whether you pay VAT.
5. If you want foreign cards: ask **Octobank** (and Payme, about their Visa/MC "Payment API") for written confirmation that foreign-issued cards and USD work for a fashion shop, and their exact rate. Note that Octo requires a **.uz domain** and a **static IP**.
6. A lawyer's sign-off on personal-data storage under the new art. 27¹.

Until those arrive, the code runs **only against local mocks and provider sandboxes**. No live keys, no real charges.
