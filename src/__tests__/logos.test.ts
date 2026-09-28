import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    listItems: vi.fn(),
    getItem: vi.fn(),
    fetchUrlMetadata: vi.fn(),
    setItemFavicon: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn(),
  },
}));

const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

function meta(id: string, checkedDaysAgo: number) {
  // The list carries the URL: the refresh never fetches a whole item (and
  // its password) just to read it.
  return { id, kind: "login", title: id, url: `https://${id}.com`, favicon: "", icon_checked_at: NOW - checkedDaysAgo * DAY };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { api } = await import("../lib/api");
  (api.getItem as any).mockImplementation((id: string) =>
    Promise.resolve({ type: "login", id, url: `https://${id}.com`, favicon: "" }),
  );
  (api.fetchUrlMetadata as any).mockResolvedValue({ title: null, favicon_data_url: "data:image/png;base64,new" });
  // Most cases here are about the age check, so they opt in explicitly; the
  // real default is false and has its own test below.
  (api.getConfig as any).mockResolvedValue({ autolock_mins: 15, auto_refresh_icons: true });
});

it("never loads a whole item to find its URL", async () => {
  const { api } = await import("../lib/api");
  const { refreshSiteLogos } = await import("../lib/logos");
  (api.listItems as any).mockResolvedValue([meta("stale", 45)]);
  await refreshSiteLogos(true);
  expect(api.fetchUrlMetadata).toHaveBeenCalledWith("https://stale.com");
  expect(api.getItem).not.toHaveBeenCalled();
});

describe("refreshSiteLogos", () => {
  it("contacts nothing when the automatic refresh is off, which is the default", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.getConfig as any).mockResolvedValue({ autolock_mins: 15, auto_refresh_icons: false });
    (api.listItems as any).mockResolvedValue([meta("stale", 45)]);

    const [updated, checked] = await refreshSiteLogos();

    expect([updated, checked]).toEqual([0, 0]);
    // Nothing may leave the machine: a request per stale login is the vault's
    // account list handed to the network, timestamped to the unlock.
    expect(api.fetchUrlMetadata).not.toHaveBeenCalled();
    expect(api.listItems).not.toHaveBeenCalled();
  });

  it("still honours the Settings button while the automatic refresh is off", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.getConfig as any).mockResolvedValue({ autolock_mins: 15, auto_refresh_icons: false });
    (api.listItems as any).mockResolvedValue([meta("stale", 45)]);

    const [, checked] = await refreshSiteLogos(true);

    expect(checked).toBe(1);
    expect(api.fetchUrlMetadata).toHaveBeenCalledTimes(1);
  });

  it("skips icons checked inside the last 30 days", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.listItems as any).mockResolvedValue([meta("fresh", 3), meta("stale", 45)]);
    const [updated, checked] = await refreshSiteLogos();
    expect(checked).toBe(1);
    expect(updated).toBe(1);
    expect(api.fetchUrlMetadata).toHaveBeenCalledTimes(1);
    expect(api.fetchUrlMetadata).toHaveBeenCalledWith("https://stale.com");
  });

  it("force re-checks everything, for the Settings button", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.listItems as any).mockResolvedValue([meta("fresh", 3), meta("stale", 45)]);
    const [, checked] = await refreshSiteLogos(true);
    expect(checked).toBe(2);
    expect(api.fetchUrlMetadata).toHaveBeenCalledTimes(2);
  });

  it("stamps a site that returned no icon so it is not retried tomorrow", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.listItems as any).mockResolvedValue([meta("noicon", 45)]);
    (api.fetchUrlMetadata as any).mockResolvedValue({ title: null, favicon_data_url: null });
    const [updated] = await refreshSiteLogos();
    expect(updated).toBe(0);
    expect(api.setItemFavicon).toHaveBeenCalledWith("noicon", null);
  });
});

describe("progress and new logins", () => {
  it("reports each site as it is checked", async () => {
    const { api } = await import("../lib/api");
    const { refreshSiteLogos } = await import("../lib/logos");
    (api.listItems as any).mockResolvedValue([meta("a", 0), meta("b", 0)]);
    const seen: [number, number][] = [];
    await refreshSiteLogos(true, (d, t) => seen.push([d, t]));
    expect(seen).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("fetches only logins never looked up, even with the automatic refresh off", async () => {
    const { api } = await import("../lib/api");
    const { fetchMissingLogos } = await import("../lib/logos");
    (api.getConfig as any).mockResolvedValue({ autolock_mins: 15, auto_refresh_icons: false });
    (api.listItems as any).mockResolvedValue([
      { ...meta("new", 0), host: "new.com", favicon: "", icon_checked_at: 0 },
      { ...meta("old", 40), host: "old.com", favicon: "" },
      { ...meta("has", 0), host: "has.com", favicon: "data:x", icon_checked_at: 0 },
    ]);
    expect(await fetchMissingLogos()).toBe(1);
    expect(api.fetchUrlMetadata).toHaveBeenCalledTimes(1);
    expect(api.fetchUrlMetadata).toHaveBeenCalledWith("https://new.com");
  });
});

describe("logoFor", () => {
  it("finds a saved login's logo for the approved host or its parent site", async () => {
    const { logoFor } = await import("../components/ApprovedSites");
    const logos = { "google.com": "g", "twitch.tv": "t" };
    expect(logoFor("twitch.tv", logos)).toBe("t");
    expect(logoFor("accounts.google.com", logos)).toBe("g");
    expect(logoFor("github.com", logos)).toBe("");
  });
});
