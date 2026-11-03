/**
 * D57: an emoji icon for an ingredient, derived automatically from its label
 * (no storage, same icon everywhere). Keyword matching on the accent-stripped
 * lowercased label, most specific first; a neutral fork-and-knife fallback.
 *
 * French labels (the kitchen's article list), with common English keywords too.
 */

/** lowercase + strip accents, so "pâtes" matches "pates" and "crème" "creme". */
function normalize(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Ordered: the first group with a matching keyword wins. */
const RULES: { icon: string; keywords: string[] }[] = [
  // Desserts / sweets (before "creme" and "pomme" catch them wrongly)
  { icon: '🍮', keywords: ['creme brulee', 'flan', 'panna', 'dessert', 'pudding'] },
  { icon: '🍩', keywords: ['beignet', 'donut', 'churros'] },
  { icon: '🍪', keywords: ['cookie', 'biscuit', 'sable', 'speculoos'] },
  { icon: '🍰', keywords: ['gateau', 'cake', 'patisserie', 'tarte', 'muffin', 'brownie'] },
  { icon: '🍨', keywords: ['glace', 'sorbet', 'ice cream'] },
  { icon: '🍫', keywords: ['chocolat', 'cacao', 'nutella', 'chocolate'] },
  { icon: '🍬', keywords: ['bonbon', 'sucre', 'candy', 'caramel'] },
  { icon: '🍯', keywords: ['miel', 'honey', 'sirop', 'confiture'] },
  // Meat & fish
  {
    icon: '🍗',
    keywords: ['poulet', 'dinde', 'volaille', 'chicken', 'turkey', 'cuisse', 'escalope'],
  },
  { icon: '🍖', keywords: ['agneau', 'mouton', 'gigot', 'cotelette', 'lamb'] },
  { icon: '🥩', keywords: ['boeuf', 'veau', 'steak', 'viande', 'hache', 'beef', 'entrecote'] },
  { icon: '🌭', keywords: ['merguez', 'saucisse', 'charcuterie', 'sausage', 'hot dog'] },
  { icon: '🥓', keywords: ['lardon', 'bacon', 'jambon', 'ham'] },
  { icon: '🦐', keywords: ['crevette', 'gambas', 'fruits de mer', 'shrimp', 'calamar', 'moule'] },
  {
    icon: '🐟',
    keywords: ['poisson', 'thon', 'saumon', 'sardine', 'merlu', 'cabillaud', 'fish', 'abadeche'],
  },
  // Dairy & eggs
  { icon: '🥚', keywords: ['oeuf', 'egg'] },
  {
    icon: '🧀',
    keywords: ['fromage', 'cheese', 'gruyere', 'mozzarella', 'cheddar', 'parmesan', 'feta'],
  },
  { icon: '🧈', keywords: ['beurre', 'butter', 'margarine'] },
  { icon: '🥛', keywords: ['lait', 'milk', 'yaourt', 'yogourt', 'creme', 'cream'] },
  // Starches & bakery
  {
    icon: '🍝',
    keywords: [
      'pates',
      'penne',
      'spaghetti',
      'macaroni',
      'lasagne',
      'pasta',
      'nouille',
      'tagliatelle',
    ],
  },
  { icon: '🍚', keywords: ['riz', 'rice', 'vermicelle', 'risotto'] },
  { icon: '🍲', keywords: ['semoule', 'couscous', 'boulgour', 'quinoa'] },
  {
    icon: '🍞',
    keywords: [
      'pain',
      'bread',
      'batbout',
      'baguette',
      'brioche',
      'batboute',
      'toast',
      'burger',
      'bun',
    ],
  },
  { icon: '🌾', keywords: ['farine', 'ble', 'flour', 'cereale', 'avoine', 'orge'] },
  { icon: '🍟', keywords: ['frite', 'fries', 'chips'] },
  // Vegetables
  { icon: '🍅', keywords: ['tomate', 'tomato'] },
  { icon: '🧅', keywords: ['oignon', 'onion', 'echalote'] },
  { icon: '🧄', keywords: ['ail', 'garlic'] },
  { icon: '🥕', keywords: ['carotte', 'carrot'] },
  { icon: '🥔', keywords: ['pomme de terre', 'patate', 'potato', 'puree'] },
  { icon: '🍆', keywords: ['aubergine', 'eggplant'] },
  { icon: '🥒', keywords: ['courgette', 'concombre', 'cucumber', 'zucchini'] },
  { icon: '🌶️', keywords: ['piment', 'harissa', 'chili'] },
  { icon: '🫑', keywords: ['poivron', 'pepper bell'] },
  {
    icon: '🥬',
    keywords: [
      'salade',
      'laitue',
      'mesclun',
      'roquette',
      'epinard',
      'chou',
      'lettuce',
      'spinach',
      'cabbage',
    ],
  },
  { icon: '🍄', keywords: ['champignon', 'mushroom'] },
  { icon: '🌽', keywords: ['mais', 'corn'] },
  { icon: '🥦', keywords: ['brocoli', 'broccoli'] },
  {
    icon: '🫛',
    keywords: ['pois', 'haricot', 'pea', 'bean', 'lentille', 'fève', 'feve', 'pois chiche'],
  },
  { icon: '🎃', keywords: ['potiron', 'courge', 'citrouille', 'pumpkin'] },
  { icon: '🫒', keywords: ['olive', 'huile', 'oil'] },
  { icon: '🥑', keywords: ['avocat', 'avocado'] },
  // Drinks
  { icon: '🧃', keywords: ['jus', 'juice', 'nectar'] },
  { icon: '🥤', keywords: ['soda', 'cola', 'limonade', 'ice tea', 'canette', 'boisson'] },
  { icon: '💧', keywords: ['eau', 'water'] },
  { icon: '🍵', keywords: ['the ', 'infusion', 'tea'] },
  { icon: '☕', keywords: ['cafe', 'coffee'] },
  // Fruits
  { icon: '🍋', keywords: ['citron', 'lemon', 'lime'] },
  { icon: '🍊', keywords: ['orange', 'clementine', 'mandarine'] },
  { icon: '🍎', keywords: ['pomme', 'apple'] },
  { icon: '🍌', keywords: ['banane', 'banana'] },
  { icon: '🍓', keywords: ['fraise', 'strawberry'] },
  { icon: '🍇', keywords: ['raisin', 'grape'] },
  { icon: '🍑', keywords: ['peche', 'abricot', 'nectarine', 'peach', 'apricot'] },
  { icon: '🍉', keywords: ['pasteque', 'watermelon'] },
  { icon: '🍈', keywords: ['melon', 'cantaloup'] },
  { icon: '🌴', keywords: ['datte', 'date'] },
  { icon: '🍐', keywords: ['poire', 'pear', 'ananas', 'pineapple', 'mangue', 'mango', 'kiwi'] },
  // Nuts, herbs, spices, condiments
  {
    icon: '🥜',
    keywords: ['amande', 'noix', 'cacahuete', 'noisette', 'pistache', 'almond', 'nut', 'sesame'],
  },
  {
    icon: '🌿',
    keywords: [
      'menthe',
      'persil',
      'coriandre',
      'basilic',
      'thym',
      'herbe',
      'aneth',
      'mint',
      'parsley',
    ],
  },
  {
    icon: '🧂',
    keywords: [
      'sel',
      'poivre',
      'salt',
      'pepper',
      'cumin',
      'paprika',
      'curcuma',
      'cannelle',
      'safran',
      'epice',
      'spice',
      'ras el',
    ],
  },
  {
    icon: '🥫',
    keywords: ['sauce', 'ketchup', 'mayonnaise', 'moutarde', 'concentre', 'coulis', 'conserve'],
  },
  { icon: '🫙', keywords: ['vinaigre', 'vinaigrette', 'cornichon'] },
]

const FALLBACK = '🍴'

export function ingredientIcon(label: string | null | undefined): string {
  if (!label) return FALLBACK
  const text = normalize(label)
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.icon
  }
  return FALLBACK
}
