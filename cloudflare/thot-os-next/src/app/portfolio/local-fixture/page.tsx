import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { PortfolioEditor } from "@/components/portfolio-editor";

function swatch(color: string, label: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="${color}"/><circle cx="400" cy="215" r="105" fill="#fff8"/><text x="400" y="435" text-anchor="middle" font-size="38" font-family="sans-serif" fill="#1d161a">${label}</text></svg>`)}`;
}

async function fixtureAction(_form: FormData) { "use server"; }

export default async function PortfolioLocalFixture({ searchParams }: { searchParams: Promise<{ from?: string; categoryId?: string; newCategoryName?: string; fullLengthAssetId?: string }> }) {
  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV !== "development" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
    process.env.PORTFOLIO_SYNTHETIC_PREVIEW !== "1") notFound();
  const query = await searchParams;
  const fromLibrary = query.from === "library";
  const categories = [{ id: "11111111-1111-4111-8111-111111111111", name: "Clips", sort_order: 0 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Photo sets", sort_order: 1 }];
  const newCategoryId = "33333333-3333-4333-8333-333333333333";
  if (query.categoryId === newCategoryId && query.newCategoryName && query.newCategoryName.length <= 50 && !/[<>]/.test(query.newCategoryName)) {
    categories.push({ id: newCategoryId, name: query.newCategoryName, sort_order: 2 });
  }
  const selectedCategoryId = categories.some((category) => category.id === query.categoryId) ? query.categoryId! : categories[0].id;
  const selectedFullLengthId = query.fullLengthAssetId === "synthetic-private-full" ? query.fullLengthAssetId : null;
  const libraryQuery = new URLSearchParams({ safety: "nsfw", added: "1", categoryId: selectedCategoryId });
  if (selectedCategoryId === newCategoryId) libraryQuery.set("newCategoryName", categories[2].name);
  if (selectedFullLengthId) libraryQuery.set("fullLengthAssetId", selectedFullLengthId);
  const cards = [
    { assetId: "synthetic-preview-1", basename: "Synthetic short clip.mp4", title: "A short clip", description: "A quick look at the collection.",
      categoryId: fromLibrary ? selectedCategoryId : categories[0].id, fullLengthAssetId: fromLibrary ? selectedFullLengthId : null, video: true, legacy: false, safety: "nsfw" as const,
      sourceAvailable: true, mediaReady: true, previewKey: "synthetic-poster-1", imageUrl: swatch("#ffb0cc", "SYNTHETIC CLIP") },
    { assetId: "synthetic-photo-2", basename: "Synthetic portrait.jpg", title: "Portrait preview", description: "A sample photo card.",
      categoryId: categories[1].id, fullLengthAssetId: "synthetic-private-full", video: false, legacy: false, safety: "nsfw" as const,
      sourceAvailable: true, mediaReady: true, previewKey: "synthetic-preview-2", imageUrl: swatch("#b3e9cc", "SYNTHETIC PHOTO") },
  ];
  return <div className="os-cloud-shell"><main className="workspace" style={{ marginLeft: 0, maxWidth: 1440 }}>
    <PageHeader title="Portfolio" eyebrow="LOCAL SYNTHETIC FIXTURE" subtitle="This local review page uses invented cards and cannot publish or save real data." />
    <p className="portfolio-publish-attention">Synthetic review only. Buttons run no-op local actions; no creator data is saved or published. {fromLibrary ? "The category and optional private full video below came from the one-step Library selection." : ""}</p>
    {fromLibrary && <Link className="secondary-action" href={`/library/local-fixture?${libraryQuery}`}>← Back to synthetic Library asset</Link>}
    <PortfolioEditor creatorName="Example Creator" revision={0} cards={fromLibrary ? cards.slice(0, 1) : cards} categories={categories}
      fullVideos={[{ id: "synthetic-private-full", basename: "Private full video.mp4" }]} canEdit publishingEnabled profileReady
      saveAction={fixtureAction} publishAction={fixtureAction} createCategoryAction={fixtureAction} renameCategoryAction={fixtureAction} synthetic />
  </main></div>;
}
