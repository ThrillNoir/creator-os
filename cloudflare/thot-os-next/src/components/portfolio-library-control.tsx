import Link from "next/link";

export function PortfolioLibraryControl({ assetId, selected, available, canEdit, action, portfolioHref = "/portfolio", blockedReason }: {
  assetId: string; selected: boolean; available: boolean; canEdit: boolean;
  action: (form: FormData) => Promise<void>; portfolioHref?: string; blockedReason?: string;
}) {
  return <section className="panel portfolio-library-control"><div><h2>Add to Portfolio</h2>
    <p>{selected ? "This preview is in your private draft." : available ? "Add this photo or short clip to your private Portfolio draft." : blockedReason ?? "This item must finish verification before it can be added."} Adding it does not change your live More page. Set its category and layout in Portfolio.</p></div>
    {canEdit && (selected || available) && <form action={action}><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value={selected ? "remove" : "add"} />
      <button className={selected ? "secondary-action" : "primary"} type="submit">{selected ? "Remove from private draft" : "Add to portfolio"}</button></form>}
    {selected && <Link className="secondary-action" href={portfolioHref}>Open Portfolio layout →</Link>}
  </section>;
}
