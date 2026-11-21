import { notFound } from "next/navigation";
import { WalletView } from "@/components/wallet/WalletView";
import { shortAddr } from "@/lib/format";

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return { title: `Wallet ${shortAddr(address, 4, 4)}` };
}

export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!SOL.test(address) && !EVM.test(address)) notFound();
  return <WalletView address={EVM.test(address) ? address.toLowerCase() : address} />;
}
