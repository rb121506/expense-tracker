// Shared expense categories used by the bot and API validation.

const CATEGORY_KEYWORDS = {
  Food: ['lunch', 'dinner', 'breakfast', 'food', 'dominos', 'zomato', 'swiggy', 'zepto', 'blinkit', 'chai', 'coffee', 'restaurant', 'biryani', 'pizza', 'snacks', 'shawarma', 'faasos', 'momo', 'chinese', 'canteen', 'thali', 'pav bhaji', 'vada pav', 'burger', 'sandwich', 'fries', 'noodles', 'dosa', 'idli'],
  Transport: ['auto', 'uber', 'ola', 'metro', 'bus', 'rickshaw', 'petrol', 'cab', 'rapido', 'train', 'railway', 'parking', 'diesel', 'bike service', 'servicing'],
  Subscriptions: ['youtube', 'spotify', 'netflix', 'hotstar', 'prime', 'apple', 'claude', 'subscription', 'ott', 'jiocinema', 'google cloud', 'icloud'],
  Drinks: ['bar', 'pub', 'wine', 'beer', 'liquor', 'brewery', 'whisky', 'vodka', 'rum', 'cocktail', 'nightlife'],
  Entertainment: ['movie', 'game', 'concert', 'bowling', 'pickleball', 'cricket', 'gaming', 'theatre', 'amusement'],
  College: ['books', 'printing', 'xerox', 'stationery', 'fees', 'lab'],
  Gym: ['gym', 'protein', 'supplement', 'fitness'],
  Shopping: ['clothes', 'shoes', 'amazon', 'flipkart', 'mall', 'shirt', 'jeans', 'myntra', 'ajio', 'meesho'],
  Health: ['medicine', 'pharmacy', 'doctor', 'chemist', 'dermatologist', 'dermat', 'hospital', 'clinic', 'wellness'],
  Skincare: ['moisturizer', 'sunscreen', 'facewash', 'skincare', 'serum'],
};

const DEFAULT_CATEGORY = 'Miscellaneous';
const CATEGORIES = Object.freeze([...Object.keys(CATEGORY_KEYWORDS), DEFAULT_CATEGORY]);

const CATEGORY_EMOJI = {
  Food: '🍔',
  Transport: '🚗',
  Subscriptions: '🔄',
  Drinks: '🍻',
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
