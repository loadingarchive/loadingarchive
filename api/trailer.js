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
    // Steam dropped the flat mp4 field for newer trailers in favor of HLS/DASH
    // manifests, so fall back to the HLS stream (playable via hls.js) when needed.
    const mp4 = movie?.mp4?.max || movie?.mp4?.["480"] || null;
    const hls = movie?.hls_h264 || null;

    if (!mp4 && !hls) return res.status(404).json({ error: "No playable trailer source" });

    return res.status(200).json({ mp4, hls, name: movie.name });
  } catch (e) {
    return res.status(500).json({ error: "Steam fetch failed" });
  }
}
