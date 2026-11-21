import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";
import { BRAND, ROUTES } from "@/config/brand";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="21 November 2026"
      intro={`These terms apply to your use of ${BRAND.name}: the website, terminal, AI analyst, data API and MCP server. By using them you agree to these terms.`}
      sections={[
        [
          "Information, not advice",
          <p key="i">
            Everything on {BRAND.name}, including prices, security scans, trader rankings and AI analyst answers, is general information. It is not investment, financial, legal or tax
            advice. Crypto assets are volatile and you can lose all of the money you put in. Make your own decisions and, where needed, ask a licensed advisor.
          </p>,
        ],
        [
          "Data accuracy",
          <p key="d">
            Market data comes from third parties and public blockchains and can be delayed, incomplete or wrong. Security scans flag known risk patterns; a clean scan does not mean a token
            is safe. AI answers can be mistaken. We provide the service &quot;as is&quot; without warranties.
          </p>,
        ],
        [
          "Your wallet and swaps",
          <p key="w">
            {BRAND.name} is non-custodial. You sign every transaction in your own wallet, and you are responsible for checking what you sign. Swaps are executed by third-party routers and
            DEXs; we do not control them and cannot reverse a transaction.
          </p>,
        ],
        [
          "Acceptable use",
          <ul key="u">
            <li>Do not break the law, including sanctions and securities laws that apply to you.</li>
            <li>Do not abuse, overload or try to break the service, or get around rate limits.</li>
            <li>Do not resell raw API data or share API keys outside your organization unless your plan allows it.</li>
          </ul>,
        ],
        [
          "API keys and plans",
          <p key="k">
            You are responsible for keeping your API keys secret and for usage made with them. Plan limits and prices are shown on the <Link href={ROUTES.dataApi}>Data API</Link> page and
            may change with notice. We may suspend keys that break these terms.
          </p>,
        ],
        [
          "Liability",
          <p key="l">
            To the extent the law allows, {BRAND.name} is not liable for trading losses, lost profits or indirect damages arising from use of the service, and our total liability is
            limited to the amount you paid us in the 12 months before the claim.
          </p>,
        ],
        [
          "Changes",
          <p key="c">We may update these terms. We will change the date above, and continuing to use the service means you accept the new terms.</p>,
        ],
        [
          "Contact",
          <p key="m">
            Questions: use the <Link href={`${ROUTES.dataApi}#contact`}>contact form</Link>. {BRAND.disclaimer}
          </p>,
        ],
      ]}
    />
  );
}
