import { handleGames }  from './handlers/games.js';
import { handleTrailer } from './handlers/trailer.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/games')   return handleGames(request, env);
    if (pathname === '/api/trailer') return handleTrailer(request, env);

    return env.ASSETS.fetch(request);
  },
};
