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
    // Steam dropped flat mp4 for newer trailers; fall back to HLS when needed.
    const mp4 = movie?.mp4?.max || movie?.mp4?.['480'] || null;
    const hls = movie?.hls_h264 || null;

    if (!mp4 && !hls) {
      return Response.json({ error: 'No playable trailer source' }, { status: 404 });
    }

    return Response.json({ mp4, hls, name: movie.name });
  } catch {
    return Response.json({ error: 'Steam fetch failed' }, { status: 500 });
  }
}
