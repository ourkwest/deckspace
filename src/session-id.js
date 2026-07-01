// Session ID generator
// Format: "Adjective1 Adjective2 Animal" e.g. "Big Foolish Rhinoceros"

export const ADJ1 = [
  'Big', 'Tiny', 'Huge', 'Small', 'Tall', 'Short', 'Long', 'Fat',
  'Thin', 'Old', 'Young', 'Ancient', 'Little', 'Giant', 'Vast',
];

export const ADJ2 = [
  'Angry', 'Brave', 'Clumsy', 'Dizzy', 'Evil', 'Foolish', 'Grumpy',
  'Happy', 'Itchy', 'Jolly', 'Keen', 'Lazy', 'Mighty', 'Nervous',
  'Proud', 'Quiet', 'Rude', 'Silly', 'Toxic', 'Ugly', 'Violent',
  'Wicked', 'Zealous', 'Flatulent', 'Cunning', 'Sneaky', 'Dramatic',
  'Furious', 'Gentle', 'Hungry',
];

export const ANIMALS = [
  'Aardvark', 'Badger', 'Camel', 'Dolphin', 'Eagle', 'Falcon',
  'Gorilla', 'Hamster', 'Iguana', 'Jaguar', 'Koala', 'Lemur',
  'Moose', 'Narwhal', 'Octopus', 'Penguin', 'Quail', 'Raccoon',
  'Shark', 'Tiger', 'Vulture', 'Walrus', 'Yak', 'Zebra',
  'Rhinoceros', 'Platypus', 'Flamingo', 'Lobster', 'Wombat', 'Pelican',
];

export function generateSessionId() {
  const a1 = ADJ1[Math.floor(Math.random() * ADJ1.length)];
  const a2 = ADJ2[Math.floor(Math.random() * ADJ2.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return { adj1: a1, adj2: a2, animal };
}

export function sessionIdToString({ adj1, adj2, animal }) {
  return `${adj1} ${adj2} ${animal}`;
}

export function sessionIdToKey({ adj1, adj2, animal }) {
  return `${adj1}-${adj2}-${animal}`.toLowerCase();
}
