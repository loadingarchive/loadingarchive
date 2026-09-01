// Gedeelde site-footer voor alle server-rendered paginatypes (game.js,
// month.js, trending.js) — moet er overal identiek uitzien: domino-animatie,
// een crawlbare (maar visueel verborgen) link naar elke maandpagina, en de
// zichtbare TBA/Trending/About/Privacy/Contact-rij. Styling komt uit het
// gedeelde /css/site.css (geladen door elke pagina), niet uit deze module.
// De homepage (statische index.html) kan deze module niet importeren en
// herhaalt dezelfde HTML/JS zelf, met een client-side rewrite naar hetzelfde
// venster omdat die pagina niet server-rendered is.

import { rollingMonths, toMonthKey } from '../months-window.js';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function siteFooterHtml(dominoId) {
  const year = new Date().getFullYear();
  // Maandlinks volgen het rollende venster — maanden daarbuiten bestaan niet
  // (meer) als pagina, dus daar mag geen link heen wijzen.
  const monthLinks = rollingMonths()
    .map(m => `<a href="/releases/${toMonthKey(m)}">${MONTH_NAMES[m.month - 1]} ${m.year}</a>`)
    .join('\n      ');

  return `<footer class="site-footer">
  <div class="footer-card">
    <div class="footer-top">
      <div id="${dominoId}"></div>
    </div>
    <nav class="footer-months-sr" aria-label="Browse releases by month">
      ${monthLinks}
    </nav>
    <div class="footer-bottom">
      <span class="footer-copy">&copy; Loading Archive ${year}</span>
      <nav class="footer-links" aria-label="Site links">
        <a href="/releases/tba">TBA</a>
        <a href="/trending">Trending</a>
        <a href="/events">Events</a>
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/contact">Contact</a>
      </nav>
    </div>
  </div>
</footer>`;
}
