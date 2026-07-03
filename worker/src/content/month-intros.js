// Redactionele intro's voor de SSR-maandpagina's (/releases/YYYY-MM).
//
// Waarom dit bestaat: AdSense/Google beoordeelde de site als "low value
// content" omdat elke pagina puur database-output was. Deze intro's zijn
// handgeschreven, uniek per maand en gebaseerd op wat er daadwerkelijk in
// D1 staat, géén gegenereerde template-tekst. Bij een nieuwe jaargang
// (2027+) moeten er nieuwe intro's geschreven worden; een maand zonder
// intro rendert gewoon zonder tekstblok.
//
// Elke waarde is een array van paragrafen (platte tekst, wordt ge-escaped
// behalve <a>-links die hier bewust als HTML staan, alleen interne links).

export const MONTH_INTROS = {
  '2026-01': [
    `January eases the year in with indie volume rather than blockbusters, but there are real headliners hiding in the list. Riot's free-to-play fighting game <strong>2XKO</strong> finally launches on January 20, and Bandai Namco doubles down on soulslike action with <strong>Code Vein 2</strong> at the end of the month. The Switch 2 keeps absorbing last generation's best: Final Fantasy VII Remake Intergrade and Dynasty Warriors: Origins both arrive as ports on January 22, so check the badge and the original date before you treat them as new releases.`,
    `Deeper cuts worth watching: the long-troubled <strong>Pathologic 3</strong> on January 9, GameCube classic Fire Emblem: Path of Radiance resurfacing on Switch 2, and Cult of the Lamb's Woolhaven expansion on January 22.`,
  ],
  '2026-02': [
    `February is horror month. <strong>Resident Evil Requiem</strong> lands on February 26 and is comfortably the biggest release of the winter, but it has serious company: Team Ninja's <strong>Nioh 3</strong> opens the month on February 6, and Grasshopper's typically unhinged <strong>Romeo is a Dead Man</strong> follows on the 11th. On the RPG side, Square Enix rebuilds a classic with Dragon Quest VII Reimagined, and Sega packages <strong>Yakuza Kiwami 3</strong> with the new Dark Ties story.`,
    `Nintendo counters with Mario Tennis Fever on February 12, while Edmund McMillen's long-awaited cat-breeding roguelike <strong>Mewgenics</strong> finally ships on the 10th. Port of the month is an easy call: Hollow Knight arrives on Switch 2, PS5 and Xbox on February 5, the same game eight years on, so it wears a Port badge here.`,
  ],
  '2026-03': [
    `March is the most crowded month of 2026 in our database, and it isn't close. Bungie's extraction shooter <strong>Marathon</strong> arrives March 5 after its delay, Pearl Abyss finally ships <strong>Crimson Desert</strong> on the 19th, and Nintendo gets weird with <strong>Pokémon Pokopia</strong>, a Pokémon life-sim, on March 5. Capcom's Fatal Frame II: Crimson Butterfly REMAKE (March 12) is a genuine remake, rebuilt rather than repackaged, which is exactly the distinction our badges exist for.`,
    `Also on the slate: Monster Hunter Stories 3, WWE 2K26, MLB The Show 26 (now on Switch), GreedFall: The Dying World, and Legacy of Kain: Ascendance closing the month. The Switch 2 port wave continues with Blue Prince, Kena: Bridge of Spirits and Tomb Raider I–III Remastered, all labeled Port and all with their original dates shown.`,
  ],
  '2026-04': [
    `April's headline act is <strong>Pragmata</strong> (April 17), Capcom's sci-fi project that spent half a decade in the lab. Two very different exclusives bracket the month: Housemarque's <strong>Saros</strong> closes it on PS5 on April 30, while <strong>Starfield</strong> finally makes the jump to PS5 on April 7 as a port, and labeled as such. Blizzard expands Diablo IV with the Lord of Hatred expansion on the 28th.`,
    `Nintendo has a quietly packed month: Pokémon Champions on April 8, the new Tomodachi Life on the 16th, and Overwatch arriving on Switch 2. Our anticipated pick from the indie side is <strong>MOUSE: P.I. For Hire</strong> (April 16), the rubber-hose-cartoon noir shooter that looks like a 1930s Fleischer film with a body count.`,
  ],
  '2026-05': [
    `May belongs to two open worlds: <strong>Forza Horizon 6</strong> races onto PC and Xbox on May 19, and IO Interactive's Bond origin story <strong>007 First Light</strong> follows on the 27th. In between, Unknown Worlds opens up <strong>Subnautica 2</strong> early access on May 14 and Supermassive continues its interactive-horror run with Directive 8020 on the 12th.`,
    `The port column is unusually strong this month: Indiana Jones and the Great Circle and Stray both land on Switch 2, and Story of Seasons: Grand Bazaar reaches PS5 and Xbox. Thirteen re-releases in total, every one labeled with its original date. Lego Batman: Legacy of the Dark Knight (May 22) and Warhammer 40,000: Mechanicus II round out a denser month than its 136 entries suggest.`,
  ],
  '2026-06': [
    `June is Switch 2 month in all but name. <strong>Final Fantasy VII Rebirth</strong> arrives on Nintendo's console (and Xbox) June 3, followed by Devil May Cry 5, Sonic Frontiers: Definitive Edition, Sea of Stars, SnowRunner and Rise of the Tomb Raider, a full shelf of ports each marked as such here. The genuinely new highlight is <strong>Deltarune: Chapter 5</strong> on June 24, alongside the long-awaited <strong>Gothic 1 Remake</strong> on June 5, a real remake rebuilt from the ground up.`,
    `Elsewhere: EA Sports UFC 6 on the 19th, Hell Let Loose gets its Vietnam standalone on the 18th, and Nintendo's retro drip-feed delivers Donkey Kong 64 and the original Star Fox to Switch Online.`,
  ],
  '2026-07': [
    `July is quieter in volume (61 games) but unusually rich in curiosities. <strong>EA Sports College Football 27</strong> (July 9) is the commercial heavyweight, while the same day delivers two very different remakes: Ubisoft's <strong>Assassin's Creed Black Flag Resynced</strong> and, improbably, a new <strong>Backyard Baseball</strong>. Sword Art Online fans get the ambitious <strong>Echoes of Aincrad</strong>, and <strong>Palworld</strong> finally reaches PlayStation and Xbox on July 10, a port of a game you've likely already seen everywhere.`,
    `Mid-month is indie-dense: Moss: The Forgotten Relic, the chaotic co-op sequel Heave Ho 2, and Ratatan, the spiritual successor to Patapon, all cluster around July 16. We've flagged twenty games as anticipated this month, the highest ratio of the year.`,
  ],
  '2026-08': [
    `August is small (31 games) but it punches far above its weight for one reason: <strong>Metal Gear Solid: Master Collection Vol. 2</strong> on August 27 and <strong>Elden Ring Tarnished Edition</strong> closing the month on Switch 2. Both are re-releases and labeled accordingly; neither is any less interesting for it. Lies of P: Complete Edition joins the Switch 2 migration on the 6th.`,
    `Among the genuinely new: <strong>Duskfade</strong> (August 13) leads a strong indie Thursday alongside Rivage and Wild Blue Skies, the farming-sim-with-murders <strong>Grave Seasons</strong> follows on the 14th, and tactics fans finally get <strong>BRIGANDINE ABYSS</strong> on August 26. Cinemaware's Defender of the Crown returns as a full remake, 40 years after the Amiga original.`,
  ],
  '2026-09': [
    `September's marquee release is <strong>Warhammer 40,000: Dawn of War IV</strong> on September 17, the RTS series' first mainline entry in over a decade. Mojang follows with <strong>Minecraft Dungeons II</strong> on the 29th, and Koei Tecmo remasters a genre landmark with Dynasty Warriors 3: Complete Edition on the 30th.`,
    `The port list is long for a 39-game month: <strong>Valheim</strong> reaches Switch 2 and PS5 on September 9, RuneScape: Dragonwilds spreads to consoles, and Wo Long: Fallen Dynasty joins the Switch 2 catalogue. Racing fans get an unexpected wildcard in Hot Wheels Infinite Rush (September 24). As always, every re-release carries its original date next to the badge.`,
  ],
  '2026-10': [
    `October 2026 is re-release season, and we mean that as a compliment. <strong>Kingdom Hearts Collection [I ~ III]</strong> bundles the entire saga onto Switch 2, PS5 and Xbox on October 8, one day before <strong>Dragon's Dogma 2: Dark Arisen</strong> brings Capcom's expanded edition to the same platforms. Ubisoft's <strong>Rayman Legends Retold</strong> (October 1) is a proper remake of one of the best platformers ever made, and Earth Defense Force 5 arrives on Switch 2 for portable bug-hunting.`,
    `Even the nostalgia pick is a deep one: Toy Story 3: Complete Edition on October 15, resurrecting one of the most quietly beloved licensed games. The genuinely-new highlight is rhythm-action title <strong>Don't Fret</strong> on October 1.`,
  ],
  '2026-11': [
    `November is the thinnest month on the 2026 calendar so far (nine games as of today), but release lists this far out always fill in as publishers lock Q4 dates, so check back. The current standout is <strong>Metaphor: ReFantazio</strong> arriving on Switch 2 on November 12: Atlus' award-winner going portable is the kind of port that actually matters.`,
    `The rest of the month leans retro and family: Godzilla: Destroy All Monsters Melee Remastered (November 3) revives the GameCube brawler, Gothic 3 Classic reaches consoles, and Mattel's <strong>Barbie Rewind</strong> (November 12) is exactly the kind of oddity we track so you don't miss it.`,
  ],
  '2026-12': [
    `December 2026 is nearly empty right now (five listed games), which is normal this far ahead: publishers avoid announcing December dates until autumn, and this page will grow considerably. What's confirmed is promising, though: <strong>Dragon Quest Monsters: The Withered World</strong> launches across everything on December 3, the same day <strong>Xenoblade Chronicles 3</strong> gets its Switch 2 edition.`,
    `If you're planning ahead, the <a href="/releases/tba">TBA list</a> is where December's eventual heavyweights are currently hiding. Games move onto this page the moment a date is confirmed.`,
  ],
  'tba': [
    `These are the announced games that don't have a confirmed release date yet, the "coming eventually" shelf. We track them so that the moment a publisher commits to a date, the game moves onto its month page automatically; until then, this list is the most honest answer to "when is it coming out?": nobody knows yet.`,
    `A word of caution from experience: TBA games slip, get re-announced, and occasionally vanish entirely. We prune listings that go dead and keep original announcement details for the rest. If a game you're waiting for is missing here, <a href="/contact">let us know</a> and we'll add it.`,
  ],
};
