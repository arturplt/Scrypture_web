import { EMOTICONS, type Emotion } from './bobr';
import { EMOTICON_LIBRARY, type LibraryKind } from './emoticonLibrary';

/**
 * ASCII emoticon manager: every face Bóbr can make, with the feeling it stands for.
 * Plain ASCII only (Press Start 2P cannot draw anything else).
 *
 * `HAPPY` .. `SAD` are the moods Bóbr has today (`emotionFor`). The `PLANNED_EMOTIONS` are the emotions plan:
 * feelings he does not show yet, with the faces already drawn for when something triggers them.
 */
export type PlannedEmotion = 'LOVE' | 'ANGRY' | 'SCARED' | 'SURPRISED' | 'PROUD' | 'BORED' | 'CONFUSED' | 'SICK' | 'COLD' | 'SHY' | 'LAUGHING' | 'CRYING';
export type EmoticonFeeling = Emotion | PlannedEmotion;

export const PLANNED_EMOTIONS: readonly PlannedEmotion[] = ['LOVE', 'ANGRY', 'SCARED', 'SURPRISED', 'PROUD', 'BORED', 'CONFUSED', 'SICK', 'COLD', 'SHY', 'LAUGHING', 'CRYING'];
export const ACTIVE_EMOTIONS = Object.keys(EMOTICONS) as Emotion[];

/** `fancy` faces use characters outside ASCII, so Press Start 2P cannot draw them: they fall back to a system font. */
export interface Emoticon { face: string; feeling: EmoticonFeeling; note: string; fancy?: boolean }

const fancy = (face: string, feeling: EmoticonFeeling, note: string): Emoticon => ({ face, feeling, note, fancy: true });

