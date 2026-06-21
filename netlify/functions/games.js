exports.handler = async function (event) {
  const apiKey = process.env.RAWG_API_KEY;

  // Optioneel: maand meegeven via query param (?month=2025-06)
  const { month } = event.queryStringParameters || {};

  // Datumrange bepalen (standaard: huidige maand)
  const now = month ? new Date(month + "-01") : new Date();
  const year = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();

  const dateFrom = `${year}-${m}-01`;
  const dateTo   = `${year}-${m}-${daysInMonth}`;

  const url = `https://api.rawg.io/api/games?key=${apiKey}&dates=${dateFrom},${dateTo}&ordering=released&page_size=40`;

  try {
    const res  = await fetch(url);
    const data = await res.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch games", detail: err.message }),
    };
  }
};
