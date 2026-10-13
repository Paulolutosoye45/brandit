/*
 * What Brandit Studio will not make, and why. Brandit is the printer: what the picture maker draws, Brandit presses onto
 * cloth and card, so these are business rules and not only policy.
 *
 * Version 1 of the content policy (agreed by the owner):
 *  - no AI generation for political campaign material, or anything that resembles an official document
 *  - no other companies' logos or cartoon characters
 *  - no likeness of a real, named person (celebrities, politicians)
 *  - no religious figures drawn by the picture maker
 *  - nothing sexual, graphic or violent, and nothing that insults a religion, a tribe or a group
 *  - the ID card product is for a company's own staff cards only
 * Customer-supplied artwork is not affected: a customer can still upload their own file and we print it as before.
 *
 * The lists below are a first line of defence, not a complete one. A person at Brandit can add words in the console
 * (Studio settings, "Extra blocked words"), every result can be put in front of a person (review mode), and the print
 * desk can refuse any job. Lists will always miss something: keep them growing from what the review queue shows.
 */
export type Category =
  | 'political' | 'official_document' | 'brand_ip' | 'real_person' | 'religious_figure' | 'sexual' | 'violence' | 'hate' | 'illegal' | 'custom';

export const CATEGORY_LABEL: Record<Category, string> = {
  political: 'Political campaign material',
  official_document: 'Official documents and IDs',
  brand_ip: 'Other companies\' logos and characters',
  real_person: 'A real person\'s likeness',
  religious_figure: 'Religious figures',
  sexual: 'Sexual content',
  violence: 'Graphic or violent content',
  hate: 'Insulting a religion, tribe or group',
  illegal: 'Illegal activity',
  custom: 'Blocked by Brandit',
};

/** What the customer is told. It always says what they can do instead. */
export const CATEGORY_MESSAGE: Record<Category, string> = {
  political: 'Studio does not make political campaign material. If you have your own artwork, upload it as usual and we will print it.',
  official_document: 'Studio does not make anything that looks like an official document, ID, certificate or banknote. Staff ID cards for your own company are fine.',
  brand_ip: 'Studio cannot draw other companies\' logos or cartoon characters. Upload your own logo and we will place it exactly as it is.',
  real_person: 'Studio cannot draw a real person\'s likeness from their name. Upload your own photo and we will place it as it is.',
  religious_figure: 'Studio does not draw religious figures. You can type a verse or a name in your words, or upload your own picture.',
  sexual: 'Studio cannot make this kind of picture. Change the description and try again.',
  violence: 'Studio does not make violent or graphic pictures. Change the description and try again.',
  hate: 'Studio does not make anything that insults a religion, a tribe or a group of people.',
  illegal: 'Studio cannot make this. Change the description and try again.',
  custom: 'Studio cannot make this. Change the description and try again, or message us on WhatsApp.',
};

type Rule = {
  cat: Category;
  verdict: 'block' | 'review';
  re: RegExp;
  /** Only checked on the description of the look, not on the words the customer types to print. A business may type "passport photos" or "MTN"; the picture maker must not draw one. */
  lookOnly?: boolean;
  /** Also checked on the typed words when the product is an ID card, where the words are the whole document. */
  idStrict?: boolean;
};

