export const fixtureCatalog = [
  { id: "studio-portrait", title: "Studio portrait", description: "A soft light portrait study.", kind: "image", section: "Photos", genre: "Portraits" },
  { id: "after-hours", title: "After hours", description: "A short cinematic mood preview.", kind: "video", section: "Clips", genre: "Performance", fullAssetId: "fixture-full-after-hours" },
  { id: "quiet-morning", title: "Quiet morning", description: "A glimpse behind the scenes.", kind: "image", section: "Behind the scenes", genre: "Everyday" },
  { id: "movement-study", title: "Movement study", description: "A second short preview clip.", kind: "video", section: "Clips", genre: "Everyday", fullAssetId: "fixture-full-movement-study" },
];

const sections = new Set(["Photos", "Clips", "Behind the scenes"]);
const genres = new Set(["Portraits", "Performance", "Everyday"]);

export class PortfolioFixture {
  constructor(creatorSlug = "adelaide", profileVersionId = "local-adelaide-v1", contactDestinations = {}) {
    this.creatorSlug = creatorSlug;
    this.profileVersionId = profileVersionId;
    this.contactDestinations = contactDestinations;
    this.items = new Map(fixtureCatalog.map((item) => [item.id, { ...item, selected: false, published: false, order: 0 }]));
    this.requests = [];
  }

  update(slug, id, { selected, section, genre, order }) {
    if (slug !== this.creatorSlug) return false;
    const item = this.items.get(id);
    if (!item || !sections.has(section) || !genres.has(genre) || !Number.isInteger(order) || order < 0 || order > 99) return false;
    item.selected = selected === true;
    item.section = section;
    item.genre = genre;
    item.order = order;
    if (!item.selected) item.published = false;
    return true;
  }

  publish(slug, id) {
    const item = slug === this.creatorSlug ? this.items.get(id) : null;
    if (!item || !item.selected) return false;
    item.published = true;
    return true;
  }

  withdraw(slug, id) {
    const item = slug === this.creatorSlug ? this.items.get(id) : null;
    if (!item) return false;
    item.published = false;
    return true;
  }

  projection(slug, versionId) {
    if (slug !== this.creatorSlug || versionId !== this.profileVersionId) return null;
    return {
      schemaVersion: 1,
      creatorSlug: slug,
      publishedProfileVersionId: versionId,
      cards: [...this.items.values()].filter((item) => item.published).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((item) => ({
        id: item.id, title: item.title, description: item.description, section: item.section, genre: item.genre, kind: item.kind,
        previewPath: `/portfolio-fixture/${slug}/${item.id}.${item.kind === "image" ? "svg" : "mp4"}`,
        ...(item.kind === "video" ? { posterPath: `/portfolio-fixture/${slug}/${item.id}.svg` } : {}),
      })),
    };
  }

  submitRequest(slug, { requestType, message, email, acknowledge }) {
    if (slug !== this.creatorSlug || !["photo", "clip", "other"].includes(requestType) ||
      typeof message !== "string" || message.trim().length < 10 || message.length > 800 ||
      typeof email !== "string" || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      acknowledge !== "yes") return false;
    this.requests.push({ requestType, message: message.trim(), email });
    return true;
  }

  prepareFullLengthContact(slug, { previewId, name, contactMethod, message }) {
    const item = slug === this.creatorSlug ? this.items.get(previewId) : null;
    if (!item?.published || item.kind !== "video" || !item.fullAssetId ||
      typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\r\n<>]/.test(name) ||
      typeof message !== "string" || message.trim().length < 10 || message.length > 800 ||
      !["telegram", "email"].includes(contactMethod)) return null;
    // Keep the private full-video relationship on the server. The visitor's
    // edited text cannot change the reference resolved from the preview ID.
    const preparedMessage = `${message.trim().replace(/\r\n?/g, "\n")}\n\nFrom: ${name.trim()}\nReference: ${item.id} — ${item.title}`;
    const destination = this.contactDestinations[contactMethod];
    let href = null;
    if (contactMethod === "email" && typeof destination === "string" && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(destination)) {
      href = `mailto:${destination}?subject=${encodeURIComponent(`Full-length request: ${item.title}`)}&body=${encodeURIComponent(preparedMessage.replace(/\n/g, "\r\n"))}`;
    }
    if (contactMethod === "telegram" && typeof destination === "string" && /^[A-Za-z0-9_]{5,32}$/.test(destination)) {
      href = `https://t.me/${destination}?text=${encodeURIComponent(preparedMessage)}`;
    }
    return { previewId: item.id, fullAssetId: item.fullAssetId, contactMethod, message: preparedMessage, href };
  }
}
