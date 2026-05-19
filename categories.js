// Shared expense categories used by the bot and API validation.

const CATEGORY_KEYWORDS = {
  Food: ['lunch', 'dinner', 'breakfast', 'food', 'dominos', 'zomato', 'swiggy', 'zepto', 'blinkit', 'chai', 'coffee', 'restaurant', 'biryani', 'pizza', 'snacks'],
  Transport: ['auto', 'uber', 'ola', 'metro', 'bus', 'rickshaw', 'petrol', 'cab', 'rapido'],
  Entertainment: ['movie', 'netflix', 'spotify', 'game', 'concert', 'bowling'],
  College: ['books', 'printing', 'xerox', 'stationery', 'fees', 'lab'],
  Gym: ['gym', 'protein', 'supplement', 'fitness'],
  Shopping: ['clothes', 'shoes', 'amazon', 'flipkart', 'mall', 'shirt', 'jeans'],
  Health: ['medicine', 'pharmacy', 'doctor', 'chemist'],
  Skincare: ['moisturizer', 'sunscreen', 'facewash', 'skincare', 'serum'],
};

const DEFAULT_CATEGORY = 'Miscellaneous';
const CATEGORIES = Object.freeze([...Object.keys(CATEGORY_KEYWORDS), DEFAULT_CATEGORY]);

const CATEGORY_EMOJI = {
  Food: '🍔',
  Transport: '🚗',
  Entertainment: '🎬',
  College: '🎓',
  Gym: '💪',
  Shopping: '🛍️',
  Health: '💊',
  Skincare: '✨',
  Miscellaneous: '📦',
};

function categorize(text = '') {
  const lower = String(text).toLowerCase();
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) return category;
  }
  return DEFAULT_CATEGORY;
}

function isKnownCategory(category) {
  return CATEGORIES.includes(category);
}

module.exports = {
  CATEGORY_KEYWORDS,
  CATEGORY_EMOJI,
  CATEGORIES,
  DEFAULT_CATEGORY,
  categorize,
  isKnownCategory,
};