/** The hand-picked faces: the ones Bóbr animates today and the emotions plan. */
const CORE_LIST: readonly Emoticon[] = [
  // ---- in use now (frames of EMOTICONS) ----
  { face: '(^_^)', feeling: 'HAPPY', note: 'content, fed and cheerful' },
  { face: '(^o^)', feeling: 'HAPPY', note: 'grinning wide' },
  { face: 'XD', feeling: 'HAPPY', note: 'cracking up' },
  { face: '(._.)', feeling: 'NEUTRAL', note: 'nothing special going on' },
  { face: '(-_-)', feeling: 'NEUTRAL', note: 'blank, a bit flat' },
  { face: '(-_-)zZ', feeling: 'SLEEPY', note: 'dozing off at night' },
  { face: '(=__=)', feeling: 'SLEEPY', note: 'eyes half shut' },
  { face: '(-_-)zz', feeling: 'SLEEPY', note: 'fast asleep' },
  { face: '\\(^o^)/', feeling: 'EXCITED', note: 'cheering after a task or berry' },
  { face: '\\(^O^)/', feeling: 'EXCITED', note: 'cheering louder' },
  { face: '\\o/', feeling: 'EXCITED', note: 'arms up' },
  { face: '(o_o)', feeling: 'HUNGRY', note: 'staring, wants food' },
  { face: '(O_O)', feeling: 'HUNGRY', note: 'wide eyes, very hungry' },
  { face: '(>_<)', feeling: 'HUNGRY', note: 'stomach hurts' },
  { face: '(^_~)', feeling: 'MISCHIEVOUS', note: 'wink, up to something' },
  { face: '(~_^)', feeling: 'MISCHIEVOUS', note: 'wink the other way' },
  { face: '(-_-~)', feeling: 'MISCHIEVOUS', note: 'sly squint' },
  { face: '(T_T)', feeling: 'SAD', note: 'crying quietly' },
  { face: '(;_;)', feeling: 'SAD', note: 'tearful' },
  // ---- the emotions plan (not triggered yet) ----
  { face: '(*^_^*)', feeling: 'LOVE', note: 'blushing, fond of you' },
  { face: '(^3^)', feeling: 'LOVE', note: 'blowing a kiss' },
  { face: '<3', feeling: 'LOVE', note: 'heart' },
  { face: '(>_<#)', feeling: 'ANGRY', note: 'fuming' },
  { face: '(`_\')', feeling: 'ANGRY', note: 'glaring' },
  { face: '>:(', feeling: 'ANGRY', note: 'scowling' },
  { face: '(O.O;)', feeling: 'SCARED', note: 'startled, sweating' },
  { face: '(@_@;)', feeling: 'SCARED', note: 'terrified, dizzy' },
  { face: 'D:', feeling: 'SCARED', note: 'gasping' },
  { face: '(O_o)', feeling: 'SURPRISED', note: 'did not expect that' },
  { face: '(!_!)', feeling: 'SURPRISED', note: 'shocked' },
  { face: ':O', feeling: 'SURPRISED', note: 'mouth open' },
  { face: '(^_^)b', feeling: 'PROUD', note: 'thumbs up, did well' },
  { face: '(`^\')', feeling: 'PROUD', note: 'chin up' },
  { face: '(-.-)', feeling: 'BORED', note: 'nothing to do' },
  { face: '(-_-;)', feeling: 'BORED', note: 'sighing' },
  { face: '(?_?)', feeling: 'CONFUSED', note: 'does not get it' },
  { face: '(o_O?)', feeling: 'CONFUSED', note: 'head tilted' },
  { face: '(x_x)', feeling: 'SICK', note: 'unwell' },
  { face: '(+_+)', feeling: 'SICK', note: 'dizzy, feverish' },
  { face: '(>_<)b', feeling: 'COLD', note: 'shivering' },
  { face: '(;_;)~', feeling: 'COLD', note: 'teeth chattering' },
  { face: '(/_\\)', feeling: 'SHY', note: 'hiding the face' },
  { face: '(^_^;)', feeling: 'SHY', note: 'embarrassed laugh' },
  { face: '(^o^)ha', feeling: 'LAUGHING', note: 'laughing out loud' },
  { face: '(^,^)', feeling: 'LAUGHING', note: 'giggling' },
  { face: '(T^T)', feeling: 'CRYING', note: 'happy tears' },
  { face: '(ToT)', feeling: 'CRYING', note: 'sobbing' },
  // ---- fancy (Unicode) faces ----
  fancy('(˶>⩊<˶)', 'EXCITED', 'squeezing with joy, cheeks pink'),
  fancy('ᗜ⩊ᗜ', 'HAPPY', 'beaming'),
  fancy('(˶ᵔ ᵕ ᵔ˶)', 'HAPPY', 'soft, shy smile'),
  fancy('◝(ᵔᗜᵔ)◜', 'HAPPY', 'arms up, delighted'),
  fancy('⚞^◕⩊◕^⚟', 'HUNGRY', 'big sparkly eyes, begging for food'),
  fancy('¯\\_(ツ)_/¯', 'CONFUSED', 'shrug, no idea'),
  fancy('( ꩜ ᯅ ꩜;)', 'CONFUSED', 'swirly eyes, lost'),
  fancy('(╥﹏╥)', 'CRYING', 'wobbly sobbing'),
  fancy('/•᷅•᷄\\', 'SAD', 'worried eyebrows'),
  fancy('( ͡° ͜ʖ ͡°)', 'MISCHIEVOUS', 'the lenny, very suspicious'),
  fancy('(ᵕ—ᴗ—)', 'MISCHIEVOUS', 'playful wink'),
  fancy('ヽ(°〇°)ﾉ', 'SURPRISED', 'gasp, hands up'),
  fancy('❍⩊❍', 'SURPRISED', 'round eyes'),
  fancy('〜(꒪꒳꒪)〜', 'SICK', 'wobbly, dazed'),
  fancy('( ͡• _•)ദ്ദി', 'PROUD', 'smug, knows he did well'),
  fancy('(˵ •̀ ᴗ - ˵ ) ✧', 'PROUD', 'cheeky, sparkling'),
  fancy('(ง •̀_•́)ง', 'ANGRY', 'fists up, ready to fight'),
  fancy("੭(╯'□')╯︵ ┻━┻", 'ANGRY', 'flips the table'),
  fancy('(⚆_⚆)', 'SCARED', 'wide eyes, frozen'),
  fancy('(˶˃⤙˂˶)', 'LAUGHING', 'squinting grin'),
  fancy('(つ｡˃ ᵕ ˂)つ', 'LOVE', 'wants a hug'),
  fancy('⸝♡•ᴗ•', 'LOVE', 'happy heart'),
  fancy('(⇀‸↼‶)', 'BORED', 'unimpressed, a sweat drop'),
];

const coreFaces = new Set(CORE_LIST.map(e => e.face));
const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s);