const w = (words: string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`);

// Everything below is matched against text that has been lower-cased, de-accented and un-obfuscated (0 for o, @ for a).
export const RULES: Rule[] = [
  // ---- Political campaigns ----
  { cat: 'political', verdict: 'block', re: w(['apc', 'pdp', 'nnpp', 'apga', 'ypp', 'inec', 'all progressives congress', 'peoples democratic party', 'labour party', 'new nigeria peoples party']) },
  { cat: 'political', verdict: 'block', re: /\b(?:vote (?:for|me|him|her|us)|re-?elect|elect(?:ion|ed)?|ballot|manifesto|aspirant|our candidate|candidacy|running for (?:office|governor|president|senate|chairman|councillor)|contesting|governorship|gubernatorial|senatorial|presidential|councillorship|swearing[- ]in|inauguration of (?:the )?(?:governor|president|senator))\b/ },
  { cat: 'political', verdict: 'block', re: /\b(?:election|political|governorship|presidential|senatorial|councillor(?:ship)?|party) (?:campaign|rally)\b|\b(?:election|political|governorship|presidential|senatorial) (?:poster|flyer|banner|billboard|t-?shirts?)\b|\bpolitical party\b/ },
  { cat: 'political', verdict: 'block', re: /\bvote\b.{0,60}\b(?:for|as)\b.{0,20}\b(?:governor|senator|president|chairman|councillor|mayor|lga|house of (?:reps|representatives)|assembly)\b/ },
  { cat: 'political', verdict: 'block', re: /\b(?:governor|senator|president|chairman|councillor|mayor)\b.{0,25}\b20(?:2[7-9]|3\d)\b/ },
  { cat: 'political', verdict: 'block', re: /\b(?:sdp|adc|lp|zlp)\b.{0,40}\b(?:campaign|vote|candidate|party|rally|election)\b|\b(?:campaign|vote|candidate|party|rally|election)\b.{0,40}\b(?:sdp|adc|lp|zlp)\b/ },

  // ---- Official documents ----
  { cat: 'official_document', verdict: 'block', lookOnly: true, idStrict: true, re: /\b(?:passport|nin slip|national identi(?:ty|fication)|national id|driver'?s? licen[cs]e|birth certificate|death certificate|marriage certificate|degree certificate|certificate of (?:origin|incorporation|registration|authenticity|occupancy)|transcript|bank ?note|naira note|currency note|dollar bill|cheque|visa|coat of arms|official seal|federal republic|nigeria police|nigerian army|nigerian navy|air force|frsc|nysc|cac certificate|tax clearance|court order|affidavit|power of attorney|voter'?s? card|pvc card|republic of|government of)\b/ },
  { cat: 'official_document', verdict: 'block', re: /\b(?:fake|forged?|counterfeit|duplicate|replica) (?:id|certificate|receipt|document|licen[cs]e|passport|visa|stamp|seal|note|cheque|result)\b/ },

  // ---- Other companies' logos and characters (description of the look only: a business name typed as plain words is fine) ----
  { cat: 'brand_ip', verdict: 'block', lookOnly: true, re: w(['nike', 'adidas', 'puma', 'gucci', 'louis vuitton', 'chanel', 'prada', 'balenciaga', 'versace', 'dior', 'fendi', 'apple logo', 'coca[- ]?cola', 'pepsi', 'fanta', 'mtn', 'glo', 'airtel', '9mobile', 'gtbank', 'gtco', 'access bank', 'zenith bank', 'first bank', 'uba', 'opay', 'palmpay', 'kuda', 'dangote', 'heineken', 'guinness', 'star lager', 'netflix', 'youtube', 'instagram', 'facebook', 'tiktok', 'whatsapp logo', 'twitter', 'mcdonald', 'kfc', 'nestle', 'peak milk', 'indomie', 'golden penny', 'mickey', 'minnie', 'donald duck', 'disney', 'pixar', 'marvel', 'spider[- ]?man', 'batman', 'superman', 'iron man', 'hulk', 'avengers', 'black panther', 'pokemon', 'pikachu', 'hello kitty', 'barbie', 'naruto', 'dragon ball', 'goku', 'peppa pig', 'cocomelon', 'paw patrol', 'super mario', 'sponge ?bob', 'tom and jerry', 'winnie the pooh', 'lion king', 'harry potter', 'star wars', 'darth vader', 'fifa', 'uefa', 'premier league', 'olympic rings', 'real madrid', 'barcelona fc', 'manchester united', 'chelsea fc', 'liverpool fc', 'super eagles logo', 'nff'] ) },

  // ---- A real person's likeness (description of the look only: a name typed as plain words, for example in a memorial, is fine) ----
  { cat: 'real_person', verdict: 'block', lookOnly: true, re: w(['tinubu', 'buhari', 'atiku', 'peter obi', 'obi cubana', 'kwankwaso', 'jonathan goodluck', 'goodluck jonathan', 'obasanjo', 'sanwo[- ]?olu', 'wike', 'fela kuti', 'davido', 'wizkid', 'burna ?boy', 'tems', 'rema', 'asake', 'ayra starr', 'tiwa savage', 'don jazzy', 'mr ibu', 'mercy johnson', 'genevieve nnaji', 'regina daniels', 'funke akindele', 'kanye', 'drake', 'beyonce', 'rihanna', 'taylor swift', 'cristiano ronaldo', 'ronaldo', 'lionel messi', 'messi', 'mbappe', 'trump', 'obama', 'biden', 'putin', 'elon musk', 'kim kardashian', 'jay[- ]?z', 'chris brown', 'rick ross'] ) },
  { cat: 'real_person', verdict: 'block', lookOnly: true, re: /\b(?:looks? like|likeness of|face of|portrait of|photo ?realistic (?:picture|image|portrait) of|resembling|in the image of|deepfake)\b.{0,40}\b(?:president|governor|senator|minister|actor|actress|singer|footballer|celebrity|politician|pastor|imam|bishop|king|oba|emir|ooni)\b/ },

  // ---- Religious figures the picture maker must never draw ----
  { cat: 'religious_figure', verdict: 'block', lookOnly: true, re: /\b(?:jesus|allah|prophet muhammad|prophet mohammed|muhammad|mohammed|virgin mary|madonna|holy spirit|angel gabriel|buddha|krishna|shango|sango|orisha|yemoja|oshun|osun goddess|ogun god|olodumare|chukwu|ifa priest|deity)\b/ },

  // ---- Sexual ----
  { cat: 'sexual', verdict: 'block', re: /\b(?:porn\w*|nudity|naked|topless|nsfw|erotic\w*|fetish|orgy|xxx|hentai|onlyfans|genitals?|penis|vagina|boobs?|sex tape|sexual\w*|strip ?tease|stripper|prostitut\w*|brothel|rape|molest\w*|incest|pedophil\w*|paedophil\w*)\b/ },
  { cat: 'sexual', verdict: 'review', re: /\b(?:sexy|nude|nudes|sensual|seductive|lingerie|underwear|bikini|swimsuit|thong|hot girls?|cleavage)\b/ },

  // ---- Graphic or violent ----
  { cat: 'violence', verdict: 'block', re: /\b(?:gore|gory|dismember\w*|decapitat\w*|behead\w*|massacre|genocide|torture\w*|lynch\w*|mutilat\w*|corpse|dead bod(?:y|ies)|bloodbath|bomb(?:ing| making)|terroris[tm]|mass shooting|school shooting|assassinat\w*|hang(?:ing)? (?:a |the )?(?:man|woman|person))\b/ },
  { cat: 'violence', verdict: 'review', re: /\b(?:gun|guns|rifle|ak ?47|pistol|machete|cutlass|knife attack|blood|bloody|kill|killing|murder|stab|stabbing|suicide|shoot(?:ing)? (?:him|her|them|people))\b/ },

  // ---- Hate ----
  { cat: 'hate', verdict: 'block', re: /\b(?:nazi|hitler|kkk|ku klux|swastika|white power|heil|jihad against|death to|kill all)\b/ },
  { cat: 'hate', verdict: 'block', re: /\b(?:hate|kill|destroy|exterminate|wipe out|burn|cleanse)\b.{0,24}\b(?:igbo|yoruba|hausa|fulani|ijaw|tiv|muslims?|christians?|jews?|arabs?|blacks?|whites?|gays?|lesbians?|ethnic)\b/ },
  { cat: 'hate', verdict: 'block', re: /\b(?:igbos?|yorubas?|hausas?|fulanis?|ijaws?|tivs?|muslims?|christians?|jews?|arabs?|gays?|lesbians?|northerners|southerners|easterners)\b.{0,16}\b(?:are|is)\b.{0,16}\b(?:animals?|pigs?|dogs?|vermin|cockroach(?:es)?|monkeys?|terrorists?|evil|filthy|dirty|stupid|thieves|cursed|scum|worthless)\b/ },

  // ---- Illegal ----
  { cat: 'illegal', verdict: 'block', re: /\b(?:cocaine|heroin|crack cocaine|methamphetamine|drug dealer|sell(?:ing)? drugs|drug trafficking|human trafficking|yahoo ?yahoo|yahoo boy|sakawa|ponzi|money laundering|blackmail|ritual killing|money ritual)\b/ },
  { cat: 'illegal', verdict: 'review', re: /\b(?:scam\w*|fraud\w*|fake news|weed|marijuana|cannabis)\b/ },
];

/** A short plain-language version, shown on the AI designs page and in the Studio start page. */
export const POLICY_SUMMARY: { title: string; body: string }[] = [
  { title: 'No political campaign material', body: 'Studio does not make posters, flyers or banners for elections or political parties. If you have your own artwork, upload it as usual.' },
  { title: 'Nothing that looks official', body: 'No IDs, passports, certificates, banknotes, stamps or seals. The ID card product is for your own company\'s staff cards.' },
  { title: 'No other company\'s logo or cartoon character', body: 'Use your own logo and we place it exactly as supplied. Studio will not draw someone else\'s.' },
  { title: 'No real person\'s likeness from a name', body: 'Upload your own photo of the person. We place it as it is and never redraw a face.' },
  { title: 'No religious figures', body: 'You can type a verse or a name. The picture maker will not draw religious figures.' },
  { title: 'Nothing sexual, graphic or insulting', body: 'No sexual or graphic pictures, and nothing that insults a religion, a tribe or a group of people.' },
];
