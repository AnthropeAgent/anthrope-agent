import { PeakModule } from "../PeakModule";

export default async function PeakModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return <PeakModule slug={module} />;
}