/** The kaomoji library: named faces (`(lenny)`, `(tableflip)` ...) that stand for a feeling join the list under it. */
const libraryFaces: Emoticon[] = EMOTICON_LIBRARY
  .filter(([, face, feeling]) => feeling && !coreFaces.has(face))
  .map(([names, face, feeling]) => ({ face, feeling: feeling as EmoticonFeeling, note: names.map(n => `(${n})`).join(' '), ...(isAscii(face) ? {} : { fancy: true }) }));

/** Every face and what it means. The first face listed under a feeling is its "main" face. */
export const EMOTICON_LIST: readonly Emoticon[] = [...CORE_LIST, ...libraryFaces];

/** Library entries that are not a feeling: symbols (hearts, arrows, dice ...) and bigger scenes or animals. */
export interface ExtraFace { face: string; names: string[]; kind: Exclude<LibraryKind, 'face'> }
export const EMOTICON_EXTRAS: readonly ExtraFace[] = EMOTICON_LIBRARY
  .filter(([, face, feeling, kind]) => !feeling && kind !== 'face' && !coreFaces.has(face))
  .map(([names, face, , kind]) => ({ face, names, kind: kind as ExtraFace['kind'] }));

/** Search by face, alias or note (case-insensitive); empty search matches everything. */
export const matchesEmoticon = (q: string, ...parts: string[]) => { const s = q.trim().toLowerCase(); return !s || parts.some(p => p.toLowerCase().includes(s)); };

export const isPlanned = (f: EmoticonFeeling): f is PlannedEmotion => (PLANNED_EMOTIONS as readonly string[]).includes(f);

/** All faces for a feeling, main face first. */
export const emoticonsFor = (feeling: EmoticonFeeling): Emoticon[] => EMOTICON_LIST.filter(e => e.feeling === feeling);

/** The feeling a face stands for, or undefined if the face is not in the list. */
export const feelingOf = (face: string): EmoticonFeeling | undefined => EMOTICON_LIST.find(e => e.face === face)?.feeling;

/** Feelings in display order: today's moods first, then the plan. */
export const ALL_FEELINGS: readonly EmoticonFeeling[] = [...ACTIVE_EMOTIONS, ...PLANNED_EMOTIONS];

/** Faces grouped by feeling, in display order. */
export const emoticonGroups = (): { feeling: EmoticonFeeling; faces: Emoticon[]; planned: boolean }[] =>
  ALL_FEELINGS.map(feeling => ({ feeling, faces: emoticonsFor(feeling), planned: isPlanned(feeling) }));

// ---- Bóbr's repertoire --------------------------------------------------------------------------
/**
 * What else each mood can show now and then, besides its own animation: the feelings next to it. A happy Bóbr may laugh or look
 * proud, a hungry one may get cross, a sad one may cry. The first entry is the mood itself and is by far the most likely.
 */
export const REPERTOIRE: Record<Emotion, readonly EmoticonFeeling[]> = {
  HAPPY: ['HAPPY', 'LAUGHING', 'PROUD', 'LOVE'],
  NEUTRAL: ['NEUTRAL', 'BORED', 'CONFUSED', 'SURPRISED'],
  SLEEPY: ['SLEEPY', 'BORED', 'SICK'],
  EXCITED: ['EXCITED', 'LAUGHING', 'SURPRISED', 'PROUD'],
  HUNGRY: ['HUNGRY', 'ANGRY', 'SAD', 'SCARED'],
  MISCHIEVOUS: ['MISCHIEVOUS', 'LAUGHING', 'PROUD', 'SHY'],
  SAD: ['SAD', 'CRYING', 'COLD', 'SCARED'],
};

/** A face has to fit the little bubble over Bóbr's head. */
export const FLOURISH_MAX_LEN = 9;
/** Chance that a flourish is the mood's own feeling rather than a neighbouring one. */
export const FLOURISH_OWN = 0.5;

/**
 * A face for Bóbr to flash between his usual frames. `rand` returns [0, 1) (inject it to test). Every face comes from the
 * repertoire of his mood and is short enough for the bubble, so the same mood never produces a face that is out of character.
 */
export function flourishFor(mood: Emotion, rand: () => number = Math.random): Emoticon {
  const pool = REPERTOIRE[mood];
  const feeling = rand() < FLOURISH_OWN ? pool[0] : pool[1 + Math.floor(rand() * (pool.length - 1))];
  const faces = emoticonsFor(feeling).filter(e => e.face.length <= FLOURISH_MAX_LEN);
  return faces[Math.floor(rand() * faces.length)] ?? emoticonsFor(pool[0])[0];
}
