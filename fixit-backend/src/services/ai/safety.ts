import { z } from 'zod';

/*
Backend-owned safety classification.

Safety is enforced here, not by prompt wording. Four questions are answered:

1. Has the USER reported an immediate hazard (gas, fire/smoke, electrical,
   refrigerant, water near electrics) or asked for dangerous work?
2. Has the MODEL asserted an active hazard or written an unsafe instruction?
3. Do reported conditions (a leak, a wet floor) make touching the plug unsafe?
4. Which backend-written response belongs to the detected categories?

Component names on their own are never hazards: a door lock, circuit breaker or
compressor is only restricted when paired with an invasive action (bypassing an
interlock, opening a panel, testing a compressor). Safe documented external
operations, such as resetting a breaker, checking that a door is latched or
unplugging the appliance itself from the wall, are allowed. Ambiguous invasive
actions stay restricted: when uncertain, the classifier prefers safety.

Negation is scoped locally. "The dryer won't start and it smells like gas" is a
gas report: the "won't" belongs to a different clause. A negation cancels a
hazard only when it directly governs the hazard phrase: every word between
them must be "transparent" (articles, perception or existence verbs, or other
hazard words in a list), as in "I have not noticed any burning smell or smoke".
Any other word ends the negation's reach, so "my oven won't stop smoking",
"I can't get rid of the gas smell", "no matter what I do it sparks", "without
warning it sparked" and "not sure if it's smoke or steam" are hazard reports.
*/

export const safetyCategorySchema = z.enum([
  'GAS',
  'FIRE_SMOKE',
  'ELECTRICAL',
  'REFRIGERANT',
  'WATER_ELECTRICAL',
  // A persisted hazard whose details could not be read back (corrupt or
  // schema-drifted context). Never detected from text; it exists so that
  // unreadable safety state fails closed instead of being discarded.
  'UNVERIFIED_HAZARD',
  'UNSAFE_REQUEST',
  'UNSAFE_MODEL_INSTRUCTION',
]);

export type SafetyCategory = z.infer<typeof safetyCategorySchema>;

// Most urgent first. Responses and persisted lists use this order.
const PRIORITY: readonly SafetyCategory[] = safetyCategorySchema.options;

// Physical conditions persist for the session. Requests and model drafts are
// decided per turn: asking about dangerous work is refused when asked, but it
// is not a hazard in the room and must not lock every later turn.
const PHYSICAL_HAZARDS: ReadonlySet<SafetyCategory> = new Set([
  'GAS',
  'FIRE_SMOKE',
  'ELECTRICAL',
  'REFRIGERANT',
  'WATER_ELECTRICAL',
  'UNVERIFIED_HAZARD',
]);

// ---------------------------------------------------------------------------
// Text normalisation, clauses and local negation
// ---------------------------------------------------------------------------

