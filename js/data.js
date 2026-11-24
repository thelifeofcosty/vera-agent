/*
 * Demo merchant directory.
 * Stands in for the merchant database + public merchant info that the real
 * agent would query. Every merchant here is fictional.
 *
 * price          per person, in GBP
 * acceptsVisa    the agent only ever books merchants where this is true
 * prepay         true = the booking must be paid up front (agent pays)
 * cancellation   'free' | 'non-refundable'
 * capacity       places available per time slot
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.VeraData = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AREAS = ['Ginza', 'Asakusa', 'Shibuya', 'Shinjuku'];

  // Words in a prompt that point at one of the areas above.
  const AREA_ALIASES = {
    ginza: 'Ginza', tsukiji: 'Ginza', yurakucho: 'Ginza',
    asakusa: 'Asakusa', ueno: 'Asakusa',
    shibuya: 'Shibuya', harajuku: 'Shibuya',
    shinjuku: 'Shinjuku',
  };

  const MERCHANTS = [
    // ---- Ginza ----
    { id: 'm01', name: 'Sushi Kaze', area: 'Ginza', category: 'restaurant',
      tags: ['sushi', 'omakase', 'seafood', 'japanese'], price: 85, rating: 4.8, reviews: 1240,
      acceptsVisa: true, prepay: true, cancellation: 'non-refundable',
      slots: ['12:00', '13:30', '18:00', '20:00'], capacity: 8, access: [], dietary: ['gluten-free'],
      blurb: 'Ten-seat omakase counter, seasonal fish from the morning market.' },
    { id: 'm02', name: 'Ginza Backstreets Walking Tour', area: 'Ginza', category: 'tour',
      tags: ['walking', 'history', 'architecture'], price: 32, rating: 4.7, reviews: 860,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['10:00', '12:00', '15:00'], capacity: 12, access: ['step-free'], dietary: [],
      blurb: 'Two hours of hidden alleys, shrines and department-store history with a local guide.' },
    { id: 'm03', name: 'Tsukiji Outer Market Food Walk', area: 'Ginza', category: 'tour',
      tags: ['food', 'market', 'seafood', 'walking'], price: 38, rating: 4.6, reviews: 2100,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['09:00', '11:00', '12:30'], capacity: 10, access: [], dietary: [],
      blurb: 'Tasting tour of the outer market stalls: tamagoyaki, fresh oysters, matcha.' },
    { id: 'm04', name: 'Hoshi Tempura', area: 'Ginza', category: 'restaurant',
      tags: ['tempura', 'japanese'], price: 45, rating: 4.5, reviews: 640,
      acceptsVisa: true, prepay: false, cancellation: 'free',
      slots: ['12:00', '18:30', '20:00'], capacity: 6, access: [], dietary: ['vegetarian'],
      blurb: 'Light, crisp tempura fried in front of you. Vegetable course available.' },
    { id: 'm05', name: 'Kabuki Single-Act Seats', area: 'Ginza', category: 'culture',
      tags: ['kabuki', 'theatre', 'traditional'], price: 25, rating: 4.4, reviews: 3020,
      acceptsVisa: true, prepay: true, cancellation: 'non-refundable',
      slots: ['11:00', '14:00', '18:00'], capacity: 30, access: ['step-free'], dietary: [],
      blurb: 'Watch a single act of a kabuki play, with an English audio guide.' },
    { id: 'm06', name: 'Ginza Tea Ceremony House', area: 'Ginza', category: 'class',
      tags: ['tea', 'ceremony', 'traditional', 'matcha'], price: 28, rating: 4.9, reviews: 410,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['10:30', '13:00', '16:00'], capacity: 6, access: [], dietary: [],
      blurb: 'Hands-on tea ceremony with a tea master in a quiet tatami room.' },
    { id: 'm07', name: 'Midori Vegan Kitchen', area: 'Ginza', category: 'restaurant',
      tags: ['japanese', 'healthy'], price: 22, rating: 4.3, reviews: 380,
      acceptsVisa: true, prepay: false, cancellation: 'free',
      slots: ['12:00', '13:00', '19:00'], capacity: 10, access: ['step-free'],
      dietary: ['vegan', 'vegetarian', 'gluten-free'],
      blurb: 'Plant-based shojin-style set menus.' },
    { id: 'm08', name: 'Corner Ramen Stand', area: 'Ginza', category: 'restaurant',
      tags: ['ramen', 'noodles'], price: 12, rating: 4.2, reviews: 950,
      acceptsVisa: false, prepay: false, cancellation: 'free',
      slots: ['11:00', '12:00', '13:00', '19:00'], capacity: 8, access: [], dietary: [],
      blurb: 'Cash-only standing ramen counter.' },

    // ---- Asakusa ----
    { id: 'm09', name: 'Asakusa Rickshaw & Temple Tour', area: 'Asakusa', category: 'tour',
      tags: ['temple', 'history', 'rickshaw'], price: 35, rating: 4.7, reviews: 1500,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['10:00', '12:00', '14:00'], capacity: 4, access: [], dietary: [],
      blurb: 'Rickshaw ride around Senso-ji and the old merchant streets.' },
    { id: 'm10', name: 'Kimono Stroll Asakusa', area: 'Asakusa', category: 'class',
      tags: ['kimono', 'photography', 'traditional'], price: 40, rating: 4.5, reviews: 720,
      acceptsVisa: true, prepay: true, cancellation: 'non-refundable',
      slots: ['09:30', '11:30', '13:30'], capacity: 8, access: [], dietary: [],
      blurb: 'Kimono rental with dressing help and a short photo walk.' },
    { id: 'm11', name: 'Yakitori Alley Asakusa', area: 'Asakusa', category: 'restaurant',
      tags: ['yakitori', 'izakaya', 'japanese'], price: 30, rating: 4.4, reviews: 530,
      acceptsVisa: true, prepay: false, cancellation: 'free',
      slots: ['18:00', '19:30', '21:00'], capacity: 12, access: [], dietary: [],
      blurb: 'Charcoal skewers and local sake under the railway arches.' },

    // ---- Shibuya ----
    { id: 'm12', name: 'Shibuya Neon Night Walk', area: 'Shibuya', category: 'tour',
      tags: ['nightlife', 'photography', 'walking'], price: 29, rating: 4.6, reviews: 980,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['19:00', '20:30'], capacity: 12, access: ['step-free'], dietary: [],
      blurb: 'The crossing, Center Gai and hidden bars after dark.' },
    { id: 'm13', name: 'Shibuya Ramen Lab', area: 'Shibuya', category: 'restaurant',
      tags: ['ramen', 'noodles'], price: 15, rating: 4.6, reviews: 1870,
      acceptsVisa: true, prepay: false, cancellation: 'free',
      slots: ['11:30', '12:30', '18:00', '19:30'], capacity: 10, access: [], dietary: ['vegetarian'],
      blurb: 'Rich tonkotsu and a proper vegetarian miso bowl.' },
    { id: 'm14', name: 'Sushi-Making Workshop', area: 'Shibuya', category: 'class',
      tags: ['sushi', 'cooking'], price: 55, rating: 4.8, reviews: 660,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['11:00', '15:00', '18:00'], capacity: 8, access: ['step-free'], dietary: [],
      blurb: 'Learn to make nigiri and rolls from a sushi chef, then eat them.' },

    // ---- Shinjuku ----
    { id: 'm15', name: 'Shinjuku Izakaya Hopping', area: 'Shinjuku', category: 'tour',
      tags: ['food', 'nightlife', 'izakaya'], price: 60, rating: 4.7, reviews: 1320,
      acceptsVisa: true, prepay: true, cancellation: 'non-refundable',
      slots: ['18:30', '20:00'], capacity: 10, access: [], dietary: [],
      blurb: 'Three izakaya in Omoide Yokocho and Golden Gai with food and drinks included.' },
    { id: 'm16', name: 'Gyoen Garden Guided Walk', area: 'Shinjuku', category: 'tour',
      tags: ['garden', 'nature', 'walking'], price: 18, rating: 4.5, reviews: 450,
      acceptsVisa: true, prepay: true, cancellation: 'free',
      slots: ['10:00', '12:00', '14:30'], capacity: 15, access: ['step-free'], dietary: [],
      blurb: 'A calm walk through Shinjuku Gyoen with a gardener-guide.' },
  ];

  return { AREAS, AREA_ALIASES, MERCHANTS };
});
