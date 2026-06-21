exports.handler = async function (event) {
  const { appid } = event.queryStringParameters || {};
  if (!appid) return { statusCode: 400, body: JSON.stringify({ error: "Missing appid" }) };

  try {
    const res  = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`);
    const data = await res.json();
    const app  = data?.[appid]?.data;

    if (!app || !app.movies || app.movies.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "No trailer found" }) };
    }

    const movie = app.movies[0];
    const mp4   = movie?.mp4?.max || movie?.mp4?.["480"] || null;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
      body: JSON.stringify({ mp4, name: movie.name }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Steam fetch failed" }) };
  }
};
