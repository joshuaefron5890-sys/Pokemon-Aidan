// Aidan's Pokemon Card Collection
// Each entry can be a plain string or an object with overrides:
// { query, setName, tcgUrl }

const CARD_LIST = [
  {
    query: "Bulbasaur 133/132",
    setName: "Mega Evolution",
    tcgUrl: "https://www.tcgplayer.com/product/654472/pokemon-me01-mega-evolution-bulbasaur-133-132",
  },
  {
    query: "Mega Sharpedo ex 113/094",
    setName: "Phantasmal Flames",
    tcgUrl: "https://www.tcgplayer.com/product/662192/pokemon-me02-phantasmal-flames-mega-sharpedo-ex-113-094",
  },
  {
    query: "Whirlipede 133/086",
    setName: "Black Bolt",
    tcgUrl: "https://www.tcgplayer.com/product/642588/pokemon-sv-black-bolt-whirlipede-133-086",
  },
  {
    query: "Throh 128/086",
    setName: "Black Bolt",
    tcgUrl: "https://www.tcgplayer.com/product/642583/pokemon-sv-black-bolt-throh-128-086",
  },
  {
    query: "Rowlet 043",
    setName: "Mega Evolution",
    tcgUrl: "https://www.tcgplayer.com/product/684467/pokemon-me-mega-evolution-promo-rowlet-043?page=1&Language=English",
  },
  {
    query: "Marill 232/217",
    setName: "Ascended Heroes",
    tcgUrl: "https://www.tcgplayer.com/product/676044/pokemon-me-ascended-heroes-marill-232-217",
  },
  {
    query: "Pidgeotto 208/197",
    setName: "Obsidian Flames",
    tcgUrl: "https://www.tcgplayer.com/product/509956/pokemon-sv03-obsidian-flames-pidgeotto-208-197",
  },
  {
    query: "Team Rocket's Wobbuffet 203",
    setName: "Scarlet & Violet Black Star Promos",
    tcgUrl: "https://www.tcgcollector.com/cards/49288/team-rockets-wobbuffet-scarlet-and-violet-promos-203",
  },
  {
    query: "Mega Skarmory ex 055/088",
    setName: "Perfect Order",
    tcgUrl: "https://www.tcgplayer.com/product/684351/pokemon-me03-perfect-order-mega-skarmory-ex-055-088",
  },
  {
    query: "Servine 088/086",
    setName: "Black Bolt",
    tcgUrl: "https://www.tcgplayer.com/product/642537/pokemon-sv-black-bolt-servine-088-086?Language=English&page=1",
  },
  {
    query: "Dewgong 097/094",
    cardId: "me2-97",
    setName: "Phantasmal Flames",
    tcgUrl: "https://www.tcgplayer.com/product/662152/pokemon-me02-phantasmal-flames-dewgong-097-094?Language=English&page=1",
  },
  {
    query: "Blastoise-EX XY30",
    setName: "XY Black Star Promos",
    tcgUrl: "https://www.tcgplayer.com/product/96393/pokemon-xy-promos-blastoise-ex-xy30?Language=English",
  },
  {
    query: "Salazzle ex 101/088",
    setName: "Perfect Order",
    tcgUrl: "https://www.tcgplayer.com/product/684377/pokemon-me03-perfect-order-salazzle-ex-101-088",
  },
  {
    query: "Tyrunt 070",
    setName: "Mega Evolution Promos",
    tcgUrl: "https://www.tcgplayer.com/product/685562/pokemon-me-mega-evolution-promo-tyrunt-070",
  },
  {
    query: "Snorlax 051",
    cardId: "svp-51",
    setName: "Scarlet & Violet Black Star Promos",
    tcgUrl: "https://www.tcgplayer.com/product/517175/pokemon-sv-scarlet-and-violet-promo-cards-snorlax-051",
  },
  {
    query: "Popplio 045",
    setName: "Mega Evolution Promos",
    tcgUrl: "https://www.tcgplayer.com/product/684469/pokemon-me-mega-evolution-promo-popplio-045",
  },
  {
    query: "Mismagius ex 112/094",
    setName: "Phantasmal Flames",
    tcgUrl: "https://www.tcgplayer.com/product/662200/pokemon-me02-phantasmal-flames-mismagius-ex-112-094",
  },
  {
    query: "Mudsdale 175/162",
    setName: "Temporal Forces",
    tcgUrl: "https://www.tcgplayer.com/product/542896/pokemon-sv05-temporal-forces-mudsdale-175-162",
  },
  {
    query: "Drayton 232/191",
    setName: "Surging Sparks",
    tcgUrl: "https://www.tcgplayer.com/product/589924/pokemon-sv08-surging-sparks-drayton-232-191",
  },
  {
    query: "Friends in Paldea 137/131",
    setName: "Prismatic Evolutions",
    tcgUrl: "https://www.tcgplayer.com/product/610492/pokemon-sv-prismatic-evolutions-friends-in-paldea-137-131",
  },
  {
    query: "Cheren 258/217",
    setName: "Ascended Heroes",
    tcgUrl: "https://www.tcgplayer.com/product/676070/pokemon-me-ascended-heroes-cheren",
  },
  {
    query: "Ethan's Ho-Oh ex 039/182",
    setName: "Destined Rivals",
    tcgUrl: "https://www.tcgplayer.com/product/632858/pokemon-sv10-destined-rivals-ethans-ho-oh-ex-039-182",
  },
  {
    query: "Arven's Mabosstiff ex 139/182",
    setName: "Destined Rivals",
    tcgUrl: "https://www.tcgplayer.com/product/632946/pokemon-sv10-destined-rivals-arvens-mabosstiff-ex-139-182",
  },
];
