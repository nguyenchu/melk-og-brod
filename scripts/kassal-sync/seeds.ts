// Søkeord vi synker hver natt. Ett søk dekker alle kjeder for de matchende varene,
// så en bred, men kompakt liste gir god katalogdekning innenfor 60 req/min.
// Utvid gjerne med brukernes favoritt-søk når vi har trafikk.

export const SEED_TERMS: string[] = [
  // Meieri & egg
  'melk', 'lettmelk', 'helmelk', 'skummet melk', 'laktosefri melk', 'havremelk',
  'fløte', 'kremfløte', 'rømme', 'creme fraiche', 'smør', 'meierismør', 'margarin',
  'ost', 'gulost', 'norvegia', 'jarlsberg', 'brunost', 'revet ost', 'cottage cheese',
  'egg', 'yoghurt', 'gresk yoghurt', 'skyr', 'kefir',
  // Brød & bakeri
  'brød', 'grovbrød', 'loff', 'rundstykker', 'knekkebrød', 'pølsebrød', 'lefse',
  'wraps', 'pita', 'havregryn', 'müsli', 'cornflakes',
  // Kjøtt & fjørfe
  'kjøttdeig', 'karbonadedeig', 'kylling', 'kyllingfilet', 'kyllinglår', 'svinekjøtt',
  'koteletter', 'bacon', 'pølser', 'wienerpølser', 'kjøttkaker', 'pålegg', 'leverpostei',
  'spekeskinke', 'salami', 'kalkun',
  // Fisk
  'laks', 'torsk', 'sei', 'fiskekaker', 'fiskeboller', 'reker', 'makrell i tomat', 'tunfisk',
  // Tørrvarer
  'pasta', 'spaghetti', 'lasagne', 'ris', 'jasminris', 'couscous', 'bulgur', 'hvetemel',
  'sukker', 'gjær', 'havsalt', 'olivenolje', 'matolje', 'ketchup', 'sennep', 'majones',
  'pasta saus', 'taco', 'tortilla', 'kokosmelk', 'soyasaus', 'buljong',
  // Frukt & grønt
  'banan', 'eple', 'appelsin', 'druer', 'jordbær', 'blåbær', 'sitron', 'avokado',
  'tomat', 'agurk', 'paprika', 'salat', 'løk', 'hvitløk', 'potet', 'gulrot', 'brokkoli',
  'champignon', 'spinat',
  // Drikke
  'juice', 'appelsinjuice', 'eplejuice', 'brus', 'cola', 'farris', 'vann', 'energidrikk',
  'kaffe', 'filterkaffe', 'kaffekapsler', 'svart te', 'grønn te', 'kakao',
  // Frys
  'pizza', 'frossenpizza', 'fiskepinner', 'pommes frites', 'softis', 'iskrem', 'bær frossen',
  // Snacks & søtt
  'potetgull', 'sjokolade', 'godteri', 'kjeks', 'nøtter', 'popcorn',
  // Baby & husholdning
  'bleier', 'barnemat', 'våtservietter', 'toalettpapir', 'tørkerull', 'oppvaskmiddel',
  'vaskemiddel', 'såpe', 'tannkrem', 'shampoo',
];