// Curly apostrophes from phone keyboards must not defeat "don't" or "can't".
function normalizeText(text: string): string {
  return text.replace(/[‘’ʼ`]/g, "'");
}

function clauses(text: string): string[] {
  return text
    .split(/[.!?;:\n,]+|\bbut\b|\bhowever\b|\balthough\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

// Water-near-electrics phrases routinely span a comma ("leaking from the base,
// right next to the plug"), so that check uses whole sentences instead.
function sentences(text: string): string[] {
  return text
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const NEGATION_WORD =
  /^(?:no|not|never|none|nothing|without|nor|haven't|havent|hasn't|hasnt|hadn't|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|can't|cant|cannot|couldn't|couldnt|won't|wont|wouldn't|wouldnt|shouldn't|shouldnt)$/i;

// A negation's scope ends at punctuation or at a conjunction that starts a new
// statement ("it won't start AND it smells like gas").
const SCOPE_BOUNDARY =
  /[.!?;:,\n]|\b(?:and|but|so|because|cause|since|when|whenever|then|until|till|while|although|though|however|now|yet|plus)\b/gi;

// How many words before a hazard phrase a negation may sit and still apply.
// Only transparent words may fill that gap (see NEGATION_TRANSPARENT).
const NEGATION_WINDOW_WORDS = 8;

// Words that may sit between a negation and the hazard it negates without
// breaking the link: "no sparks", "never saw any sparks", "have not noticed
// any burning smell or smoke", "there isn't a gas smell". Deliberately small:
// an unlisted word ("stop", "rid", "matter", "warning", "sure", "think") means
// the negation is about something else and the hazard stands.
const NEGATION_TRANSPARENT = new Set([
  // articles, quantifiers, pronouns and fillers
  'a', 'an', 'the', 'any', 'some', 'single', 'sign', 'signs', 'trace', 'traces', 'evidence', 'hint', 'of',
  'or', 'nor', 'even', 'ever', 'yet', 'really', 'actually', 'at', 'all', 'i', 'we', 'it', "it's", 'there',
  "there's", 'anything', 'visible', 'obvious', 'real', 'like', 'more',
  // existence and perception verbs
  'is', 'was', 'were', 'are', 'am', 'be', 'been', 'have', 'has', 'had', 'having', 'get', 'got', 'gotten',
  'getting', 'see', 'saw', 'seen', 'seeing', 'notice', 'noticed', 'noticing', 'smell', 'smells', 'smelled',
  'smelt', 'smelling', 'detect', 'detected', 'hear', 'heard', 'feel', 'felt', 'observe', 'observed', 'find',
  'found', 'spot', 'spotted', 'sense', 'sensed', 'experienced', 'experience',
  // other hazard words in a coordinated list ("no sparks or smoke")
  'smoke', 'smoking', 'fire', 'flames', 'flame', 'burning', 'burnt', 'burned', 'sparks', 'spark', 'sparking',
  'gas', 'propane', 'odor', 'odour', 'shock', 'shocks', 'electrical', 'electric', 'leak', 'leaks', 'leaking',
  'water', 'puddle', 'puddles', 'wet', 'damp', 'refrigerant', 'freon',
]);

function localScope(text: string, index: number): string {
  const prefix = text.slice(0, index);
  let start = 0;
  for (const match of prefix.matchAll(SCOPE_BOUNDARY)) start = (match.index ?? 0) + match[0].length;
  return prefix.slice(start);
}

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z']+|[^a-z']+$/gi, '').toLowerCase())
    .filter(Boolean);
}

// A negated list: "haven't noticed any unusual noises or burning smells",
// "no noise or smoke". Walking back past "or" may skip one earlier list item
// of up to two words, but only when that item is introduced by a quantifier
// or by "no" itself. "It won't heat or it smokes" and "not sure if it's
// steam or smoke" are therefore still hazard reports.
const LIST_INTRODUCER = new Set(['any', 'a', 'an', 'the', 'some', 'no', 'without']);
const LIST_ITEM_MAX_WORDS = 2;

// Walks back from the hazard phrase over transparent words only. The first
// non-transparent word ends the search, so a negation of something else
// ("won't STOP smoking") never cancels the hazard.
function isNegatedLocally(text: string, index: number): boolean {
  const before = words(localScope(text, index)).slice(-(NEGATION_WINDOW_WORDS + LIST_ITEM_MAX_WORDS));
  let i = before.length - 1;
  while (i >= 0) {
    const word = before[i]!;
    if (NEGATION_WORD.test(word)) return true;
    if (word === 'or' || word === 'nor') {
      // Skip the earlier list item when it is introduced by a quantifier.
      let j = i - 1;
      let skipped = 0;
      while (j >= 0 && skipped < LIST_ITEM_MAX_WORDS && !LIST_INTRODUCER.has(before[j]!) && !NEGATION_WORD.test(before[j]!)) {
        j -= 1;
        skipped += 1;
      }
      if (skipped > 0 && j >= 0 && LIST_INTRODUCER.has(before[j]!)) {
        i = j;
        continue;
      }
      if (skipped > 0) return false;
      i -= 1;
      continue;
    }
    if (!NEGATION_TRANSPARENT.has(word)) return false;
    i -= 1;
  }
  return false;
}

function gi(source: string): RegExp {
  return new RegExp(source, 'gi');
}

// Distance idioms are not negations: "water is not far from the outlet".
const DISTANCE_IDIOM = /\bnot\s+(?:too\s+|very\s+|that\s+|so\s+)?far\b/gi;

// Negative wording that intensifies or hedges rather than denies: "won't stop
// leaking", "no matter what", "without warning", "not sure if".
const NON_NEGATING_IDIOM =
  /\b(?:won't|wont|can't|cant|cannot|couldn't|couldnt|doesn't|doesnt|didn't|didnt|isn't|isnt|not|never|wouldn't|wouldnt)\s+(?:stop|stops|stopped|quit|quits|end)\b|\bno\s+matter\b|\bwithout\s+(?:warning|reason|stopping|notice)\b|\bnot\s+(?:sure|certain)\b|\b(?:can't|cant|cannot|couldn't|couldnt)\s+get\s+rid\b/gi;

function hasNegationInside(match: string): boolean {
  return match
    .replace(DISTANCE_IDIOM, ' ')
    .replace(NON_NEGATING_IDIOM, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z']+|[^a-z']+$/gi, ''))
    .some((word) => NEGATION_WORD.test(word));
}

// A negation about novelty or timing does not deny the hazard (C2): "never
// seen sparks like this before", "there's never been smoke like this", "it
// wasn't sparking until today". The wording after the hazard phrase shows that
// the hazard is present now.
// Fourth review: "never had sparks before today" reports sparks today.
const PRESENT_DESPITE_NEGATION =
  /^\s*(?:[a-z']+\s+){0,3}?(?:like\s+(?:this|that|it|these|those)\b|(?:this|that)\s+(?:bad|badly|much|many|thick|big|strong|often)\b|(?:until|till|til)\b|before\s+(?:today|tonight|now|this\s+(?:morning|afternoon|evening|week|time))\b)/i;

// Index of the first match the negation rules do not cancel, or -1.
function firstUnnegatedIndex(pattern: RegExp, text: string, options: { negationInside?: boolean } = {}): number {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const presentNow = PRESENT_DESPITE_NEGATION.test(text.slice(start + match[0].length));
    if (!presentNow && isNegatedLocally(text, start)) continue;
    if (!presentNow && options.negationInside && hasNegationInside(match[0])) continue;
    return start;
  }
  return -1;
}

function matchesUnnegated(pattern: RegExp, text: string, options: { negationInside?: boolean } = {}): boolean {
  return firstUnnegatedIndex(pattern, text, options) >= 0;
}

// Fourth review: a negated hazard followed by a clause or sentence that
// resumes it elliptically is present now: "It didn't spark before, but now
// it does", "It wasn't smoking yesterday but today it is", "... Now it does."
const RESUMPTION =
  /^(?:and\s+|so\s+|yet\s+|but\s+)?(?:(?:now|today|tonight|this\s+(?:morning|afternoon|evening|time|week)|lately|recently|suddenly|all\s+of\s+a\s+sudden)\s*,?\s*(?:it|they|there|this|mine)\s*(?:'s|\s+(?:does|do|is|are|did|has|have|was|were|keeps?|started|starts|began))\b|(?:it|they|this|mine)\s+(?:does|do|is|are|did|has|have)(?:\s+(?:now|today|tonight|again))?\s*[.!]*$)/i;

// A hazard named inside a general or hypothetical question is not a report:
// "Is there a risk of electric shock when cleaning the filter?", "Do these
// models ever catch fire?", "What if it sparks?". Wording that places the
// hazard in the present ("again", "now", "keeps", "started") makes it a
// report again. "Is it normal that it smells like gas?" has no hypothetical
// lead and stays a report.
const HYPOTHETICAL_LEAD =
  /\bwhat\s+(?:if|happens\s+if|would\s+happen\s+if|(?:should|do|would|can|must)\s+(?:i|we|you)\s+do\s+(?:if|when|in\s+case))\b|\b(?:risks?|chances?|dangers?|possibility|likelihood|odds)\s+of\b|\bin\s+case\s+(?:of|there|it|i|you)\b|\b(?:avoid|avoiding|prevent|preventing|reduce|minimi[sz]e)\b|\bever\b|\b(?:can|could|would|might|will|does|do)\s+(?:it|this|that|they|these|those|the\s+[a-z-]+|a\s+[a-z-]+|[a-z]+\s+models?)\s+(?:ever\s+|actually\s+|really\s+)?(?:give|cause|start|catch|lead\s+to|result\s+in)\b/i;
// Leads that are hypothetical only in a question ("Do these models ever
// catch fire?", "Can it give me a shock?").
const HYPOTHETICAL_REQUIRES_QUESTION = /^(?:ever|can|could|would|might|will|does|do)\b/i;
const PRESENT_INDICATOR =
  /\b(?:again|now|right\s+now|currently|already|just\s+(?:now|did|started|happened)|today|tonight|this\s+(?:morning|afternoon|evening)|keeps?|kept|started|starting|still|recently|earlier|yesterday|last\s+night|anymore|any\s+more)\b/i;

function isHypothetical(clause: string, index: number, question: boolean): boolean {
  const lead = HYPOTHETICAL_LEAD.exec(clause.slice(0, index));
  if (!lead) return false;
  if (HYPOTHETICAL_REQUIRES_QUESTION.test(lead[0]) && !question) return false;
  return !PRESENT_INDICATOR.test(clause);
}

// Sentences as in sentences(), each marked with whether it ends in "?".
function sentencesWithMood(text: string): Array<{ sentence: string; question: boolean }> {
  return [...text.matchAll(/[^.!?;\n]+([.!?;\n]*)/g)]
    .map((match) => ({ sentence: match[0].replace(/[.!?;\n]+$/, '').trim(), question: (match[1] ?? '').includes('?') }))
    .filter(({ sentence }) => sentence.length > 0);
}

// "Do these models ever catch fire? Mine just did." The short answer turns
// the hypothetical back into a report.
const HYPOTHETICAL_ANSWERED =
  /^(?:and\s+|well\s+|actually\s+|but\s+)?(?:mine|ours|it|this\s+one|my\s+[a-z-]+)\s+(?:just\s+|actually\s+|already\s+|now\s+|has\s+)?(?:did|does|has|is|was|had)\b(?:\s+(?:just\s+now|now|today|again|already|before))?\s*[.!]*$/i;

// I1: a negated list split by commas, "There is no smoke, gas smell or
// sparking". A comma-separated clause stays negated only when the previous
// clause ended in a negated hazard list and this clause has no verb or subject
// of its own (only list words and hazard nouns). "There's no smoke, it smells
// like gas" is still a gas report.
const HAZARD_LIST_NOUNS = new Set([
  'smoke', 'smoking', 'fire', 'flames', 'flame', 'burning', 'burnt', 'burned', 'sparks', 'spark', 'sparking',
  'arcing', 'gas', 'propane', 'smell', 'odor', 'odour', 'fumes', 'shock', 'shocks', 'leak', 'leaks', 'leaking',
  'water', 'puddle', 'puddles', 'refrigerant', 'freon', 'overheating',
]);
const LIST_FILLER = new Set(['a', 'an', 'the', 'any', 'some', 'or', 'nor', 'and', 'even', 'no', 'visible', 'obvious',
  'sign', 'signs', 'of', 'trace', 'traces', 'hint']);

function endsInNegatedHazardList(clause: string): boolean {
  const list = words(clause);
  let negation = -1;
  list.forEach((word, index) => {
    if (NEGATION_WORD.test(word)) negation = index;
  });
  if (negation < 0) return false;
  const tail = list.slice(negation + 1);
  return (
    tail.some((word) => HAZARD_LIST_NOUNS.has(word)) &&
    tail.every((word) => NEGATION_TRANSPARENT.has(word) || LIST_FILLER.has(word))
  );
}

function isVerblessHazardList(clause: string): boolean {
  const list = words(clause);
  return (
    list.length > 0 &&
    list.some((word) => HAZARD_LIST_NOUNS.has(word)) &&
    list.every((word) => HAZARD_LIST_NOUNS.has(word) || LIST_FILLER.has(word))
  );
}

// Clauses as in clauses(), each marked with whether it follows a bare comma.
function clausesWithBoundary(text: string): Array<{ clause: string; afterComma: boolean; start: number; end: number }> {
  const result: Array<{ clause: string; afterComma: boolean; start: number; end: number }> = [];
  let last = 0;
  let afterComma = false;
  for (const match of text.matchAll(/[.!?;:\n,]+|\bbut\b|\bhowever\b|\balthough\b/gi)) {
    const clause = text.slice(last, match.index).trim();
    if (clause) result.push({ clause, afterComma, start: last, end: match.index ?? last });
    afterComma = /^,+$/.test(match[0]);
    last = (match.index ?? 0) + match[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) result.push({ clause: tail, afterComma, start: last, end: text.length });
  return result;
}

// ---------------------------------------------------------------------------
// Immediate hazards reported by the user
// ---------------------------------------------------------------------------

const POWER_CONNECTOR = String.raw`(?:plugs?|sockets?|outlets?|wall (?:sockets?|outlets?)|power (?:cords?|leads?|cables?|points?|strips?)|extension (?:cords?|leads?)|cords?|cables?|leads?)`;
const MELT_CONTEXT = String.raw`(?:plastic|wires?|wiring|cords?|plugs?|sockets?|outlets?|insulation|knobs?|switch(?:es)?|panels?|housing|casing|elements?|motors?|components?|boards?|connectors?|terminals?|rubber|cables?|leads?|fuses?|buttons?|dials?|controls?)`;
const NOT_ABSORBER = String.raw`(?!\s+absorbers?)`;

// Intensifiers and hedges between a smell verb and "of/like gas" (C1): "smells
// strongly of gas", "smells a bit like gas", "reeks really badly of propane".
const SMELL_INTENSIFIER = String.raw`(?:(?:really|very|so|quite|pretty|strongly|faintly|slightly|mildly|vaguely|heavily|badly|definitely|distinctly|clearly|totally|absolutely|almost|just|kinda|weirdly|strangely|oddly|still|now|a\s+(?:bit|little|lot)|kind\s+of|sort\s+of)\s+){0,3}`;
const GAS_PART = String.raw`(?:pipes?|lines?|hoses?|valves?|connectors?|connections?|fittings?|regulators?|flex(?:es)?|taps?|cylinders?|bottles?|tanks?)`;
// Fire and smoke alarm maintenance ("the fire alarm battery chirps") is not a
// fire report; an alarm going off still is.
const ALARM_MAINTENANCE = String.raw`(?!\s+(?:alarms?|detectors?)\s+(?:batter(?:y|ies)|(?:keeps?\s+|is\s+|was\s+|started\s+)?chirp\w*))`;
// A hypothesis question about overheating ("is it overheating?", "could the
// motor be overheating") is not a report that it is overheating. "Why is it
// overheating?" presumes it is, so it still counts.
const NOT_OVERHEAT_HYPOTHESIS = String.raw`(?<!\b(?<!\bwhy\s+)(?:is|was|could|might|would|can|does|do)\s+(?:it|this|that|the\s+[a-z-]+|my\s+[a-z-]+|your\s+[a-z-]+)\s+(?:be\s+|still\s+)?|\b(?:maybe|perhaps|possibly|probably)\s+(?:it'?s\s+|it\s+is\s+)?)`;

const IMMEDIATE_HAZARDS: ReadonlyArray<readonly [SafetyCategory, RegExp]> = [
  // Gas: smells, leaks, rotten eggs and carbon monoxide alarms.
  ['GAS', gi(String.raw`\b(?:(?:gas|propane|lpg) (?:leak|smell|odou?r|stench|stink)s?|smell(?:s|ed|ing)?\s+${SMELL_INTENSIFIER}(?:of\s+|like\s+)?(?:natural\s+|propane\s+|lpg\s+)?(?:gas|propane)|rotten[- ]eggs? (?:smell|odou?r|stench))\b`)],
  // "stinks of gas", "reeks of gas", "a whiff of gas", "the stench of gas",
  // "smell of natural gas", "smell of propane gas", "a gassy smell".
  ['GAS', gi(String.raw`\b(?:stinks?|stank|stinking|stinky|reeks?|reeked|reeking)\s+${SMELL_INTENSIFIER}(?:of|like)\s+(?:natural\s+|propane\s+|lpg\s+)?(?:gas|propane)\b`)],
  // "the kitchen is full of gas", "the stove is giving off gas".
  ['GAS', gi(String.raw`\b(?:full|filled|filling)\s+(?:up\s+)?(?:of|with)\s+(?:natural\s+|propane\s+|lpg\s+)?(?:gas|propane)\b|\b(?:giv(?:e|es|ing)|gave|given|emit(?:s|ted|ting)?|releas(?:e|es|ed|ing)|let(?:s|ting)?)\s+(?:off|out)\s+(?:(?:a|some)\s+)?(?:natural\s+|propane\s+|lpg\s+)?(?:gas|propane)\b`)],
  // "the gas pipe is hissing", "hissing from the gas line".
  ['GAS', gi(String.raw`\b(?:gas|propane|lpg)\s+${GAS_PART}\s+(?:is\s+|are\s+|was\s+|keeps\s+|seems\s+to\s+be\s+|started\s+)?hiss\w*|\bhiss\w*\s+(?:(?:sound|noise)s?\s+)?(?:from|at|near|by|around|behind)\s+(?:the\s+|my\s+|a\s+)?(?:gas|propane|lpg)\b`)],
  // C8: a disconnected, loosened or broken gas connection is an active gas
  // hazard ("I disconnected the gas line", "the gas hose came off").
  ['GAS', gi(String.raw`\b(?:disconnected|unhooked|detached|removed|loosened|unscrewed|undid|undone|cut|broke|broken|snapped|cracked|damaged|split|pulled\s+(?:off|out))\s+(?:the\s+|my\s+|a\s+|our\s+|its\s+)?(?:[a-z-]+\s+)?(?:gas|propane|lpg)\s+${GAS_PART}\b`)],
  ['GAS', gi(String.raw`\b(?:gas|propane|lpg)\s+${GAS_PART}\s+(?:(?:is|are|was|were|got|has\s+been|have\s+been|seems?|looks?)\s+(?:\w+\s+)?(?:disconnected|loose|detached|unhooked|broken|cracked|damaged|split|undone|unscrewed)|(?:came|comes|come|popped|fell|has\s+come)\s+(?:\w+\s+)?(?:off|loose|out|apart))\b`)],
  ['GAS', gi(String.raw`\b(?:whiff|stench|stink|reek|smell|odou?r|scent|hint|trace)\s+of\s+(?:natural\s+|propane\s+|lpg\s+|cooking\s+)?(?:gas|propane)\b`)],
  ['GAS', gi(String.raw`\bgassy\s+(?:smell|odou?r|stench|stink|scent)\b|\b(?:smell|stink|reek)(?:s|ed|ing)?\s+(?:a\s+bit\s+|kind\s+of\s+|slightly\s+|really\s+|very\s+)?gassy\b`)],
  ['GAS', gi(String.raw`\b(?:leak(?:s|ed|ing)?|leaking out|escaping|hiss(?:es|ed|ing)?)\s+(?:natural\s+|propane\s+|lpg\s+)?gas\b`)],
  ['GAS', gi(String.raw`\b(?:gas|propane|lpg)\s+(?:is\s+|was\s+|keeps\s+|seems\s+to\s+be\s+)?(?:leak(?:s|ed|ing)?|escaping|coming out|hissing out)\b`)],
  ['GAS', gi(String.raw`\b(?:smell(?:s|ed|ing)?|stinks?|stank|odou?r)\s+(?:of\s+|like\s+)?(?:a\s+)?rotten[- ]eggs?\b`)],
  // A CO alarm's battery is maintenance, not an alarm going off.
  ['GAS', gi(String.raw`\bcarbon[- ]monoxide\b(?!\s+(?:alarm|detector)s?\s+batter)|\bco\s+(?:alarm|detector|alert|sensor)s?\b(?!\s+batter)`)],
  // Fire and smoke.
  // "Smoked salmon" in the fridge is food, not smoke.
  // I2: a burner flame's colour or size ("the burner flame is yellow") is a
  // combustion symptom, not a fire report. Flames coming out of an appliance
  // are still a fire report.
  ['FIRE_SMOKE', gi(String.raw`\b(?:smoke${ALARM_MAINTENANCE}|smokes|smoking|smoky|smokey|fire${ALARM_MAINTENANCE}(?!\s+up\b)|flames?(?=\s+(?:are\s+|is\s+|were\s+|was\s+)?(?:shooting|coming|leaping|spreading|bursting|pouring|billowing|licking|out|everywhere|from|inside|behind|under|in\s+the|on\s+the))|(?<!\b(?:yellow|orange|blue|lazy|weak|uneven|lifting|floating|sooty)\s)flames?(?!\s+(?:is|are|was|were|looks?|looked|seems?|burns?|burning|appears?|has\s+turned|turned|went|goes|keeps\s+going)\s+(?:(?:very|too|a\s+bit|quite|mostly|all|really)\s+)?(?:yellow|orange|blue|red|low|small|weak|uneven|lazy|lifting|floating|flickering|sooty|out)\b)|smoked(?!\s+(?:salmon|fish|meat|ham|cheese|sausages?|bacon|turkey|food|paprika)))\b`)],
  // "My toaster is burning the bread" and "burning question" are not fires.
  ['FIRE_SMOKE', gi(String.raw`\b(?:burning(?!\s+(?:the\s+|my\s+|our\s+|your\s+)?(?:bread|toast|bagels?|food|pizza|rice|cookies?|cakes?|meat|edges?|bottoms?|crusts?|question|desire))|charred|scorched)\b`)],
  ['FIRE_SMOKE', gi(String.raw`${NOT_OVERHEAT_HYPOTHESIS}\b(?:overheated|overheating)\b`)],
  // Melting is a fire sign only for appliance materials (plastic, wiring,
  // knobs, the element). Melted ice cream, ice or frost is not a hazard.
  ['FIRE_SMOKE', gi(String.raw`\b(?:melted|melting|melts)\s+(?:[a-z-]+\s+){0,2}?${MELT_CONTEXT}\b`)],
  ['FIRE_SMOKE', gi(String.raw`\b${MELT_CONTEXT}\s+(?:(?:has|have|had|is|was|are|were|got|looks?|looked|seems?|seemed|started|starting|began|appears?)\s+)?(?:(?:to|all|partly|partially|slightly|completely|a\s+bit|been)\s+)?(?:melted|melting|melt|melts)\b`)],
  ['FIRE_SMOKE', gi(String.raw`\bsomething\s+(?:is\s+|was\s+|has\s+)?melt(?:ed|ing)\b|\bsmell(?:s|ed|ing)?\s+(?:like\s+|of\s+)?(?:something\s+)?melt(?:ed|ing)\b`)],
  ['FIRE_SMOKE', gi(String.raw`\bburnt\s+(?:smell|odou?r|plastic|rubber)\b|\bsmell(?:s|ed|ing)?\s+(?:like\s+)?(?:something\s+)?burnt\b`)],
  // Electrical: sparks, shocks, live or exposed wiring, damaged or hot
  // connectors.
  ['ELECTRICAL', gi(String.raw`\b(?:sparks?|sparking|sparked|arcing)\b`)],
  ['ELECTRICAL', gi(String.raw`\b(?:electric(?:al)? shock|shocked|electrocuted|electrocution)\b`)],
  ['ELECTRICAL', gi(String.raw`\b(?:got|get|gets|getting|received?|receiving|felt|feel|feeling|had)\s+(?:a\s+|an\s+)?(?:[a-z]+\s+)?(?:electric(?:al)?\s+)?shocks?\b${NOT_ABSORBER}`)],
  ['ELECTRICAL', gi(String.raw`\b(?:zapped|shocked)\s+(?:me|us|him|her|them|my)\b|\b(?:gave|gives|giving)\s+(?:me|us|him|her|them)\s+(?:a\s+|an\s+)?(?:[a-z]+\s+)?shocks?\b${NOT_ABSORBER}`)],
  ['ELECTRICAL', gi(String.raw`\blive (?:wire|wiring|terminal)s?\b`)],
  ['ELECTRICAL', gi(String.raw`\bexposed\b[^.!?;,]{0,50}\b(?:mains|voltage|wires?|wiring|electrical|terminals?)\b`)],
  ['ELECTRICAL', gi(String.raw`\b(?:mains|voltage|wires?|wiring)\b[^.!?;,]{0,50}\bexposed\b`)],
  ['ELECTRICAL', gi(String.raw`\bfray(?:ed|ing)\s+(?:power\s+|electrical\s+)?(?:cords?|cables?|wires?|wiring|leads?|plugs?)\b`)],
  ['ELECTRICAL', gi(String.raw`\b(?:cords?|cables?|wires?|wiring|leads?)\s+(?:is|are|was|were|looks?|looked|got|has|have|seems?)\s+(?:[a-z]+\s+)?fray(?:ed|ing)\b`)],
  ['ELECTRICAL', gi(String.raw`\bbare\s+(?:copper\s+|metal\s+)?(?:wires?|wiring|conductors?)\b|\b(?:wires?|wiring)\s+(?:is|are|was|were)\s+(?:[a-z]+\s+)?bare\b`)],
  ['ELECTRICAL', gi(String.raw`\b(?:burnt|burned|scorched|charred|blackened|melted)\s+(?:[a-z]+\s+)?(?:plugs?|sockets?|outlets?|cords?|wires?|wiring|cables?)\b`)],
  ['ELECTRICAL', gi(String.raw`\b${POWER_CONNECTOR}\s+(?:is|are|was|were|looks?|looked|got|has|have|went|turned|seems?)\s+(?:[a-z]+\s+){0,2}?(?:burnt|burned|scorched|charred|blackened|melted|discolou?red)\b`)],
  ['ELECTRICAL', gi(String.raw`\b${POWER_CONNECTOR}\s+(?:is|are|was|were|gets?|got|getting|feels?|felt|becomes?|became|runs?|running|seems?)\s+(?:[a-z]+\s+)?(?:hot|warm to the touch)\b|\bhot\s+(?:plugs?|sockets?|outlets?|power cords?)\b`)],
  // Refrigerant.
  ['REFRIGERANT', gi(String.raw`\b(?:refrigerant|freon|coolant) leaks?\b`)],
  ['REFRIGERANT', gi(String.raw`\bleak(?:s|ed|ing)?\s+(?:out\s+)?(?:refrigerant|freon|coolant)\b|\b(?:refrigerant|freon|coolant)\s+(?:is\s+|was\s+)?(?:leak(?:s|ed|ing)?|escaping|coming out)\b`)],
];

const WATER = String.raw`(?:water|wet|leak(?:s|ed|ing)?|puddles?|flood(?:ed|ing|s)?|damp|soaked|soaking|dripping|drips?|moisture|spill(?:s|ed|ing)?|pool(?:s|ed|ing))`;
const ELECTRIC_POINT = String.raw`(?:outlets?|sockets?|wall sockets?|plugs?|power (?:cords?|cables?|leads?|points?|strips?|supply|supplies|board)|(?:extension|electrical) (?:cords?|leads?|box(?:es)?)|cords?|wiring|wires?|electrical|electrics|electronics|control (?:boards?|panels?)|circuit boards?|pcbs?|surge protectors?|fuse box|breaker (?:box|panel)|electrical panel)`;
const NEAR = String.raw`(?:on|onto|near|nearby|around|under|underneath|into|in|behind|by|over|beside|next to|close to|where|not (?:too |very |that |so )?far from|(?:a )?(?:few|couple of) (?:inches|feet|centimet(?:er|re)s|cm) (?:from|away from)|reach(?:es|ed|ing)?|touch(?:es|ed|ing)?|at|toward|towards)`;
const DETERMINER = String.raw`(?:the|a|an|my|our|its|their|this|that|some)`;

const WATER_ELECTRICAL_PATTERNS: readonly RegExp[] = [
  // "water is leaking near the outlet", "puddle where the socket is"
  gi(String.raw`\b${WATER}\b[^.!?;]{0,60}?\b${NEAR}\s+(?:${DETERMINER}\s+)?(?:[a-z-]+\s+)?${ELECTRIC_POINT}\b`),
  // "wet power cord", "damp outlet"
  gi(String.raw`\b(?:wet|damp|soaked|flooded|waterlogged)\s+(?:[a-z-]+\s+)?${ELECTRIC_POINT}\b`),
  // "the plug is wet", "control board got soaked", "cord is sitting in water"
  gi(String.raw`\b${ELECTRIC_POINT}\b[^.!?;]{0,20}\b(?:wet|damp|soaked|flooded|waterlogged|in (?:a |the )?(?:water|puddle))\b`),
];

// A leak or wet floor near the appliance. Not a hazard on its own, but it
// makes touching the plug or socket unsafe, so plug-pulling advice is replaced
// with circuit-breaker isolation.
const WET_CONDITION = gi(
  String.raw`\b(?:leak(?:s|ed|ing)?|leakage|puddl(?:e|es|ed|ing)|flood(?:s|ed|ing)?|overflow(?:s|ed|ing)?|pool(?:s|ed|ing)|spill(?:s|ed|ing)|gush(?:es|ed|ing)|water\s+(?:is\s+|was\s+)?(?:on|all over|everywhere|under|underneath|around|coming out|pouring|spraying)|(?:floor|ground|carpet|rug|tiles?)\s+(?:is\s+|was\s+|are\s+|got\s+)?(?:[a-z]+\s+)?(?:wet|soaked|soaking|flooded|damp)|wet\s+(?:floor|ground|carpet|rug|tiles?))\b`,
);

// ---------------------------------------------------------------------------
// CR-A: gas co-occurrence
// ---------------------------------------------------------------------------
//
// Fixed phrases cannot keep up with natural wording ("it smelt of gas when I
// came in", "smells strongly and distinctly of gas", "I can hear gas hissing
// behind the stove", "I took the gas hose off", "the gas connector snapped").
// A sentence is therefore a possible gas emergency when it contains:
//  1. a gas term and a smell / hiss / leak / escape term close to each other,
//  2. gas hardware and a damage or disconnection term, or
//  3. a reported disconnection of "the gas".
// The word "gas" on its own never counts ("my gas oven won't heat"). A smell
// attributed to something else ("smells of burnt toast", "smells musty"), a
// water leak, negation in the same scope and gas used only as an appliance
// descriptor far from the hazard word are not gas reports. Conservative false
// positives are accepted for plausible gas reports.

const GAS_WORD = String.raw`(?:gas|propane|lpg|butane)`;
const GAS_APPLIANCE_WORD = String.raw`(?:stoves?|ovens?|ranges?|dryers?|cookers?|hobs?|cooktops?|burners?|grills?|bbqs?|barbecues?|heaters?|boilers?|furnaces?|fireplaces?|fires?|appliances?|fridges?|refrigerators?|models?|versions?|units?|tops?|rings?|water\s+heaters?)`;
// Gas used for something other than the substance or its supply.
const GAS_NOT_SUBSTANCE = String.raw`(?:bills?|mark|stations?|prices?|pedals?|mileage|company|companies|supplier|suppliers|provider|safe|engineers?|certificates?|tariffs?|account)`;
const GAS_TERM = gi(String.raw`\b(?:natural\s+gas|${GAS_WORD})\b(?!\s+${GAS_NOT_SUBSTANCE}\b)`);
const GAS_DESCRIPTOR_AFTER = new RegExp(String.raw`^\s+(?:[a-z-]+\s+)?${GAS_APPLIANCE_WORD}\b`, 'i');
const GAS_HAZARD_TERM = gi(
  String.raw`\b(?:smell\w*|smelt|stink\w*|stank|reek\w*|odou?rs?|whiff|stench|fumes?|hiss\w*|leak\w*|escap\w*)\b`,
);
// The smell is attributed to something other than gas.
const SMELL_ATTRIBUTED_ELSEWHERE = new RegExp(
  String.raw`^\s+${SMELL_INTENSIFIER}(?:(?:of|like)\s+(?:a\s+|the\s+|some\s+|an\s+)?(?!(?:natural\s+)?${GAS_WORD}\b|rotten|eggs?\b|sulph|sulf|something\b)[a-z]+|(?:musty|mouldy|moldy|damp|burnt|burned|burning|smoky|smokey|fishy|sour|stale|plasticky|clean|fresh|nice|good|fine|normal|sweet|mildewy|of\s+mildew))`,
  'i',
);
const LIQUID = String.raw`(?:water|oil|fluid|coolant|refrigerant|freon|grease|fat|liquid)`;
const LEAK_IS_LIQUID_BEFORE = new RegExp(String.raw`\b${LIQUID}\s+(?:is\s+|was\s+|keeps\s+|has\s+been\s+|started\s+)?$`, 'i');
const LEAK_IS_LIQUID_AFTER = new RegExp(String.raw`^\s+(?:out\s+)?(?:some\s+|a\s+lot\s+of\s+)?${LIQUID}\b`, 'i');
const GAS_HW = String.raw`(?:hoses?|lines?|pipes?|piping|tubes?|tubing|connectors?|connections?|fittings?|flex(?:es)?|valves?|regulators?|taps?|cocks?|supply|supplies|bayonets?|couplings?)`;
// Words that mean "turned off" rather than "came off" for a valve or tap.
const GAS_CLOSURE_HW = /^(?:valves?|taps?|cocks?|supply|supplies)$/i;
const GAS_HW_MENTION = gi(
  String.raw`\b${GAS_WORD}\s+(?:[a-z-]+\s+)?(${GAS_HW})\b|\b(${GAS_HW})\s+(?:for|to|from|of|on)\s+(?:the\s+)?${GAS_WORD}\b`,
);
const GAS_DAMAGE = gi(
  String.raw`\b(?:loose|loosened|disconnected|detached|unhooked|unscrewed|undone|undid|broken|snapped|cracked|split|damaged|punctured|ripped|torn|severed|bent|kinked|crushed|removed|(?:came|come|comes|coming|fell|falls|falling|popped|pops|knocked|pulled|ripped|broke|snapped|took|taken|got)\s+(?:[a-z'-]+\s+){0,4}?(?:off|out|loose|apart|away)|(?:is|was|are|were|'s|been)\s+(?:now\s+|still\s+|completely\s+|just\s+)?(?:off|out|loose|apart))\b`,
);
// "I disconnected the gas to move the stove". An electrical unplug of a gas
// appliance ("disconnected the gas dryer from the wall socket") is not.
const GAS_DISCONNECTED = gi(
  String.raw`\b(?:disconnected|unhooked|detached|capped|removed|took\s+off|taken\s+off)\s+(?:the\s+|my\s+|our\s+)?(?:natural\s+)?${GAS_WORD}\b(?!\s+${GAS_NOT_SUBSTANCE}\b)(?![^.!?;\n]{0,40}\bfrom\s+(?:the\s+)?(?:wall|socket|outlet|plug|power|mains|electric))`,
);

const OTHER_APPLIANCE = new RegExp(String.raw`\b(?:${GAS_APPLIANCE_WORD}|dishwashers?|washers?|washing\s+machines?|freezers?|microwaves?|kettles?|toasters?|bins?|drains?|sinks?)\b`, 'i');
// The appliance word right after the gas descriptor itself ("gas HOB won't
// light") is not another appliance.
const GAS_DESCRIPTOR_LEAD = new RegExp(String.raw`^\s+(?:[a-z-]+\s+)?${GAS_APPLIANCE_WORD}\b`, 'i');

function wordPosition(text: string, index: number): number {
  return text.slice(0, index).split(/\s+/).filter(Boolean).length;
}

// A negation between two linked terms ("the gas hob doesn't smell") cancels
// the pair, unless a new clause starts after it ("won't light and smells").
function negatedBetween(between: string): boolean {
  let start = 0;
  for (const match of between.matchAll(SCOPE_BOUNDARY)) start = (match.index ?? 0) + match[0].length;
  return hasNegationInside(between.slice(start));
}

function linkedTermsNegated(sentence: string, first: { index: number; end: number }, second: { index: number; end: number }): boolean {
  const presentNow = PRESENT_DESPITE_NEGATION.test(sentence.slice(second.end));
  if (presentNow) return false;
  return (
    isNegatedLocally(sentence, first.index) ||
    isNegatedLocally(sentence, second.index) ||
    negatedBetween(sentence.slice(first.end, second.index))
  );
}

// Smell, hiss, leak or escape terms that are not attributed to something
// other than gas (burnt toast, water).
function gasHazardTerms(sentence: string): Array<{ index: number; end: number }> {
  const result: Array<{ index: number; end: number }> = [];
  for (const hazard of sentence.matchAll(GAS_HAZARD_TERM)) {
    const index = hazard.index ?? 0;
    const end = index + hazard[0].length;
    const after = sentence.slice(end);
    if (/^(?:smell|stink|reek|odou?r|whiff|stench)/i.test(hazard[0]) && SMELL_ATTRIBUTED_ELSEWHERE.test(after)) continue;
    if (/^leak/i.test(hazard[0]) && (LEAK_IS_LIQUID_BEFORE.test(sentence.slice(0, index)) || LEAK_IS_LIQUID_AFTER.test(after))) continue;
    result.push({ index, end });
  }
  return result;
}

// A sentence identifying something as gas: "I think it's gas.", "Could it
// be gas?", "Probably propane." Used with an adjacent smell / hiss / leak
// sentence ("There's a strange smell in the kitchen. I think it's gas.").
const GAS_IDENTIFIED = gi(
  String.raw`\b(?:it'?s|it\s+is|it\s+was|that'?s|that\s+is|be|being|maybe|probably|possibly|definitely|perhaps|surely|like|of|from\s+the|think|thought|guess|suspect)\s+(?:the\s+|a\s+|some\s+)?(?:natural\s+)?${GAS_WORD}\b(?!\s+(?:${GAS_APPLIANCE_WORD}|${GAS_NOT_SUBSTANCE})\b)`,
);

// GAS when a sentence with an unnegated smell / hiss / leak term sits next to
// a sentence that identifies it as gas.
function gasAcrossSentences(texts: readonly string[]): number {
  for (let index = 0; index < texts.length; index += 1) {
    const sentence = texts[index]!;
    const hasHazard = gasHazardTerms(sentence).some(({ index: at }) => !isNegatedLocally(sentence, at));
    if (!hasHazard) continue;
    for (const neighbour of [texts[index - 1], texts[index + 1]]) {
      if (neighbour === undefined) continue;
      for (const match of neighbour.matchAll(GAS_IDENTIFIED)) {
        const gasAt = (match.index ?? 0) + match[0].search(new RegExp(String.raw`\b(?:natural\s+)?${GAS_WORD}\b`, 'i'));
        if (!isNegatedLocally(neighbour, gasAt) && !negatedBetween(neighbour.slice(0, gasAt).slice(-30))) return index;
      }
    }
  }
  return -1;
}

// Index of a possible gas report in the sentence, or -1. Terms at positions
// for which `ignored` is true (a negated verbless list) do not count.
function gasCooccurrence(sentence: string, ignored: (index: number) => boolean = () => false): number {
  const gasTerms = [...sentence.matchAll(GAS_TERM)].filter((match) => !ignored(match.index ?? 0)).map((match) => {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    return { index, end, word: wordPosition(sentence, index), descriptor: GAS_DESCRIPTOR_AFTER.test(sentence.slice(end)) };
  });
  if (gasTerms.length === 0) return -1;

  // 1. Gas with a smell, hiss, leak or escape term.
  for (const { index, end } of gasHazardTerms(sentence)) {
    if (ignored(index)) continue;
    const word = wordPosition(sentence, index);
    for (const gas of gasTerms) {
      if (Math.abs(gas.word - word) > (gas.descriptor ? 6 : 10)) continue;
      const [first, second] = gas.index < index ? [gas, { index, end }] : [{ index, end }, gas];
      // "I have a gas stove and the dishwasher smells": another appliance
      // between a descriptor and the smell takes the smell.
      if (gas.descriptor && OTHER_APPLIANCE.test(sentence.slice(Math.min(gas.end, end), Math.max(gas.index, index)).replace(GAS_DESCRIPTOR_LEAD, ''))) continue;
      if (linkedTermsNegated(sentence, first, second)) continue;
      return Math.min(gas.index, index);
    }
  }

  // 2. Gas hardware that is loose, broken, removed or disconnected.
  const hardware = [...sentence.matchAll(GAS_HW_MENTION)].filter((match) => !ignored(match.index ?? 0));
  for (const damage of sentence.matchAll(GAS_DAMAGE)) {
    const index = damage.index ?? 0;
    const end = index + damage[0].length;
    for (const part of hardware) {
      const partIndex = part.index ?? 0;
      const partEnd = partIndex + part[0].length;
      const noun = part[1] ?? part[2] ?? '';
      if (GAS_CLOSURE_HW.test(noun) && /\b(?:is|was|are|were|'s|been)\b[^]*\boff$/i.test(damage[0])) continue;
      if (Math.abs(wordPosition(sentence, partIndex) - wordPosition(sentence, index)) > 8) continue;
      const [first, second] = partIndex < index ? [{ index: partIndex, end: partEnd }, { index, end }] : [{ index, end }, { index: partIndex, end: partEnd }];
      if (linkedTermsNegated(sentence, first, second)) continue;
      return Math.min(partIndex, index);
    }
  }

  // 3. "Disconnected the gas".
  return firstUnnegatedIndex(GAS_DISCONNECTED, sentence);
}

// ---------------------------------------------------------------------------
// Dangerous work: invasive action + restricted subject
// ---------------------------------------------------------------------------

const IRREGULAR: Readonly<Record<string, readonly string[]>> = {
  take: ['take', 'takes', 'took', 'taken', 'taking'],
  hold: ['hold', 'holds', 'held', 'holding'],
  override: ['override', 'overrides', 'overrode', 'overridden', 'overriding'],
  top: ['top', 'tops', 'topped', 'topping'],
  get: ['get', 'gets', 'got', 'gotten', 'getting'],
  break: ['break', 'breaks', 'broke', 'broken', 'breaking'],
  pull: ['pull', 'pulls', 'pulled', 'pulling'],
  pop: ['pop', 'pops', 'popped', 'popping'],
  gut: ['gut', 'guts', 'gutted', 'gutting'],
  buy: ['buy', 'buys', 'bought', 'buying'],
  swap: ['swap', 'swaps', 'swapped', 'swapping'],
  put: ['put', 'puts', 'putting'],
  cut: ['cut', 'cuts', 'cutting'],
  strip: ['strip', 'strips', 'stripped', 'stripping'],
  clip: ['clip', 'clips', 'clipped', 'clipping'],
  grab: ['grab', 'grabs', 'grabbed', 'grabbing'],
  snip: ['snip', 'snips', 'snipped', 'snipping'],
  bleed: ['bleed', 'bleeds', 'bled', 'bleeding'],
  undo: ['undo', 'undoes', 'undid', 'undone', 'undoing'],
  lay: ['lay', 'lays', 'laid', 'laying'],
  run: ['run', 'runs', 'ran', 'running'],
  stick: ['stick', 'sticks', 'stuck', 'sticking'],
  drag: ['drag', 'drags', 'dragged', 'dragging'],
  set: ['set', 'sets', 'setting'],
  read: ['read', 'reads', 'reading'],
};

function allForms(verb: string): string[] {
  const head = verb.split(' ')[0]!;
  return [
    ...(IRREGULAR[head]
      ?? (head.endsWith('e')
        ? [head, `${head}s`, `${head}d`, `${head.slice(0, -1)}ing`]
        : /[^aeiou]y$/.test(head)
          ? [head, `${head.slice(0, -1)}ies`, `${head.slice(0, -1)}ied`, `${head}ing`]
          : /(?:s|sh|ch|x|z)$/.test(head)
            ? [head, `${head}es`, `${head}ed`, `${head}ing`]
            : [head, `${head}s`, `${head}ed`, `${head}ing`])),
  ];
}

function pastHeadForms(verb: string): string[] {
  const head = verb.split(' ')[0]!;
  const irregular = IRREGULAR[head];
  return irregular
    ? irregular.filter((form) => form !== head && !form.endsWith('ing') && !form.endsWith('s'))
    : head.endsWith('e')
      ? [`${head}d`]
      : /[^aeiou]y$/.test(head)
        ? [`${head.slice(0, -1)}ied`]
        : [`${head}ed`];
}

function withRest(verb: string, heads: readonly string[]): string[] {
  const rest = verb.split(' ').slice(1);
  return heads.map((form) => [form, ...rest].join(String.raw`[\s-]+`));
}

function presentVerbs(list: readonly string[]): string {
  return `(?:${list
    .flatMap((verb) => {
      const past = new Set(pastHeadForms(verb));
      return withRest(verb, allForms(verb).filter((form) => !past.has(form)));
    })
    .join('|')})`;
}

// Verbs whose past form is identical to the present ("put", "set", "read")
// have no distinct past forms; an empty alternation would match everywhere,
// so it becomes a pattern that never matches.
function pastVerbs(list: readonly string[]): string {
  const forms = list.flatMap((verb) => withRest(verb, pastHeadForms(verb)));
  return forms.length ? `(?:${forms.join('|')})` : '(?!x)x';
}

const GENERAL_ACTIONS = [
  'check', 'test', 'measure', 'probe', 'inspect', 'open', 'remove', 'replace', 'charge', 'recharge',
  'refill', 'top up', 'add', 'bypass', 'short', 'jump', 'bridge', 'disconnect', 'reconnect', 'adjust',
  'repair', 'fix', 'install', 'handle', 'touch', 'unscrew', 'pry', 'service', 'discharge', 'rewire',
  'solder', 'disassemble', 'dismantle', 'take apart', 'take off', 'swap', 'loosen', 'tighten', 'buy',
  'purchase', 'unhook', 'detach', 'undo', 'unfasten', 'jumper',
] as const;

const PAST_ACTIONS = [
  'test', 'check', 'measure', 'replace', 'recharge', 'refill', 'charge', 'bypass', 'open', 'handle',
  'service', 'disconnect', 'repair', 'discharge', 'rewire', 'short', 'jump', 'remove', 'dismantle',
  'swap', 'loosen', 'unhook', 'detach', 'undo', 'bridge', 'cut', 'splice', 'clip', 'snip', 'bleed',
  'disable', 'defeat', 'override', 'tamper', 'unscrew', 'disassemble', 'take apart', 'take off', 'unplug',
  'jumper', 'ground',
] as const;

// C8: completed work that leaves a hazard behind - an opened appliance, a
// defeated safety device, a disconnected gas connection or a shorted
// capacitor. A request anywhere in the same message ("What now?") is then a
// request to continue that work. Completed work that restores the appliance
// ("I replaced the thermal fuse") is not in this list.
const HAZARD_LEAVING_ACTIONS = new Set<string>([
  'bypass', 'short', 'jump', 'bridge', 'disconnect', 'unhook', 'detach', 'undo', 'loosen', 'open', 'remove',
  'take off', 'take apart', 'discharge', 'rewire', 'cut', 'splice', 'clip', 'snip', 'bleed', 'defeat',
  'disable', 'override', 'tamper', 'unscrew', 'pry', 'disassemble', 'dismantle', 'unplug', 'jumper', 'ground',
]);

type RestrictedSubject = {
  subject: string;
  actions: readonly string[];
  // Removing the appliance's own panels or casing: the appliance is then
  // open, so any request in the same message is about work inside it.
  opening?: boolean;
};

// "Magnetron" and common misspellings: magnatron, magentron, magnitron,
// megnetron, magneton.
const MAGNETRON = String.raw`(?:m[ae]g(?:n[aeiou]|en)tr?[aeo]ns?)`;

const MICROWAVE_SHELL = String.raw`(?:outer\s+)?(?:covers?|casing|case|housing|shell|cabinet|panels?|lid)`;
const POSSESSIVE = String.raw`(?:the\s+|your\s+|my\s+|this\s+|its\s+)?`;
const BODY_PANEL = String.raw`(?:(?:back|rear|side|top|front|service|control|main|electrical|outer)\s+panels?|(?:outer\s+|main\s+)?(?:casing|housing|cabinet)|(?:appliance|unit|machine|oven|dishwasher|dryer|washer|fridge|refrigerator|freezer)(?:'s)?\s+(?:cover|case|casing|housing))`;

// Capacitors, including the "cap" / "HV cap" shorthand. A bare "cap" is only
// restricted with shorting or discharging actions: a drain-filter cap is not.
const CAPACITOR = String.raw`(?:capacitors?|(?:hv|high[- ]voltage)\s+caps?)`;
// Gas supply hardware. Igniters and thermocouples are listed separately so a
// user can still be asked to check whether the igniter glows.
// C5: gas control/safety valves, oven safety valves and burner valves. A bare
// "valve" (water inlet valve, drain valve) is not gas hardware.
const GAS_HARDWARE = String.raw`(?:gas (?:(?:control|safety|shut-?off|main|burner|oven)\s+)?(?:lines?|valves?|pipes?|hoses?|connections?|connectors?|fittings?|regulators?|flex(?:es)?|supply|supplies|cocks?|shut-?offs?)|propane (?:lines?|valves?|regulators?|hoses?)|(?:oven|range|stove|burner|cooktop|hob|pilot)\s+(?:(?:safety|gas|control)\s+)?valves?|safety\s+valves?)`;
const GAS_IGNITION = String.raw`(?:thermocouples?|ignit(?:er|or)s?)`;
// A gas appliance being disconnected or moved may strain its gas connection.
const GAS_APPLIANCE = String.raw`(?:gas\s+(?:stoves?|ranges?|ovens?|dryers?|cookers?|hobs?|cooktops?|water\s+heaters?|boilers?|appliances?|fireplaces?|grills?))`;
// C5: TCO (thermal cut-off) and thermal limiters are safety devices too.
const SAFETY_DEVICE = String.raw`(?:safety (?:device|switch|interlock|thermostat|cut-?out)s?|thermal (?:fuse|cut-?off|cut-?out|limiter|limit(?: switch)?)s?|(?:high|hi)[- ]limit (?:thermostats?|switch(?:es)?|limiters?)|tcos?|limiter thermostats?)`;
// C5: microwave inverter boards are part of the high-voltage section.
const INVERTER = String.raw`(?:(?:microwave\s+)?inverter\s+(?:boards?|modules?|assembl(?:y|ies)|circuits?|pcbs?)|microwave(?:'s)?\s+inverters?)`;
const VOLTS = String.raw`(?:\d+\s?(?:v|vac|volts?)|volts?|vac)`;

// Components that are never recommended for user replacement, through text or
// through the parts channel: high-voltage and microwave parts, capacitors,
// safety devices, gas hardware, the sealed refrigeration system, mains-level
// wiring and safety interlocks.
// Door switches are restricted as parts too (C5): on a microwave they are the
// door interlock, and a replacement assembly may contain one.
const RESTRICTED_COMPONENT = String.raw`(?:${MAGNETRON}|(?:high[- ]voltage|hv)\s+(?:transformers?|capacitors?|caps?|diodes?|fuses?|components?|parts?|boards?)|${INVERTER}|${CAPACITOR}|${SAFETY_DEVICE}|${GAS_HARDWARE}|${GAS_IGNITION}|compressors?|(?:compressor|start) relays?|overload (?:relays?|protectors?)|refrigerant|freon|coolant|sealed system|terminal blocks?|wiring harness(?:es)?|(?:circuit )?breakers?|electrical panels?|fuse box(?:es)?|consumer units?|door (?:locks?|latch(?:es)?|interlocks?|switch(?:es)?)(?: assembly| assemblies)?|lid (?:locks?|switch(?:es)?)|interlocks?)`;
const RESTRICTED_COMPONENT_PATTERN = new RegExp(String.raw`\b${RESTRICTED_COMPONENT}\b`, 'i');

// CR-C: microwave internals. Everything behind a microwave's casing sits next
// to the high-voltage section, so these are never user parts: the HV diode,
// internal (ceramic) fuses, the transformer, the primary / secondary /
// monitor interlock switches, inverter and control boards, the magnetron and
// the HV capacitor. Diodes and rectifiers have no other household-appliance
// meaning, so they are restricted everywhere.
const HV_PART = String.raw`(?:high[- ]voltage|hv)\s+(?:transformers?|capacitors?|caps?|diodes?|rectifiers?|fuses?|components?|parts?|boards?|circuits?|section|sides?|wires?|wiring|leads?|terminals?|areas?)`;
const MICROWAVE_INTERNAL = String.raw`(?:microwave(?:'s)?\s+(?:(?:high[- ]voltage|hv|internal|main|control|power|door|ceramic|line|inverter|relay|display|interlock|safety|thermal)\s+)?(?:diodes?|fuses?|transformers?|capacitors?|boards?|pcbs?|inverters?|interlocks?|(?:interlock\s+|door\s+|latch\s+)?switch(?:es)?|wiring|wires?|components?|internals?|electronics|relays?|thermostats?|thermal\s+(?:fuses?|cut-?offs?|protectors?)|magnetrons?)|(?:primary|secondary|monitor)\s+(?:interlock\s+|door\s+|latch\s+)?switch(?:es)?|diodes?|rectifiers?)`;
// With the appliance known to be a microwave, these bare names are internal
// parts too ("replace the fuse", "a new transformer").
const MICROWAVE_CONTEXT_PART = String.raw`(?:(?:(?:ceramic|main|line|internal|glass|thermal)\s+)?fuses?|transformers?|(?:control|main|power|display|relay|inverter|circuit|pcb)\s+boards?|pcbs?|relays?|(?:door|interlock|latch|safety)\s+switch(?:es)?|interlocks?|thermal\s+(?:protectors?|switch(?:es)?)|thermostats?|internal\s+(?:wiring|wires?|parts?|components?))`;
const MICROWAVE_INTERNAL_PATTERN = new RegExp(String.raw`\b(?:${HV_PART}|${MICROWAVE_INTERNAL})\b`, 'i');
// The only microwave parts a user may replace: the turntable and its
// supports, filters, the waveguide cover, racks, knobs, handles and mounting
// kits. Any other microwave part is treated as internal.
const MICROWAVE_USER_PART =
  /^(?:(?:glass\s+)?(?:turntable|tray|plate)(?:\s+(?:tray|plate|glass|supports?|rings?|rollers?|couplers?|couplings?|hubs?|guides?)){0,2}|roller\s+(?:rings?|guides?|supports?)|(?:turntable\s+)?(?:supports?|rollers?|rings?|couplers?|couplings?|hubs?|drive\s+(?:dogs?|couplers?))|(?:(?:grease|charcoal|carbon|vent|recirculating|odou?r)\s+)?filters?|waveguide\s+covers?|mica\s+(?:sheets?|covers?|plates?)|racks?|shelf|shelves|knobs?|(?:door\s+)?handles?|(?:mounting|installation|trim)\s+(?:kits?|plates?|brackets?))$/i;
const COMPONENT_NOISE = /\b(?:microwave(?:'s)?|replacement|genuine|oem|original|new|spare|assembly|assy|part|parts|for|the|a|an|compatible|universal|kit\s+of)\b/gi;
const MICROWAVE_MENTION = /\bmicrowaves?\b(?![\s-]+(?:safe|popcorn|meals?|dinners?|bowls?|dishes|containers?|cookware)\b)/i;

// True when any of the texts shows that the appliance is a microwave.
export function mentionsMicrowave(texts: ReadonlyArray<string | null | undefined>): boolean {
  return texts.some((text) => Boolean(text && MICROWAVE_MENTION.test(normalizeText(text))));
}

export type ComponentContext = { microwave?: boolean };

// True when a component name refers to a part that must not be recommended
// for user replacement. With a microwave (named in the component or known
// from the conversation), only the user-serviceable allowlist is permitted.
export function isRestrictedComponent(component: string | null | undefined, context: ComponentContext = {}): boolean {
  if (!component) return false;
  const text = normalizeText(component);
  if (RESTRICTED_COMPONENT_PATTERN.test(text) || MICROWAVE_INTERNAL_PATTERN.test(text)) return true;
  if (!context.microwave && !MICROWAVE_MENTION.test(text)) return false;
  const core = text.replace(COMPONENT_NOISE, ' ').replace(/[^a-z\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
  return core.length > 0 && !MICROWAVE_USER_PART.test(core);
}

const RESTRICTED_SUBJECTS: readonly RestrictedSubject[] = [
  // Live electrics. Unplugging the appliance itself from the wall is handled
  // by SAFE_ISOLATION below.
  {
    subject: String.raw`(?:mains|voltage|live (?:wire|wiring|terminal)s?|${CAPACITOR}|earth wire|ground wire|(?:compressor|start) relay|overload (?:relay|protector)|terminal blocks?|wiring harness(?:es)?)`,
    actions: GENERAL_ACTIONS,
  },
  // Unplugging internal electrical parts means the appliance is open. The
  // appliance itself may still be unplugged (SAFE_ISOLATION).
  {
    subject: String.raw`(?:wiring harness(?:es)?|terminal blocks?|${CAPACITOR}|(?:compressor|start) relay|overload (?:relay|protector)|${MAGNETRON})`,
    actions: ['unplug'],
  },
  // C3: bleeding or draining a capacitor is discharging it ("bleed the
  // capacitor with a 10k resistor"). A bare "cap" is only matched with
  // "bleed", so "drain the water and refit the filter cap" stays allowed.
  {
    subject: CAPACITOR,
    actions: ['bleed', 'drain'],
  },
  // CR-C: microwave internal parts.
  {
    subject: String.raw`(?:${HV_PART}|${MICROWAVE_INTERNAL})`,
    actions: [...GENERAL_ACTIONS, 'cut', 'splice', 'clip', 'snip', 'join', 'twist'],
  },
  {
    subject: String.raw`caps?`,
    actions: ['bleed'],
  },
  // C3: reading the mains supply ("use a multimeter to read the mains supply
  // at the terminal block").
  {
    subject: String.raw`(?:mains(?:\s+(?:supply|voltage|power))?|terminal blocks?|live (?:wire|wiring|terminal)s?|incoming (?:supply|power|voltage)|supply voltage)(?!\s+(?:ratings?|requirements?|specs?|specifications?|labels?))`,
    actions: ['read'],
  },
  // Voltage figures: "check for 240 volts", "measure 120V".
  {
    subject: VOLTS,
    actions: ['check', 'test', 'measure', 'probe', 'meter'],
  },
  // Terminals and a bare "cap" are restricted when shorted, bridged, jumped
  // or (terminals) touched.
  {
    subject: String.raw`terminals?`,
    actions: ['short', 'bridge', 'jump', 'touch'],
  },
  {
    subject: String.raw`caps?`,
    actions: ['short', 'bridge', 'jump', 'discharge'],
  },
  // Microwave high-voltage section and casing.
  {
    subject: String.raw`(?:${MAGNETRON}|${INVERTER}|(?:high[- ]voltage|hv) (?:transformers?|capacitors?|caps?|diodes?|components?|parts?|circuits?|section)|microwave(?:'s)? ${MICROWAVE_SHELL}|${MICROWAVE_SHELL}\s+(?:of|on|from)\s+${POSSESSIVE}microwave|microwave(?:'s)? interior panels?)`,
    actions: GENERAL_ACTIONS,
  },
  // Gas and sealed refrigerant systems.
  {
    subject: String.raw`(?:refrigerant|freon|coolant(?: line)?|sealed system|${GAS_HARDWARE}|propane line)`,
    actions: GENERAL_ACTIONS,
  },
  // Igniters and thermocouples: watching the igniter glow is a safe check;
  // anything else is gas-appliance work.
  {
    subject: GAS_IGNITION,
    actions: GENERAL_ACTIONS.filter((action) => action !== 'check' && action !== 'inspect'),
  },
  // "Disconnect the gas stove from the wall" may mean the gas supply.
  {
    subject: GAS_APPLIANCE,
    actions: ['disconnect', 'reconnect', 'detach', 'unhook', 'remove', 'install'],
  },
  // Safety devices. Bare "safety" ("for your safety") is not a subject.
  // C3: cutting a thermal fuse out and splicing or clipping its wires
  // together defeats it.
  {
    subject: SAFETY_DEVICE,
    actions: [...GENERAL_ACTIONS, 'cut', 'splice', 'clip', 'snip', 'join', 'twist', 'jumper'],
  },
  // Household electrical panel: opening or working inside it is restricted;
  // checking it for a tripped breaker is not.
  {
    subject: String.raw`(?:electrical panel|fuse box|breaker (?:box|panel)|consumer unit|distribution board|panel cover)`,
    actions: ['open', 'remove', 'unscrew', 'take off', 'repair', 'replace', 'install', 'rewire', 'service',
      'touch', 'bypass', 'jump', 'short', 'bridge', 'probe', 'test', 'measure'],
  },
  // A breaker may be reset, checked or switched; replacing, wiring or
  // defeating one is electrical work.
  {
    subject: String.raw`(?:circuit )?breakers?`,
    actions: ['replace', 'install', 'repair', 'rewire', 'remove', 'bypass', 'jump', 'short', 'bridge',
      'tape', 'hold', 'test', 'probe', 'measure', 'service', 'open'],
  },
  // Door locks and interlocks: making sure the door is latched is fine;
  // defeating, testing or replacing the mechanism is not.
  {
    subject: String.raw`(?:door (?:locks?|latch(?:es)?|interlocks?|switch(?:es)?)(?: assembl(?:y|ies))?|lid (?:locks?|switch(?:es)?)|interlocks?)`,
    actions: ['bypass', 'defeat', 'override', 'disable', 'jump', 'jumper', 'short', 'bridge', 'tamper', 'rewire',
      'disassemble', 'remove', 'replace', 'test', 'probe', 'measure', 'force'],
  },
  // A compressor may be listened to or checked for running; testing,
  // starting or replacing it is technician work.
  {
    subject: String.raw`compressors?`,
    actions: GENERAL_ACTIONS.filter((action) => action !== 'check' && action !== 'inspect'),
  },
  // Opening the appliance body exposes wiring. Filter access doors and kick
  // plates are deliberately not listed.
  {
    subject: BODY_PANEL,
    actions: ['open', 'remove', 'unscrew', 'take off', 'pry', 'disassemble', 'dismantle', 'take apart'],
    opening: true,
  },
];

// CR-B: high-risk subjects. Verb lists cannot anticipate every way of telling
// someone to work on these ("ground the capacitor", "lay a screwdriver over
// the terminals", "jumper the thermal limiter"), so any ACTIONABLE wording
// about them is blocked whatever the verb (see highRiskInstruction). Naming
// one in a description, a warning or a technician referral stays allowed.
// Igniters are deliberately not listed: watching an igniter glow is an
// approved safe check and the existing igniter rules still apply.
const GAS_SUPPLY_SUBJECT = String.raw`(?:${GAS_HARDWARE}|${GAS_WORD}\s+(?:supply\s+)?(?:hoses?|lines?|pipes?|piping|tubes?|tubing|connectors?|connections?|fittings?|flex(?:es)?|cylinders?|bottles?|tanks?|bayonets?|couplings?|meters?|inlets?)|(?:the|your|my|our)\s+(?:natural\s+)?gas\b(?!\s+(?:${GAS_APPLIANCE_WORD}|${GAS_NOT_SUBSTANCE}|knobs?|flames?|smell|odou?r|leaks?|settings?|controls?|ignit(?:er|or)s?|burners?)\b))`;
const MAINS_WIRING = String.raw`(?:(?:live|neutral|earth|ground|hot)\s+(?:and\s+(?:neutral|live|earth|ground)\s+)?(?:wires?|wiring|conductors?|terminals?|connections?|sides?)|mains(?:\s+(?:supply|voltage|power|wiring|wires?|electricity|terminals?|connections?))?|terminal\s+blocks?|wiring\s+harness(?:es)?|live\s+(?:parts?|circuits?|components?|electrics?)|l\s*(?:and|&|\/)\s*n|n\s*(?:and|&|\/)\s*l)`;
const MICROWAVE_BODY = String.raw`(?:outer\s+)?(?:covers?|casing|case|housing|shell|cabinet)`;
const HIGH_RISK_SUBJECT = String.raw`(?:${CAPACITOR}|${HV_PART}|${MAGNETRON}|${INVERTER}|${MICROWAVE_INTERNAL}|microwave(?:'s)?\s+${MICROWAVE_BODY}|(?:${MICROWAVE_BODY}|(?:back|rear|side|top|outer)\s+panels?)\s+(?:of|on|from)\s+${POSSESSIVE}microwave|${GAS_SUPPLY_SUBJECT}|${SAFETY_DEVICE}|${MAINS_WIRING})`;
const HIGH_RISK_PATTERN = new RegExp(String.raw`\b${HIGH_RISK_SUBJECT}\b`, 'i');
const HIGH_RISK_MICROWAVE_PATTERN = new RegExp(String.raw`\b(?:${HIGH_RISK_SUBJECT}|${MICROWAVE_CONTEXT_PART})\b`, 'i');

type InstructionRule = {
  // Zero-width at every possible start, with the whole phrase in group 1, so
  // a prohibited earlier verb cannot hide a later unprohibited one.
  pattern: RegExp;
  // Past-tense phrasing ("I replaced the thermal fuse") describes completed
  // work rather than asking for it.
  past: boolean;
  opening?: boolean;
  // A noun phrase ("a replacement magnetron", "a new thermal fuse") rather
  // than an action. A technician named in the same sentence makes it a
  // referral ("a new compressor needs a technician").
  nounPhrase?: boolean;
  // Completed work that leaves a hazard behind (C8). Any request in the
  // same USER message makes the past-tense report a request.
  leavesHazard?: boolean;
  // A safety device or interlock that has been jumpered, bypassed or wired
  // around. The appliance is unsafe to use, so the report is refused even
  // without a request in the same message.
  defeatsSafety?: boolean;
};

function rule(source: string, past: boolean, extra: Partial<InstructionRule> = {}): InstructionRule {
  return { pattern: gi(String.raw`\b(?=(${source}))`), past, ...extra };
}

const SPLIT_VERBS = ['take', 'pull', 'get', 'pop', 'lift', 'pry', 'prise'];

// Testing or measuring with the appliance live: "check for 240 volts with the
// dryer plugged in", "test the element while it is powered". A "test cycle"
// or "test mode" is a programme, not a live-circuit measurement.
const LIVE_CONDITION = String.raw`(?:(?:while|with|when)\s+(?:it|the\s+[a-z-]+|the\s+power|power|everything)\s+(?:is\s+|still\s+|is\s+still\s+|left\s+)?(?:plugged\s+in|powered(?:\s+on|\s+up)?|switched\s+on|turned\s+on|energi[sz]ed|live|on)|(?:while|when)\s+(?:it'?s|it\s+is|still)\s+(?:plugged\s+in|powered|on|live|running)|with\s+(?:the\s+)?power\s+(?:on|connected|still\s+on|applied)|(?:while|with)\s+(?:the\s+)?(?:power\s+on|plugged\s+in|powered\s+(?:on|up)))`;
const LIVE_TEST_VERB = String.raw`(?:test|tests|testing|measure|measures|measuring|probe|probes|probing|meter|metering)\b(?!\s+(?:cycle|run|mode|program|programme|wash|load|button))`;

// Opening a panel or cover to reach electrical parts.
const REACH_ELECTRICS = String.raw`(?:reach|access|get\s+(?:to|at)|expose|see|inspect|check|test)\s+(?:the\s+|its\s+|any\s+)?(?:[a-z-]+\s+)?(?:wiring|wires|terminals?|harness|control\s+boards?|circuit\s+boards?|electronics|electrics|connections|motor|heating\s+element|element)`;

// C3: a tool laid, held or touched across a capacitor's terminals ("put a
// screwdriver across the capacitor terminals", "place a screwdriver across
// it" after the capacitor was named). "Posts", "leads" and "across both" are
// read as terminals when a capacitor or the high-voltage section is the
// subject (see TERMINAL_SYNONYM).
const BRIDGING_VERBS = ['put', 'place', 'lay', 'rest', 'hold', 'touch', 'run', 'drag', 'stick', 'press', 'apply',
  'use', 'set', 'position', 'connect', 'attach', 'clip'];
const BRIDGED_PART = String.raw`(?:terminals?|${CAPACITOR}|caps?|${MAGNETRON}|(?:high[- ]voltage|hv)\s+[a-z-]+)`;
const BRIDGING_TOOL = String.raw`(?:screwdrivers?|pliers|jumpers?|wires?|resistors?|bulbs?|tools?|knife|knives|blades?|spanners?|wrench(?:es)?|metal|paper\s*clips?|probes?|test\s+leads?|clips?)`;
// C3: a meter on live parts ("use a multimeter on the live wires").
const METER = String.raw`(?:multi-?meters?|volt-?meters?|meters?|(?:voltage\s+|circuit\s+)?testers?|test\s+(?:leads?|probes?)|probes?)`;
const LIVE_TARGET = String.raw`(?:mains|live\s+(?:wires?|wiring|terminals?|parts?|circuits?|supply)|terminal\s+blocks?|${VOLTS}|voltage|incoming\s+(?:power|supply|voltage)|power\s+supply|supply\s+(?:voltage|wires?|terminals?))`;
// C8: a body panel or back that is already off ("the back panel is already
// off", "I have the back off"). A control panel that is "off" is a dark
// display, so it is not listed.
// Fourth review: a microwave cover or casing that is off counts as well.
const OPENED_BODY = String.raw`(?:(?<!(?:filter|pump|lint|drain|light|bulb|lamp|fan|detergent|dispenser)\s)(?:(?:back|rear|side|top|service|outer|access)\s+(?:panels?|covers?)|back|rear|(?:outer\s+)?(?:casing|housing|cabinet))|microwave(?:'s)?\s+(?:(?:outer|back|rear|side|top)\s+)?(?:covers?|casing|case|housing|shell|cabinet|lid)|(?:covers?|casing|case|housing|shell|cabinet|lid)\s+(?:of|on)\s+${POSSESSIVE}microwave)`;
// "is off", "'s off", "has been removed", "'s been taken off".
const BODY_STATE = String.raw`(?:\s+(?:is|are|was|were|has\s+been|have\s+been)|'s(?:\s+been)?|'re)\s+(?:already\s+|now\s+|still\s+|currently\s+|completely\s+)?(?:off|removed|open|taken\s+off|out)\b`;
// Defeated safety devices and interlocks (fourth review: "I jumpered the
// thermal fuse", "I wired around the thermal fuse").
const DEFEATABLE = String.raw`(?:${SAFETY_DEVICE}|door\s+(?:locks?|latch(?:es)?|interlocks?|switch(?:es)?)|lid\s+(?:locks?|switch(?:es)?)|interlocks?|(?:primary|secondary|monitor)\s+(?:interlock\s+)?switch(?:es)?)`;
const DEFEAT_VERBS = ['bypass', 'jump', 'jumper', 'bridge', 'short', 'defeat', 'disable', 'override', 'tamper'];
const WIRE_AROUND = String.raw`(?:wire|wires|wired|wiring|run|ran|put|fit|fitted)\s+(?:a\s+(?:jumper|wire|link)\s+)?(?:around|round|past|across|over|out)`;

function pastRules(source: (verbs: string) => string, actions: readonly string[], extra: Partial<InstructionRule>): InstructionRule[] {
  const leaving = actions.filter((action) => HAZARD_LEAVING_ACTIONS.has(action));
  const other = actions.filter((action) => !HAZARD_LEAVING_ACTIONS.has(action));
  return [
    ...(leaving.length ? [rule(source(pastVerbs(leaving)), true, { ...extra, leavesHazard: true })] : []),
    ...(other.length ? [rule(source(pastVerbs(other)), true, extra)] : []),
  ];
}

const INSTRUCTION_RULES: readonly InstructionRule[] = [
  ...RESTRICTED_SUBJECTS.flatMap(({ subject, actions, opening }) => {
    const past = actions.filter((action) => (PAST_ACTIONS as readonly string[]).includes(action));
    const extra = opening ? { opening } : {};
    return [
      rule(String.raw`${presentVerbs(actions)}\b[^.!?;\n]{0,70}\b${subject}\b`, false, extra),
      ...pastRules((verbs) => String.raw`${verbs}\b[^.!?;\n]{0,70}\b${subject}\b`, actions, extra),
      ...pastRules((verbs) => String.raw`${subject}\b[^.!?;\n]{0,70}\b${verbs}\b`, past, extra),
    ];
  }),
  // Tools across, over or onto capacitor terminals.
  rule(String.raw`${presentVerbs(BRIDGING_VERBS)}\b[^.!?;\n]{0,50}\b(?:across|over)\s+(?:[a-z'-]+\s+){0,3}?${BRIDGED_PART}\b`, false),
  rule(String.raw`${presentVerbs(BRIDGING_VERBS)}\b[^.!?;\n]{0,30}\b${BRIDGING_TOOL}\b[^.!?;\n]{0,30}?\b(?:on|onto|to|between|against|across|over|into)\s+(?:[a-z'-]+\s+){0,3}?${BRIDGED_PART}\b`, false),
  ...pastRules((verbs) => String.raw`${verbs}\b[^.!?;\n]{0,50}\b(?:across|between|over)\s+(?:[a-z'-]+\s+){0,3}?${BRIDGED_PART}\b`, BRIDGING_VERBS, { leavesHazard: true }),
  // Grounding / earthing a capacitor: "ground the capacitor with a
  // screwdriver". A determiner is required so "ground wire" is not a verb.
  rule(String.raw`(?:ground|grounds|grounding|earth|earths|earthing)\s+(?:the\s+|its\s+|it\b|both\s+|each\s+|any\s+|your\s+)(?:[a-z'-]+\s+){0,3}?(?:${BRIDGED_PART}|it\b|them\b)`, false),
  ...pastRules((verbs) => String.raw`${verbs}\s+(?:the\s+|its\s+|it\b|both\s+|each\s+|any\s+)(?:[a-z'-]+\s+){0,3}?(?:${BRIDGED_PART}|it\b|them\b)`, ['ground'], {}),
  // Meters on live parts.
  rule(String.raw`${presentVerbs(BRIDGING_VERBS)}\b[^.!?;\n]{0,30}\b${METER}\b[^.!?;\n]{0,60}\b${LIVE_TARGET}\b`, false),
  // Fourth review: meter probes on live and neutral wires, and any wiring or
  // meter check while the appliance is powered ("check the wires with a
  // multimeter while it is plugged in").
  rule(String.raw`${presentVerbs([...BRIDGING_VERBS, 'check', 'test', 'measure', 'probe'])}\b[^.!?;\n]{0,40}\b(?:to|on|onto|against|across|between)\s+(?:[a-z'-]+\s+){0,2}?(?:live|neutral|hot|line|earth|ground)\s+(?:and\s+(?:live|neutral|earth|ground)\s+)?(?:wires?|wiring|terminals?|conductors?|connections?|sides?)\b`, false),
  rule(String.raw`${METER}\b[^.!?;\n]{0,70}\b${LIVE_CONDITION}`, false),
  rule(String.raw`${presentVerbs(['check', 'test', 'touch', 'handle', 'inspect', 'probe', 'measure', 'feel', 'move', 'wiggle'])}\b[^.!?;\n]{0,40}\b(?:wires?|wiring|terminals?|connections?|connectors?|harness)\b[^.!?;\n]{0,50}\b${LIVE_CONDITION}`, false),
  // Defeated safety devices and interlocks.
  rule(String.raw`${pastVerbs(DEFEAT_VERBS)}\b[^.!?;\n]{0,40}\b${DEFEATABLE}\b`, true, { leavesHazard: true, defeatsSafety: true }),
  rule(String.raw`${WIRE_AROUND}\s+(?:[a-z'-]+\s+){0,3}?${DEFEATABLE}\b`, false),
  rule(String.raw`(?:wired|ran|fitted)\s+(?:a\s+(?:jumper|wire|link)\s+)?(?:around|round|past|across|over|out)\s+(?:[a-z'-]+\s+){0,3}?${DEFEATABLE}\b`, true, { leavesHazard: true, defeatsSafety: true }),
  rule(String.raw`${DEFEATABLE}\b[^.!?;\n]{0,30}\b(?:is|are|was|were|has\s+been|have\s+been|'s)\s+(?:now\s+|still\s+|currently\s+|already\s+)?(?:bypassed|jumpered|jumped|bridged|shorted|defeated|disabled|overridden|wired\s+out)\b`, true, { leavesHazard: true, defeatsSafety: true }),
  // Split particles on gas hardware: "take the gas hose off the back of the
  // stove", "pull the gas line out".
  rule(String.raw`${presentVerbs(SPLIT_VERBS)}\s+(?:[a-z'-]+\s+){0,3}?${GAS_HARDWARE}\s+(?:[a-z'-]+\s+){0,2}?(?:off|out|loose|apart|away)\b`, false),
  // Opened appliance body.
  rule(String.raw`${OPENED_BODY}${BODY_STATE}`, true, { opening: true }),
  rule(String.raw`(?:have|got|had|with|'ve\s+got)\s+(?:the\s+|its\s+|it's\s+)?${OPENED_BODY}\s+(?:already\s+|now\s+|still\s+)?(?:off|removed|open)\b`, true, { opening: true }),
  rule(String.raw`(?:have|got|had|with|'ve\s+got)\s+(?:the\s+|its\s+)?${MICROWAVE_SHELL}\s+off\s+(?:of\s+)?${POSSESSIVE}microwave\b`, true, { opening: true }),
  // Replacement wording without a "replace" verb: "you'll need a replacement
  // magnetron", "fit a new thermal fuse", "order a new capacitor".
  rule(String.raw`(?:replacement|new|spare|substitute)\s+(?:[a-z-]+\s+){0,2}?${RESTRICTED_COMPONENT}\b`, true, { nounPhrase: true }),
  rule(String.raw`${RESTRICTED_COMPONENT}\s+replacements?\b`, true, { nounPhrase: true }),
  // Live testing and reaching electrics.
  rule(String.raw`${LIVE_TEST_VERB}[^.!?;\n]{0,70}\b${LIVE_CONDITION}\b`, false),
  rule(String.raw`${presentVerbs(['remove', 'open', 'unscrew', 'take off', 'lift', 'pry'])}\b[^.!?;\n]{0,40}\b(?:panels?|covers?|casing|housing|guards?)\b[^.!?;\n]{0,30}?\bto\s+${REACH_ELECTRICS}\b`, false, { opening: true }),
  // Split particles: "take the cover off the microwave", "take the back panel
  // off", "pull the casing out".
  ...[false, true].flatMap((past) => {
    const verbs = past ? pastVerbs(SPLIT_VERBS) : presentVerbs(SPLIT_VERBS);
    return [
      rule(String.raw`${verbs}\s+(?:[a-z'-]+\s+){0,3}?${MICROWAVE_SHELL}\s+(?:off|out)\s+(?:of\s+)?${POSSESSIVE}microwave\b`, past, { opening: true }),
      rule(String.raw`${verbs}\s+(?:[a-z'-]+\s+){0,3}?${BODY_PANEL}\s+(?:[a-z'-]+\s+){0,2}?(?:off|out|apart)\b`, past, { opening: true }),
      // C8: "take the back off", "I already took the back off".
      rule(String.raw`${verbs}\s+(?:the\s+|its\s+|it's\s+)?(?:back|rear|sides?)\s+off\b`, past, { opening: true }),
      rule(String.raw`${past ? pastVerbs(['take', 'pull', 'break']) : presentVerbs(['take', 'pull', 'break'])}\s+${POSSESSIVE}(?:[a-z-]+\s+)?microwave\s+apart\b`, past, { opening: true }),
      rule(String.raw`${past ? pastVerbs(['open up', 'dismantle', 'disassemble', 'unscrew', 'gut']) : presentVerbs(['open up', 'dismantle', 'disassemble', 'unscrew', 'gut'])}\s+${POSSESSIVE}(?:[a-z-]+\s+)?microwave\b(?!\s+door)`, past, { opening: true }),
    ];
  }),
];

// Any mention of a restricted subject, used to resolve "it", "its" and "them"
// in the clauses and steps that follow.
const SUBJECT_MENTION_SOURCES = [...RESTRICTED_SUBJECTS.map(({ subject }) => subject), RESTRICTED_COMPONENT, HIGH_RISK_SUBJECT];
const SUBJECT_MENTION = gi(String.raw`\b(?:${SUBJECT_MENTION_SOURCES.join('|')})\b`);
// With a microwave, bare internal part names ("the fuse") are subjects too.
const SUBJECT_MENTION_MICROWAVE = gi(String.raw`\b(?:${[...SUBJECT_MENTION_SOURCES, MICROWAVE_CONTEXT_PART].join('|')})\b`);

function subjectMentions(text: string, microwave = false): string[] {
  return [...text.matchAll(microwave ? SUBJECT_MENTION_MICROWAVE : SUBJECT_MENTION)].map((match) => match[0]);
}

// Subjects whose "posts", "leads" or "both" are high-voltage terminals.
const TERMINAL_OWNER = new RegExp(String.raw`^(?:${CAPACITOR}|caps?|${MAGNETRON}|(?:high[- ]voltage|hv)\b.*)$`, 'i');
// Only in noun position ("both posts", "the leads", "across two pins"), so the
// verb in "Contact a technician about the capacitor" is never rewritten.
const TERMINAL_SYNONYM =
  /(?<=\b(?:the|both|two|its|their|these|those|each|either|other|a|an|across|between|on|onto|to|touching|metal|exposed)\s+(?:[a-z-]+\s+)?)(?:posts?|leads?|pins?|prongs?|contacts?|lugs?)\b/gi;
const ACROSS_BOTH = /\bacross\s+both\b(?!\s+terminals)/gi;

const PRONOUN = /\b(?:it's|its|it|them|they|their)\b/gi;
const HAS_PRONOUN = /\b(?:it's|its|it|them|they|their)\b/i;

// "Short its terminals" after "Find the capacitor" becomes "Short the
// capacitor's terminals", so the restricted subject is checked as if named.
function substitutePronouns(clause: string, subject: string): string {
  return clause.replace(PRONOUN, (word) => {
    const lower = word.toLowerCase();
    if (lower === 'its' || lower === 'their') return `the ${subject}'s`;
    if (lower === "it's") return `the ${subject} is`;
    return `the ${subject}`;
  });
}

// "Unplug the washer from the wall", "disconnect it from the mains" and "make
// sure it is plugged into the wall socket" are standard safe power checks for
// the APPLIANCE ITSELF. The phrase is removed before subject matching so the
// word "mains" in it is not read as live-circuit work. The object must be the
// appliance or a pronoun: "disconnect the gas line from the wall" or
// "disconnect the capacitor wires from the mains" is never a safe isolation.
const POWER_POINT = String.raw`(?:the\s+|a\s+)?(?:mains(?: power| supply| socket| outlet)?|wall(?: socket| outlet)?|outlet|socket|power(?: supply| outlet| socket| point)?)`;
const APPLIANCE_NOUN = String.raw`(?:appliances?|units?|machines?|washer|washing machine|dryer|tumble dryer|dishwasher|fridge|refrigerator|freezer|fridge[- ]freezer|oven|stove|range|cooktop|hob|cooker|microwave|air conditioner|ac unit|heater|water heater|boiler|dehumidifier|humidifier|kettle|toaster|vacuum)`;
// A gas appliance is excluded: "disconnect the gas stove from the wall" may
// mean the gas supply, so it is never treated as a safe electrical isolation.
const ISOLATION_OBJECT = String.raw`(?:it|them|everything|(?:the|your|my|this|that)\s+(?!gas\s)(?:[a-z-]+\s+)?${APPLIANCE_NOUN})`;
const ISOLATION_ADVERB = String.raw`(?:(?:completely|fully|first|briefly|safely|properly)\s+)?`;
const SAFE_ISOLATION = gi(
  String.raw`\b(?:(?:unplug\w*|disconnect\w*|isolat\w*)\s+${ISOLATION_OBJECT}\s+${ISOLATION_ADVERB}(?:from|at)|(?:switch\w*|turn\w*)\s+(?:${ISOLATION_OBJECT}\s+off|off\s+${ISOLATION_OBJECT})\s+${ISOLATION_ADVERB}(?:from|at)|plugged\s+(?:back\s+)?in(?:to)?)\s+${POWER_POINT}\b`,
);

// Who is told to do the work. A prohibition directly governing the verb, or a
// technician as the one doing it, makes the phrase a warning, not a DIY
// instruction. A prohibition elsewhere in the clause ("so you don't get
// shocked", "I can't afford a technician so ...") changes nothing.
const PROHIBITION = String.raw`(?:do not|don't|dont|never|avoid|should not|shouldn't|must not|mustn't|cannot|can't|will not|won't|not|no need to|refrain from|rather than|instead of|without|(?:is\s+|it's\s+|it is\s+)?(?:not|never)\s+safe\s+to|unsafe\s+to|dangerous\s+to)`;
const PROHIBITION_FILLER = String.raw`(?:(?:ever|even|attempt|attempting|try|trying|recommend|recommending|advise|to|be tempted to|yourself)\s+){0,3}`;
const PROHIBITED_PREFIX = new RegExp(String.raw`\b${PROHIBITION}\s+${PROHIBITION_FILLER}$`, 'i');
// The model declining to explain the work: "I can't explain how to discharge
// the capacitor". The refusal must directly govern the action.
const REFUSAL_PREFIX =
  /\b(?:can't|cannot|can not|won't|will not|(?:am\s+)?(?:not\s+able|unable)\s+to)\s+(?:safely\s+)?(?:provide|give|offer|explain|describe|show(?: you)?|tell you|guide you(?: through)?|walk you through|help(?: you)?(?: with)?|recommend|advise|suggest)\s+(?:you\s+)?(?:(?:any\s+|the\s+)?(?:instructions?|steps|guidance|details)\s+)?(?:(?:on|for|about)\s+)?(?:how\s+)?(?:to\s+)?$/i;
const QUESTION_NOT = /\bwhy\s+(?:not|don't|dont)\s+(?:i\s+|we\s+|you\s+)?$/i;
const TECH = String.raw`(?:technicians?|professionals?|engineers?|electricians?|specialists?|installers?|service (?:agents?|engineers?|technicians?|centres?|centers?|providers?)|repair (?:shops?|services?|persons?|people))`;
const DELEGATED_PREFIX = new RegExp(
  String.raw`(?:\b${TECH}\s+(?:(?:will|would|must|should|can|could|may|might|needs?\s+to|has\s+to|have\s+to|is\s+(?:able|required|trained)\s+to|ought\s+to)\s+)?(?:(?:safely|properly|first|also|then|be\s+able\s+to|need\s+to)\s+){0,2}|\b(?:have|let|ask|get|hire|call|book|need|needs)\s+(?:a|an|the|your)\s+(?:[a-z-]+\s+){0,2}?${TECH}\s+(?:to\s+)?)$`,
  'i',
);
const DELEGATED_SUFFIX = new RegExp(
  String.raw`^(?:[^.!?;\n]{0,40}?\bby\s+(?:a|an|the|your)\s+(?:[a-z-]+\s+){0,2}?${TECH}\b|\s+(?:is|are|would be|will be|should (?:only )?be|must (?:only )?be|can (?:only )?be)\s+(?:[a-z]+\s+)?(?:not safe|unsafe|dangerous|hazardous|not a diy|a job for|work for|only for))`,
  'i',
);
const OR_COORDINATION = /\b(?:or|nor)\s+(?:[a-z]+\s+)?$/i;

// "A technician would test the capacitor, and so can you": naming a
// technician does not make the work professional when the same sentence
// hands it back to the user.
const SELF_TOO =
  /\b(?:and\s+|but\s+)?so\s+(?:can|could|may|should|will)\s+you\b|\bas\s+(?:can|could)\s+you\b|\byou\s+(?:can|could|may)\s+(?:do\s+(?:it|this|that|the\s+same)\s+)?(?:too|as\s+well|yourself)\b|\b(?:but|and)\s+you\s+(?:can|could)\s+(?:also\s+|easily\s+|just\s+)?(?:do|handle|manage)\b/i;
// The same hand-back across sentences: "A technician would do this. You can
// do it yourself, though." Only "do it/this/that" phrasing counts, so an
// unrelated "you can also check the hose" does not.
// Fourth review: indirect encouragement - "It is easy enough to do
// yourself", "Feel free to try it yourself", "Anyone can do it". A
// prohibition directly before it ("It is not easy enough to do yourself",
// "Don't try it yourself") is a warning, see handsWorkBack.
const ENCOURAGEMENT = String.raw`(?:easy|simple|straightforward)\s+enough\s+(?:to\s+(?:do|fix|handle|manage|tackle|sort|replace|swap)\b(?:\s+(?:it\s+|this\s+|that\s+)?yourself)?|for\s+(?:you|anyone|most\s+people)\b)|\bfeel\s+free\s+to\s+(?:try|do|have\s+a\s+go|tackle|attempt|give)|\banyone\s+(?:can|could)\s+(?:do|manage|handle|fix|replace|tackle)\b|\b(?:do|fix|replace|handle|try|tackle|attempt|sort|swap|change)\s+(?:it|this|that|them|the\s+job|the\s+repair)\s+yourself\b|\bdo-?it-?yourself\b|\bdiy[- ](?:friendly|job|fix|repair)\b`;
const SELF_TOO_ANYWHERE = new RegExp(
  String.raw`\byou\s+(?:can|could|may|should|will)\s+(?:also\s+|easily\s+|just\s+|safely\s+)?do\s+(?:it|this|that|the\s+same)\b(?:\s+(?:yourself|too|as\s+well))?|\bno\s+need\s+(?:for|to\s+(?:call|hire|book|wait\s+for|pay(?:\s+for)?))\s+(?:a|an|the)\s+(?:[a-z-]+\s+)?${TECH}|\bno\s+(?:[a-z-]+\s+)?${TECH}\s+(?:is\s+)?(?:needed|required|necessary)\b|\b${ENCOURAGEMENT}`,
  'i',
);
// Clause-level encouragement (with a high-risk subject in the same clause):
// also "the diode is easy to replace", "replace the magnetron yourself".
const ENCOURAGEMENT_PATTERN = gi(
  String.raw`\b(?:${ENCOURAGEMENT})|\b(?:easy|easily|simple|straightforward|quick|cheap|safe)\s+(?:enough\s+)?to\s+(?:do|fix|replace|swap|change|handle|manage|test|discharge|repair|tackle|sort|remove|install|fit|bypass|short|ground)\b|\b(?:do|fix|replace|handle|try|tackle|attempt|sort|swap|change|test|discharge|remove|install|repair|fit|short|ground|bypass|it|this|that|them)\b[^.!?;,]{0,40}?\byourself\b|\bno\s+(?:special\s+)?(?:skills?|experience|expertise)\s+(?:is\s+|are\s+)?(?:needed|required|necessary)\b|\b(?:themselves|themself|yourselves|on\s+(?:their|your|his|her)\s+own|without\s+(?:any\s+)?(?:help|assistance|a\s+technician|an\s+engineer|an\s+electrician|professional\s+help))\b`,
);

// C4: the short hand-back can also stand in its own sentence: "A technician
// would discharge the capacitor. And so can you." / "... You can too." So
// SELF_TOO is checked across the whole text as well, not only per sentence.
const SELF_TOO_STANDALONE =
  /\b(?:and\s+|but\s+)?so\s+(?:can|could|may|should|will)\s+you\b|\bas\s+(?:can|could)\s+you\b|\byou\s+(?:can|could|may)\s+(?:do\s+(?:it|this|that|the\s+same)\s+)?(?:too|as\s+well|yourself)\b/i;

// A negation just before encouragement wording turns it into a warning: "It
// isn't easy enough to do yourself", "This is not a job to do yourself".
const NEGATED_BEFORE = /\b(?:not|never|no|isn't|isnt|aren't|arent|wasn't|don't|dont|doesn't|doesnt|won't|wont|can't|cant|cannot|shouldn't|mustn't|avoid|without)\b(?:\s+\S+){0,4}\s*$/i;

function handsWorkBack(text: string): boolean {
  return [SELF_TOO_ANYWHERE, SELF_TOO_STANDALONE].some((pattern) => {
    for (const match of text.matchAll(new RegExp(pattern.source, 'gi'))) {
      const prefix = text.slice(0, match.index ?? 0);
      // Only the current sentence can negate it.
      const sentence = prefix.slice(Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf('!'), prefix.lastIndexOf('?'), prefix.lastIndexOf('\n')) + 1);
      if (PROHIBITED_PREFIX.test(prefix) || NEGATED_BEFORE.test(sentence)) continue;
      return true;
    }
    return false;
  });
}

function isProhibitedOrDelegated(clause: string, start: number, end: number, allowDelegation = true): boolean {
  const prefix = clause.slice(0, start);
  if (allowDelegation && (DELEGATED_PREFIX.test(prefix) || DELEGATED_SUFFIX.test(clause.slice(end)))) return true;
  if (QUESTION_NOT.test(prefix)) return false;
  if (PROHIBITED_PREFIX.test(prefix) || REFUSAL_PREFIX.test(prefix)) return true;
  // "Do not open the panel or test the mains voltage": the prohibition covers
  // both coordinated actions.
  return OR_COORDINATION.test(prefix) && new RegExp(String.raw`\b${PROHIBITION}\b`, 'i').test(prefix);
}

// A user clause that asks for help or instructions, as opposed to describing
// work that has already been done. A modal counts only with a person ("can
// I", "should we", "will you"), so "it still will not heat" is a report.
const REQUEST_MARKER =
  /\?|\b(?:how|what|which|where|(?:should|shall|can|could|may|might|would|will)\s+(?:i|we|you)|need(?:s)? to|want(?:s)? to|going to|gonna|plan(?:ning)? to|about to|help|show|tell|explain|steps?|guide|instructions?|walk me|is it (?:ok|okay|safe|fine)|safe to|try(?:ing)? to)\b/i;

// Message-level request intent (IM-4) uses a stricter marker so a report such
// as "I replaced the fuse but it still will not heat" is not read as a request.
const MESSAGE_REQUEST =
  /\?|\b(?:how\s+(?:do|can|should|would|could)\s+i|what\s+(?:should|do|can|could|would)\s+i|which\s+[a-z]+\s+(?:should|do|can)\s+i|should\s+i|can\s+i|could\s+i|do\s+i\s+need|tell\s+me|show\s+me|explain|walk\s+me|help\s+me|guide\s+me|next\s+steps?)\b/i;

// Words in a request that continue invasive work: "Which wire should I check
// next?" after "I removed the back panel".
const CONTINUES_INVASIVE_WORK =
  /\b(?:wires?|wiring|terminals?|connectors?|harness|voltage|volts?|multimeter|meter|continuity|resistance|ohms?|live|exposed|in\s+there|behind\s+(?:it|the\s+panel)|inside\s+(?:it|the\s+(?:unit|machine|appliance)))\b/i;

// "for that", "do it", "is it safe": a follow-up that points back at an
// earlier request rather than naming a new topic.
const BACK_REFERENCE =
  /\b(?:for|with|do|doing|about|try|trying|attempt|attempting)\s+(?:that|this|those|it|them)\b|\b(?:is|would)\s+(?:it|that|this)\s+(?:be\s+)?(?:safe|dangerous|ok|okay|hard|difficult|easy|risky)\b|\b(?:that|this|those)\s+(?:step|steps|procedure|process|method|way|job|work|repair|bit)\b/i;
const TOOL_QUESTION =
  /\b(?:what|which|kind\s+of|type\s+of)\s+(?:[a-z]+\s+){0,2}?(?:tools?|screwdrivers?|gloves|meters?|multimeters?|resistors?|equipment|gear|pliers|wrench(?:es)?|spanners?|tape|sealants?|compound)\b|\btools?\s+(?:do|would|should|will)\s+i\b/i;

// ---------------------------------------------------------------------------
// CR-B: actionable wording about a high-risk subject
// ---------------------------------------------------------------------------
//
// A clause is actionable when it tells someone to do something: an
// imperative ("Ground the capacitor ..."), a directive ("you should / can /
// need to ...", "make sure ...", "the next step is to ..."), an instruction
// gerund ("Discharging the capacitor is easy"), a tool phrase ("with a
// screwdriver"), a passive instruction ("the diode must be replaced") or
// self-encouragement ("easy enough to do yourself"). An actionable clause
// that names a high-risk subject is unsafe whatever the verb, unless it is a
// prohibition, a protective action (stop, keep away, call a technician), a
// technician delegation or a warning ("... is dangerous"). Descriptions
// ("the magnetron may have failed") are not actionable.

const CLAUSE_LEAD_FILLER =
  /^(?:\s*(?:\d+\s*[.):-]+|[-*•]+|step\s+\d+\s*[:.)-]?|(?:and|or|then|next|now|first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|lastly|also|so|carefully|gently|slowly|simply|just|please|quickly|safely|afterwards|after\s+that|to\s+start|ok(?:ay)?|well|again|instead)\b)\s*,?)+/i;

// Words that cannot start an imperative.
const NON_IMPERATIVE_START = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', "it's", 'there', "there's", 'here', "here's",
  'they', "they're", "they'll", 'their', 'them', 'we', "we're", "we'll", "we've", 'i', "i'm", "i've", "i'd", "i'll",
  'you', "you're", "you'll", "you'd", "you've", 'your', 'my', 'our', 'his', 'her', 'he', 'she', 'if', 'when',
  'whenever', 'whether', 'because', 'since', 'although', 'though', 'while', 'unless', 'as', 'until', 'till',
  'which', 'what', 'who', 'whom', 'whose', 'how', 'why', 'where', 'some', 'many', 'most', 'all', 'both', 'each',
  'every', 'either', 'neither', 'any', 'no', 'none', 'nothing', 'only', 'however', 'unfortunately', 'typically',
  'usually', 'generally', 'normally', 'often', 'sometimes', 'otherwise', 'likely', 'possibly', 'probably',
  'perhaps', 'maybe', 'yes', 'sadly', 'ideally', 'note', 'warning', 'caution', 'important', 'danger', 'safety',
  'one', 'another', 'other', 'such', 'than', 'in', 'on', 'at', 'by', 'for', 'of', 'from', 'with', 'without',
  'after', 'before', 'during', 'under', 'over', 'about', 'into', 'onto', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'do', 'does', 'did', 'has',
  'had', 'having', "can't", "won't", "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "shouldn't",
  "wouldn't", "couldn't", 'not', 'never', 'even', 'older', 'newer', 'modern', 'common', 'commonly', 'faulty',
  'bad', 'broken', 'failed', 'failing', 'blown', 'defective', 'damaged', 'burnt', 'burned', 'new', 'old',
  'replacement', 'genuine', 'original', 'once', 'high', 'low', 'thanks', 'thank', 'sorry', 'hi', 'hello',
  'great', 'good', 'fine', 'sure', 'unlike', 'like', 'per', 'according', 'due', 'yeah', 'nope', 'no',
  ...['technician', 'technicians', 'professional', 'professionals', 'engineer', 'engineers', 'electrician',
    'electricians', 'manufacturer', 'manufacturers', 'specialist', 'specialists'],
]);

// Words that typically follow an imperative verb: "Ground THE capacitor",
// "Lay A screwdriver", "Hold IT", "Take OFF".
const OBJECT_LEAD = new Set([
  'the', 'a', 'an', 'your', 'its', 'it', 'them', 'this', 'that', 'these', 'those', 'both', 'each', 'all', 'any',
  'some', 'one', 'another', 'off', 'out', 'up', 'down', 'on', 'in', 'into', 'onto', 'over', 'across', 'to',
  'with', 'for', 'around', 'between', 'through', 'away', 'back', 'apart', 'carefully', 'gently', 'firmly',
  'briefly', 'quickly', 'slowly', 'lightly', 'directly', 'together', 'first', 'here', 'there', 'my', 'his',
  'her', 'their', 'our', 'either', 'every', 'along', 'under', 'behind', 'inside', 'beneath', 'near', 'against',
  'at',
]);

// Base-form verbs common in repair instructions, for imperatives whose
// object has no determiner ("Use insulated pliers", "Bridge terminals").
const COMMON_VERBS = new Set([
  'use', 'replace', 'remove', 'check', 'test', 'measure', 'touch', 'short', 'bridge', 'jump', 'jumper', 'ground',
  'earth', 'discharge', 'drain', 'bleed', 'connect', 'disconnect', 'reconnect', 'attach', 'detach', 'unhook',
  'unscrew', 'loosen', 'tighten', 'pull', 'push', 'take', 'lift', 'pry', 'prise', 'open', 'solder', 'cut',
  'splice', 'strip', 'twist', 'bypass', 'defeat', 'override', 'disable', 'install', 'fit', 'swap', 'order', 'buy',
  'grab', 'hold', 'press', 'place', 'put', 'lay', 'rest', 'set', 'apply', 'insert', 'wrap', 'seal', 'probe',
  'inspect', 'clean', 'adjust', 'handle', 'service', 'repair', 'fix', 'rewire', 'wire', 'reach', 'access',
  'locate', 'find', 'identify', 'rotate', 'plug', 'reset', 'start', 'begin', 'run', 'power', 'energise',
  'energize', 'flip', 'release', 'free', 'clear', 'bend', 'move', 'slide', 'tap', 'knock', 'hit', 'spray', 'tape',
  'join', 'clip', 'snip', 'pinch', 'squeeze', 'reattach', 'refit', 'reinstall', 'mount', 'unclip', 'break',
  'force', 'wiggle', 'jiggle', 'shake', 'purge', 'light', 'ignite', 'relight', 'substitute', 'meter', 'turn',
  'switch', 'get', 'have', 'let', 'make', 'be', 'leave', 'keep', 'go', 'try', 'unplug', 'swap', 'upgrade',
  'disassemble', 'dismantle', 'unbolt', 'undo', 'unfasten', 'reverse', 'secure', 'feed', 'route', 'thread',
  'feel', 'sniff', 'wipe', 'spray',
]);

// Past forms are reports ("Bought a new thermal fuse"), not imperatives.
const IRREGULAR_PAST = new Set([
  'got', 'bought', 'took', 'did', 'made', 'went', 'saw', 'found', 'thought', 'broke', 'ran', 'held', 'laid', 'left',
  'kept', 'felt', 'told', 'said', 'gave', 'came', 'fell', 'stuck', 'undid', 'tore', 'wore', 'swapped', 'shook',
]);

// Nouns ending in -ing that are not instruction gerunds.
const NON_GERUND = new Set([
  'nothing', 'something', 'anything', 'everything', 'during', 'according', 'including', 'regarding',
  'following', 'depending', 'assuming', 'string', 'spring', 'ring', 'wiring', 'ceiling', 'building', 'heating',
  'cooling', 'lighting', 'housing', 'thing', 'things', 'bearing', 'fitting', 'tubing', 'piping', 'casing',
  'setting', 'opening', 'warning', 'morning', 'evening', 'timing', 'rating', 'coating', 'plumbing', 'lining',
  'coupling', 'mounting', 'bushing', 'packing', 'padding', 'sibling', 'king', 'bring', 'earthing', 'grounding',
  'arcing', 'sparking', 'smoking', 'burning', 'leaking', 'hissing', 'humming', 'buzzing', 'clicking', 'beeping',
  'flashing', 'blinking', 'nothing', 'being', 'having', 'seeing', 'feeling', 'looking',
]);

// Verbs that protect rather than repair, or only perceive or communicate.
const PROTECTIVE_VERB = new Set([
  'stop', 'cease', 'discontinue', 'leave', 'evacuate', 'exit', 'keep', 'stay', 'call', 'contact', 'consult',
  'phone', 'ring', 'book', 'hire', 'ask', 'arrange', 'schedule', 'seek', 'report', 'wait', 'ventilate', 'avoid',
  'refrain', 'unplug', 'isolate', 'warn', 'notify', 'alert', 'inform', 'note', 'remember', 'understand', 'know',
  'worry', 'think', 'believe', 'expect', 'notice', 'see', 'hear', 'smell', 'tell', 'mention', 'describe',
  'explain', 'refer', 'consider', 'bear', 'be', 'stopping', 'calling', 'contacting', 'consulting', 'waiting',
  'keeping', 'leaving', 'avoiding', 'unplugging', 'isolating', 'booking', 'hiring', 'asking', 'ventilating',
  'evacuating', 'reporting', 'staying', 'check-in', 'find', 'learn', 'read', 'look',
]);
// Causative verbs that delegate when a technician is named: "have a
// technician replace it", "get it checked by an engineer".
const DELEGATING_VERB = new Set(['have', 'let', 'get', 'had', 'got', 'need', 'needs', 'require', 'requires']);
// A prohibition at the start of a clause or region.
const PROHIBITION_START = new RegExp(String.raw`^(?:${PROHIBITION})\b`, 'i');
// A comma clause after a sentence-initial prohibition stays prohibited unless
// it starts something new: "Never, under any circumstances, touch it".
const CONTRAST_START = /^(?:but|instead|however|then|so|now|next|afterwards|after\s+that|and\s+then|first|once)\b/i;
// Where an imperative's object region ends.
const REGION_END = /\b(?:if|unless|whether|in\s+case)\b/i;
// Coordinated or sequenced sub-clauses: "Unplug it and then short the
// capacitor", "before touching the capacitor".
const SUB_CLAUSE_SPLIT = /\b(?:and(?:\s+then)?|then|or|nor|before|after|while|when|once|until|so\s+that)\b/i;
// "... is dangerous", "should only be done by a technician".
const WARNING_SUFFIX = new RegExp(
  String.raw`\b(?:is|are|can\s+be|could\s+be|would\s+be|will\s+be|may\s+be)\s+(?:extremely\s+|very\s+|potentially\s+|highly\s+|really\s+|always\s+)?(?:dangerous|unsafe|hazardous|lethal|deadly|fatal|risky|not\s+safe|not\s+a\s+diy|illegal|a\s+job\s+for|work\s+for|only\s+for|best\s+left|strictly)|\b(?:should|must|can|may)\s+only\s+be\s+[a-z]+\s+by\b|\bby\s+(?:a|an|the|your)\s+(?:[a-z-]+\s+){0,2}?${TECH}\b|\b(?:left|referred|handed|reserved)\s+(?:only\s+)?(?:to|for)\s+(?:a|an|the|your)\s+(?:[a-z-]+\s+){0,2}?${TECH}\b`,
  'i',
);
const MODEL_DIRECTIVE = new RegExp(
  String.raw`\b(?:you|we)\s+(?:will\s+|would\s+)?(?:(?:can|could|should|must|may|might)(?:\s+(?:also|then|now|simply|just|easily|safely|first))?|need\s+to|needs\s+to|have\s+to|ought\s+to|want\s+to|are\s+(?:able|going)\s+to|will\s+need\s+to|may\s+want\s+to|might\s+want\s+to)\s+|\byou'(?:ll|d)\s+(?:(?:need|want|have)\s+to\s+)?|\blet's\s+|\b(?:try|attempt)\s+(?:to\s+)?|\bi\s+(?:recommend|suggest|advise)\s+(?:that\s+)?(?:you\s+)?|\bit(?:'s|\s+is)\s+(?:best|easiest|safest|simplest|fine|okay|ok|safe|a\s+good\s+idea|worth|possible|easy|simple|straightforward)\s+(?:to\s+)?|\b(?:the\s+)?(?:next|first|best|easiest|only|last|final)\s+step\s+is\s+(?:to\s+)?|\b(?:start|begin)\s+by\s+|\bgo\s+ahead\s+and\s+|\bmake\s+sure\s+(?:to\s+|you\s+|that\s+)?|\bbe\s+sure\s+to\s+|\b(?:until|before|after|once|when)\s+you(?:'ve|\s+have)?\s+`,
  'gi',
);
// A USER request for work: "how do I", "can I", "is it safe to", "show me".
const USER_DIRECTIVE = new RegExp(
  String.raw`\bhow\s+(?:do|can|should|would|could|will|might|must)\s+(?:i|we|you|one)\s+|\bhow\s+to\s+|\b(?:can|could|should|shall|may|might|must|do|would)\s+(?:i|we)\s+(?:also\s+|just\s+|safely\s+|still\s+|then\s+|now\s+)?|\bis\s+it\s+(?:ok|okay|safe|fine|alright|possible|wise|a\s+good\s+idea)\s+(?:to|if\s+i|for\s+me\s+to)\s+|\b(?:what(?:'s|\s+is)|which\s+is)\s+the\s+(?:best|easiest|safest|right|proper|correct|quickest)\s+way\s+to\s+|\b(?:help|show|tell|teach|walk|guide|talk)\s+me\s+(?:how\s+to\s+|through\s+|to\s+)?|\b(?:steps|instructions|guide|procedure)\s+(?:to|for|on)\s+|\bi\s+(?:want|need|plan|intend|have)\s+to\s+|\bi(?:'m|\s+am)\s+(?:going|about|planning|trying)\s+to\s+|\bi(?:\s+will|'ll)\s+(?:just\s+)?|\blet\s+me\s+|\bwhere\s+(?:do|should|can)\s+i\s+|\bwhat\s+(?:do|should|can)\s+i\s+(?:use|do)\s+(?:to|on|with|for)\s+`,
  'gi',
);
const TOOL_PHRASE = gi(
  String.raw`\b(?:with|using|use)\s+(?:a|an|the|your|some|two|insulated|\w+\s+){0,2}?(?:screwdrivers?|multi-?meters?|volt-?meters?|meters?|testers?|probes?|pliers|jumpers?|jumper\s+wires?|resistors?|wrench(?:es)?|spanners?|clips?|test\s+leads?|bulbs?)\b`,
);
const PASSIVE_INSTRUCTION = gi(
  String.raw`\b(?:can|could|should|must|needs?\s+to|has\s+to|have\s+to|will\s+need\s+to|may\s+need\s+to|is\s+to\s+be)\s+(?:then\s+|now\s+|easily\s+|simply\s+|just\s+|safely\s+|first\s+)?be\s+(?:(?!(?:present|different|sufficient|hot|warm|dangerous)\b)[a-z]+(?:ed|en)|cut|put|set|shut|split|bent|built|kept|held|laid|swapped)\b`,
);

const CLAUSE_NEGATION = /\b(?:not|never|no|avoid|without|cannot)\b|n't\b/i;

function stripLead(text: string): string {
  return text.replace(CLAUSE_LEAD_FILLER, '').trim();
}

function regionOf(text: string): string {
  const end = REGION_END.exec(text);
  return end ? text.slice(0, end.index) : text;
}

// "Leave the thermal fuse bypassed", "keep the casing off": a protective verb
// that keeps a hazard in place is not protective.
const HAZARDOUS_STATE =
  /\b(?:bypass\w*|jumper\w*|jumped|short\w*|bridg\w*|disconnect\w*|exposed|uncovered|open|off|removed|plugged\s+in|running|live|energi[sz]ed|connected|loose|in\s+place|pressed|held|against|across|touching|together)\b/i;
const HOLDING_VERB = new Set(['leave', 'keep', 'stay', 'leaving', 'keeping']);

// The text after a directive or imperative is protective, perceptual, a
// prohibition or a technician delegation.
function excusedRegion(region: string): boolean {
  const trimmed = stripLead(region);
  if (PROHIBITION_START.test(trimmed)) return true;
  const [first, second] = words(trimmed);
  if (!first) return true;
  if (HOLDING_VERB.has(first) && HAZARDOUS_STATE.test(trimmed) && !/\b(?:away|clear|out)\b/i.test(trimmed)) return false;
  if (PROTECTIVE_VERB.has(first)) return true;
  if ((first === 'switch' || first === 'turn' || first === 'shut') && /\boff\b/i.test(trimmed) && !/\bgas\b/i.test(trimmed)) {
    return true;
  }
  if (DELEGATING_VERB.has(first) && TECH_MENTION_PATTERN.test(trimmed)) return true;
  // "Make sure / be sure" are directives in their own right.
  if ((first === 'make' || first === 'be') && (second === 'sure' || second === 'certain')) return true;
  return false;
}

const TECH_MENTION_PATTERN = new RegExp(String.raw`\b${TECH}\b`, 'i');

// The imperative verb that starts the text, 'gerund' for an instruction
// gerund, or null.
function clauseLead(rest: string, subject: RegExp): string | null {
  const [t0, t1] = words(rest);
  if (!t0 || NON_IMPERATIVE_START.has(t0) || /^\d/.test(t0)) return null;
  // The clause starts with the subject itself: "Microwave diodes fail".
  if (subject.exec(rest)?.index === 0) return null;
  if (/ing$/.test(t0) && t0.length > 4 && !NON_GERUND.has(t0)) return 'gerund';
  if (IRREGULAR_PAST.has(t0) || (/ed$/.test(t0) && !COMMON_VERBS.has(t0))) return null;
  if (COMMON_VERBS.has(t0) || (t1 !== undefined && (OBJECT_LEAD.has(t1) || /^\d/.test(t1)))) return t0;
  return null;
}

type HighRiskOptions = {
  author: 'USER' | 'MODEL';
  microwave: boolean;
  prohibited: boolean;
  // The sentence hands the work to a technician ("To discharge the capacitor
  // safely, call a technician"), so a purpose clause in it is not DIY.
  purposeDelegated?: boolean;
};

// A purpose infinitive states the work being instructed: "To replace the
// magnetron, first unplug the microwave". Safety purposes are not work.
const PURPOSE = /^to\s+(?!(?:avoid|prevent|stay|keep|be|protect|reduce|ensure|minimi[sz]e|help|check\s+(?:if|whether)|find\s+out|know|tell|confirm\s+(?:if|whether)|see\s+(?:if|whether))\b)/i;

// An imperative or instruction gerund whose object region names the subject.
function actionableSubClause(text: string, subject: RegExp, purposeDelegated = false): boolean {
  const stripped = stripLead(text);
  if (purposeDelegated && /^to\s/i.test(stripped)) return false;
  const rest = PURPOSE.test(stripped) ? stripped.replace(/^to\s+/i, '') : stripped;
  if (!subject.test(rest) || PROHIBITION_START.test(rest)) return false;
  const lead = clauseLead(rest, subject);
  if (!lead) return false;
  const afterLead = rest.replace(/^\S+/, '');
  if (lead === 'gerund') {
    if (PROTECTIVE_VERB.has(words(rest)[0]!) || WARNING_SUFFIX.test(rest)) return false;
  } else if (excusedRegion(rest)) {
    return false;
  }
  return subject.test(regionOf(afterLead));
}

// A directive is excused only by a prohibition that directly governs it ("you
// should never", "do not try to") or by "not something you should do".
const NOT_A_DIY_JOB = /\b(?:not|never|no)\s+(?:something|a\s+job|a\s+task|work|a\s+repair|one|an?\s+[a-z-]+\s+(?:job|task|repair))\s+(?:that\s+|which\s+)?$/i;

// The clause's actor is a technician: "A qualified technician must discharge
// the capacitor", "Only a gas engineer should touch the gas line".
const TECHNICIAN_ACTOR = new RegExp(
  String.raw`^(?:only\s+)?(?:(?:a|an|the|your)\s+)?(?:(?:qualified|licensed|certified|registered|trained|gas\s+safe|professional|authori[sz]ed)\s+){0,2}${TECH}\b`,
  'i',
);

function delegatedToTechnician(clause: string): boolean {
  return TECHNICIAN_ACTOR.test(stripLead(clause));
}

// CR-B: verb-independent check of one clause (after pronoun substitution).
function highRiskInstruction(clause: string, options: HighRiskOptions): boolean {
  const subject = options.microwave ? HIGH_RISK_MICROWAVE_PATTERN : HIGH_RISK_PATTERN;
  if (!subject.test(clause)) return false;

  // Imperatives and gerunds: the whole clause, then each coordinated or
  // sequenced sub-clause ("Unplug it and then short the capacitor",
  // "before touching the capacitor").
  if (!options.prohibited) {
    if (actionableSubClause(clause, subject, options.purposeDelegated)) return true;
    // Under a prohibition in the first part, parts joined by "and" / "or"
    // share it: "Do not open the casing or touch the capacitor", "You should
    // never open the casing or touch the capacitor".
    const pieces = clause.split(new RegExp(`(${SUB_CLAUSE_SPLIT.source})`, 'i'));
    const clauseProhibited = new RegExp(String.raw`\b${PROHIBITION}\b`, 'i').test(pieces[0] ?? '');
    for (let index = 2; index < pieces.length; index += 2) {
      const separator = (pieces[index - 1] ?? '').trim().toLowerCase();
      if (clauseProhibited && /^(?:and|or|nor)$/.test(separator)) continue;
      if (actionableSubClause(pieces[index] ?? '', subject)) return true;
    }
  }

  // Directives: the region after "you should", "how do I", "make sure", ...
  const directive = options.author === 'USER' ? USER_DIRECTIVE : MODEL_DIRECTIVE;
  for (const match of clause.matchAll(directive)) {
    const start = match.index ?? 0;
    const prefix = clause.slice(0, start);
    if (options.author === 'MODEL' && (PROHIBITED_PREFIX.test(prefix) || NOT_A_DIY_JOB.test(prefix))) continue;
    const region = regionOf(clause.slice(start + match[0].length));
    if (excusedRegion(region)) continue;
    if (subject.test(region)) return true;
  }

  if (options.author === 'USER') return false;

  // Self-encouragement, tool phrases and passive instructions (MODEL only).
  if (options.prohibited || PROHIBITION_START.test(stripLead(clause))) return false;
  for (const pattern of [ENCOURAGEMENT_PATTERN, TOOL_PHRASE, PASSIVE_INSTRUCTION]) {
    for (const match of clause.matchAll(pattern)) {
      const start = match.index ?? 0;
      const prefix = clause.slice(0, start);
      if (NEGATED_BEFORE.test(prefix) || PROHIBITED_PREFIX.test(prefix)) continue;
      // "Owners should not try to repair the thermal fuse themselves": any
      // negation earlier in the clause makes encouragement wording a warning.
      if (pattern === ENCOURAGEMENT_PATTERN && CLAUSE_NEGATION.test(prefix)) continue;
      if (
        pattern !== ENCOURAGEMENT_PATTERN &&
        (TECH_MENTION_PATTERN.test(prefix) || WARNING_SUFFIX.test(clause.slice(start)))
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

type RuleContext = {
  author: 'USER' | 'MODEL';
  // This clause asks for help, or the clause sits in a question.
  asksForWork: boolean;
  // The whole USER message asks for something, and whether that request
  // continues invasive work.
  messageAsks: boolean;
  requestContinuesWork: boolean;
  allowDelegation: boolean;
  mentionsTechnician: boolean;
  // The sentence recommends getting or fitting something, or calls the job
  // easy. A bare hypothesis ("possible compressor replacement") does not.
  recommends: boolean;
};

const RECOMMENDS =
  /\b(?:need|needs|needed|get|getting|order|ordering|buy|buying|fit|fitting|install|installing|use|grab|purchase|require|requires|swap|put\s+in|pick\s+up|replace|replacing|you'll|you\s+will|you'd|you\s+would|straightforward|easy|easily|simple|quick|cheap|diy|yourself|go\s+ahead)\b/i;

function ruleMatches(clause: string, rules: readonly InstructionRule[], context: RuleContext): boolean {
  return rules.some(({ pattern, past, opening, nounPhrase, leavesHazard, defeatsSafety }) => {
    if (context.author === 'USER' && past && !context.asksForWork && !defeatsSafety) {
      // IM-4: request intent is decided for the message, not per sentence.
      // "I removed the back panel. Which wire should I check next?" asks for
      // work inside an opened appliance. C8: so does any request after
      // completed work that leaves a hazard behind ("I shorted the
      // capacitor. What do I do now?").
      if (!context.messageAsks || !(opening || leavesHazard || context.requestContinuesWork)) return false;
    }
    if (nounPhrase && (!context.recommends || (context.mentionsTechnician && context.allowDelegation))) return false;
    for (const match of clause.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (isProhibitedOrDelegated(clause, start, start + (match[1]?.length ?? 0), context.allowDelegation)) continue;
      return true;
    }
    return false;
  });
}

const TECH_MENTION = new RegExp(String.raw`\b${TECH}\b`, 'i');

function splitKeepingPunctuation(text: string): string[] {
  return text.split(/(?<=[.!?;\n])/).filter((sentence) => sentence.trim().length > 0);
}

// Checks texts in order (reply, follow-up, steps). A restricted subject named
// in one clause, sentence or step is carried into the next sentence or step
// so "Locate the capacitor." followed by "Short its terminals." is read as
// one instruction. The carried subject lapses after one sentence without a
// mention, so "it" in an unrelated later step is not reinterpreted.
type InstructionOptions = { microwave?: boolean };

function containsUnsafeInstruction(
  texts: readonly string[],
  author: 'USER' | 'MODEL',
  options: InstructionOptions = {},
): boolean {
  const microwave = Boolean(options.microwave);
  const message = texts.join('\n');
  const messageSentences = splitKeepingPunctuation(message);
  const messageAsks = author === 'USER' && MESSAGE_REQUEST.test(message);
  const requestContinuesWork =
    messageAsks &&
    messageSentences.some(
      (sentence) =>
        MESSAGE_REQUEST.test(sentence) &&
        (CONTINUES_INVASIVE_WORK.test(sentence) || BACK_REFERENCE.test(sentence) || subjectMentions(sentence, microwave).length > 0),
    );
  const handedBack = handsWorkBack(message);
  // C4: "The capacitor holds a dangerous charge. A technician would do this.
  // You can too." Handing a technician's job back to the user while a
  // restricted subject is named is unsafe even when the action itself is
  // only referred to ("do this").
  if (author === 'MODEL' && handedBack && TECH_MENTION.test(message) && subjectMentions(message, microwave).length > 0) {
    return true;
  }

  let carried: string[] = [];
  for (const text of texts) {
    // A replacement part named alongside a technician anywhere in the same
    // reply or step is a referral ("A new compressor is costly; a technician
    // should assess it").
    const mentionsTechnician = TECH_MENTION.test(text);
    for (const sentence of splitKeepingPunctuation(text)) {
      const question = sentence.includes('?');
      const allowDelegation = !handedBack && !SELF_TOO.test(sentence);
      const mentionedHere: string[] = [];
      // CR-B: a sentence-initial prohibition covers its later comma clauses
      // ("Never, under any circumstances, touch the capacitor") unless one
      // starts something new ("..., then discharge it").
      const sentenceProhibited = PROHIBITION_START.test(stripLead(sentence));
      for (const [clauseIndex, clause] of clauses(sentence).entries()) {
        // Safe isolation of the appliance itself ("unplug it from the wall")
        // is removed before pronouns are resolved.
        const stripped = clause.replace(SAFE_ISOLATION, ' ');
        const mentions = subjectMentions(stripped, microwave);
        if (mentions.length) {
          mentionedHere.push(...mentions);
          carried = [...new Set([...mentions, ...carried])].slice(0, 4);
        }
        const variants = [stripped];
        if (carried.length && HAS_PRONOUN.test(stripped)) {
          for (const subject of carried) variants.push(substitutePronouns(stripped, subject));
        }
        // C3: with a capacitor or the high-voltage section as the subject,
        // "posts", "leads" and "across both" mean its terminals.
        if ([...carried, ...mentions].some((subject) => TERMINAL_OWNER.test(subject))) {
          for (const variant of [...variants]) {
            const terminals = variant.replace(TERMINAL_SYNONYM, 'terminals').replace(ACROSS_BOTH, 'across both terminals');
            if (terminals !== variant) variants.push(terminals);
          }
        }
        const context: RuleContext = {
          author,
          asksForWork: question || REQUEST_MARKER.test(clause),
          messageAsks,
          requestContinuesWork,
          allowDelegation,
          mentionsTechnician,
          recommends: RECOMMENDS.test(sentence),
        };
        const highRisk: HighRiskOptions = {
          author,
          microwave,
          prohibited: clauseIndex > 0 && sentenceProhibited && !CONTRAST_START.test(stripLead(clause)),
          purposeDelegated: allowDelegation && TECH_MENTION.test(sentence),
        };
        if (!highRisk.prohibited && variants.some((variant) => ruleMatches(variant, INSTRUCTION_RULES, context))) {
          return true;
        }
        // Resetting or checking a circuit breaker is a safe external
        // operation even when the circuit is named ("the microwave circuit").
        const highRiskVariants = variants.map((variant) => variant.replace(SAFE_EXTERNAL_OPERATION, ' '));
        // A delegated or handed-back technician job is judged by the rules
        // above; here a technician actor excuses only when nothing hands the
        // work back.
        if (
          highRiskVariants.some((variant) => highRiskInstruction(variant, highRisk)) &&
          !(allowDelegation && author === 'MODEL' && delegatedToTechnician(clause))
        ) {
          return true;
        }
      }
      if (!mentionedHere.length) carried = [];
      else carried = [...new Set(mentionedHere)].slice(0, 4);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Restricted follow-up after a dangerous request
// ---------------------------------------------------------------------------
//
// A dangerous request is refused in its own turn and is not persisted. While
// that request is still inside the bounded history window, later turns are
// in a restricted follow-up mode for the same subject: a question pointing
// back at the procedure ("what tool would I need for that?") is refused, and
// model output that gives instructions about the subject or its shorthand
// ("the cap", "HV", "the terminals") is blocked. Unrelated topics continue
// normally. Nothing new is persisted: the mode ends when the request leaves
// the history window.

type SubjectFamily = {
  id: string;
  // Recognises the family in the original dangerous request.
  trigger: RegExp;
  // Words that refer to the same subject in later turns and model output.
  reference: RegExp;
};

// A drain-filter or hose "cap" is not a capacitor.
const CAP_REFERENCE = String.raw`(?<!(?:filter|drain|end|hose|bottle|dust|lens|rubber|valve|pump|lint|burner)\s)caps?`;
// Fourth review: "which power lead?" names the appliance's supply cord, not a
// capacitor or high-voltage lead.
const LEAD_REFERENCE = String.raw`(?<!(?:power|mains|supply|extension|electrical)\s)leads?`;

const SUBJECT_FAMILIES: readonly SubjectFamily[] = [
  {
    id: 'CAPACITOR',
    trigger: new RegExp(String.raw`\b${CAPACITOR}\b|\b(?:discharg\w*|short\w*|bridg\w*|ground\w*|earth\w*)\b[^.!?\n]{0,30}\bcaps?\b`, 'i'),
    // C6: "posts", "leads", "bleed" and a resistor refer back to the
    // capacitor procedure ("put a screwdriver across both posts"); so does
    // the screwdriver used to short it (fourth review).
    reference: new RegExp(String.raw`\b(?:capacitors?|${CAP_REFERENCE}|hv|high[- ]voltage|terminals?|posts?|${LEAD_REFERENCE}|discharg\w*|bleed\w*|bled|resistors?|screwdrivers?)\b`, 'i'),
  },
  {
    id: 'MICROWAVE_HV',
    trigger: new RegExp(
      String.raw`\b(?:${MAGNETRON}|${INVERTER}|${MICROWAVE_INTERNAL}|high[- ]voltage|hv)\b|\bmicrowave(?:'s)?\s+${MICROWAVE_SHELL}\b|\b${MICROWAVE_SHELL}\s+(?:of|on|from|off)\s+${POSSESSIVE}microwave\b|\b(?:open(?:ing)?\s+up|dismantl\w*|disassembl\w*|unscrew\w*|gut\w*|tak(?:e|ing)\s+apart)\s+${POSSESSIVE}microwave\b`,
      'i',
    ),
    reference: new RegExp(
      String.raw`\b(?:${MAGNETRON}|inverters?|hv|high[- ]voltage|transformers?|diodes?|rectifiers?|capacitors?|terminals?|posts?|${LEAD_REFERENCE}|casing|housing|outer\s+cover|waveguide|(?:primary|secondary|monitor)\s+switch(?:es)?|interlocks?|(?:ceramic|internal)\s+fuses?)\b`,
      'i',
    ),
  },
  {
    id: 'GAS',
    trigger: new RegExp(String.raw`\b(?:${GAS_HARDWARE}|${GAS_IGNITION}|${GAS_APPLIANCE}|${GAS_SUPPLY_SUBJECT})\b`, 'i'),
    // C6: fittings, nuts, threads, tape, wrenches, spanners, sealant and a
    // valve refer back to gas-connection work ("what wrench size?", "do I
    // need tape on the thread?"). Water and drain valves and hoses do not.
    reference: /\b(?:gas|propane|thermocouples?|ignit(?:er|or)s?|regulators?|shut-?off\s+valves?|flex(?:ible)?\s+(?:connectors?|hoses?|pipes?)|fittings?|nuts?|threads?|threaded|tape|wrench(?:es)?|spanners?|sealants?|pipe\s+dope|jointing\s+compound|(?<!(?:water|inlet|drain|fill|solenoid|mixing|check|relief|expansion)\s)valves?|(?<!(?:drain|water|inlet|fill|vent|dryer)\s)hoses?|(?<!(?:wire|wiring|electrical)\s)connectors?)\b/i,
  },
  {
    id: 'REFRIGERANT',
    trigger: /\b(?:refrigerant|freon|coolant|sealed system|compressors?|(?:compressor|start) relays?|overload (?:relays?|protectors?))\b/i,
    reference: /\b(?:refrigerant|freon|coolant|sealed\s+system|compressors?|relays?|overload|recharg\w*|service\s+ports?|gauges?)\b/i,
  },
  {
    id: 'SAFETY_DEVICE',
    trigger: new RegExp(String.raw`\b${SAFETY_DEVICE}\b`, 'i'),
    reference: /\b(?:thermal|fuses?|cut-?offs?|cut-?outs?|thermostats?|high[- ]limit|safety\s+(?:devices?|switch(?:es)?))\b/i,
  },
  {
    id: 'MAINS',
    // "High voltage" names the microwave or capacitor section (other
    // families), not the household mains.
    trigger: new RegExp(
      String.raw`\b(?:mains|(?<!(?:high|hv)[- ])voltage|${VOLTS}|live (?:wire|wiring|terminal)s?|terminal blocks?|wiring harness(?:es)?|earth wire|ground wire|electrical panel|fuse box|breaker (?:box|panel)|consumer unit|distribution board|(?:circuit )?breakers?|${MAINS_WIRING})\b`,
      'i',
    ),
    reference: new RegExp(
      String.raw`\b(?:mains|voltage|${VOLTS}|live|wires?|wiring|terminals?|harness|multimeter|electrical\s+panel|fuse\s+box|breakers?|consumer\s+unit)\b`,
      'i',
    ),
  },
  {
    id: 'INTERLOCK',
    trigger: /\b(?:door (?:lock|latch|interlock|switch)|lid (?:lock|switch)|interlocks?)\b/i,
    reference: /\b(?:door\s+(?:locks?|latch(?:es)?|interlocks?|switch(?:es)?)|lid\s+(?:locks?|switch(?:es)?)|interlocks?|jumpers?|bypass\w*)\b/i,
  },
  {
    id: 'OPENING',
    trigger: new RegExp(String.raw`\b${BODY_PANEL}\b`, 'i'),
    reference: /\b(?:(?:back|rear|side|top|front|service|electrical|outer)\s+panels?|casing|housing|cabinet|wires?|wiring|terminals?|harness|(?:control|circuit)\s+boards?)\b/i,
  },
];

// Used when a refused request names a subject no family covers.
const GENERAL_FAMILY: SubjectFamily = {
  id: 'GENERAL',
  trigger: /$^/,
  reference: new RegExp(SUBJECT_MENTION.source, 'i'),
};

const FAMILIES_BY_ID = new Map([...SUBJECT_FAMILIES, GENERAL_FAMILY].map((family) => [family.id, family]));

function familiesFor(ids: readonly string[]): SubjectFamily[] {
  return ids.flatMap((id) => {
    const family = FAMILIES_BY_ID.get(id);
    return family ? [family] : [];
  });
}

// I3: the restricted follow-up window has its own size, counted in prior
// USER turns (assistant messages are not counted) and independent of the
// Gemini history limit. Configuration can widen it but never shrink it below
// this minimum.
//
// Expiry is deterministic: a refused request restricts the next
// RESTRICTED_FOLLOW_UP_MIN_USER_TURNS (or the configured, larger number of)
// user turns. With a window of 6, a request in user turn N restricts turns
// N+1 to N+6; turn N+7 is checked normally. A fresh dangerous request is
// always refused in its own turn, inside or outside the window.
export const RESTRICTED_FOLLOW_UP_MIN_USER_TURNS = 6;

export function restrictedFollowUpWindow(configured?: number | null): number {
  const requested = typeof configured === 'number' && Number.isFinite(configured) ? Math.floor(configured) : 0;
  return Math.max(RESTRICTED_FOLLOW_UP_MIN_USER_TURNS, requested);
}

// Subject families of every USER message in the given prior USER turns that
// would itself be refused as UNSAFE_REQUEST (same past-tense-aware detector).
// Only the last `window` turns are considered (oldest first, newest last).
export function restrictedFollowUpFamilies(userHistory: readonly string[], window?: number | null): string[] {
  const ids = new Set<string>();
  const turns = userHistory.slice(-restrictedFollowUpWindow(window));
  const microwave = mentionsMicrowave(turns);
  for (const raw of turns) {
    const text = normalizeText(raw);
    if (!containsUnsafeInstruction([text], 'USER', { microwave })) continue;
    const matched = SUBJECT_FAMILIES.filter((family) => family.trigger.test(text));
    for (const family of matched.length ? matched : [GENERAL_FAMILY]) ids.add(family.id);
  }
  return [...ids];
}

// Safe external operations that name a family word without continuing the
// refused work: resetting, switching or checking a circuit breaker, and
// unplugging the appliance itself. They are removed before family matching,
// so "How do I reset the breaker?" after a capacitor request is answered.
const SAFE_EXTERNAL_OPERATION = gi(
  String.raw`\b(?:reset\w*|flip\w*|switch\w*|turn\w*|check\w*|look\w*\s+at)\s+(?:(?:it|them)\s+)?(?:(?:off|on|back\s+on)\s+)?(?:at\s+)?(?:the\s+|a\s+|your\s+|my\s+)?(?:circuit\s+)?breakers?(?:\s+(?:off|on|back\s+on))?|\b(?:circuit\s+)?breakers?\s+(?:has\s+|have\s+|is\s+|keeps\s+|just\s+)?(?:tripped|trips|tripping|reset)\b`,
);

function withoutSafeOperations(text: string): string {
  return text.replace(SAFE_ISOLATION, ' ').replace(SAFE_EXTERNAL_OPERATION, ' ');
}

// The text names the restricted subject or one of its abbreviations.
export function mentionsRestrictedFamily(text: string | null | undefined, familyIds: readonly string[]): boolean {
  if (!text || familyIds.length === 0) return false;
  const normalized = withoutSafeOperations(normalizeText(text));
  return familiesFor(familyIds).some((family) => family.reference.test(normalized));
}

// A follow-up that points back at the refused procedure: a question or
// request that names the subject or its shorthand, uses a back-reference
// ("for that", "do it", "is it safe") or asks about tools; or (C6) a bare
// instruction about the subject such as "Then bridge the two posts."
function isRestrictedFollowUpRequest(text: string, familyIds: readonly string[]): boolean {
  if (familyIds.length === 0) return false;
  if (instructsRestrictedSubject([text], familyIds)) return true;
  const asks = text.includes('?') || REQUEST_MARKER.test(text);
  if (!asks) return false;
  if (mentionsRestrictedFamily(text, familyIds) || BACK_REFERENCE.test(text) || TOOL_QUESTION.test(text)) return true;
  // C6 (fourth review): "How long do I hold it?", "Where do I put it?",
  // "Should I touch them?", "How much pressure?" name nothing else, so they
  // continue the refused procedure. A question with its own concrete topic
  // ("The turntable doesn't spin. What could cause that?") is unrelated.
  return (AMBIGUOUS_PRONOUN.test(text) || PROCEDURE_DETAIL.test(text)) && isAmbiguousFollowUp(text, familyIds);
}

// ---- C6: ambiguous references inside the restriction window ---------------

const AMBIGUOUS_PRONOUN = /\b(?:it|its|it's|them|they|their|those|these|both|there)\b|\b(?:this|that|one)\s*(?=[?.!,]|$)/i;
// Questions about doing the procedure itself rather than a new topic.
const PROCEDURE_DETAIL =
  /^(?:\s*(?:ok(?:ay)?|so|and|then|right|alright|great|thanks|cool|got\s+it|done)\b[\s,.!]*)*(?:how\s+(?:long|much|many|hard|far|tight|deep|often|firmly|quickly|close)|which\s+(?:one|side|end|way|first|terminal|post|wire|tool|order)\b|where\s+(?:do|should|can|would)\s+(?:i|we)\s+(?:put|place|hold|touch|connect|attach|clip|start|press)|what\s+(?:size|kind|type|gauge|rating|resistance|voltage|order)\b)/i;
// Model steps whose object is only a pronoun: "Hold it there for 5 seconds".
const PRONOUN_OBJECT = /\b(?:it|them|they|its|their|both|there)\b/i;
// Nouns that do not establish a new topic on their own.
const VAGUE_NOUN = new Set([
  'thing', 'things', 'one', 'ones', 'bit', 'part', 'parts', 'step', 'steps', 'way', 'ways', 'procedure', 'process',
  'job', 'work', 'same', 'other', 'next', 'first', 'last', 'time', 'moment', 'second', 'seconds', 'minute',
  'minutes', 'pressure', 'force', 'end', 'ends', 'side', 'sides', 'tool', 'tools', 'screwdriver', 'screwdrivers',
  'wire', 'wires', 'lead', 'leads', 'terminal', 'terminals', 'metal', 'blade', 'tip', 'tips', 'probe', 'probes',
  'clip', 'clips', 'resistor', 'resistors', 'cap', 'caps', 'rest', 'whole', 'area', 'spot', 'place', 'point',
  'points', 'contact', 'contacts', 'post', 'posts', 'pin', 'pins', 'connection', 'connections', 'charge', 'voltage',
  'gloves', 'jumper', 'jumpers', 'pliers', 'meter', 'multimeter', 'tape', 'wrench', 'spanner', 'nut', 'nuts',
  'thread', 'threads', 'fitting', 'fittings',
  // The appliance itself is not a new topic.
  'microwave', 'oven', 'stove', 'range', 'cooker', 'hob', 'dryer', 'washer', 'machine', 'appliance', 'unit',
  'fridge', 'refrigerator', 'freezer', 'dishwasher', 'heater', 'boiler',
]);
// Words after a determiner that are not nouns.
const NON_NOUN = new Set([
  'is', 'was', 'be', 'do', 'does', 'did', 'safe', 'ok', 'okay', 'right', 'correct', 'best', 'good', 'bad', 'fine',
  'enough', 'long', 'much', 'many', 'hard', 'works', 'new', 'old', 'same', 'easiest', 'safest', 'proper', 'little',
  'big', 'small', 'insulated', 'flat', 'cheap', 'way', 'kind', 'type', 'sort', 'right', 'left', 'whole', 'other',
  'next', 'first', 'last', 'two', 'both', 'each', 'one', 'it', 'will', 'would', 'should', 'can', 'could', 'has',
  'have', 'had', 'means', 'mean', 'happens', 'happen', 'needs', 'need', 'part', 'too', 'also', 'really', 'still',
]);
const DETERMINED_PHRASE = /\b(?:the|my|your|a|an|this|that|these|those|our|their|some|another|any)\s+([a-z][a-z'-]*)(?:\s+([a-z][a-z'-]*))?/gi;

// True when the text names its own topic that is not part of the refused
// subject: "the turntable", "the door seal", "my drain hose", "the power
// lead". Tools, terminals, "the procedure" and pronouns do not count.
function hasConcreteTopic(text: string, families: readonly SubjectFamily[]): boolean {
  for (const match of text.matchAll(DETERMINED_PHRASE)) {
    const candidates = [match[1], match[2]].filter((word): word is string => Boolean(word)).map((word) => word.toLowerCase());
    for (const word of candidates) {
      if (NON_NOUN.has(word) || VAGUE_NOUN.has(word)) continue;
      const phrase = match[0];
      if (families.some((family) => family.reference.test(word) || family.reference.test(phrase))) break;
      return true;
    }
  }
  return false;
}

// A follow-up inside the restriction window that names no concrete topic of
// its own ("What next?", "How long do I hold it?").
export function isAmbiguousFollowUp(text: string | null | undefined, familyIds: readonly string[]): boolean {
  if (!text || familyIds.length === 0) return false;
  return !hasConcreteTopic(withoutSafeOperations(normalizeText(text)), familiesFor(familyIds));
}

// An imperative, directive or instruction gerund, whatever its subject.
const NO_SUBJECT = /(?!)/;
function isActionable(clause: string): boolean {
  const rest = stripLead(clause);
  if (PROHIBITION_START.test(rest)) return false;
  const lead = clauseLead(rest, NO_SUBJECT);
  if (lead === 'gerund') return !PROTECTIVE_VERB.has(words(rest)[0]!) && !WARNING_SUFFIX.test(rest);
  if (lead && !excusedRegion(rest)) return true;
  for (const match of clause.matchAll(MODEL_DIRECTIVE)) {
    const prefix = clause.slice(0, match.index ?? 0);
    if (PROHIBITED_PREFIX.test(prefix) || NOT_A_DIY_JOB.test(prefix)) continue;
    if (!excusedRegion(regionOf(clause.slice((match.index ?? 0) + match[0].length)))) return true;
  }
  return false;
}

// Verbs that make a sentence about the restricted subject instructive.
const FOLLOW_UP_ACTION = gi(
  String.raw`\b${presentVerbs([
    ...GENERAL_ACTIONS, 'touch', 'place', 'put', 'lay', 'use', 'connect', 'attach', 'clip', 'bleed', 'drain',
    'ground', 'grab', 'cut', 'strip', 'insert', 'wrap', 'reach', 'access', 'need', 'turn', 'apply', 'seal',
    'splice', 'hold', 'rest',
  ])}\b`,
);
const NEED_TECHNICIAN = new RegExp(String.raw`^\s+(?:a|an|the|your)\s+(?:[a-z-]+\s+){0,2}?${TECH}\b`, 'i');

// Model output in restricted follow-up mode: an unprohibited, undelegated
// action in a clause that names the restricted subject or its shorthand.
function instructsRestrictedSubject(texts: readonly string[], familyIds: readonly string[]): boolean {
  const families = familiesFor(familyIds);
  if (families.length === 0) return false;
  const handedBack = handsWorkBack(texts.join('\n'));
  // C6 (fourth review): whether the previous sentence or step named its own
  // concrete topic, which a pronoun in the next one may refer to.
  let previousConcrete = false;
  for (const text of texts) {
    for (const sentence of splitKeepingPunctuation(text)) {
      const allowDelegation = !handedBack && !SELF_TOO.test(sentence);
      const concreteHere = hasConcreteTopic(withoutSafeOperations(sentence), families);
      const unsafe = clauses(sentence).some((raw) => {
        const clause = withoutSafeOperations(raw);
        if (families.some((family) => family.reference.test(clause))) {
          for (const match of clause.matchAll(FOLLOW_UP_ACTION)) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            if (/^needs?$/i.test(match[0]) && NEED_TECHNICIAN.test(clause.slice(end))) continue;
            if (isProhibitedOrDelegated(clause, start, end, allowDelegation)) continue;
            return true;
          }
          // Any actionable wording about the subject, whatever the verb.
          if (isActionable(clause) && !(allowDelegation && delegatedToTechnician(clause))) return true;
        }
        // "Hold it there for five seconds": an instruction whose only object
        // is a pronoun continues the refused procedure.
        return PRONOUN_OBJECT.test(clause) && !concreteHere && !previousConcrete && isActionable(clause);
      });
      if (unsafe) return true;
      previousConcrete = concreteHere;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plug handling under wet conditions
// ---------------------------------------------------------------------------

// C9: cord and socket wording counts as well as "plug": "pull out the power
// cord", "disconnect the power cord", "pull the cord out of the wall", "turn
// it off at the socket", "turn off the power at the outlet". Switching off at
// the circuit breaker is not plug handling.
const CORD = String.raw`(?:(?:power|mains|electrical|supply)\s+)?(?:plugs?|cords?|leads?|cables?)`;
const WALL_POINT = String.raw`(?:wall(?:\s+(?:sockets?|outlets?|switch(?:es)?|plugs?))?|sockets?|plugs?|outlets?|power\s+(?:points?|sockets?|outlets?))`;
const UNPLUG_ACTION = gi(
  String.raw`\b(?:unplug\w*|(?:pull|pulls|pulled|pulling|remove|removes|removing|take|takes|taking|yank|yanks|yanking|draw|disconnect\w*|detach\w*)\s+(?:out\s+)?(?:the\s+|its\s+|it's\s+|your\s+)?(?:appliance's\s+|machine's\s+)?${CORD}|disconnect\w*\s+(?:it|the\s+[a-z-]+)\s+(?:[a-z]+\s+)?from\s+(?:the\s+)?(?:wall|socket|outlet|mains|power)|(?:switch|turn)\w*\s+(?:(?:it|them|the\s+[a-z-]+|the\s+power|power)\s+off\s+|off\s+(?:(?:it|them|the\s+[a-z-]+|the\s+power|power)\s+)?)(?:at|from)\s+(?:the\s+)?${WALL_POINT}|(?:switch|turn|flick|flip)\w*\s+off\s+(?:the\s+|your\s+|that\s+)?(?:wall\s+)?(?:sockets?|plugs?|outlets?|power\s+(?:points?|sockets?|outlets?)|wall\s+switch(?:es)?|socket\s+switch(?:es)?|plug\s+switch(?:es)?)|(?:switch|turn|flick|flip)\w*\s+(?:the\s+|your\s+|that\s+)?(?:wall\s+)?(?:sockets?|plugs?|outlets?|power\s+points?|socket\s+switch(?:es)?|wall\s+switch(?:es)?)\s+off|touch(?:es|ing)?\s+(?:the\s+|its\s+)?(?:plug|socket|outlet|power cord|cord))\b`,
);

// An unprohibited instruction (or user intention) to pull or touch the plug.
export function containsUnplugInstruction(text: string): boolean {
  const normalized = normalizeText(text);
  return clauses(normalized).some((clause) => {
    for (const match of clause.matchAll(UNPLUG_ACTION)) {
      const start = match.index ?? 0;
      if (isProhibitedOrDelegated(clause, start, start + match[0].length)) continue;
      return true;
    }
    return false;
  });
}

// The user has reported a leak, flooding or a wet floor in the current or a
// prior USER turn. Touching the plug is then never recommended.
export function reportsWetConditions(texts: readonly string[]): boolean {
  return texts.some((text) =>
    sentences(normalizeText(text)).some(
      (sentence) =>
        matchesUnnegated(WET_CONDITION, sentence) ||
        WATER_ELECTRICAL_PATTERNS.some((pattern) => matchesUnnegated(pattern, sentence, { negationInside: true })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Hazards asserted by the model
// ---------------------------------------------------------------------------

// A clause mentioning a technician or a prohibition is not an assertion that
// a hazard is present ("if there is smoke, do not use it"). This is used only
// for hazard assertions, never to excuse an instruction.
// Fourth review: risk wording ("there is a risk of fire") is a warning, not
// an assertion that a fire is present.
const SAFE_ASSERTION_CONTEXT =
  /\b(?:technician|qualified|professional|do not|don't|never|avoid|should not|shouldn't|must not|if|whether|unless|risks?|chances?|dangers?|hazards?|possib\w*|prevent\w*|reduce\w*|could|might|may|can\s+cause|in\s+case)\b/i;

const ASSERTION = String.raw`\b(?:there (?:is|are)|confirmed|evidence of|active|visible|found|detected|you have|i (?:can )?(?:see|smell|hear|notice))\b[^.!?;\n]{0,80}`;

const ESTABLISHED_HAZARDS: ReadonlyArray<readonly [SafetyCategory, RegExp]> = [
  ['GAS', gi(String.raw`${ASSERTION}\b(?:gas leak|gas odou?r)\b`)],
  ['FIRE_SMOKE', gi(String.raw`${ASSERTION}\b(?:smoke|fire|flames?|burning smell)\b`)],
  ['ELECTRICAL', gi(String.raw`${ASSERTION}\b(?:sparks?|arcing|exposed (?:live )?wires?)\b`)],
  ['REFRIGERANT', gi(String.raw`${ASSERTION}\b(?:refrigerant leak|freon leak)\b`)],
];

// ---------------------------------------------------------------------------
// Public classification API
// ---------------------------------------------------------------------------

function ordered(categories: Iterable<SafetyCategory>): SafetyCategory[] {
  const set = new Set(categories);
  return PRIORITY.filter((category) => set.has(category));
}

export function mergeSafetyCategories(...lists: ReadonlyArray<readonly SafetyCategory[] | undefined>): SafetyCategory[] {
  return ordered(lists.flatMap((list) => list ?? []));
}

// Physical hazards in one USER message. Reports go into `found`. A hazard
// named only inside a general or hypothetical question is not a report; a
// hypothetical gas question still gets the backend gas guidance for that turn
// (`hypotheticalGas`) but is never persisted.
function detectPhysicalHazards(text: string, found: Set<SafetyCategory>, hypotheticalGas?: Set<SafetyCategory>): void {
  const hypothetical = new Set<SafetyCategory>();
  // Hazards cancelled by a negation, kept for a later resumption ("... but
  // now it does").
  const negated = new Set<SafetyCategory>();
  const allSentences = sentencesWithMood(text);
  const answered = allSentences.some(({ sentence }) => HYPOTHETICAL_ANSWERED.test(sentence));
  const report = (category: SafetyCategory, hypotheticalHere: boolean) =>
    (hypotheticalHere ? hypothetical : found).add(category);

  for (const { sentence, question } of allSentences) {
    let negatedList = false;
    // Character ranges of verbless list clauses still governed by an earlier
    // "no" (I1); the gas co-occurrence check ignores terms inside them.
    const negatedRanges: Array<[number, number]> = [];
    for (const { clause, afterComma, start, end } of clausesWithBoundary(sentence)) {
      if (negated.size && RESUMPTION.test(clause) && !hasNegationInside(clause)) {
        for (const category of negated) found.add(category);
      }
      // I1: "There is no smoke, gas smell or sparking" - the verbless list
      // after the comma is still governed by "no".
      if (negatedList && afterComma && isVerblessHazardList(clause)) {
        negatedRanges.push([start, end]);
        continue;
      }
      for (const [category, pattern] of IMMEDIATE_HAZARDS) {
        // "The outlet is not hot", "the plug isn't burnt": a negation inside
        // the phrase cancels it as well.
        const index = firstUnnegatedIndex(pattern, clause, { negationInside: true });
        if (index >= 0) report(category, isHypothetical(clause, index, question));
        else if (new RegExp(pattern.source, 'i').test(clause)) negated.add(category);
      }
      negatedList = endsInNegatedHazardList(clause);
    }
    const gasIndex = gasCooccurrence(sentence, (index) => negatedRanges.some(([from, to]) => index >= from && index < to));
    if (gasIndex >= 0) report('GAS', isHypothetical(sentence, gasIndex, question));
    for (const pattern of WATER_ELECTRICAL_PATTERNS) {
      const index = firstUnnegatedIndex(pattern, sentence, { negationInside: true });
      if (index >= 0) report('WATER_ELECTRICAL', isHypothetical(sentence, index, question));
    }
  }

  // "There's a strange smell in the kitchen. I think it's gas."
  if (!found.has('GAS') && !hypothetical.has('GAS')) {
    const plain = allSentences.map(({ sentence }) => sentence);
    const at = gasAcrossSentences(plain);
    if (at >= 0) report('GAS', allSentences[at]!.question && HYPOTHETICAL_LEAD.test(plain[at]!) && !PRESENT_INDICATOR.test(plain[at]!));
  }

  for (const category of hypothetical) {
    if (answered) found.add(category);
    else if (category === 'GAS') hypotheticalGas?.add(category);
  }
}

// Conditions and requests reported in USER-authored text. A hypothetical gas
// question ("what should I do if I smell gas?") is included so it gets the
// gas guidance, but see detectUserSafetyReport for what may be persisted.
export function detectUserSafetyCategories(texts: readonly string[], options: InstructionOptions = {}): SafetyCategory[] {
  const { categories } = detectUserSafetyReport(texts, options);
  return categories;
}

// `categories` answer this turn; `reported` are the physical hazards the user
// actually reported (never a hazard named only in a general question), which
// are the only ones that may become sticky.
export function detectUserSafetyReport(
  texts: readonly string[],
  options: InstructionOptions = {},
): { categories: SafetyCategory[]; reported: SafetyCategory[] } {
  const found = new Set<SafetyCategory>();
  const hypotheticalGas = new Set<SafetyCategory>();
  const microwave = options.microwave ?? mentionsMicrowave(texts);
  for (const raw of texts) {
    const text = normalizeText(raw);
    detectPhysicalHazards(text, found, hypotheticalGas);
    if (containsUnsafeInstruction([text], 'USER', { microwave })) found.add('UNSAFE_REQUEST');
  }
  return {
    categories: ordered([...found, ...hypotheticalGas]),
    reported: stickySafetyCategories(ordered(found)),
  };
}

// Physical conditions only (no requests, no hypothetical questions), for
// earlier USER turns.
export function detectUserHazardCategories(texts: readonly string[]): SafetyCategory[] {
  const found = new Set<SafetyCategory>();
  for (const raw of texts) detectPhysicalHazards(normalizeText(raw), found);
  return ordered(found);
}

// Assertive hazards and unsafe instructions in model-generated text or in
// steps about to be shown to the user. Texts are checked in order so that a
// restricted subject named in one sentence or step is carried into pronouns
// in the next. In restricted follow-up mode, any instruction about the
// previously requested subject is blocked as well.
export function detectModelSafetyCategories(
  texts: readonly string[],
  options: { restrictedFamilies?: readonly string[]; microwave?: boolean } = {},
): SafetyCategory[] {
  const found = new Set<SafetyCategory>();
  const normalizedTexts = texts.map(normalizeText).filter((text) => text.trim().length > 0);
  if (containsUnsafeInstruction(normalizedTexts, 'MODEL', { microwave: Boolean(options.microwave) })) {
    found.add('UNSAFE_MODEL_INSTRUCTION');
  }
  if (options.restrictedFamilies?.length && instructsRestrictedSubject(normalizedTexts, options.restrictedFamilies)) {
    found.add('UNSAFE_MODEL_INSTRUCTION');
  }
  for (const text of normalizedTexts) {
    for (const clause of clauses(text)) {
      if (SAFE_ASSERTION_CONTEXT.test(clause)) continue;
      for (const [category, pattern] of ESTABLISHED_HAZARDS) {
        // "There is no fire risk here": a negation inside the assertion
        // cancels it.
        if (matchesUnnegated(pattern, clause, { negationInside: true })) found.add(category);
      }
    }
    // "Unplug it from the wall even though the floor around the socket is
    // wet": telling someone to handle a plug next to water is never allowed.
    for (const sentence of sentences(text)) {
      const wet =
        matchesUnnegated(WET_CONDITION, sentence) ||
        WATER_ELECTRICAL_PATTERNS.some((pattern) => matchesUnnegated(pattern, sentence, { negationInside: true }));
      if (wet && containsUnplugInstruction(sentence)) {
        found.add('UNSAFE_MODEL_INSTRUCTION');
        found.add('WATER_ELECTRICAL');
      }
    }
  }
  return ordered(found);
}

function userHistoryTexts(history: ReadonlyArray<{ role: string; content: string }>): string[] {
  return history.filter((message) => message.role === 'USER').map((message) => message.content);
}

// Where the restricted follow-up window comes from (I3). `restrictionUserHistory`
// holds the prior USER turns loaded for this purpose (oldest first); without
// it the USER messages of the bounded conversation history are used.
// `restrictionWindow` is the configured number of user turns, never below
// RESTRICTED_FOLLOW_UP_MIN_USER_TURNS.
export type RestrictionWindowInput = {
  history: ReadonlyArray<{ role: string; content: string }>;
  restrictionUserHistory?: readonly string[] | undefined;
  restrictionWindow?: number | undefined;
};

function restrictionUserTurns(input: RestrictionWindowInput): string[] {
  const turns = input.restrictionUserHistory ?? userHistoryTexts(input.history);
  return turns.slice(-restrictedFollowUpWindow(input.restrictionWindow));
}

// Restricted follow-up subjects for this turn, derived only from the prior
// USER turns inside the restriction window (never persisted).
export function restrictedFollowUpFamiliesFromHistory(input: RestrictionWindowInput): string[] {
  return restrictedFollowUpFamilies(restrictionUserTurns(input), input.restrictionWindow);
}

// Hazards active for this turn. Physical hazards come from persisted context
// and from the current and prior USER turns, so they stay active after
// leaving the bounded history window. A request for dangerous work is refused
// in the turn it is made and is not persisted. While it is still in the
// history window, a follow-up that points back at it ("what tool would I
// need for that?") is refused too. Assistant history and diagnostic facts are
// advisory model hypotheses and are never read here.
type UserSafetyInput = RestrictionWindowInput & {
  userContent: string;
  context: { safety?: { activeCategories: readonly SafetyCategory[] } | undefined };
};

export function assessUserSafety(input: UserSafetyInput): SafetyCategory[] {
  return assessUserSafetyState(input).categories;
}

// `categories` decide this turn. `sticky` is what may be persisted: the
// previously persisted hazards plus hazards the user actually reported in
// this or an earlier turn. A hazard named only in a general question ("Is
// there a risk of shock?", "What should I do if I smell gas?") never becomes
// sticky, so it cannot lock the session.
export function assessUserSafetyState(input: UserSafetyInput): { categories: SafetyCategory[]; sticky: SafetyCategory[] } {
  const restrictionTurns = restrictionUserTurns(input);
  const history = [...userHistoryTexts(input.history), ...restrictionTurns];
  const microwave = mentionsMicrowave([input.userContent, ...history]);
  const families = restrictedFollowUpFamilies(restrictionTurns, input.restrictionWindow);
  const followUp: SafetyCategory[] = isRestrictedFollowUpRequest(normalizeText(input.userContent), families)
    ? ['UNSAFE_REQUEST']
    : [];
  const current = detectUserSafetyReport([input.userContent], { microwave });
  const earlier = detectUserHazardCategories(history);
  return {
    categories: mergeSafetyCategories(input.context.safety?.activeCategories, current.categories, earlier, followUp),
    sticky: stickySafetyCategories(mergeSafetyCategories(input.context.safety?.activeCategories, current.reported, earlier)),
  };
}

// Only physical hazards persist across turns. An unsafe request or a single
// unsafe model draft is handled in its own turn and does not lock the session.
export function stickySafetyCategories(categories: readonly SafetyCategory[]): SafetyCategory[] {
  return ordered(categories.filter((category) => PHYSICAL_HAZARDS.has(category)));
}

// ---------------------------------------------------------------------------
// Backend-written responses
// ---------------------------------------------------------------------------

const GAS_RESPONSE =
  'A gas smell or leak is an emergency. Do not use light switches, appliances or anything that could make a spark. Leave the area, keep others away and, once outside, call your gas supplier\'s emergency line or emergency services.';
const GAS_FIRE_ADDENDUM = 'If there is also smoke or fire, get everyone out and call emergency services immediately.';

const DESCRIPTIONS: Readonly<Partial<Record<SafetyCategory, string>>> = {
  FIRE_SMOKE: 'Smoke, burning smells or overheating can mean a fire risk.',
  ELECTRICAL:
    'Sparks, shocks, damaged or overheating plugs and cords, or exposed wiring are electrical hazards.',
  REFRIGERANT: 'A refrigerant leak needs professional handling.',
  WATER_ELECTRICAL: 'Water near outlets, plugs, cords or electrical parts can cause electric shock.',
  UNVERIFIED_HAZARD:
    'A safety concern was recorded earlier in this conversation and its details could not be verified, so it is still treated as active.',
};

const ADVICE: Readonly<Partial<Record<SafetyCategory, string>>> = {
  FIRE_SMOKE:
    'Keep clear of the appliance and call emergency services if there is any fire or continuing smoke. Do not use the appliance again until it has been inspected.',
  ELECTRICAL: 'Do not touch the appliance, its plug or its wiring, and keep everyone away from it.',
  REFRIGERANT: 'Ventilate the room and avoid contact with any leaking fluid or gas.',
  WATER_ELECTRICAL: 'Do not touch the appliance, the plug or the water, and keep everyone away from the area.',
  UNVERIFIED_HAZARD:
    'Do not continue DIY troubleshooting. If you notice a gas smell, smoke, sparks or water near electrics, leave the area and call emergency services or your gas supplier.',
};

// With any electrical or water hazard the plug itself may be live or wet, so
// isolation is at the circuit breaker, never by unplugging at the wall.
const BREAKER_ISOLATION =
  'If you can reach it without touching the appliance or anything wet, switch off the power to the appliance at the circuit breaker. Do not unplug it at the wall.';
const WALL_ISOLATION = 'If it is safe to do so, switch the appliance off and unplug it at the wall.';

const UNSAFE_REQUEST_RESPONSE =
  'I can\'t guide that work because it involves live electrical parts, gas, refrigerant, safety devices or opening the appliance, which is only safe for a qualified professional.';
const UNSAFE_MODEL_RESPONSE =
  'The next steps for this problem involve electrical, gas, refrigerant or safety-critical work that is not safe to do yourself, so I can\'t provide those instructions.';

const CLOSING = 'Stop and contact a qualified technician rather than attempting a DIY repair.';

// Builds one consistent response for every active category. Category-specific
// guidance is kept, and power isolation is chosen once for the whole set so
// the response never says both "unplug it" and "do not touch the plug".
export function buildSafetyResponse(categories: readonly SafetyCategory[]): string {
  const active = new Set(ordered(categories));
  const parts: string[] = [];

  if (active.has('GAS')) {
    // Any switch, plug or breaker can spark near gas: no isolation advice.
    parts.push(GAS_RESPONSE);
    if (active.has('FIRE_SMOKE')) parts.push(GAS_FIRE_ADDENDUM);
    if (active.has('UNVERIFIED_HAZARD')) parts.push(DESCRIPTIONS.UNVERIFIED_HAZARD!);
  } else {
    const physical = PRIORITY.filter((category) => active.has(category) && DESCRIPTIONS[category]);
    parts.push(...physical.map((category) => DESCRIPTIONS[category]!));
    if (active.has('ELECTRICAL') || active.has('WATER_ELECTRICAL')) parts.push(BREAKER_ISOLATION);
    else if (active.has('FIRE_SMOKE') || active.has('REFRIGERANT')) parts.push(WALL_ISOLATION);
    // The water advice already says not to touch the appliance or plug.
    const advice = active.has('WATER_ELECTRICAL') ? physical.filter((category) => category !== 'ELECTRICAL') : physical;
    parts.push(...advice.map((category) => ADVICE[category]!));
  }

  if (active.has('UNSAFE_REQUEST')) parts.push(UNSAFE_REQUEST_RESPONSE);
  if (active.has('UNSAFE_MODEL_INSTRUCTION') || parts.length === 0) parts.push(UNSAFE_MODEL_RESPONSE);
  parts.push(CLOSING);
  return parts.join(' ');
}

// Replacement guidance when wet conditions make touching the plug unsafe.
export const WET_ISOLATION_NOTE =
  'Because there is water around the appliance, do not touch the plug, socket or cord. If you need to cut the power, switch it off at the circuit breaker, and only if you can reach it without standing in or touching water.';
