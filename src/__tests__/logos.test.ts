import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    listItems: vi.fn(),
    getItem: vi.fn(),
    fetchUrlMetadata: vi.fn(),
    setItemFavicon: vi.fn().mockResolvedValue(undefined),
  },
}));

const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

function meta(id: string, checkedDaysAgo: number) {
  return { id, kind: "login", title: id, icon_checked_at: NOW - checkedDaysAgo * DAY };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { api } = await import("../lib/api");
  (api.getItem as any).mockImplementation((id: string) =>
    Promise.resolve({ type: "login", id, url: `https://${id}.com`, favicon: "" }),
  );
  (api.fetchUrlMetadata as any).mockResolvedValue({ title: null, favicon_data_url: "data:image/png;base64,new" });
});

describe("refreshSiteLogos", () => {
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
