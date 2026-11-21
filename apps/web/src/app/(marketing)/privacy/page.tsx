import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";
import { BRAND, ROUTES } from "@/config/brand";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="21 November 2026"
      intro={`This policy explains what ${BRAND.name} collects when you use the website, terminal, data API and MCP server, why, and the choices you have. We collect as little as the product needs to work.`}
      sections={[
        [
          "What we collect",
          <ul key="c">
            <li>
              <b className="text-soft">Wallet sign-in.</b> When you sign in, we store your public wallet address and a session cookie. We never ask for, see or store your private key or seed
              phrase.
            </li>
            <li>
              <b className="text-soft">Your settings.</b> Watchlist items, alert rules, notification targets you add, and saved preferences.
            </li>
            <li>
              <b className="text-soft">API keys.</b> We store only a hash of each Data API key, plus usage counts per key for rate limits and billing.
            </li>
            <li>
              <b className="text-soft">Forms.</b> If you contact us, ask for a demo or apply for a job, we store what you submit (name, email, company, message) and the IP address of the request.
            </li>
            <li>
              <b className="text-soft">Swap records.</b> If you use the swap widget, we record the quote and the transaction hash. Swaps are signed in your own wallet; we never hold funds.
            </li>
            <li>
              <b className="text-soft">Server logs.</b> IP address, request path and time, kept for security and debugging.
            </li>
          </ul>,
        ],
        [
          "The AI analyst",
          <p key="a">
            The analyst runs in your browser with your own Anthropic API key. The key is saved only in your browser&apos;s local storage, and your questions go directly from your browser to
            Anthropic. Our servers do not receive or store your key or your conversations. Anthropic&apos;s own privacy terms apply to those requests.
          </p>,
        ],
        [
          "What we do not do",
          <ul key="n">
            <li>We do not sell personal data.</li>
            <li>We do not use advertising or third-party analytics trackers.</li>
            <li>Onchain data shown on the site (balances, trades, holders) is already public on the blockchain; we index it, we do not create it.</li>
          </ul>,
        ],
        [
          "Cookies",
          <p key="k">We use one essential session cookie to keep you signed in. There are no marketing cookies.</p>,
        ],
        [
          "Third parties",
          <p key="t">
            Market data comes from third-party providers and public blockchains. Article images may load from Unsplash. Payments, when enabled, are handled by Stripe, which receives the
            billing details you give it.
          </p>,
        ],
        [
          "Retention and your choices",
          <p key="r">
            You can remove watchlist items, alerts and API keys at any time from your account. To delete your account and the data linked to it, contact us and we will do it within 30 days,
            except where we must keep records for security or legal reasons.
          </p>,
        ],
        [
          "Contact",
          <p key="m">
            Questions about this policy: use the <Link href={`${ROUTES.dataApi}#contact`}>contact form</Link>.
          </p>,
        ],
      ]}
    />
  );
}
