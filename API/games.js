export default async function handler(req, res) {
  const rawgKey = process.env.RAWG_API_KEY;
  const { month } = req.query;

  const now = month ? new Date(month + "-01") : new Date();
  const year = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
  const dateFrom = `${year}-${m}-01`;
  const dateTo   = `${year}-${m}-${daysInMonth}`;

  const rawgUrl = `https://api.rawg.io/api/games?key=${rawgKey}&dates=${dateFrom},${dateTo}&ordering=released&page_size=40&exclude_additions=true`;

  let rawgGames = [];
  try {
    const res_rawg  = await fetch(rawgUrl);
    const data = await res_rawg.json();
    rawgGames  = data.results || [];
  } catch (e) {
    return res.status(500).json({ error: "RAWG fetch failed", detail: e.message });
  }

  if (rawgGames.length === 0) {
    return res.status(200).json({ debug: "rawg_empty", dateFrom, dateTo, results: [] });
  }

  const PLATFORM_MAP = {
    "pc": "PC", "playstation4": "PS4", "playstation5": "PS5",
    "xbox-one": "XBO", "xbox-series-x": "XSX", "nintendo-switch": "NS",
    "macos": "PC", "linux": "PC", "ios": "IOS", "android": "Android"
  };

  const results = rawgGames.map((g, idx) => {
    const steamStore = (g.stores || []).find(s => s.store?.slug === "steam");
    const steamId = steamStore?.url?.match(/\/app\/(\d+)/)?.[1] || null;

    const platforms = (g.platforms || [])
      .map(p => PLATFORM_MAP[p.platform?.slug] || null)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    return {
      id: g.id || idx,
      title: g.name,
      date: g.released,
      platforms,
      genre: (g.genres || []).map(g => g.name).slice(0, 2),
      dev: "",
      anticipated: (g.added || 0) > 200,
      trailer: null,
      steam: steamId,
      price: null,
      cover: g.background_image || null,
    };
  });

  return res.status(200).json({ results });
}
