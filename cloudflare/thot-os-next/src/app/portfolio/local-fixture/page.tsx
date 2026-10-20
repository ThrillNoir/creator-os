import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { PortfolioEditor } from "@/components/portfolio-editor";

function swatch(color: string, label: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="${color}"/><circle cx="400" cy="215" r="105" fill="#fff8"/><text x="400" y="435" text-anchor="middle" font-size="38" font-family="sans-serif" fill="#1d161a">${label}</text></svg>`)}`;
}

async function fixtureAction(_form: FormData) { "use server"; }

export default async function PortfolioLocalFixture() {
  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV !== "development" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
    process.env.PORTFOLIO_SYNTHETIC_PREVIEW !== "1") notFound();
  const categories = [{ id: "11111111-1111-4111-8111-111111111111", name: "Clips", sort_order: 0 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Photo sets", sort_order: 1 }];
  const cards = [
    { assetId: "synthetic-preview-1", basename: "Synthetic short clip.mp4", title: "A short clip", description: "A quick look at the collection.",
      categoryId: categories[0].id, fullLengthAssetId: null, video: true, legacy: false, safety: "nsfw" as const,
      sourceAvailable: true, mediaReady: true, previewKey: "synthetic-poster-1", imageUrl: swatch("#ffb0cc", "SYNTHETIC CLIP") },
    { assetId: "synthetic-photo-2", basename: "Synthetic portrait.jpg", title: "Portrait preview", description: "A sample photo card.",
      categoryId: categories[1].id, fullLengthAssetId: "synthetic-private-full", video: false, legacy: false, safety: "nsfw" as const,
      sourceAvailable: true, mediaReady: true, previewKey: "synthetic-preview-2", imageUrl: swatch("#b3e9cc", "SYNTHETIC PHOTO") },
  ];
  return <div className="os-cloud-shell"><main className="workspace" style={{ marginLeft: 0, maxWidth: 1440 }}>
    <PageHeader title="Portfolio" eyebrow="LOCAL SYNTHETIC FIXTURE" subtitle="This local review page uses invented cards and cannot publish or save real data." />
    <p className="portfolio-publish-attention">Synthetic review only. Buttons run no-op local actions.</p>
    <PortfolioEditor creatorName="Example Creator" revision={0} cards={cards} categories={categories}
      fullVideos={[{ id: "synthetic-private-full", basename: "Private full video.mp4" }]} canEdit publishingEnabled profileReady
      saveAction={fixtureAction} publishAction={fixtureAction} createCategoryAction={fixtureAction} renameCategoryAction={fixtureAction} synthetic />
  </main></div>;
}
