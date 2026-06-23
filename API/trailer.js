export default async function handler(req, res) {
  const { appid } = req.query;
  if (!appid) return res.status(400).json({ error: "Missing appid" });

  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`);
    const data = await response.json();
    const app  = data?.[appid]?.data;

    if (!app || !app.movies || app.movies.length === 0) {
      return res.status(404).json({ error: "No trailer found" });
    }

    const movie = app.movies[0];
    const mp4   = movie?.mp4?.max || movie?.mp4?.["480"] || null;

    return res.status(200).json({ mp4, name: movie.name });
  } catch (e) {
    return res.status(500).json({ error: "Steam fetch failed" });
  }
}
