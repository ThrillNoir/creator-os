import Link from "next/link";
import { ArrowLeft, CheckCircle2, FilePlus2, UsersRound } from "lucide-react";
import { createPostAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { MediaFilterBar, EmptyState } from "@/components/media-workflow";
import { MediaPicker } from "@/components/media-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAccounts, getLibraryAssets, getPeople } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

const supportedDestinations = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["threads", "Threads"],
  ["tiktok", "TikTok"],
  ["x", "X"],
  ["youtube", "YouTube"],
  ["reddit", "Reddit"],
  ["myroomz", "MyRoomz"],
  ["onlyfans", "OnlyFans"],
  ["fansly", "Fansly"],
] as const;

function destinationLabel(platform: string) {
  return supportedDestinations.find(([value]) => value === platform)?.[1] ?? platform;
}

function handleForPlatform(tags: string, platform: string) {
  return tags.split(" · ").find((tag) => tag.startsWith(`${platform}:`))?.slice(platform.length + 1) || "";
}

function StepHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="media-step-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; safety?: string; trait?: string; platform?: string; missing?: string }> }) {
  const { q = "", type = "all", safety = "", trait = "", platform = "", missing = "" } = await searchParams;
  const creator = await getActiveCreator();
  const mediaType = type === "photos" || type === "videos" ? type : "all";
  const destination = platform === "onlyfans" || platform === "fansly" ? "subscription" : ["instagram", "facebook", "threads", "tiktok", "x", "reddit"].includes(platform) ? platform : "";
  const assets = getLibraryAssets({ creatorId: creator.id, query: q, mediaType, safety, trait, destination, limit: 120 });
  const accounts = getAccounts(creator.id);
  const people = getPeople(creator.id);
  const configuredPlatforms = new Set(accounts.map((account) => account.platform));
  const missingDestinations = supportedDestinations.filter(([candidate]) => !configuredPlatforms.has(candidate));
  const missingFields = new Set(missing.split(",").filter(Boolean));
  const queryFor = (next: Record<string, string>) => new URLSearchParams({
    ...(q ? { q } : {}),
    ...(mediaType !== "all" ? { type: mediaType } : {}),
    ...(safety ? { safety } : {}),
    ...(trait ? { trait } : {}),
    ...(platform ? { platform } : {}),
    ...next,
  }).toString();

  return (
    <AppShell active="Content library">
      <section className="workspace media-workspace media-builder-workspace">
        <PageHeader
          eyebrow={platform ? `${creator.name} · ${destinationLabel(platform)} draft builder` : `${creator.name} · post builder`}
          title={platform ? `Prepare ${destinationLabel(platform)} drafts` : "Prepare content"}
          description="Choose suitable source media, add human context, then create separate local drafts for every destination. Nothing publishes from this screen."
          actions={<Button asChild size="sm" variant="secondary"><Link href="/library"><ArrowLeft aria-hidden="true" />Back to library</Link></Button>}
        />

        {missingFields.size > 0 ? <div className="media-notice media-notice-error" role="alert">Choose {[missingFields.has("asset") ? "at least one asset" : "", missingFields.has("destination") ? "a destination" : "", missingFields.has("notes") ? "creator notes" : ""].filter(Boolean).join(", ")} before creating drafts.</div> : null}

        <ol className="media-builder-steps" aria-label="Draft preparation steps">
          <li><span>1</span>Choose media</li>
          <li><span>2</span>Choose destinations</li>
          <li><span>3</span>Add context</li>
          <li><span>4</span>Create drafts</li>
        </ol>

        <div className="media-library-controls media-builder-controls">
          <nav className="media-tabs" aria-label="Media type">
            {[["all", "All"], ["photos", "Photos"], ["videos", "Videos"]].map(([value, label]) => <Link className={mediaType === value ? "active" : ""} href={`/content/new?${queryFor({ type: value === "all" ? "" : value })}`} key={value}>{label}</Link>)}
          </nav>
        </div>

        <MediaFilterBar includeDestination={false} includeUsage={false} mediaType={mediaType} platform={platform} query={q} safety={safety} trait={trait} />

        <form action={createPostAction} className="media-builder-form">
          <Card className="media-builder-panel">
            <CardHeader>
              <StepHeading description={`${assets.length} assets match the current filters. Your selection is retained while you refine them.`} number="1" title="Choose existing media" />
            </CardHeader>
            <CardContent>
              {!assets.length ? <EmptyState description="Clear or adjust the Library filters to continue choosing existing source media. Existing selections remain available below." title="No suitable assets found" /> : null}
              <MediaPicker
                key={`${creator.id}:${platform || "all"}`}
                assets={assets}
                creatorId={creator.id}
                selectionScope={platform || "all"}
              />
            </CardContent>
          </Card>

          <Card className="media-builder-panel">
            <CardHeader>
              <StepHeading description="Each account receives its own local draft variant. Creating drafts does not publish to any platform." number="2" title="Choose destinations" />
            </CardHeader>
            <CardContent className="media-builder-choice-layout">
              <fieldset className="media-choice-field">
                <legend>Destination accounts <span>(choose at least one)</span></legend>
                <div className="media-account-choices">
                  {accounts.filter((account) => !platform || account.platform === platform).map((account) => <label className="media-account-choice" key={account.id}>
                    <input defaultChecked={Boolean(platform && account.platform === platform)} name="accountIds" type="checkbox" value={account.id} />
                    <span><strong>{account.label}</strong><small>{destinationLabel(account.platform)} · {account.handle}</small></span>
                  </label>)}
                </div>
                {!accounts.filter((account) => !platform || account.platform === platform).length ? <p className="media-field-note">No connected {platform ? destinationLabel(platform) : "destination"} accounts are available for this creator.</p> : null}
                {!platform && missingDestinations.length > 0 ? <div className="media-supported-destinations"><strong>Also supported</strong>{missingDestinations.map(([missingPlatform, label]) => <Link href={`/creators/${creator.id}#destination-setup`} key={missingPlatform}>Add {label}</Link>)}</div> : null}
              </fieldset>

              <fieldset className="media-choice-field">
                <legend>Creator friends present <span>(optional)</span></legend>
                <div className="media-account-choices">
                  {people.map((person) => {
                    const relevantHandle = platform ? handleForPlatform(person.tags, platform) : "";
                    return <label className="media-account-choice" key={person.id}>
                      <input name="personIds" type="checkbox" value={person.id} />
                      <span><strong>{person.stage_name || person.display_name}</strong><small>{platform ? (relevantHandle ? `${destinationLabel(platform)} · ${relevantHandle}` : `No ${destinationLabel(platform)} handle recorded`) : (person.tags || "No handles recorded")}</small><em>Consent: {person.consent_status.replaceAll("_", " ")} · Tagging: {person.tagging_preference.replaceAll("_", " ")}</em></span>
                    </label>;
                  })}
                  {!people.length ? <Link className="media-add-person-link" href="/people"><UsersRound aria-hidden="true" />Add creator friends and recorded preferences first</Link> : null}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card className="media-builder-panel">
            <CardHeader>
              <StepHeading description="This information guides local caption drafting and review. It does not add assumptions to the creator’s story." number="3" title="Add creator context" />
            </CardHeader>
            <CardContent className="media-context-fields">
              <div>
                <Label htmlFor="creator-notes">Creator notes</Label>
                <Textarea id="creator-notes" name="creatorNotes" placeholder="Describe the confirmed context, location, people present, and any handling notes for the managing agent." required />
              </div>
              <div>
                <Label htmlFor="scheduled-at">Planned time <span className="media-optional">(optional)</span></Label>
                <Input id="scheduled-at" name="scheduledAt" type="datetime-local" />
                <p>Leave blank to keep the resulting drafts unscheduled.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="media-builder-review" variant="quiet">
            <CardContent>
              <div><CheckCircle2 aria-hidden="true" /><div><CardTitle>Review and create local drafts</CardTitle><CardDescription>The selected media and destinations will create independent draft variants that return to human approval. Nothing is published from this action.</CardDescription></div></div>
              <Button size="lg" type="submit"><FilePlus2 aria-hidden="true" />Create platform drafts</Button>
            </CardContent>
          </Card>
        </form>
      </section>
    </AppShell>
  );
}
