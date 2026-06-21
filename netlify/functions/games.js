exports.handler = async function (event) {
  const rawgKey = process.env.RAWG_API_KEY;
  const { month } = event.queryStringParameters || {};

  // Datumrange bepalen (standaard: huidige maand in 2026)
  const now = month ? new Date(month + "-01") : new Date();
  const year = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
  const dateFrom = `${year}-${m}-01`;
  const dateTo   = `${year}-${m}-${daysInMonth}`;

  // Stap 1: RAWG — haal aankomende releases op
  const rawgUrl = `https://api.rawg.io/api/games?key=${rawgKey}&dates=${dateFrom},${dateTo}&ordering=released&page_size=40&platforms=4,187,18,1,186,7&exclude_additions=true`;

  let rawgGames = [];
  try {
    const res  = await fetch(rawgUrl);
    const data = await res.json();
    rawgGames  = data.results || [];
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "RAWG fetch failed" }) };
  }

  // Filter: alleen games met Steam store link en voldoende interesse
  const withSteam = rawgGames.filter(g => {
    const hasSteam = (g.stores || []).some(s => s.store?.slug === "steam");
    const hasInterest = (g.ratings_count || 0) >= 5 || (g.added || 0) >= 20;
    const notAdult = !g.esrb_rating || g.esrb_rating.slug !== "adults-only";
    return hasSteam && hasInterest && notAdult;
  });

  // Stap 2: Steam App ID ophalen per game via RAWG store URL
  const getSteamId = (g) => {
    const steamStore = (g.stores || []).find(s => s.store?.slug === "steam");
    return steamStore?.url?.match(/\/app\/(\d+)/)?.[1] || null;
  };

  // Stap 3: Steam API aanroepen voor details (parallel, max 15 games)
  const topGames = withSteam.slice(0, 15);

  const enriched = await Promise.all(topGames.map(async (g) => {
    const steamId = getSteamId(g);
    if (!steamId) return null;

    try {
      const steamRes  = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steamId}&cc=nl&l=en`);
      const steamData = await steamRes.json();
      const app       = steamData?.[steamId]?.data;

      if (!app) return null;

      // Filter 18+ via Steam
      if (app.required_age >= 18) return null;

      // Filter: alleen games (geen DLC, software etc.)
      if (app.type !== "game") return null;

      // Prijs
      let price = null;
      if (app.is_free) {
        price = "Free";
      } else if (app.price_overview) {
        price = app.price_overview.final_formatted;
      }

      // Trailer (eerste beschikbare)
      let trailer = null;
      if (app.movies && app.movies.length > 0) {
        const ytMatch = app.movies[0]?.webm?.max?.match(/youtube\.com\/embed\/([^?]+)/);
        // Steam trailers zijn geen YouTube — we slaan de Steam movie ID op
        trailer = app.movies[0]?.id ? `steam:${app.movies[0].id}` : null;
      }

      // Platforms
      const platforms = [];
      if (app.platforms?.windows) platforms.push("Win");
      if (app.platforms?.mac)     platforms.push("Mac");
      if (app.platforms?.linux)   platforms.push("Lin");

      // Voeg console platforms toe vanuit RAWG
      const PLATFORM_MAP = {
        "playstation4": "PS4", "playstation5": "PS5",
        "xbox-one": "XBO", "xbox-series-x": "XSX", "nintendo-switch": "NS",
      };
      (g.platforms || []).forEach(p => {
        const mapped = PLATFORM_MAP[p.platform?.slug];
        if (mapped && !platforms.includes(mapped)) platforms.push(mapped);
      });

      return {
        id: steamId,
        title: app.name,
        date: g.released,
        platforms,
        genre: (app.genres || []).map(g => g.description).slice(0, 2),
        dev: (app.developers || []).join(", "),
        anticipated: (g.added || 0) > 500,
        trailer: null,
        steam: steamId,
        price,
        cover: app.header_image || g.background_image || null,
        short_description: app.short_description || null,
      };
    } catch (e) {
      return null;
    }
  }));

  const results = enriched.filter(Boolean);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=43200", // 12 uur cache
    },
    body: JSON.stringify({ results }),
  };
};
