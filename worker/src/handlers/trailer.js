export async function handleTrailer(request) {
  const { searchParams } = new URL(request.url);
  const appid = searchParams.get('appid');

  if (!appid) {
    return Response.json({ error: 'Missing appid' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`
    );
    const data = await response.json();
    const app  = data?.[appid]?.data;

    if (!app?.movies?.length) {
      return Response.json({ error: 'No trailer found' }, { status: 404 });
    }

    const movie = app.movies[0];
    // Prefer highest-quality source: mp4.max > webm.max > fallback to 480p.
    // For HLS prefer HEVC (H.265) over H.264 when available — better quality per bit.
    const mp4 = movie?.mp4?.max || movie?.webm?.max || movie?.mp4?.['480'] || null;
    const hls = movie?.hls_hevc || movie?.hls_h264 || null;

    if (!mp4 && !hls) {
      return Response.json({ error: 'No playable trailer source' }, { status: 404 });
    }

    return Response.json({ mp4, hls, name: movie.name });
  } catch {
    return Response.json({ error: 'Steam fetch failed' }, { status: 500 });
  }
}
