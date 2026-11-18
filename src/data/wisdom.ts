/** What the planner box says when Bóbr has nothing to nudge about: one line a minute, cycling through
 *  jokes, quotes, facts, fallacies and life tips (English only for now). */
export type Wisdom = { kind: 'joke' | 'quote' | 'fact' | 'fallacy' | 'tip'; text: string };

export const WISDOM: Wisdom[] = [
  { kind: 'joke', text: 'Why did the beaver stay in school? To improve his dam skills.' },
  { kind: 'joke', text: 'I told my planner a joke about procrastination. I\'ll tell you the punchline tomorrow.' },
  { kind: 'joke', text: 'Why don\'t programmers like nature? Too many bugs.' },
  { kind: 'joke', text: 'I used to hate facial hair, but then it grew on me.' },
  { kind: 'joke', text: 'What do you call a fish wearing a bowtie? Sofishticated.' },
  { kind: 'joke', text: 'Why did the scarecrow win an award? He was outstanding in his field.' },
  { kind: 'joke', text: 'I\'m reading a book about anti-gravity. It\'s impossible to put down.' },
  { kind: 'joke', text: 'Time flies like an arrow. Fruit flies like a banana.' },
  { kind: 'quote', text: '"We are what we repeatedly do. Excellence, then, is not an act, but a habit." (Will Durant)' },
  { kind: 'quote', text: '"You have power over your mind, not outside events." (Marcus Aurelius)' },
  { kind: 'quote', text: '"A journey of a thousand miles begins with a single step." (Lao Tzu)' },
  { kind: 'quote', text: '"It is not that we have little time, but that we waste much of it." (Seneca)' },
  { kind: 'quote', text: '"The unexamined life is not worth living." (Socrates)' },
  { kind: 'quote', text: '"Well begun is half done." (Aristotle)' },
  { kind: 'quote', text: '"What we do every day matters more than what we do once in a while." (Gretchen Rubin)' },
  { kind: 'quote', text: '"No man ever steps in the same river twice." (Heraclitus)' },
  { kind: 'fact', text: 'Beavers\' teeth are orange because the enamel is reinforced with iron.' },
  { kind: 'fact', text: 'A beaver can hold its breath underwater for about 15 minutes.' },
  { kind: 'fact', text: 'Honey never spoils: edible honey was found in 3,000-year-old Egyptian tombs.' },
  { kind: 'fact', text: 'Octopuses have three hearts and blue blood.' },
  { kind: 'fact', text: 'Bananas are berries, but strawberries are not.' },
  { kind: 'fact', text: 'A day on Venus is longer than its year.' },
  { kind: 'fact', text: 'Wombat droppings are cube-shaped.' },
  { kind: 'fact', text: 'Oxford University is older than the Aztec Empire.' },
  { kind: 'fact', text: 'Your brain uses about 20% of your energy while being 2% of your weight.' },
  { kind: 'fact', text: 'The Lake District\'s Windermere is England\'s largest natural lake, about 18 km long.' },
  { kind: 'fallacy', text: 'Ad hominem: attacking the person instead of the argument. "He\'s wrong because he\'s rude" is no rebuttal.' },
  { kind: 'fallacy', text: 'Straw man: twisting someone\'s view into a weaker one, then knocking that down.' },
  { kind: 'fallacy', text: 'Sunk cost: "I\'ve already spent so much" is no reason to keep going. Only the future counts.' },
  { kind: 'fallacy', text: 'Appeal to popularity: millions of people can be wrong. Popular is not the same as true.' },
  { kind: 'fallacy', text: 'False dilemma: "either A or B" when there are more options. Ask: what else is there?' },
  { kind: 'fallacy', text: 'Slippery slope: claiming one step will inevitably lead to disaster, without showing the steps between.' },
  { kind: 'fallacy', text: 'Post hoc: B happened after A, so A caused B. The rooster does not make the sun rise.' },
  { kind: 'fallacy', text: 'Confirmation bias: we notice what agrees with us. Go looking for the evidence against your view.' },
  { kind: 'fallacy', text: 'Appeal to authority: an expert in one field is not automatically right in another.' },
  { kind: 'fallacy', text: 'Survivorship bias: we study the winners and forget the many who did the same and failed.' },
  { kind: 'fallacy', text: 'Dunning-Kruger: the less we know, the easier it is to feel certain. Stay curious.' },
  { kind: 'fallacy', text: 'Tu quoque: "you do it too" does not make a wrong thing right.' },
  { kind: 'tip', text: 'Two-minute rule: if it takes under two minutes, do it now.' },
  { kind: 'tip', text: 'Drink a glass of water first. Many "tired" moments are thirst.' },
  { kind: 'tip', text: 'Start with the smallest possible step. Five minutes beats waiting for motivation.' },
  { kind: 'tip', text: 'Sleep is a task too. Protect it like an appointment.' },
  { kind: 'tip', text: 'Write tomorrow\'s top three tasks tonight. Mornings get easier.' },
  { kind: 'tip', text: 'Stand up, stretch, look far away. Your eyes and back will thank you.' },
  { kind: 'tip', text: 'Do the hardest task first, while your willpower is fresh.' },
  { kind: 'tip', text: 'Say thank you to someone today. It costs nothing and lasts.' },
  { kind: 'tip', text: 'Don\'t shop hungry, don\'t decide angry, don\'t reply tired.' },
  { kind: 'tip', text: 'Never break the chain: one tick a day builds a habit faster than one big push.' },
  { kind: 'tip', text: 'Spend a little less than you earn, and let the difference grow.' },
  { kind: 'tip', text: 'Take a walk when you\'re stuck. Ideas like to arrive on foot.' },
];

/** The line for this minute: a stride coprime to the length visits every entry before repeating, so the kinds are mixed. */
export function wisdomAt(ms: number): Wisdom {
  const n = WISDOM.length, stride = 7;   // 7 shares no factor with 50
  return WISDOM[(Math.floor(ms / 60000) * stride) % n];
}
